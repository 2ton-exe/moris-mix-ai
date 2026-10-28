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
 * Current Flash model as of Sprint 3. Override with AI_MODEL when Gemini
 * retires or overloads a model; no code change should be needed (AI-03).
 * Observed 2026-10-28: gemini-3.8-flash returns 503, gemini-2.5-flash is
 * capped at 20 free-tier requests per day.
 */
const DEFAULT_MODEL = "gemini-3.6-flash";
const DEFAULT_TIMEOUT_MS = 30_000;
/** One attempt plus one bounded retry (AI-18). */
const MAX_ATTEMPTS = 2;

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

export type GeminiAdapterConfig = {
  apiKey?: string;
  modelName?: string;
  timeoutMs?: number;
  generateText?: GenerateText;
  log?: (entry: AIOperationLog) => void;
};

export class GeminiAdapter implements AIProvider {
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly generateText: GenerateText;
  private readonly log: (entry: AIOperationLog) => void;
  private readonly client?: GoogleGenerativeAI;

  constructor(config: GeminiAdapterConfig = {}) {
    this.modelName = config.modelName ?? Deno.env.get("AI_MODEL") ?? DEFAULT_MODEL;
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

  generateRecipe(_input: GenerateRecipeInput): Promise<GeneratedRecipe> {
    return Promise.reject(new Error("generateRecipe is implemented in AI-06."));
  }

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

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

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

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /timed? ?out|aborted/i.test(error.message);
}

function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
