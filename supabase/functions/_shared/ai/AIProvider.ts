import { z } from "npm:zod@4.6.6";
import { ExtractedRecipeSchema, GeneratedRecipeSchema } from "./schemas.ts";
import type { Recipe } from "../schemas.ts";
import type { ChefRecipeContextResult } from "./schemas.ts";

export type ExtractRecipeInput = { rawText: string };
export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;

export type GenerateRecipeInput = { pantryItems: string[]; preferences?: string };
/** Ranked, owner-scoped context built by BE-10 before the provider is called. */
export type GenerateRecipeContext = ChefRecipeContextResult;
export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;

export type MoriChatMessage = { role: "user" | "assistant"; content: string };
export type MoriChatPage = "recipes" | "recipe" | "new-recipe" | "quick-entry" | "chef" | "other";
export type MoriChatRecipe = Pick<Recipe, "id" | "title" | "ingredients" | "instructions" | "notes" | "star_rating" | "cooked_at">;
export type MoriChatInput = {
  messages: MoriChatMessage[];
  page: MoriChatPage;
  currentRecipe: MoriChatRecipe | null;
  recipes: MoriChatRecipe[];
  savedRecipesStatus: "available" | "empty" | "unavailable";
};

export interface MoriChatProvider {
  reply(input: MoriChatInput): Promise<string>;
}

export interface AIProvider {
  extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe>;
  generateRecipe(
    input: GenerateRecipeInput,
    context: GenerateRecipeContext,
  ): Promise<GeneratedRecipe>;
  testConnection(): Promise<string>; 
}
