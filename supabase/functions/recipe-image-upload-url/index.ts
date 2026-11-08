import { type AuthDeps, authenticateRequest } from "../_shared/auth.ts";
import {
  getCorsHeaders,
  handleCorsPreflight,
  jsonResponse,
} from "../_shared/cors.ts";
import { RecipeImageUploadRequestSchema } from "../_shared/recipe-images/schemas.ts";
import {
  checkRecipeImageStaging,
  deleteRecipeImageStaging,
  putRecipeImageStaging,
  type R2Config,
  resolveR2Config,
} from "../_shared/recipe-images/r2.ts";
import {
  createUploadIntent,
  persistUploadIntent,
} from "../_shared/recipe-images/uploadIntents.ts";

const ALLOWED_METHODS = "POST, PUT, OPTIONS";
const MAX_RECIPE_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_FINISH_MARGIN_MS = 30_000;

export type UploadHandlerDeps = AuthDeps & {
  r2Config?: R2Config;
  supabaseServiceRoleKey?: string;
  now?: () => Date;
  putUpload?: typeof putRecipeImageStaging;
  checkUpload?: typeof checkRecipeImageStaging;
  deleteUpload?: typeof deleteRecipeImageStaging;
};

type StoredUploadIntent = {
  id: string;
  user_id: string;
  recipe_id: string;
  staging_key: string;
  final_key: string;
  content_type: string;
  byte_size: number;
  created_at: string;
  expires_at: string;
  state: string;
  cleanup_status: string;
};

class UploadInputError extends Error {}

function respond(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(body, {
    status,
    headers: { ...getCorsHeaders(ALLOWED_METHODS), ...headers },
  });
}

function error(code: string, message: string, status: number): Response {
  return respond({ error: { code, message } }, status);
}

function validUploadId(value: string | null): value is string {
  return value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value);
}

async function readBoundedBody(
  req: Request,
  expectedSize: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!req.body) throw new UploadInputError("Missing upload body.");
  const reader = req.body.getReader();
  let body: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        total + value.byteLength > MAX_RECIPE_IMAGE_BYTES ||
        total + value.byteLength > expectedSize
      ) {
        await reader.cancel();
        throw new UploadInputError("Upload exceeds its declared size.");
      }
      const needed = total + value.byteLength;
      if (needed > body.byteLength) {
        const capacity = Math.min(
          expectedSize,
          Math.max(needed, body.byteLength * 2),
        );
        const expanded = new Uint8Array(capacity);
        expanded.set(body);
        body = expanded;
      }
      body.set(value, total);
      total += value.byteLength;
    }
  } catch (cause) {
    if (cause instanceof UploadInputError) throw cause;
    throw new UploadInputError("Upload body could not be read.");
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedSize) {
    throw new UploadInputError("Upload size does not match its intent.");
  }
  return body;
}

async function loadStoredIntent(
  id: string,
  userId: string,
  deps: UploadHandlerDeps,
): Promise<StoredUploadIntent | null> {
  const base = deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const serviceKey = deps.supabaseServiceRoleKey ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base?.trim() || !serviceKey?.trim()) {
    throw new Error("Missing upload intent configuration.");
  }
  const url = new URL("/rest/v1/recipe_image_upload_intents", base);
  url.searchParams.set(
    "select",
    "id,user_id,recipe_id,staging_key,final_key,content_type,byte_size,created_at,expires_at,state,cleanup_status",
  );
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  const response = await (deps.fetch ?? fetch)(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Upload intent lookup failed.");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0] as Partial<StoredUploadIntent>;
  if (
    row.id !== id || row.user_id !== userId ||
    typeof row.recipe_id !== "string" ||
    row.staging_key !==
      `recipe-images/staging/${userId}/${row.recipe_id}/${id}` ||
    typeof row.final_key !== "string" ||
    typeof row.content_type !== "string" ||
    typeof row.byte_size !== "number" ||
    typeof row.created_at !== "string" ||
    typeof row.expires_at !== "string" ||
    typeof row.state !== "string" ||
    typeof row.cleanup_status !== "string"
  ) return null;
  const createdAt = Date.parse(row.created_at);
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(createdAt) || expiresAt - createdAt !== 600_000) {
    return null;
  }
  return {
    ...row as StoredUploadIntent,
    created_at: new Date(createdAt).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
  };
}

function intentIsUploadable(intent: StoredUploadIntent, now: Date): boolean {
  const expiry = Date.parse(intent.expires_at);
  return intent.state === "pending" && intent.cleanup_status === "waiting" &&
    Number.isFinite(expiry) && expiry - now.getTime() > UPLOAD_FINISH_MARGIN_MS;
}

