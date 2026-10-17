import { AIProvider, ExtractRecipeInput, ExtractedRecipe, GenerateRecipeInput, GeneratedRecipe } from "./AIProvider.ts";
import { GoogleGenAI } from "npm:@google/genai@2.29.1";

export class GeminiAdapter implements AIProvider {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(config?: { apiKey?: string; modelName?: string }) {
    const apiKey = config?.apiKey || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing!");

    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = config?.modelName || Deno.env.get("AI_MODEL") || "gemini-3.8-flash";
  }

  extractRecipe(_input: ExtractRecipeInput): Promise<ExtractedRecipe> {
    return Promise.reject(new Error("Method not implemented for Sprint 1."));
  }

  generateRecipe(_input: GenerateRecipeInput): Promise<GeneratedRecipe> {
    return Promise.reject(new Error("Method not implemented for Sprint 1."));
  }

  async testConnection(): Promise<string> {
    const interaction = await this.ai.interactions.create({
      model: this.modelName,
      input: "Respond with exactly: 'Gemini backend connectivity successful.'",
      store: false,
    });
    const response = interaction.output_text?.trim();
    if (!response) throw new Error("Gemini connectivity check returned no text output.");
    return response;
  }
}
