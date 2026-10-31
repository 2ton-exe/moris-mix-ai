import {
  GoogleGenerativeAI,
  GoogleGenerativeAIError,
  GoogleGenerativeAIResponseError,
} from "npm:@google/generative-ai@0.21.0";
import type {
  AIProvider,
  ExtractRecipeInput,
  ExtractedRecipe,
  GenerateRecipeContext,
  GenerateRecipeInput,
  GeneratedRecipe,
} from "./AIProvider.ts";
import {
  CHEF_PROMPT,
  EXTRACTION_PROMPT,
  type PromptTemplate,
  buildChefPrompt,
  buildExtractionPrompt,
} from "./prompts.ts";
import { ExtractedRecipeSchema, GeneratedRecipeSchema } from "./schemas.ts";

/**
 * Pinned extraction model as of Sprint 3. AI_MODEL overrides it, so a model
 * retirement never needs a code change (AI-03).
 *
 * Why the lite model rather than gemini-3.6-flash: on the free tier the 3.6
 * model returned 503 "high demand" on roughly one call in three and hit a
 * per-minute 429 under back-to-back evaluation runs. The pinned 3.5 Flash-Lite
 * passed the six-case evaluation set 6/6 and the live extraction suite 3/3
 * with no provider errors. A stable model gives a reproducible benchmark;
 * a faster model that fails a third of the time does not.
 *
 * The version is pinned on purpose. `gemini-flash-lite-latest` resolves to
 * 3.5 Flash-Lite today, but an alias can move and silently change what the
 * evaluation measured.
 */
/**
 * Finish reasons that mean the provider blocked the content rather than
 * returned malformed output. The pinned SDK's own list is a subset; the API
 * can return newer reasons that its enum does not know about yet.
 */
const BLOCKED_FINISH_REASONS: ReadonlySet<string> = new Set([
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "ESCALATION",
  "PUP_LIMITED_DISABLED",
]);

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 30_000;
/** One attempt plus one bounded retry (AI-18). */
const MAX_ATTEMPTS = 2;

/** Maximum time spent waiting for the single retry, separate from request timeouts. */
const MAX_RETRY_DELAY_MS = 5_000;

/** Honor provider cooldowns; never shorten an excessive delay to fit our budget. */
function retryDelayMs(error: unknown): number | undefined {
  const providerDelay = readProviderRetryDelayMs(error);
  if (providerDelay !== undefined) {
    return providerDelay <= MAX_RETRY_DELAY_MS ? providerDelay : undefined;
  }
  return 250 + Math.floor(Math.random() * 250);
}

/**
 * The pinned SDK drops response headers but preserves google.rpc.RetryInfo in
 * errorDetails. Its retryDelay uses protobuf's nonnegative seconds string with
 * up to nine fractional digits. Ignore malformed metadata; use the longest
 * valid delay when more than one entry is supplied. An overflowing duration is
 * still excessive, so it must not fall back to an immediate jittered retry.
 */
function readProviderRetryDelayMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const details = (error as { errorDetails?: unknown }).errorDetails;
  if (!Array.isArray(details)) return undefined;

  let delayMs: number | undefined;
  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) continue;
    if (detail["@type"] !== "type.googleapis.com/google.rpc.RetryInfo") continue;
    const duration: unknown = detail.retryDelay;
    if (typeof duration !== "string" || !/^\d+(?:\.\d{1,9})?s$/.test(duration)) continue;
    const milliseconds = Math.ceil(Number(duration.slice(0, -1)) * 1000);
    delayMs = Math.max(delayMs ?? 0, milliseconds);
  }
  return delayMs;
}

/**
 * Converts a provider cooldown to the whole seconds a client `Retry-After`
 * needs. Clamped to [1, 3600] so an absent or overflowing delay can never emit
 * a `Retry-After: 0`/`Infinity` header.
 */