function intentCanRetainObject(intent: StoredUploadIntent, now: Date): boolean {
  const expiry = Date.parse(intent.expires_at);
  return intent.cleanup_status === "waiting" &&
    ((intent.state === "pending" && Number.isFinite(expiry) &&
      expiry > now.getTime()) ||
      intent.state === "finalizing" || intent.state === "attached");
}

async function uploadReservation(
  operation: "claim" | "release",
  uploadId: string,
  userId: string,
  token: string,
  deps: UploadHandlerDeps,
): Promise<boolean> {
  const base = deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const key = deps.supabaseServiceRoleKey ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base?.trim() || !key?.trim()) {
    throw new Error("Missing upload configuration.");
  }
  const response = await (deps.fetch ?? fetch)(
    new URL(`/rest/v1/rpc/${operation}_recipe_image_upload_reservation`, base),
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_id: uploadId,
        p_user_id: userId,
        p_token: token,
      }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error("Upload reservation operation failed.");
  const result: unknown = await response.json();
  if (typeof result !== "boolean") {
    throw new Error("Invalid upload reservation result.");
  }
  if (operation === "release" && !result) {
    throw new Error("Upload reservation release failed.");
  }
  return result;
}

async function uploadBody(
  req: Request,
  uploadId: string,
  userId: string,
  deps: UploadHandlerDeps,
): Promise<Response> {
  const url = new URL(req.url);
  if (
    url.hash !== "" || url.searchParams.size !== 1 ||
    url.searchParams.getAll("upload_id").length !== 1 ||
    url.searchParams.get("upload_id") !== uploadId
  ) return error("VALIDATION_ERROR", "Invalid upload request.", 400);

  const contentType = req.headers.get("Content-Type");
  const contentLength = req.headers.get("Content-Length");
  if (
    !contentType || req.headers.get("Content-Encoding") !== null ||
    req.headers.get("Content-Range") !== null ||
    (contentLength !== null && !/^\d+$/.test(contentLength))
  ) return error("VALIDATION_ERROR", "Invalid upload request.", 400);

  const intent = await loadStoredIntent(uploadId, userId, deps);
  if (!intent) return error("UPLOAD_NOT_FOUND", "Upload not found.", 404);
  if (!intentIsUploadable(intent, deps.now?.() ?? new Date())) {
    return error("UPLOAD_EXPIRED", "Upload is no longer available.", 410);
  }
  if (
    contentType !== intent.content_type ||
    !Number.isInteger(intent.byte_size) || intent.byte_size < 1 ||
    intent.byte_size > MAX_RECIPE_IMAGE_BYTES ||
    (contentLength !== null && Number(contentLength) !== intent.byte_size)
  ) return error("VALIDATION_ERROR", "Invalid upload request.", 400);

  const token = crypto.randomUUID();
  if (!await uploadReservation("claim", uploadId, userId, token, deps)) {
    return error(
      "UPLOAD_IN_PROGRESS",
      "Upload is already being processed.",
      409,
    );
  }
  try {
    const config = resolveR2Config(deps.r2Config);
    const existing = await (deps.checkUpload ?? checkRecipeImageStaging)(
      intent.staging_key,
      config,
      deps.fetch ?? fetch,
    );
    if (existing === "exists") {
      return error(
        "UPLOAD_ALREADY_USED",
        "Upload has already been received.",
        409,
      );
    }
    if (existing !== "missing") {
      return error(
        "STORAGE_UNAVAILABLE",
        "Image storage is temporarily unavailable.",
        503,
      );
    }

    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await readBoundedBody(req, intent.byte_size);
    } catch (cause) {
      if (cause instanceof UploadInputError) {
        return error(
          "VALIDATION_ERROR",
          "Upload size does not match its intent.",
          400,
        );
      }
      throw cause;
    }

    const currentBeforePut = await loadStoredIntent(uploadId, userId, deps);
    if (
      !currentBeforePut ||
      !intentIsUploadable(currentBeforePut, deps.now?.() ?? new Date())
    ) {
      return error("UPLOAD_EXPIRED", "Upload is no longer available.", 410);
    }

    const put = await (deps.putUpload ?? putRecipeImageStaging)(
      {
        recipe_id: currentBeforePut.recipe_id,
        content_type: currentBeforePut.content_type as
          | "image/jpeg"
          | "image/png"
          | "image/webp",
        byte_size: currentBeforePut.byte_size,
        id: currentBeforePut.id,
        user_id: currentBeforePut.user_id,
        staging_key: currentBeforePut.staging_key,
        final_key: currentBeforePut.final_key,
        created_at: currentBeforePut.created_at,
        expires_at: currentBeforePut.expires_at,
        state: "pending",
      },
      config,
      body,
      deps.fetch ?? fetch,
      deps.now?.() ?? new Date(),
    );
    if (put === "already_exists") {
      return error(
        "UPLOAD_ALREADY_USED",
        "Upload has already been received.",
        409,
      );
    }
    if (put !== "stored") {
      return error(
        "STORAGE_UNAVAILABLE",
        "Image storage is temporarily unavailable.",
        503,
      );
    }

    const current = await loadStoredIntent(uploadId, userId, deps);
    if (
      !current || !intentCanRetainObject(current, deps.now?.() ?? new Date())
    ) {
      await (deps.deleteUpload ?? deleteRecipeImageStaging)(
        currentBeforePut.staging_key,
        config,
        deps.fetch ?? fetch,
      );
      return error("UPLOAD_EXPIRED", "Upload is no longer available.", 410);
    }
    return respond({ upload: { id: uploadId, received: true } }, 201);
  } finally {
    try {
      await uploadReservation("release", uploadId, userId, token, deps);
    } catch {
      console.error("Recipe image upload reservation release failed");
    }
  }
}

