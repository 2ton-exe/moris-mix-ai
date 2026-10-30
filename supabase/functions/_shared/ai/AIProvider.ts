import { z } from "npm:zod@3.22.4";
import { ExtractedRecipeSchema, GeneratedRecipeSchema } from "./schemas.ts";
import type { ChefRecipeContextResult } from "./schemas.ts";

export type ExtractRecipeInput = { rawText: string };
export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;

export type GenerateRecipeInput = { pantryItems: string[]; preferences?: string };
/** Ranked, owner-scoped context built by BE-10 before the provider is called. */
export type GenerateRecipeContext = ChefRecipeContextResult;
export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;

export interface AIProvider {
  extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe>;
  generateRecipe(
    input: GenerateRecipeInput,
    context: GenerateRecipeContext,
  ): Promise<GeneratedRecipe>;
  testConnection(): Promise<string>; 
}