function retryAfterSecondsFromMs(delayMs: number | undefined): number | undefined {
  if (delayMs === undefined || Number.isNaN(delayMs)) return undefined;
  if (!Number.isFinite(delayMs)) return 3600;
  return Math.min(3600, Math.max(1, Math.ceil(delayMs / 1000)));
}

/** Stable failure codes that the AI-05 endpoint maps to HTTP statuses. */
export type AIErrorCode =
  | "invalid_output"
  | "internal_error"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable"
  | "rate_limited";

/**
 * Typed AI failure. `code` is stable so callers (the AI-05 endpoint) can map it
 * to an HTTP status without parsing messages. Messages are user-safe: they
 * never contain prompt text or recipe text.
 */
export type AIAttempt = {
  readonly code: AIErrorCode;
  readonly nonConsuming: boolean;
};

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly operation: "extract" | "generate";
  /** True only for failures a second identical call could plausibly fix. */
  readonly retryable: boolean;
  /** Metadata only, for example the schema paths that failed. Never values. */
  readonly detail?: string;
  /**
   * Provider-requested cooldown in whole seconds, when the provider told us one
   * (a `429` with `google.rpc.RetryInfo`). The AI-05 endpoint forwards this as
   * the client `Retry-After`. Undefined when the provider gave no usable delay.
   */
  readonly retryAfterSeconds?: number;
  readonly nonConsuming: boolean;
  readonly attempts: readonly AIAttempt[];

  /** Records safe failure metadata and derives retryability from the stable error code. */
  constructor(
    code: AIErrorCode,
    operation: "extract" | "generate",
    message: string,
    detail?: string,
    retryAfterSeconds?: number,
    nonConsuming?: boolean,
    attempts?: readonly AIAttempt[],
  ) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.operation = operation;
    // Retry only what the spec allows: 429, 5xx, timeouts and network errors.
    // A permanent 4xx (bad key, wrong model, malformed request) is classified
    // as provider_rejected and must fail fast instead of burning a second call.
    this.retryable = code === "provider_timeout" ||
      code === "provider_unavailable" ||
      code === "rate_limited";
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
    this.nonConsuming = nonConsuming ??
      (code === "rate_limited" || code === "provider_rejected");
    this.attempts = attempts ?? [{ code, nonConsuming: this.nonConsuming }];
  }
}

/** Metadata-only log entry (AI-20). Never carries prompts or recipe text. */
export type AIOperationLog = {
  op: "extract" | "generate";
  model: string;
  promptId: string;
  promptVersion: string;
  attempt: number;
  latencyMs: number;
  outcome: "success" | AIErrorCode;
  detail?: string;
};

/** Test seam: replaces the real Gemini call. */
export type GenerateText = (prompt: string) => Promise<string>;

/** Adapter options. Production reads env vars; tests inject a generator. */
export type GeminiAdapterConfig = {
  apiKey?: string;
  modelName?: string;
  timeoutMs?: number;
  generateText?: GenerateText;
  /**
   * Test seam: replaces the SDK client so tests can exercise the real
   * `callModel` (`generateContent` then `response.text()`) path without a key.
   */
  client?: GoogleGenerativeAI;
  log?: (entry: AIOperationLog) => void;
  /** Test seam for the backoff, so retry tests do not sleep for real. */
  sleep?: (ms: number) => Promise<void>;
};

/** Builds the real SDK client, requiring a key only when none is injected. */
function createGeminiClient(apiKey: string | undefined): GoogleGenerativeAI {
  const resolvedKey = apiKey ?? Deno.env.get("GEMINI_API_KEY");
  if (!resolvedKey) throw new Error("GEMINI_API_KEY is missing.");
  return new GoogleGenerativeAI(resolvedKey);
}

/**
 * Gemini-backed `AIProvider`.
 *
 * Both operations share one bounded-retry loop and one metadata-only log shape;
 * tests inject a generator so they never touch the network, and a log sink so
 * they can assert the metadata that gets recorded.
 */
export class GeminiAdapter implements AIProvider {
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly generateText: GenerateText;
  private readonly log: (entry: AIOperationLog) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly client?: GoogleGenerativeAI;

