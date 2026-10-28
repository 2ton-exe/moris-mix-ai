import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import type {
  AIProvider,
  ExtractRecipeInput,
  ExtractedRecipe,
  GenerateRecipeInput,
  GeneratedRecipe,
} from "./AIProvider.ts";
import { EXTRACTION_PROMPT, buildExtractionPrompt } from "./prompts.ts";
import { ExtractedRecipeSchema } from "./schemas.ts";

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
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 30_000;
/** One attempt plus one bounded retry (AI-18). */
const MAX_ATTEMPTS = 2;

/** Stable failure codes that the AI-05 endpoint maps to HTTP statuses. */
export type AIErrorCode =
  | "invalid_output"
  | "provider_timeout"
  | "provider_unavailable"
  | "rate_limited";

/**
 * Typed AI failure. `code` is stable so callers (the AI-05 endpoint) can map it
 * to an HTTP status without parsing messages. Messages are user-safe: they
 * never contain prompt text or recipe text.
 */
export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly operation: "extract" | "generate";
  readonly retryable: boolean;
  /** Metadata only, for example the schema paths that failed. Never values. */
  readonly detail?: string;

  constructor(
    code: AIErrorCode,
    operation: "extract" | "generate",
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.operation = operation;
    this.retryable = code !== "invalid_output";
    this.detail = detail;
  }
}

/** Metadata-only log entry (AI-20). Never carries prompts or recipe text. */
export type AIOperationLog = {
  op: "extract";
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
  log?: (entry: AIOperationLog) => void;
};

/**
 * Gemini-backed `AIProvider`.
 *
 * Extraction is the only implemented operation; `generateRecipe` belongs to
 * AI-06. Tests inject a generator so they never touch the network, and inject
 * a log sink so they can assert the metadata that gets recorded.
 */
export class GeminiAdapter implements AIProvider {
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly generateText: GenerateText;
  private readonly log: (entry: AIOperationLog) => void;
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

    if (config.generateText) {
      this.generateText = config.generateText;
      return;
    }

    const apiKey = config.apiKey ?? Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

    const client = new GoogleGenerativeAI(apiKey);
    this.client = client;
    this.generateText = (prompt) => this.callModel(client, prompt);
  }

  /**
   * Extracts a recipe from the user's own notes.
   *
   * Retries once for provider failures only. Invalid model output is not
   * retried: the same prompt is unlikely to produce different JSON, and a
   * retry would burn free-tier quota for no benefit. Nothing is persisted.
   *
   * @throws {AIError} with a stable `code` the endpoint can map to HTTP.
   */
  async extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe> {
    const prompt = buildExtractionPrompt(input.rawText);
    let lastError: AIError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();

      try {
        const raw = await this.generateText(prompt);
        const recipe = parseExtractionResponse(raw);

        this.log({
          ...this.logMeta(attempt, startedAt),
          outcome: "success",
        });

        return recipe;
      } catch (error) {
        const aiError = toAIError(error, "extract");

        this.log({
          ...this.logMeta(attempt, startedAt),
          outcome: aiError.code,
          detail: aiError.detail,
        });

        if (!aiError.retryable || attempt === MAX_ATTEMPTS) throw aiError;
        lastError = aiError;
      }
    }

    throw lastError ?? new AIError("provider_unavailable", "extract", "Gemini extraction failed.");
  }

  /** Not part of AI-04; reserved for AI-06. */
  generateRecipe(_input: GenerateRecipeInput): Promise<GeneratedRecipe> {
    return Promise.reject(new Error("generateRecipe is implemented in AI-06."));
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

  /** Metadata-only part of a log entry. Never includes prompt or recipe text. */
  private logMeta(attempt: number, startedAt: number): Omit<AIOperationLog, "outcome"> {
    return {
      op: "extract",
      model: this.modelName,
      promptId: EXTRACTION_PROMPT.id,
      promptVersion: EXTRACTION_PROMPT.version,
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
    return result.response.text();
  }
}

/** Exported for tests. */
export function parseExtractionResponse(raw: string): ExtractedRecipe {
  const cleaned = stripCodeFence(raw);

  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new AIError("invalid_output", "extract", "Gemini did not return valid JSON.");
  }

  const parsed = ExtractedRecipeSchema.safeParse(value);
  if (!parsed.success) {
    const fieldPaths = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    const message = fieldPaths
      ? `Gemini output did not match the recipe schema (fields: ${fieldPaths}).`
      : "Gemini output did not match the recipe schema.";
    throw new AIError("invalid_output", "extract", message, fieldPaths);
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

  const message = error instanceof Error ? error.message : String(error);
  const status = readStatus(error);

  if (status === 429 || /quota|rate limit/i.test(message)) {
    return new AIError(
      "rate_limited",
      operation,
      "Gemini rate limit or free-tier quota reached.",
    );
  }

  if (isTimeout(error)) {
    return new AIError("provider_timeout", operation, "Gemini did not respond in time.");
  }

  return new AIError("provider_unavailable", operation, "Gemini is currently unavailable.");
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
  return typeof status === "number" ? status : undefined;
}
