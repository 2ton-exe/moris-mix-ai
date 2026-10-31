import { authenticateRequest, type AuthContext, type AuthDeps } from "../_shared/auth.ts";
import { handleCorsPreflight } from "../_shared/cors.ts";
import type { AIProvider, GenerateRecipeInput } from "../_shared/ai/AIProvider.ts";
import { AIError, GeminiAdapter } from "../_shared/ai/GeminiAdapter.ts";
import { createFailureDrillProvider } from "../_shared/ai/drills.ts";
import {
  AI_ALLOWED_METHODS,
  AI_MAX_REQUEST_BYTES,
  type AIEndpointErrorCode,
  aiErrorResponse,
  aiJsonResponse,
  isEnvEnabled,
  isPlainObject,
  mapAiError,
  normalizeQuotaRetryAfterSeconds,
  readBodyWithinByteLimit,
  withAiCorsMethods,
} from "../_shared/ai/http.ts";
import { consumeDailyQuota, type QuotaCheck } from "../_shared/ai/quota.ts";
import { buildChefRecipeContext } from "../_shared/ai/recipeContext.ts";
import {
  GenerateRecipeRequestSchema,
  GenerateRecipeResponseSchema,
  GeneratedRecipeSchema,
  type ChefRecipeContextResult,
  type GenerateRecipeResponse,
  type SuggestedParent,
} from "../_shared/ai/schemas.ts";

export type GenerateRecipeDeps = AuthDeps & {
  supabaseServiceRoleKey?: string;
  provider?: AIProvider;
  quotaCheck?: QuotaCheck;
  buildContext?: (
    auth: AuthContext,
    input: GenerateRecipeInput,
  ) => Promise<ChefRecipeContextResult>;
};

const ALLOWED_METHODS = AI_ALLOWED_METHODS;
export const MAX_REQUEST_BYTES = AI_MAX_REQUEST_BYTES;

export const GENERATE_ENABLED_ENV = "AI_GENERATE_ENABLED";
export const GENERATE_DISABLED_ENV = "AI_GENERATE_DISABLED";

export type GenerateRecipeErrorCode = AIEndpointErrorCode;

function generateJsonResponse(body: unknown, init?: ResponseInit): Response {
  return aiJsonResponse(body, init, ALLOWED_METHODS);
}

function errorResponse(
  code: AIEndpointErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return aiErrorResponse(code, message, status, extraHeaders, ALLOWED_METHODS);
}

function resolveProvider(deps: GenerateRecipeDeps): AIProvider {
  return deps.provider ?? createFailureDrillProvider("generate") ?? new GeminiAdapter();
}

function resolveParents(
  parentRecipeIds: string[],
  context: ChefRecipeContextResult,
): SuggestedParent[] {
  const candidates = new Map(context.recipes.map((recipe) => [recipe.id, recipe]));
  const parents: SuggestedParent[] = [];
  const seen = new Set<string>();

  for (const id of parentRecipeIds) {
    if (seen.has(id)) continue;
    const candidate = candidates.get(id);
    if (!candidate) {
      throw new AIError(
        "invalid_output",
        "generate",
        "Generation proposed a parent recipe outside the supplied candidates.",
        "parentRecipeIds",
      );
    }
    seen.add(id);
    parents.push({
      id: candidate.id,
      title: candidate.title,
      star_rating: candidate.star_rating,
    });
  }

  return parents;
}

