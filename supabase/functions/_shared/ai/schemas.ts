import { z } from "npm:zod@3.22.4";

// --- BASE SCHEMAS ---

/**
 * Models routinely send null where the schema expects an absent optional field.
 * Normalise null to undefined instead of rejecting an otherwise valid recipe.
 */
function nullToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === null ? undefined : value), schema);
}

export const IngredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nonnegative().nullable().default(null),
  unit: z.string().nullable().default(null),
  quantityText: nullToUndefined(z.string().optional()),
  inferred: z.boolean().default(false)
});

export const InstructionSchema = z.object({
  step: z.number().int().positive(),
  text: z.string().min(1)
});

/**
 * The prompt promises steps numbered 1..n in order, but InstructionSchema only
 * checks a positive integer. Enforce the array-level rule here, where the whole
 * list is available, so a sequence like 1, 3, 3 cannot pass as valid extraction.
 */
const SequentialInstructionsSchema = z
  .array(InstructionSchema)
  .superRefine((steps, ctx) => {
    steps.forEach((step, index) => {
      if (step.step !== index + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "step"],
          message: `Expected step ${index + 1}.`,
        });
      }
    });
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
  title: z.string().min(1),
  ingredients: z.array(IngredientSchema),
  instructions: SequentialInstructionsSchema,
  // Models often send null for an optional field. Normalise that to absent
  // instead of failing an otherwise valid extraction.
  flavor_scores: nullToUndefined(FlavorScoreSchema.optional())
});

export const GeneratedRecipeSchema = z.object({
  recipe: ExtractedRecipeSchema,
  parentRecipeIds: z.array(z.string().uuid())
});

/**
 * AI-06: the brain-dump input cap. Extraction rejects anything longer before
 * the provider call, so a single request can never fan out into an unbounded
 * (billable) prompt.
 */
export const MAX_EXTRACTION_INPUT_CHARS = 10_000;

/**
 * Request contract for AI-05 (`POST /extract-recipe`).
 *
 * The schema deliberately checks shape and emptiness but not size: an oversized
 * but well-formed body must fail as `413 INPUT_TOO_LARGE`, not as a generic
 * `400 VALIDATION_ERROR`. The endpoint owns that size check.
 */
export const ExtractRecipeRequestSchema = z.object({
  notes: z.string().trim().min(1)
});

export const ExtractRecipeResponseSchema = z.object({
  recipe: ExtractedRecipeSchema
});

export type ExtractRecipeRequest = z.infer<typeof ExtractRecipeRequestSchema>;
export type ExtractRecipeResponse = z.infer<typeof ExtractRecipeResponseSchema>;

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
  notes: z.string().nullable().optional(),
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
  notes: z.string().nullable(),
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

export const RecipeIdParamSchema = z.string().uuid();

export const RecipeParamsSchema = z.object({
  id: z.string().uuid(),
});

export const RecipeSortModeSchema = z.enum(["newest", "rating"]);
export type RecipeSortMode = z.infer<typeof RecipeSortModeSchema>;

export const RecipeCursorSchema = z.object({
  sort: RecipeSortModeSchema,
  title: z.string().optional(),
  ingredient: z.string().optional(),
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  starRating: z.number().int().min(1).max(5).nullable().optional(),
});
export type RecipeCursor = z.infer<typeof RecipeCursorSchema>;

export const RecipeListResponseSchema = z.object({
  recipes: z.array(RecipeSchema),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

export const UpdateRecipeRequestSchema = z.object({
  title: z.string().trim().min(1).optional(),
  raw_input: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  ingredients: z.array(IngredientSchema).optional(),
  instructions: z.array(InstructionSchema).optional(),
  flavor_scores: FlavorScoreSchema.nullable().optional(),
  star_rating: z.number().int().min(1).max(5).nullable().optional(),
  cooked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate).nullable().optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update." },
);

export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequestSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeResponse = z.infer<typeof RecipeResponseSchema>;
export type RecipeParams = z.infer<typeof RecipeParamsSchema>;
export type RecipeListResponse = z.infer<typeof RecipeListResponseSchema>;
export type UpdateRecipeRequest = z.infer<typeof UpdateRecipeRequestSchema>;

export const ChefContextStatusSchema = z.enum([
  "MATCHED",
  "NO_PANTRY_OVERLAP",
  "NO_SAVED_RECIPES",
  "EMPTY_PANTRY",
]);
export type ChefContextStatus = z.infer<typeof ChefContextStatusSchema>;

function isValidIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export const ChefIsoTimestampSchema = z
  .string()
  .datetime({ offset: true, message: "INVALID_TIMESTAMP" })
  .refine(isValidIsoTimestamp, { message: "INVALID_TIMESTAMP" });

export const ChefTopKSchema = z
  .number()
  .int()
  .min(1)
  .max(10)
  .refine(Number.isFinite, { message: "topK must be a finite integer between 1 and 10." });

export const ChefMaxCandidatesSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .refine(Number.isFinite, { message: "maxCandidates must be a finite integer between 1 and 1000." });

export const ChefRecipeContextInputSchema = z.object({
  pantryItems: z.array(z.string().max(100)).max(100),
  preferences: z.string().max(1000).optional(),
}).strict();

export const ChefRecipeContextOptionsSchema = z.object({
  topK: ChefTopKSchema.default(3),
  maxCandidates: ChefMaxCandidatesSchema.default(1000),
}).strict();

export const ChefContextCandidateSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().min(1),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.nullable(),
  star_rating: z.number().int().min(1).max(5).refine(Number.isFinite).nullable(),
  created_at: ChefIsoTimestampSchema,
});
export type ChefContextCandidate = z.infer<typeof ChefContextCandidateSchema>;

