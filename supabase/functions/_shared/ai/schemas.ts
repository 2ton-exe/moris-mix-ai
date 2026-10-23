import { z } from "npm:zod@3.22.4";

// --- BASE SCHEMAS ---
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

// --- AI SCHEMAS (SPRINT 2) ---
export const ExtractedRecipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.optional()
});

export const GeneratedRecipeSchema = z.object({
  recipe: ExtractedRecipeSchema,
  parentRecipeIds: z.array(z.string().uuid())
});

// --- DEMO SCHEMAS (RESTORED FOR SPRINT 1 CI) ---
export const DemoRecipeSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.nullable(),
  star_rating: z.number().int().min(1).max(5).nullable(),
  cooked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
});

export const DemoRecipeResponseSchema = z.object({
  recipe: DemoRecipeSchema
});

export type DemoRecipe = z.infer<typeof DemoRecipeSchema>;
export type DemoRecipeResponse = z.infer<typeof DemoRecipeResponseSchema>;