  /**
   * Builds the adapter. An explicit `config.modelName` wins, then a non-blank
   * `AI_MODEL`, then the pinned default. The `trim` matters: a dashboard that
   * saves `AI_MODEL=""` or whitespace would otherwise build the invalid model
   * path `models/`, which looks like a provider outage after the retry.
   */
  constructor(config: GeminiAdapterConfig = {}) {
    this.modelName = config.modelName ??
      (Deno.env.get("AI_MODEL")?.trim() || DEFAULT_MODEL);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log = config.log ?? ((entry) => console.log(JSON.stringify(entry)));
    this.sleep = config.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    if (config.generateText) {
      this.generateText = config.generateText;
      return;
    }

    const client = config.client ?? createGeminiClient(config.apiKey);
    this.client = client;
    this.generateText = (prompt) => this.callModel(client, prompt);
  }

  /**
   * Extracts a recipe from the user's own notes.
   *
   * @throws {AIError} with a stable `code` the endpoint can map to HTTP.
   */
  extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe> {
    return this.runOperation(
      "extract",
      EXTRACTION_PROMPT,
      buildExtractionPrompt(input.rawText),
      parseExtractionResponse,
    );
  }

  /**
   * Generates an unsaved recipe preview from the user's pantry and their own
   * retrieved recipes (AI-06).
   *
   * BE-10 builds `context` from `input` and normalizes the pantry and
   * preferences, so the prompt reads those values from the context rather than
   * keeping a second copy that could drift. `input` still shapes the request
   * the caller validated; the adapter never persists anything.
   *
   * @throws {AIError} with a stable `code` the endpoint can map to HTTP.
   */
  generateRecipe(
    _input: GenerateRecipeInput,
    context: GenerateRecipeContext,
  ): Promise<GeneratedRecipe> {
    const allowedParentIds = new Set(context.recipes.map((recipe) => recipe.id));
    return this.runOperation(
      "generate",
      CHEF_PROMPT,
      buildChefPrompt(context),
      (raw) => parseGenerationResponse(raw, allowedParentIds),
    );
  }

  /**
   * Runs one operation with at most one retry for provider failures only.
   *
   * Invalid model output is not retried: the same prompt is unlikely to
   * produce different JSON, and a retry would burn free-tier quota for no
   * benefit. Extraction and generation share this loop so their retry,
   * timeout and logging behavior cannot drift. Nothing is persisted.
   */
  private async runOperation<T>(
    operation: "extract" | "generate",
    promptTemplate: PromptTemplate,
    prompt: string,
    parse: (raw: string) => T,
  ): Promise<T> {
    const attempts: AIAttempt[] = [];
    let lastError: AIError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();

      try {
        const raw = await this.generateText(prompt);
        const result = parse(raw);

        this.safeLog({
          ...this.logMeta(operation, promptTemplate, attempt, startedAt),
          outcome: "success",
        });

        return result;
      } catch (error) {
        const aiError = toAIError(error, operation);
        attempts.push({
          code: aiError.code,
          nonConsuming: aiError.nonConsuming,
        });

        this.safeLog({
          ...this.logMeta(operation, promptTemplate, attempt, startedAt),
          outcome: aiError.code,
          detail: aiError.detail,
        });

        const accumulatedError = new AIError(
          aiError.code,
          aiError.operation,
          aiError.message,
          aiError.detail,
          aiError.retryAfterSeconds,
          attempts.every((entry) => entry.nonConsuming),
          [...attempts],
        );

        if (!aiError.retryable || attempt === MAX_ATTEMPTS) throw accumulatedError;
        const delayMs = retryDelayMs(aiError.code === "rate_limited" ? error : undefined);
        if (delayMs === undefined) throw accumulatedError;
        lastError = accumulatedError;
        await this.sleep(delayMs);
      }
    }