export async function handler(
  req: Request,
  deps: UploadHandlerDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCorsPreflight(ALLOWED_METHODS);
  if (req.method !== "POST" && req.method !== "PUT") {
    return respond(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only POST, PUT and OPTIONS methods are supported.",
        },
      },
      405,
      { Allow: ALLOWED_METHODS },
    );
  }
  try {
    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      if (auth.response.status === 401) {
        return error(
          "UNAUTHORIZED",
          "Missing or invalid authentication credentials.",
          401,
        );
      }
      const headers = new Headers(auth.response.headers);
      Object.entries(getCorsHeaders(ALLOWED_METHODS)).forEach(([key, value]) =>
        headers.set(key, value)
      );
      return new Response(auth.response.body, {
        status: auth.response.status,
        headers,
      });
    }
    if (req.method === "PUT") {
      const uploadId = new URL(req.url).searchParams.get("upload_id");
      if (!validUploadId(uploadId)) {
        return error("VALIDATION_ERROR", "Invalid upload request.", 400);
      }
      return await uploadBody(
        req,
        uploadId.toLowerCase(),
        auth.context.user.id,
        deps,
      );
    }
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return error(
        "INVALID_JSON",
        "Request body must be a valid JSON object.",
        400,
      );
    }
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      return error(
        "INVALID_JSON",
        "Request body must be a valid JSON object.",
        400,
      );
    }
    const validation = RecipeImageUploadRequestSchema.safeParse(parsed);
    if (!validation.success || new URL(req.url).search !== "") {
      return error("VALIDATION_ERROR", "Invalid recipe image request.", 400);
    }
    const { user, supabase } = auth.context;
    const request = {
      ...validation.data,
      recipe_id: validation.data.recipe_id.toLowerCase(),
    };
    const { data, error: queryError } = await supabase.from("recipes")
      .select("id, user_id")
      .eq("id", request.recipe_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (queryError) throw new Error("Recipe ownership lookup failed.");
    if (!data || data.id !== request.recipe_id || data.user_id !== user.id) {
      return error("RECIPE_NOT_FOUND", "Recipe not found.", 404);
    }
    resolveR2Config(deps.r2Config);
    const intent = createUploadIntent(request, user.id, deps.now?.());
    const quota = await persistUploadIntent(intent, deps);
    if (quota === "rate_limited") {
      return error(
        "UPLOAD_RATE_LIMITED",
        "Upload signing limit reached. Please try again later.",
        429,
      );
    }
    if (quota === "pending_limit") {
      return error(
        "UPLOAD_QUOTA_EXCEEDED",
        "Too many image uploads are pending. Please try again later.",
        429,
      );
    }
    const uploadUrl = new URL(
      "/functions/v1/recipe-image-upload-url",
      deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL"),
    );
    uploadUrl.searchParams.set("upload_id", intent.id);
    return respond({
      upload: {
        id: intent.id,
        url: uploadUrl.toString(),
        method: "PUT",
        headers: { "Content-Type": intent.content_type },
        expires_at: intent.expires_at,
      },
    }, 200);
  } catch {
    console.error("Recipe image upload signing failed");
    return error("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