export const RankedRecipeContextItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  flavor_scores: FlavorScoreSchema.nullable(),
  star_rating: z.number().int().min(1).max(5).refine(Number.isFinite).nullable(),
  created_at: ChefIsoTimestampSchema,
  overlap_ratio: z.number().gt(0).max(1).refine(Number.isFinite),
  matched_ingredients: z.array(z.string().min(1)).min(1),
});
export type RankedRecipeContextItem = z.infer<typeof RankedRecipeContextItemSchema>;

export const ChefRecipeContextResultSchema = z.object({
  status: ChefContextStatusSchema,
  pantryItems: z.array(z.string().min(1)),
  preferences: z.string().optional(),
  recipes: z.array(RankedRecipeContextItemSchema).max(10),
  totalCandidateCount: z.number().int().min(0).max(1000).refine(Number.isFinite),
  matchedCandidateCount: z.number().int().min(0).max(1000).refine(Number.isFinite),
  truncated: z.boolean(),
}).superRefine((data, ctx) => {
  if (data.matchedCandidateCount > data.totalCandidateCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["matchedCandidateCount"],
      message: "matchedCandidateCount cannot exceed totalCandidateCount.",
    });
  }

  if (data.recipes.length > data.matchedCandidateCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipes"],
      message: "recipes length cannot exceed matchedCandidateCount.",
    });
  }

  if (data.totalCandidateCount === 0 && data.truncated) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["truncated"],
      message: "truncated must be false when totalCandidateCount is 0.",
    });
  }

  switch (data.status) {
    case "NO_SAVED_RECIPES": {
      if (data.totalCandidateCount !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalCandidateCount"],
          message: "NO_SAVED_RECIPES requires totalCandidateCount === 0.",
        });
      }
      if (data.matchedCandidateCount !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["matchedCandidateCount"],
          message: "NO_SAVED_RECIPES requires matchedCandidateCount === 0.",
        });
      }
      if (data.recipes.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recipes"],
          message: "NO_SAVED_RECIPES requires empty recipes.",
        });
      }
      break;
    }
    case "EMPTY_PANTRY": {
      if (data.totalCandidateCount < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalCandidateCount"],
          message: "EMPTY_PANTRY requires totalCandidateCount >= 1.",
        });
      }
      if (data.pantryItems.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pantryItems"],
          message: "EMPTY_PANTRY requires empty pantryItems.",
        });
      }
      if (data.matchedCandidateCount !== 0 || data.recipes.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recipes"],
          message: "EMPTY_PANTRY requires zero matched candidates and empty recipes.",
        });
      }
      break;
    }
    case "NO_PANTRY_OVERLAP": {
      if (data.totalCandidateCount < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalCandidateCount"],
          message: "NO_PANTRY_OVERLAP requires totalCandidateCount >= 1.",
        });
      }
      if (data.pantryItems.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pantryItems"],
          message: "NO_PANTRY_OVERLAP requires non-empty pantryItems.",
        });
      }
      if (data.matchedCandidateCount !== 0 || data.recipes.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recipes"],
          message: "NO_PANTRY_OVERLAP requires zero matched candidates and empty recipes.",
        });
      }
      break;
    }
    case "MATCHED": {
      if (data.totalCandidateCount < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["totalCandidateCount"],
          message: "MATCHED requires totalCandidateCount >= 1.",
        });
      }
      if (data.pantryItems.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pantryItems"],
          message: "MATCHED requires non-empty pantryItems.",
        });
      }
      if (data.matchedCandidateCount < 1 || data.recipes.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recipes"],
          message: "MATCHED requires matchedCandidateCount >= 1 and non-empty recipes.",
        });
      }
      break;
    }
  }
});
export type ChefRecipeContextResult = z.infer<typeof ChefRecipeContextResultSchema>;