    throw lastError ??
      new AIError(
        "provider_unavailable",
        operation,
        operation === "extract" ? "Gemini extraction failed." : "Gemini generation failed.",
        undefined,
        undefined,
        attempts.length > 0 ? attempts.every((entry) => entry.nonConsuming) : false,
        attempts,
      );
  }

  /** Live smoke check used by the optional connectivity script. */
  async testConnection(): Promise<string> {
    if (!this.client) {
      throw new Error(
        "testConnection needs a real Gemini client; this adapter was created with an injected generator.",
      );
    }

    const model = this.client.getGenerativeModel(
      { model: this.modelName },
      { timeout: this.timeoutMs },
    );
    const result = await model.generateContent(
      "Respond with exactly: 'Gemini backend connectivity successful.'",
    );
    return result.response.text();
  }

  /**
   * Logging is observability, not part of the operation. A broken sink must
   * never fail a successful extraction, trigger a retry, or mask a typed error.
   */
  private safeLog(entry: AIOperationLog): void {
    try {
      this.log(entry);
    } catch {
      // Deliberately swallowed: the sink is not our failure domain.
    }
  }

  /** Metadata-only part of a log entry. Never includes prompt or recipe text. */
  private logMeta(
    operation: "extract" | "generate",
    promptTemplate: PromptTemplate,
    attempt: number,
    startedAt: number,
  ): Omit<AIOperationLog, "outcome"> {
    return {
      op: operation,
      model: this.modelName,
      promptId: promptTemplate.id,
      promptVersion: promptTemplate.version,
      attempt,
      latencyMs: Date.now() - startedAt,
    };
  }

  /** One Gemini request in JSON mode. The response is validated by the caller. */
  private async callModel(client: GoogleGenerativeAI, prompt: string): Promise<string> {
    const model = client.getGenerativeModel(
      {
        model: this.modelName,
        // Ask Gemini for JSON, but still validate it below: JSON mode is not a
        // security boundary (AI-10).
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      },
      { timeout: this.timeoutMs },
    );

    const result = await model.generateContent(prompt);
    const response = result.response;
    const finishReason = response.candidates?.[0]?.finishReason;

    // SDK 0.21.0 throws for SAFETY/RECITATION/LANGUAGE, but newer block
    // reasons such as PROHIBITED_CONTENT return empty text instead. Without
    // this check they would be misreported as invalid model output.
    if (finishReason && BLOCKED_FINISH_REASONS.has(finishReason)) {
      throw new GoogleGenerativeAIResponseError(
        `Candidate was blocked due to ${finishReason}`,
        response,
      );
    }

    return response.text();
  }
}

/** Exported for tests. */
export function parseExtractionResponse(raw: string): ExtractedRecipe {
  const cleaned = stripCodeFence(raw);

  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new AIError("invalid_output", "extract", "Gemini did not return valid JSON.", undefined, undefined, false);
  }

  const parsed = ExtractedRecipeSchema.safeParse(value);
  if (!parsed.success) {
    const fieldPaths = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    const message = fieldPaths
      ? `Gemini output did not match the recipe schema (fields: ${fieldPaths}).`
      : "Gemini output did not match the recipe schema.";
    throw new AIError("invalid_output", "extract", message, fieldPaths, undefined, false);
  }

  return parsed.data;
}

/**
 * Validates a generated preview and enforces AI-07's generation boundary:
 * every proposed parent must be one of the recipes the backend actually put in
 * the prompt. An invented or foreign ID is a hard failure, never a silent drop,
 * because silently dropping could hide a prompt-injection attempt.
 *
 * Exported for tests.
 */
