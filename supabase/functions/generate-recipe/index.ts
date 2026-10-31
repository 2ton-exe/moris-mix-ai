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
import { checkDailyQuota, type QuotaCheck } from "../_shared/ai/quota.ts";
import { buildChefRecipeContext } from "../_shared/ai/recipeContext.ts";
import {
  resolveCandidateTokenSecret,
  signCandidateToken,
} from "../_shared/ai/candidateToken.ts";
import {
  GenerateRecipeRequestSchema,
  GenerateRecipeResponseSchema,
  GeneratedRecipeSchema,
  type ChefRecipeContextResult,
  type GenerateRecipeResponse,
  type SuggestedParent,
} from "../_shared/ai/schemas.ts";

export type GenerateRecipeDeps = AuthDeps & {
  /** Injected provider (tests/dev). Production builds the real Gemini adapter. */
  provider?: AIProvider;
  /** Injected quota boundary (tests); production reads `ai_usage_daily`. */
  quotaCheck?: QuotaCheck;
  /** Injected retrieval boundary (tests); production reads the caller's recipes. */
  buildContext?: (
    auth: AuthContext,
    input: GenerateRecipeInput,
  ) => Promise<ChefRecipeContextResult>;
  /** Override for tests/DI; production reads `AI_CANDIDATE_TOKEN_SECRET`. */
  candidateTokenSecret?: string;
};

const ALLOWED_METHODS = AI_ALLOWED_METHODS;
/** Reject bodies larger than this before parsing. The request caps fit comfortably. */
export const MAX_REQUEST_BYTES = AI_MAX_REQUEST_BYTES;

/** Operator opt-in while BE-12 atomic quota accounting is pending. Defaults off. */
export const GENERATE_ENABLED_ENV = "AI_GENERATE_ENABLED";

/**
 * Operator kill switch. When truthy, generation is refused before the quota
 * read or the provider call, so an operator can stop spend/abuse immediately
 * without a deploy (see the quota note in `_shared/ai/quota.ts`).
 */
export const GENERATE_DISABLED_ENV = "AI_GENERATE_DISABLED";

export type GenerateRecipeErrorCode = AIEndpointErrorCode;

/** JSON response that advertises this route's allowed methods. */
function generateJsonResponse(body: unknown, init?: ResponseInit): Response {
  return aiJsonResponse(body, init, ALLOWED_METHODS);
}

/** Shared error envelope bound to this route's allowed methods. */
function errorResponse(
  code: AIEndpointErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return aiErrorResponse(code, message, status, extraHeaders, ALLOWED_METHODS);
}

/** Injected provider wins (tests/dev); otherwise honor the drill; otherwise the real adapter. */
function resolveProvider(deps: GenerateRecipeDeps): AIProvider {
  return deps.provider ?? createFailureDrillProvider("generate") ?? new GeminiAdapter();
}

/**
 * Resolves the model's parent IDs into display summaries (FE-10).
 *
 * The provider already rejected IDs outside the candidate set, but the endpoint
 * re-checks because AI-10 treats every provider as untrusted. A missing ID is a
 * hard failure, never a silent drop, so a hallucinated or foreign parent can
 * never reach the client. Duplicate IDs collapse to one parent while keeping
 * model order.
 */
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

/**
 * Authenticates generation requests, checks the operator opt-in, input limits
 * and quota, retrieves the caller's own ranked recipes, then returns a
 * validated but unsaved preview. No recipe, lineage or usage row is written
 * here; saving is an explicit later action.
 */
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

    // Keep generation off until an operator opts in while atomic accounting is
    // pending. The kill switch takes precedence, even when generation is
    // explicitly enabled.
    if (!isEnvEnabled(GENERATE_ENABLED_ENV) || isEnvEnabled(GENERATE_DISABLED_ENV)) {
      return errorResponse(
        "AI_DISABLED",
        "AI recipe generation is temporarily disabled.",
        503,
      );
    }

    // Cheap pre-check first: reject an obviously oversized body (when the client
    // declares a length) before reading it at all.
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

    // Authoritative check: a declared length can be absent or lie, so the byte
    // budget is enforced while streaming the body.
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

    // AI-07: without a signing secret the endpoint cannot issue the token the
    // save path requires, so refuse before spending quota or provider calls.
    let candidateTokenSecret: string;
    try {
      candidateTokenSecret = resolveCandidateTokenSecret(deps.candidateTokenSecret);
    } catch {
      console.error("AI_CANDIDATE_TOKEN_SECRET is missing or too short; refusing generation.");
      return errorResponse("INTERNAL_ERROR", "Internal server error.", 500);
    }

    // AI-17: check the per-user daily quota before retrieval and the provider call.
    const quota = await (deps.quotaCheck ?? checkDailyQuota)(user.id, supabase);
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

    // BE-10: retrieve only the caller's own recipes and rank them against this
    // pantry. Cold start is a normal status here, not an error.
    const context = await (deps.buildContext ?? buildChefRecipeContext)(
      auth.context,
      input,
    );

    const provider = resolveProvider(deps);
    const generated = await provider.generateRecipe(input, context);

    // AI-10: never trust the provider, even one that claims to validate. The
    // endpoint re-validates so malformed data can never reach the frontend.
    const revalidated = GeneratedRecipeSchema.safeParse(generated);
    if (!revalidated.success) {
      throw new AIError("invalid_output", "generate", "Generation failed schema validation.");
    }

    const parents = resolveParents(revalidated.data.parentRecipeIds, context);
    // AI-07: the token lists exactly the parents shown in this preview; the
    // user may save a subset later, but never anything outside it.
    const candidateToken = parents.length === 0
      ? null
      : await signCandidateToken({
        userId: user.id,
        parentRecipeIds: parents.map((parent) => parent.id),
        secret: candidateTokenSecret,
      });

    const response: GenerateRecipeResponse = {
      recipe: revalidated.data.recipe,
      substitutions: revalidated.data.substitutions,
      parents,
      candidate_token: candidateToken,
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

    // AI-06: return the validated preview only. Nothing is persisted here.
    return generateJsonResponse(responseValidation.data, { status: 200 });
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
