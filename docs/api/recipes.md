# Authenticated recipe REST API contract (`GET`, `POST`, `PATCH`, `DELETE /recipes`)

This contract defines the authenticated recipe REST endpoints (`supabase/functions/recipes/index.ts`) and shared Zod schemas (`CreateRecipeRequestSchema`, `UpdateRecipeRequestSchema`, `RecipeSchema`, `RecipeResponseSchema`, `RecipeListResponseSchema`, `RecipeParamsSchema`, `RecipeIdParamSchema` in `supabase/functions/_shared/ai/schemas.ts`, re-exported via `supabase/functions/_shared/schemas.ts`) implemented for BE-05 (#47) and completed for BE-06 (#48).

## Endpoints overview

| Method | Path pattern | Operation | Success status | Success response envelope |
| --- | --- | --- | --- | --- |
| `GET` | `/functions/v1/recipes` or `/recipes` | List authenticated user recipes with `limit`/`offset` pagination | `200 OK` | `{ "recipes": Recipe[] }` |
| `POST` | `/functions/v1/recipes` or `/recipes` | Create an owned recipe | `201 Created` | `{ "recipe": Recipe }` |
| `GET` | `/functions/v1/recipes/:id` or `/recipes/:id` | Retrieve an owned recipe | `200 OK` | `{ "recipe": Recipe }` |
| `PATCH` | `/functions/v1/recipes/:id` or `/recipes/:id` | Update allowed fields and rating | `200 OK` | `{ "recipe": Recipe }` |
| `DELETE` | `/functions/v1/recipes/:id` or `/recipes/:id` | Delete an owned recipe | `204 No Content` | (empty body) |
| `OPTIONS` | Any supported recipe path | CORS preflight check | `204 No Content` | (empty body) |

## Headers and Authentication

- **Authentication:** `Authorization: Bearer <supabase-access-token>` is required and verified by the handler.
- **API key:** `apikey` is optional for this handler and is not used to authenticate the caller. Supabase clients may send the project key alongside the user token.
- **Request body:** `POST` and `PATCH` require a valid JSON object. `Content-Type: application/json` is recommended but the handler does not enforce the header.
- **Query parameters:** collection `GET` accepts `limit` and `offset`; other query parameters are ignored.
- **Access control:** authenticated users only. Verified through `authenticateRequest(req, deps)` (`supabase/functions/_shared/auth.ts`).
- **Preflight exception:** `OPTIONS` preflight requests are handled before authentication and return `204 No Content` with CORS headers.

## 1. GET /recipes — List user recipes

Retrieves recipes belonging to the authenticated user, ordered by `created_at` descending and then `id` ascending.

Pagination defaults to `limit=1000` and `offset=0`. `limit` must be an integer from `1` to `1000`; `offset` must be a non-negative safe integer. Request the next page by increasing `offset` by the requested `limit`. A page shorter than `limit` is the last page.

### Request

- **Method and path:** `GET /functions/v1/recipes` (or `GET /recipes`)
- **Query parameters:** `limit` (optional, default `1000`, range `1..1000`) and `offset` (optional, default `0`, non-negative integer).
- **Headers:** `Authorization: Bearer <token>` (required); `apikey: <key>` is optional.
- **Body:** none

### Response (`200 OK`)

Returns a JSON object matching `RecipeListResponseSchema`:

```json
{
  "recipes": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "user_id": "99999999-9999-9999-9999-999999999999",
      "title": "Crispy Garlic Shallot Rice",
      "raw_input": "Leftover jasmine rice, shallots, garlic, soy sauce.",
      "notes": null,
      "ingredients": [
        { "name": "jasmine rice", "quantity": 2, "unit": "cups", "inferred": false },
        { "name": "shallots", "quantity": null, "unit": null, "quantityText": "2 small", "inferred": true }
      ],
      "instructions": [
        { "step": 1, "text": "Slice shallots and garlic thinly." },
        { "step": 2, "text": "Crisp in oil and toss with rice." }
      ],
      "flavor_scores": {
        "sweet": 1,
        "salty": 4,
        "sour": 0,
        "bitter": 1,
        "umami": 5,
        "spicy": 2
      },
      "star_rating": 5,
      "cooked_at": "2026-10-19",
      "image_url": null,
      "created_at": "2026-10-20T06:00:00.000Z",
      "updated_at": "2026-10-20T06:00:00.000Z"
    }
  ]
}
```

When the user has no saved recipes, returns `200 OK` with `{ "recipes": [] }`. Internal columns (`image_path` and `is_public`) are excluded from serialization.

## 2. GET /recipes/:id — Read one recipe

Retrieves a single recipe owned by the authenticated caller.

### Request

- **Method and path:** `GET /functions/v1/recipes/:id` (or `GET /recipes/:id`)
- **Parameters:** `:id` must be a valid RFC 4122 UUID.
- **Headers:** `Authorization: Bearer <token>` (required); `apikey: <key>` is optional.
- **Body:** none

### Response (`200 OK`)

Returns a JSON object matching `RecipeResponseSchema`:

```json
{
  "recipe": {
    "id": "33333333-3333-4333-8333-333333333333",
    "user_id": "99999999-9999-9999-9999-999999999999",
    "title": "Crispy Garlic Shallot Rice",
    "raw_input": "Leftover jasmine rice, shallots, garlic, soy sauce.",
    "notes": null,
    "ingredients": [
      { "name": "jasmine rice", "quantity": 2, "unit": "cups", "inferred": false },
      { "name": "shallots", "quantity": null, "unit": null, "quantityText": "2 small", "inferred": true }
    ],
    "instructions": [
      { "step": 1, "text": "Slice shallots and garlic thinly." },
      { "step": 2, "text": "Crisp in oil and toss with rice." }
    ],
    "flavor_scores": {
      "sweet": 1,
      "salty": 4,
      "sour": 0,
      "bitter": 1,
      "umami": 5,
      "spicy": 2
    },
    "star_rating": 5,
    "cooked_at": "2026-10-19",
    "image_url": null,
    "created_at": "2026-10-20T06:00:00.000Z",
    "updated_at": "2026-10-20T06:00:00.000Z"
  }
}
```

### Not found and access rejection

If `:id` does not exist or belongs to another user, returns `404 Not Found` with `{ "error": { "code": "NOT_FOUND", "message": "Recipe not found." } }`. The endpoint never reveals whether an inaccessible recipe exists.

If `:id` is malformed (not a valid UUID), returns `400 Bad Request` with `{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid recipe ID.", "details": [...] } }`.

## 3. POST /recipes — Create recipe

Creates a new recipe owned by the authenticated caller.

### Request body (`CreateRecipeRequestSchema`)

```json
{
  "title": "Crispy Garlic Shallot Rice",
  "raw_input": "Leftover jasmine rice, shallots, garlic, soy sauce.",
  "notes": "Chef note: crisp shallots on medium-low heat to avoid bitterness.",
  "ingredients": [
    { "name": "jasmine rice", "quantity": 2, "unit": "cups", "inferred": false },
    { "name": "shallots", "quantity": null, "unit": null, "quantityText": "2 small", "inferred": true }
  ],
  "instructions": [
    { "step": 1, "text": "Slice shallots and garlic thinly." },
    { "step": 2, "text": "Crisp in oil and toss with rice." }
  ],
  "flavor_scores": {
    "sweet": 1,
    "salty": 4,
    "sour": 0,
    "bitter": 1,
    "umami": 5,
    "spicy": 2
  },
  "star_rating": 5,
  "cooked_at": "2026-10-19"
}
```

### Field rules for creation

| Field | Required | Type / Constraints | Default / Normalization |
| --- | --- | --- | --- |
| `title` | Required | `string`, trimmed, minimum 1 non-whitespace character | Trimmed via `.trim()` |
| `raw_input` | Optional | `string | null` | `null` when omitted |
| `notes` | Optional | `string | null` | `null` when omitted |
| `ingredients` | Required | `Ingredient[]` (`name: string`, `quantity: number | null`, `unit: string | null`, `quantityText?: string`, `inferred?: boolean`) | `inferred` defaults to `false` |
| `instructions` | Required | `Instruction[]` (`step: number`, `text: string`) | Preserved as validated array |
| `flavor_scores` | Optional | `FlavorScores | null` (`sweet`, `salty`, `sour`, `bitter`, `umami`, `spicy`, each `0..5`) | `null` when omitted |
| `star_rating` | Optional | integer `1..5` or `null` | `null` when omitted |
| `cooked_at` | Optional | calendar date `YYYY-MM-DD` or `null` | `null` when omitted |

### Response (`201 Created`)

Returns `201 Created` with `{ "recipe": Recipe }` envelope matching `RecipeResponseSchema`.

## 4. PATCH /recipes/:id — Update recipe and rating

Applies partial updates to an owned recipe.

### Request

- **Method and path:** `PATCH /functions/v1/recipes/:id` (or `PATCH /recipes/:id`)
- **Parameters:** `:id` must be a valid RFC 4122 UUID.
- **Headers:** `Authorization: Bearer <token>` (required); `apikey: <key>` is optional. `Content-Type: application/json` is recommended.

### Request body (`UpdateRecipeRequestSchema`)

All fields are optional, but at least one valid field must be provided. An empty JSON object `{}` is rejected with `400 VALIDATION_ERROR`. Omitted fields remain untouched in the database. Unsupported or protected fields (`user_id`, `id`, `is_public`, `image_url`, `created_at`, `updated_at`, etc.) are rejected by `.strict()` validation:

```json
{
  "title": "Crispy Garlic Shallot Rice - Extra Crispy",
  "notes": "Add extra toasted sesame oil and crispy shallots",
  "star_rating": 4,
  "cooked_at": "2026-10-21"
}
```

### Supported update fields

| Field | Type / Constraints | Behavior |
| --- | --- | --- |
| `title` | `string`, trimmed, min 1 char | If provided, cannot be empty or null |
| `raw_input` | `string | null` | Sets `raw_input` column; explicit `null` clears column |
| `notes` | `string | null` | Sets `notes` column; explicit `null` clears column |
| `ingredients` | `Ingredient[]` | Replaces ingredients array; cannot be null |
| `instructions` | `Instruction[]` | Replaces instructions array; cannot be null |
| `flavor_scores` | `FlavorScores | null` | Updates flavor scores; explicit `null` clears column |
| `star_rating` | integer `1..5` or `null` | Updates rating; explicit `null` unrates recipe |
| `cooked_at` | calendar date `YYYY-MM-DD` or `null` | Updates cooked date; explicit `null` clears column |

Personal recipe notes (`notes`) are stored in dedicated nullable column `public.recipes.notes` introduced in migration `20261023000002_add_notes_to_recipes.sql`. `notes` is completely independent of `raw_input` (which stores the original AI prompt or generation input). Modifying or nullifying `notes` never alters `raw_input`, and modifying or nullifying `raw_input` never alters `notes`.

### Empty PATCH semantics

An empty JSON object body `{}` is rejected with `400 Bad Request` and error code `VALIDATION_ERROR` (`At least one field must be provided for update.`). It never executes database operations.

### Explicit null versus omitted fields

- **Omitted fields:** Any field omitted from the PATCH body remains untouched in the database.
- **Explicit `null` for nullable fields:** Explicitly providing `null` for `raw_input`, `notes`, `flavor_scores`, `star_rating`, or `cooked_at` persists as SQL `NULL`, clearing the corresponding column.
- **Explicit `null` for non-nullable fields:** Providing `null` for non-nullable fields (`title`, `ingredients`, `instructions`) is rejected during schema validation with `400 VALIDATION_ERROR` before database access.

### Response (`200 OK`)

Returns `200 OK` with updated `{ "recipe": Recipe }` matching `RecipeResponseSchema`. The `updated_at` timestamp is updated automatically by PostgreSQL trigger `tr_recipes_updated_at`.

## 5. DELETE /recipes/:id — Delete recipe

Deletes an owned recipe according to the database model.

### Request

- **Method and path:** `DELETE /functions/v1/recipes/:id` (or `DELETE /recipes/:id`)
- **Parameters:** `:id` must be a valid RFC 4122 UUID.
- **Headers:** `Authorization: Bearer <token>` (required); `apikey: <key>` is optional.
- **Body:** none

### Deletion and lineage behavior

- Physical deletion is performed via PostgREST through the caller-scoped client enforcing RLS `recipes_delete_own`.
- Foreign keys on `public.recipe_lineage` (`parent_recipe_id` and `child_recipe_id`) specify `ON DELETE CASCADE`. PostgreSQL automatically cascades deletion to related lineage entries.
- If the recipe does not exist or is not owned by the authenticated caller, returns `404 Not Found` with `{ "error": { "code": "NOT_FOUND", "message": "Recipe not found." } }`.

### Response (`204 No Content`)

Returns `204 No Content` with an empty response body, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and CORS headers.

## Ownership and server-controlled fields

- Recipe ownership (`user_id`) is derived exclusively from `auth.context.user.id` after verifying the Bearer token.
- Any client attempts to supply or modify `user_id`, `userId`, `owner_id`, `is_public`, `id`, `created_at`, or `updated_at` are rejected during validation or ignored.
- Database operations run through the request-scoped RLS-aware Supabase client (`auth.context.supabase`), enforcing PostgreSQL Row-Level Security:
  - `recipes_select_own`: `USING (auth.uid() = user_id)`
  - `recipes_insert_own`: `WITH CHECK (auth.uid() = user_id)`
  - `recipes_update_own`: `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`
  - `recipes_delete_own`: `USING (auth.uid() = user_id)`

## Errors

All error responses use `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`.

| HTTP status | Code | Message | When |
| --- | --- | --- | --- |
| `400 Bad Request` | `INVALID_JSON` | `Request body must be a valid JSON object.` | Request body is empty, malformed JSON, or not a plain JSON object. |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid recipe payload.` | Request body fails Zod validation. Includes `error.details` array of `{ path, code, message }`. |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid recipe ID.` | Route parameter `:id` is not a valid UUID string. Includes `error.details` array with `path: "id"`. |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid pagination parameters.` | Collection `GET` has an invalid, duplicate, or out-of-range `limit` or `offset`. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Missing or invalid Authorization header.` | `Authorization` header is missing, empty, not `Bearer`, or not a compact 3-part JWS. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Invalid or expired authentication credentials.` | Supabase Auth rejects the Bearer JWT as invalid, expired, revoked, or unauthenticated. |
| `404 Not Found` | `NOT_FOUND` | `Recipe not found.` | Target recipe does not exist or belongs to another user. |
| `404 Not Found` | `NOT_FOUND` | `Route not found.` | Request targets an unsupported sub-path under `/recipes`. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only GET, POST, and OPTIONS methods are supported.` | Unsupported method on collection route (`/recipes`). Includes `Allow: GET, POST, OPTIONS`. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only GET, PATCH, DELETE, and OPTIONS methods are supported.` | Unsupported method on member route (`/recipes/:id`). Includes `Allow: GET, PATCH, DELETE, OPTIONS`. |
| `503 Service Unavailable` | `AUTH_SERVICE_RATE_LIMITED` | `Authentication service is temporarily unavailable. Please try again later.` | Upstream Supabase Auth returns `429 Too Many Requests`. Propagates `Retry-After` header when present. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | `Internal server error.` | Server configuration error, database query failure, RLS denial, or schema mismatch. Never leaks secrets or SQL details. |

## CORS behavior

- `OPTIONS` preflight requests return `204 No Content` with `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`, and `X-Content-Type-Options: nosniff`.
- In `supabase/config.toml`, `[functions.recipes]` sets `verify_jwt = false` at the gateway so unauthenticated browser `OPTIONS` preflight requests reach the handler while all data operations strictly enforce `authenticateRequest(req, deps)`.

## Frontend behavior

- Show a pending state while each authenticated recipe request is in flight.
- On success, use the returned `recipes` or `recipe` envelope; after `204 No Content` from delete, remove the recipe without trying to parse a response body.
- For non-2xx responses, network failures, or invalid JSON, show a retryable, user-safe error and do not display raw backend details.

## Verification and testing (`supabase/functions/tests/recipes_test.ts`)

Verification is organized into deterministic offline tests and optional live hosted RLS integration testing:
- **Deterministic offline tests (35 tests in `recipes_test.ts`):** Run completely offline without database or Auth dependencies. The two hosted integration tests are conditionally ignored unless their dedicated test project is configured.
- **Database migration tests:** Run offline via `node test-migrations.mjs`.
- **RLS remote guard test:** Run offline via `node test-rls-guard.mjs`.
- **Command:**
  ```sh
  deno test --frozen-lockfile --node-modules-dir=auto --allow-env supabase/functions/tests/recipes_test.ts
  ```

### Test database isolation

Hosted integration tests use dedicated non-production projects. The guarded test migration runner requires the expected test-project reference and rejects loopback and the primary production project as targets.

### Schema and migration history

- **Initial schema:** `20261013000000_initial_schema.sql` creates base tables, RLS policies, indexes, and triggers.
- **Recipe visibility:** `20261017000001_add_is_public_to_recipes.sql` adds `is_public boolean not null default false` to `public.recipes`.
- **Dedicated recipe notes:** `20261023000002_add_notes_to_recipes.sql` adds nullable `notes text` column to `public.recipes`, enabling personal chef/cooking notes without modifying or colliding with `raw_input`. All CRUD routes (`GET`, `POST`, `PATCH`) support `notes` independently of `raw_input`.