export function parseGenerationResponse(
  raw: string,
  allowedParentIds: ReadonlySet<string>,
): GeneratedRecipe {
  const cleaned = stripCodeFence(raw);

  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new AIError("invalid_output", "generate", "Gemini did not return valid JSON.", undefined, undefined, false);
  }

  const parsed = GeneratedRecipeSchema.safeParse(value);
  if (!parsed.success) {
    const fieldPaths = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    const message = fieldPaths
      ? `Gemini output did not match the recipe schema (fields: ${fieldPaths}).`
      : "Gemini output did not match the recipe schema.";
    throw new AIError("invalid_output", "generate", message, fieldPaths, undefined, false);
  }

  const hasUnknownParent = parsed.data.parentRecipeIds
    .some((id) => !allowedParentIds.has(id));
  if (hasUnknownParent) {
    throw new AIError(
      "invalid_output",
      "generate",
      "Gemini proposed a parent recipe outside the supplied candidates.",
      "parentRecipeIds",
      undefined,
      false,
    );
  }

  return parsed.data;
}

/** Removes a markdown code fence if the model added one. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/** Maps any thrown value to a typed, user-safe `AIError`. */
function toAIError(error: unknown, operation: "extract" | "generate"): AIError {
  if (error instanceof AIError) return error;

  // The SDK throws this from `response.text()` when Gemini blocks the prompt
  // or candidate for safety, recitation or language reasons. It carries no
  // HTTP status, so without this branch a real block would surface as a 500
  // INTERNAL_ERROR instead of the documented 502 AI_PROVIDER_REJECTED.
  if (error instanceof GoogleGenerativeAIResponseError) {
    return new AIError(
      "provider_rejected",
      operation,
      "Gemini blocked the response for safety or policy reasons.",
      undefined,
      undefined,
      false,
    );
  }

  const status = readStatus(error);

  if (status === 429) {
    return new AIError(
      "rate_limited",
      operation,
      "Gemini rate limit or free-tier quota reached.",
      undefined,
      // Forward the provider's own cooldown when it supplied one; the endpoint
      // turns this into a client `Retry-After` so the UI waits the right amount.
      retryAfterSecondsFromMs(readProviderRetryDelayMs(error)),
      true,
    );
  }

  if (status === 408 || (status === undefined && isTimeout(error))) {
    return new AIError(
      "provider_timeout",
      operation,
      "Gemini did not respond in time.",
      undefined,
      undefined,
      false,
    );
  }

  // Any other 4xx means the request, key, or model is wrong. A retry cannot
  // fix that, so surface it as non-retryable instead of an apparent outage.
  if (status !== undefined && status >= 400 && status < 500) {
    return new AIError(
      "provider_rejected",
      operation,
      "Gemini rejected the request. Check the API key and model configuration.",
      undefined,
      undefined,
      true,
    );
  }

  if (status !== undefined && status >= 500 && status < 600) {
    return new AIError(
      "provider_unavailable",
      operation,
      "Gemini is currently unavailable.",
      undefined,
      undefined,
      false,
    );
  }

  if (status === undefined && isNetworkError(error)) {
    return new AIError(
      "provider_unavailable",
      operation,
      "Gemini is currently unavailable.",
      undefined,
      undefined,
      false,
    );
  }

  return new AIError(
    "internal_error",
    operation,
    `Gemini ${operation} failed unexpectedly.`,
    undefined,
    undefined,
    false,
  );
}

/** Recognize transport failures without treating every local SDK error as an outage. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" &&
    /^(?:ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH)$/.test(code)) {
    return true;
  }

  // The SDK wraps fetch exceptions and discards their type/cause. Match only
  // known transport messages inside its fetch wrapper, never the wrapper alone.
  const message = error instanceof GoogleGenerativeAIError
    ? error.message.match(/^\[GoogleGenerativeAI Error\]: Error fetching from https?:\/\/\S+: (.+)$/s)?.[1]
    : error instanceof TypeError ? error.message : undefined;
  return message !== undefined &&
    /^(?:fetch failed|failed to fetch|NetworkError when attempting to fetch resource|Load failed|error sending request for url\b)/i.test(message);
}

/** True when the failure looks like a timeout or an abort. */
function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /timed? ?out|aborted/i.test(error.message);
}

/** Reads an HTTP-style numeric `status` without trusting the error's shape. */
function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status < 600
    ? status
    : undefined;
}
