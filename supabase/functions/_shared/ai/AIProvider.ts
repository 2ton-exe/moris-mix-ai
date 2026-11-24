import { z } from "npm:zod@4.6.6";
import { ExtractedRecipeSchema, GeneratedRecipeSchema } from "./schemas.ts";
import type {
  ChefRecipeContextResult,
  GeneratedRevisionSchema,
} from "./schemas.ts";
import type { RecipeRevisionContext } from "./recipeRevision.ts";

export type ExtractRecipeInput = { rawText: string };
export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;

export type GenerateRecipeInput = {
  pantryItems: string[];
  preferences?: string;
};
/** Owner-scoped context built before the provider is called. */
export type GenerateRecipeContext =
  | ChefRecipeContextResult
  | RecipeRevisionContext;
export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;
export type GeneratedRevision = z.infer<typeof GeneratedRevisionSchema>;

export interface AIProvider {
  extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe>;
  generateRecipe(
    input: GenerateRecipeInput,
    context: GenerateRecipeContext,
  ): Promise<GeneratedRevision>;
  testConnection(): Promise<string>;
}
