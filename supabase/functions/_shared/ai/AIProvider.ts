import { z } from "npm:zod@3.22.4";
import { ExtractedRecipeSchema } from "./schemas.ts";

export type ExtractRecipeInput = { rawText: string };
// This magically turns your Zod schema into a strict TypeScript type!
export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;

export type GenerateRecipeInput = { pantryItems: string[]; preferences?: string };
export type GeneratedRecipe = { recipe: ExtractedRecipe; parentRecipeIds: string[] };

export interface AIProvider {
  extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe>;
  generateRecipe(input: GenerateRecipeInput): Promise<GeneratedRecipe>;
  testConnection(): Promise<string>; 
}