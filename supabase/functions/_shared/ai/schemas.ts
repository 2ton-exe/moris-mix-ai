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

export const GeneratedRecipeSchema = z.object({
  recipe: ExtractedRecipeSchema,
  parentRecipeIds: z.array(z.string())
});

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

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export const CreateRecipeRequestSchema = z.object({
  title: z.string().trim().min(1),
  raw_input: z.string().nullable().optional(),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.nullable().optional(),
  star_rating: z.number().int().min(1).max(5).nullable().optional(),
  cooked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate).nullable().optional(),
});

export const RecipeSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().min(1),
  raw_input: z.string().nullable(),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.nullable(),
  star_rating: z.number().int().min(1).max(5).nullable(),
  cooked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate).nullable(),
  image_url: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const RecipeResponseSchema = z.object({
  recipe: RecipeSchema,
});

export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequestSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeResponse = z.infer<typeof RecipeResponseSchema>;