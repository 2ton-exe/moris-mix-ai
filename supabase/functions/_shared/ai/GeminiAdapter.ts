import { AIProvider, ExtractRecipeInput, ExtractedRecipe, GenerateRecipeInput, GeneratedRecipe } from "./AIProvider.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";

export class GeminiAdapter implements AIProvider {
  private ai: GoogleGenerativeAI;
  private modelName: string;

  constructor() {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing!");
    
    this.ai = new GoogleGenerativeAI(apiKey);
    this.modelName = Deno.env.get("AI_MODEL") || "gemini-1.5-flash"; 
  }

  extractRecipe(_input: ExtractRecipeInput): Promise<ExtractedRecipe> {
    return Promise.reject(new Error("Method not implemented for Sprint 1."));
  }

  generateRecipe(_input: GenerateRecipeInput): Promise<GeneratedRecipe> {
    return Promise.reject(new Error("Method not implemented for Sprint 1."));
  }

  async testConnection(): Promise<string> {
    const model = this.ai.getGenerativeModel({ model: this.modelName });
    const result = await model.generateContent("Respond with exactly: 'Gemini backend connectivity successful.'");
    return result.response.text();
  }
}