export async function handler(
  req: Request,
  deps: GenerateRecipeDeps = {},
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const isTargetRoute = url.pathname === "/functions/v1/generate-recipe" ||
      url.pathname === "/generate-recipe";

    if (!isTargetRoute) {
      return errorResponse("NOT_FOUND", "Route not found.", 404);
    }

    if (req.method === "OPTIONS") {
      return handleCorsPreflight(ALLOWED_METHODS);
    }

    if (req.method !== "POST") {
      return errorResponse(
        "METHOD_NOT_ALLOWED",
        "Only POST and OPTIONS methods are supported.",
        405,
        { Allow: ALLOWED_METHODS },
      );
    }

    const auth = await authenticateRequest(req, deps);
    if (!auth.ok) {
      return withAiCorsMethods(auth.response, ALLOWED_METHODS);
    }

    const { user, supabase } = auth.context;

    if (!isEnvEnabled(GENERATE_ENABLED_ENV) || isEnvEnabled(GENERATE_DISABLED_ENV)) {
      return errorResponse(
        "AI_DISABLED",
        "AI recipe generation is temporarily disabled.",
        503,
      );
    }

    const declaredLength = req.headers.get("content-length");
    if (declaredLength !== null) {
      const declaredBytes = Number(declaredLength);
      if (Number.isSafeInteger(declaredBytes) && declaredBytes > MAX_REQUEST_BYTES) {
        return errorResponse(
          "INPUT_TOO_LARGE",
          `Request body must be at most ${MAX_REQUEST_BYTES} bytes.`,
          413,
        );
      }
    }

    const read = await readBodyWithinByteLimit(req, MAX_REQUEST_BYTES);
    if (!read.ok) {
      if (read.reason === "too_large") {
        return errorResponse(
          "INPUT_TOO_LARGE",
          `Request body must be at most ${MAX_REQUEST_BYTES} bytes.`,
          413,
        );
      }
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    const rawBody = read.text;
    if (!rawBody || rawBody.trim().length === 0) {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    if (!isPlainObject(parsedBody)) {
      return errorResponse("INVALID_JSON", "Request body must be a valid JSON object.", 400);
    }

    const validation = GenerateRecipeRequestSchema.safeParse(parsedBody);
    if (!validation.success) {
      const details = validation.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      }));
      return generateJsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request payload.",
            details,
          },
        },
        { status: 400 },
      );
    }

    const input: GenerateRecipeInput = {
      pantryItems: validation.data.pantryItems,
      ...(validation.data.preferences === undefined
        ? {}
        : { preferences: validation.data.preferences }),
    };

    const quota = await (deps.quotaCheck ?? consumeDailyQuota)(user.id, supabase, {
      supabaseUrl: deps.supabaseUrl,
      supabaseServiceRoleKey: deps.supabaseServiceRoleKey,
      fetch: deps.fetch,
    });
    if (quota.status === "unavailable") {
      return errorResponse(
        "QUOTA_UNAVAILABLE",
        "Could not verify AI usage limits. Please try again shortly.",
        503,
      );
    }
    if (quota.status === "exceeded") {
      return errorResponse(
        "QUOTA_EXCEEDED",
        "Daily AI usage limit reached. Please try again after the quota resets.",
        429,
        { "Retry-After": String(normalizeQuotaRetryAfterSeconds(quota.retryAfterSeconds)) },
      );
    }

    try {
      const context = await (deps.buildContext ?? buildChefRecipeContext)(
        auth.context,
        input,
      );

      const provider = resolveProvider(deps);
      const generated = await provider.generateRecipe(input, context);

      const revalidated = GeneratedRecipeSchema.safeParse(generated);
      if (!revalidated.success) {
        throw new AIError("invalid_output", "generate", "Generation failed schema validation.");
      }

      const response: GenerateRecipeResponse = {
        recipe: revalidated.data.recipe,
        substitutions: revalidated.data.substitutions,
        parents: resolveParents(revalidated.data.parentRecipeIds, context),
        context: {
          status: context.status,
          matchedCandidateCount: context.matchedCandidateCount,
          totalCandidateCount: context.totalCandidateCount,
        },
      };

      const responseValidation = GenerateRecipeResponseSchema.safeParse(response);
      if (!responseValidation.success) {
        throw new AIError("invalid_output", "generate", "Generation failed response validation.");
      }

      try {
        await quota.confirm?.();
      } catch (confirmError) {
        console.error("Quota confirmation failed", confirmError);
      }

      return generateJsonResponse(responseValidation.data, { status: 200 });
    } catch (opError) {
      try {
        await quota.rollback?.();
      } catch (rollbackError) {
        console.error("Quota rollback failed", rollbackError);
      }
      throw opError;
    }
  } catch (error) {
    if (error instanceof AIError) {
      return mapAiError(error, ALLOWED_METHODS);
    }

    console.error("Unhandled exception in generate-recipe handler");
    return errorResponse("INTERNAL_ERROR", "Internal server error.", 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handler(req));
}
