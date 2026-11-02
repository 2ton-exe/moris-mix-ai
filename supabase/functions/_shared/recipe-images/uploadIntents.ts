import { createClient } from "npm:@supabase/supabase-js@2.39.8";
import { z } from "npm:zod@3.22.4";
import {
  type RecipeImageUploadRequest,
  RecipeImageUploadRequestSchema,
} from "./schemas.ts";

export const UPLOAD_TTL_SECONDS = 600;

export type UploadIntent = RecipeImageUploadRequest & {
  id: string;
  user_id: string;
  staging_key: string;
  final_key: string;
  created_at: string;
  expires_at: string;
  state: "pending";
};

export function createUploadIntent(
  request: RecipeImageUploadRequest,
  userId: string,
  now: Date = new Date(),
  uploadId: string = crypto.randomUUID(),
  finalObjectId: string = crypto.randomUUID(),
): UploadIntent {
  const metadata = RecipeImageUploadRequestSchema.parse(request);
  const user_id = z.string().uuid().parse(userId).toLowerCase();
  const id = z.string().uuid().parse(uploadId).toLowerCase();
  const finalId = z.string().uuid().parse(finalObjectId).toLowerCase();
  const recipe_id = metadata.recipe_id.toLowerCase();
  const created = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const suffix = `${user_id}/${recipe_id}/${id}`;
  return {
    ...metadata,
    recipe_id,
    id,
    user_id,
    staging_key: `recipe-images/staging/${suffix}`,
    final_key: `recipe-images/final/${suffix}/${finalId}`,
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + UPLOAD_TTL_SECONDS * 1000)
      .toISOString(),
    state: "pending",
  };
}

export function validateUploadIntent(intent: UploadIntent): void {
  const expected = createUploadIntent(
    {
      recipe_id: intent.recipe_id,
      content_type: intent.content_type,
      byte_size: intent.byte_size,
    },
    intent.user_id,
    new Date(intent.created_at),
    intent.id,
    intent.final_key.split("/").at(-1),
  );
  for (const field of Object.keys(expected) as (keyof UploadIntent)[]) {
    if (intent[field] !== expected[field]) {
      throw new Error("Invalid upload intent.");
    }
  }
}

export async function persistUploadIntent(
  intent: UploadIntent,
  deps: {
    supabaseUrl?: string;
    supabaseServiceRoleKey?: string;
    fetch?: typeof fetch;
  } = {},
): Promise<void> {
  validateUploadIntent(intent);
  const url = deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const key = deps.supabaseServiceRoleKey ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url?.trim() || !key?.trim()) {
    throw new Error("Missing upload intent configuration.");
  }
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { ...(deps.fetch ? { fetch: deps.fetch } : {}) },
  });
  const { error } = await client.from("recipe_image_upload_intents").insert(
    intent,
  );
  if (error) {
    throw new Error("Upload intent persistence failed.");
  }
}
