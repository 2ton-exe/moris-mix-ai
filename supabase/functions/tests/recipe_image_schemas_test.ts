import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  RecipeImageAttachRequestSchema,
  RecipeImageContentTypeSchema,
  RecipeImageMetadataSchema,
  RecipeImageUploadRequestSchema,
} from "../_shared/schemas.ts";
import type {
  RecipeImageAttachRequest,
  RecipeImageContentType,
  RecipeImageMetadata,
  RecipeImageUploadRequest,
} from "../_shared/schemas.ts";

const uploadRequest: RecipeImageUploadRequest = {
  recipe_id: "99999999-9999-9999-9999-999999999999",
  content_type: "image/jpeg",
  byte_size: 245760,
};

Deno.test("recipe image upload request accepts supported image metadata", () => {
  assertEquals(
    RecipeImageUploadRequestSchema.parse(uploadRequest),
    uploadRequest,
  );
});

Deno.test("recipe image upload request accepts the 10 MiB limit", () => {
  const maxSizedRequest = { ...uploadRequest, byte_size: 10_485_760 };
  assertEquals(
    RecipeImageUploadRequestSchema.parse(maxSizedRequest),
    maxSizedRequest,
  );
});

Deno.test("recipe image upload request rejects invalid recipe IDs", () => {
  assertThrows(() =>
    RecipeImageUploadRequestSchema.parse({
      ...uploadRequest,
      recipe_id: "recipe-1",
    })
  );
});

Deno.test("recipe image upload request rejects unsupported image types", () => {
  assertThrows(() =>
    RecipeImageUploadRequestSchema.parse({
      ...uploadRequest,
      content_type: "image/svg+xml",
    })
  );
});

Deno.test("recipe image upload request rejects invalid or excessive byte sizes", () => {
  for (const byte_size of [0, -1, 1.5, 10_485_761]) {
    assertThrows(() =>
      RecipeImageUploadRequestSchema.parse({ ...uploadRequest, byte_size })
    );
  }
});

Deno.test("recipe image upload request rejects caller-selected ownership and storage fields", () => {
  assertThrows(() =>
    RecipeImageUploadRequestSchema.parse({
      ...uploadRequest,
      user_id: "99999999-9999-9999-9999-999999999999",
    })
  );
  assertThrows(() =>
    RecipeImageUploadRequestSchema.parse({
      ...uploadRequest,
      object_key: "user/recipe/image.jpg",
    })
  );
});

Deno.test("recipe image attach request accepts stable recipe and upload UUIDs", () => {
  const request: RecipeImageAttachRequest = {
    recipe_id: "99999999-9999-9999-9999-999999999999",
    upload_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  assertEquals(RecipeImageAttachRequestSchema.parse(request), request);
});

Deno.test("recipe image attach request rejects invalid recipe and upload IDs", () => {
  const request: RecipeImageAttachRequest = {
    recipe_id: "99999999-9999-9999-9999-999999999999",
    upload_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };

  for (
    const [field, value] of [["recipe_id", "recipe-1"], [
      "upload_id",
      "upload-1",
    ]] as const
  ) {
    assertThrows(() =>
      RecipeImageAttachRequestSchema.parse({ ...request, [field]: value })
    );
  }
});

Deno.test("recipe image attach request rejects caller-selected storage paths", () => {
  assertThrows(() =>
    RecipeImageAttachRequestSchema.parse({
      recipe_id: "99999999-9999-9999-9999-999999999999",
      upload_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      image_path: "user/recipe/image.jpg",
    })
  );
});

Deno.test("recipe image metadata accepts verified stored image details", () => {
  const content_type: RecipeImageContentType = "image/webp";
  const metadata: RecipeImageMetadata = {
    recipe_id: "99999999-9999-9999-9999-999999999999",
    content_type,
    byte_size: 245760,
    uploaded_at: "2026-10-26T10:04:00Z",
  };
  assertEquals(RecipeImageMetadataSchema.parse(metadata), metadata);
});

Deno.test("recipe image metadata rejects invalid timestamps and internal paths", () => {
  const metadata = {
    recipe_id: "99999999-9999-9999-9999-999999999999",
    content_type: "image/png",
    byte_size: 245760,
    uploaded_at: "not-a-timestamp",
  };
  assertThrows(() => RecipeImageMetadataSchema.parse(metadata));
  assertThrows(() =>
    RecipeImageMetadataSchema.parse({
      ...metadata,
      uploaded_at: "2026-10-26T10:04:00Z",
      image_path: "user/recipe/image.jpg",
    })
  );
  for (const byte_size of [0, 10_485_761]) {
    assertThrows(() =>
      RecipeImageMetadataSchema.parse({
        ...metadata,
        uploaded_at: "2026-10-26T10:04:00Z",
        byte_size,
      })
    );
  }
});

Deno.test("recipe image content type schema accepts only the supported formats", () => {
  for (
    const contentType of ["image/jpeg", "image/png", "image/webp"] as const
  ) {
    assertEquals(RecipeImageContentTypeSchema.parse(contentType), contentType);
  }
  assertThrows(() => RecipeImageContentTypeSchema.parse("image/gif"));
});
