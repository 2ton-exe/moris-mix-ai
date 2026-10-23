import { z } from "npm:zod@3.22.4";
import { ExtractedRecipeSchema, GeneratedRecipeSchema } from "./schemas.ts";

export type ExtractRecipeInput = { rawText: string };
export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;

export type GenerateRecipeInput = { pantryItems: string[]; preferences?: string };
export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;

export interface AIProvider {
  extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe>;
  generateRecipe(input: GenerateRecipeInput): Promise<GeneratedRecipe>;
  testConnection(): Promise<string>; 
}