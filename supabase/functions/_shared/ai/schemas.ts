import { z } from "npm:zod@3.22.4";

// Rule DB-06 to DB-09
export const IngredientSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  quantityText: z.string().optional(),
  inferred: z.boolean().default(false)
});

// Rule DB-10
export const InstructionSchema = z.object({
  step: z.number(),
  text: z.string()
});

// Rule DB-11 & DB-12
export const FlavorScoreSchema = z.object({
  sweet: z.number().min(0).max(5),
  salty: z.number().min(0).max(5),
  sour: z.number().min(0).max(5),
  bitter: z.number().min(0).max(5),
  umami: z.number().min(0).max(5),
  spicy: z.number().min(0).max(5)
});

// The final extracted recipe schema
export const ExtractedRecipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.optional()
});