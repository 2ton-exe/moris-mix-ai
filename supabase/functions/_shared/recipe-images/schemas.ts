import { z } from "npm:zod@3.22.4";

const MAX_RECIPE_IMAGE_BYTES = 10 * 1024 * 1024;

export const RecipeImageContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const RecipeImageUploadRequestSchema = z.object({
  recipe_id: z.string().uuid(),
  content_type: RecipeImageContentTypeSchema,
  byte_size: z.number().int().positive().max(MAX_RECIPE_IMAGE_BYTES),
}).strict();

export const RecipeImageAttachRequestSchema = z.object({
  recipe_id: z.string().uuid(),
  upload_id: z.string().uuid(),
}).strict();

export const RecipeImageMetadataSchema = z.object({
  recipe_id: z.string().uuid(),
  content_type: RecipeImageContentTypeSchema,
  byte_size: z.number().int().positive().max(MAX_RECIPE_IMAGE_BYTES),
  uploaded_at: z.string().datetime(),
}).strict();

export type RecipeImageContentType = z.infer<
  typeof RecipeImageContentTypeSchema
>;
export type RecipeImageUploadRequest = z.infer<
  typeof RecipeImageUploadRequestSchema
>;
export type RecipeImageAttachRequest = z.infer<
  typeof RecipeImageAttachRequestSchema
>;
export type RecipeImageMetadata = z.infer<typeof RecipeImageMetadataSchema>;
