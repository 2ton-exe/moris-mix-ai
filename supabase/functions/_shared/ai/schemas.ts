import { z } from "npm:zod@3.22.4";
// Restored for Sprint 1 demo-recipe compatibility
export const DemoRecipeResponseSchema = z.any();

export const IngredientSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  quantityText: z.string().optional(),
  inferred: z.boolean().default(false)
});

export const InstructionSchema = z.object({
  step: z.number(),
  text: z.string()
});

export const FlavorScoreSchema = z.object({
  sweet: z.number().min(0).max(5),
  salty: z.number().min(0).max(5),
  sour: z.number().min(0).max(5),
  bitter: z.number().min(0).max(5),
  umami: z.number().min(0).max(5),
  spicy: z.number().min(0).max(5)
});

export const ExtractedRecipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.optional()
});

// NEW: Generation Schema for Belen
export const GeneratedRecipeSchema = z.object({
  recipe: ExtractedRecipeSchema,
  parentRecipeIds: z.array(z.string())
});