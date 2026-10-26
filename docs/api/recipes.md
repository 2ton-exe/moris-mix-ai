# Authenticated recipe REST API contract (`GET`, `POST`, `PATCH`, `DELETE /recipes`)

This contract defines the authenticated recipe REST endpoints (`supabase/functions/recipes/index.ts`) and shared Zod schemas (`CreateRecipeRequestSchema`, `UpdateRecipeRequestSchema`, `RecipeSchema`, `RecipeResponseSchema`, `RecipeListResponseSchema`, `RecipeParamsSchema`, `RecipeIdParamSchema` in `supabase/functions/_shared/ai/schemas.ts`, re-exported via `supabase/functions/_shared/schemas.ts`) implemented for BE-05 (#47), BE-06 (#48), and BE-08.

## Endpoints overview

| Method | Path pattern | Operation | Success status | Success response envelope |
| --- | --- | --- | --- | --- |
| `GET` | `/functions/v1/recipes` or `/recipes` | List authenticated user recipes with search, sorting, and cursor pagination | `200 OK` | `{ "recipes": Recipe[], "next_cursor": string \| null, "has_more": boolean }` |
| `POST` | `/functions/v1/recipes` or `/recipes` | Create an owned recipe | `201 Created` | `{ "recipe": Recipe }` |
| `GET` | `/functions/v1/recipes/:id` or `/recipes/:id` | Retrieve an owned recipe | `200 OK` | `{ "recipe": Recipe }` |
| `PATCH` | `/functions/v1/recipes/:id` or `/recipes/:id` | Update allowed fields and rating | `200 OK` | `{ "recipe": Recipe }` |
| `DELETE` | `/functions/v1/recipes/:id` or `/recipes/:id` | Delete an owned recipe | `204 No Content` | (empty body) |
| `OPTIONS` | Any supported recipe path | CORS preflight check | `204 No Content` | (empty body) |

## Headers and Authentication

- **Authentication:** `Authorization: Bearer <supabase-access-token>` is required and verified by the handler.
- **API key:** `apikey` is optional for this handler and is not used to authenticate the caller. Supabase clients may send the project key alongside the user token.
- **Request body:** `POST` and `PATCH` require a valid JSON object. `Content-Type: application/json` is recommended but the handler does not enforce the header.
- **Query parameters:** collection `GET` accepts `title`, `ingredient`, `sort`, `limit`, `cursor`, and legacy `offset`.
- **Access control:** authenticated users only. Verified through `authenticateRequest(req, deps)` (`supabase/functions/_shared/auth.ts`). All queries and database operations are strictly scoped to the authenticated caller (`auth.uid() = user_id`).
- **Preflight exception:** `OPTIONS` preflight requests are handled before authentication and return `204 No Content` with CORS headers.

## 1. GET /recipes — List user recipes

Retrieves recipes belonging to the authenticated caller, supporting case-insensitive title and ingredient substring search, rating and creation date sorting, and stable cursor-based keyset pagination.

### Supported query parameters

| Parameter | Type / Constraints | Default | Behavior |
| --- | --- | --- | --- |
| `title` | `string` | optional | Case-insensitive partial substring match against recipe `title`. Leading and trailing whitespace is trimmed. Empty or whitespace-only values are ignored without filtering out recipes. |
| `ingredient` | `string` | optional | Case-insensitive partial substring match against canonical persisted recipe `ingredients` JSONB representation via generated column `ingredients_text`. Leading and trailing whitespace is trimmed. Empty or whitespace-only values are ignored. |
| `sort` | `string` (`newest` \| `rating`) | `newest` | Controls result ordering. Unsupported sort values return `400 VALIDATION_ERROR`. |
| `pagination` | `string` (`cursor` \| `offset`) | optional (`offset`) | Explicit pagination mode selector. When set to `cursor`, enables cursor keyset pagination (default limit 20, max limit 100). When omitted or set to `offset`, requests use legacy offset pagination (default limit 1000, max limit 1000). |
| `limit` | integer `1..100` (cursor mode) or `1..1000` (legacy offset mode) | `20` (cursor mode), `1000` (offset mode) | Number of recipes to return per page. In legacy offset mode, requests such as `?limit=200` are valid without an explicit `offset`. Exceeding the mode's maximum limit returns `400 VALIDATION_ERROR`. |
| `cursor` | opaque base64 string | optional | Opaque URL-safe Unicode-safe keyset continuation token returned in `next_cursor` from a preceding cursor response. Opts the request into cursor mode. Cannot be combined with `offset` or `pagination=offset`. |
| `offset` | non-negative safe integer | optional (`0`) | Backward-compatible offset pagination parameter from BE-06. Cannot be combined with `cursor` or `pagination=cursor`. |

### Search rules

- **Title search:** `title` performs case-insensitive substring matching (`ILIKE '%title%'`).
- **Ingredient search:** `ingredient` performs case-insensitive substring matching against persisted `ingredients` via generated column `ingredients_text` (`ingredients_text ILIKE '%ingredient%'`).
- **Whitespace handling:** Leading and trailing whitespace in `title` and `ingredient` is trimmed. Empty or whitespace-only search terms do not filter out recipes.
- **Filter combination:** When both `title` and `ingredient` are supplied, both filters must be satisfied (logical AND).
- **No matches:** If no recipes match the filters, returns `200 OK` with `{ "recipes": [], "next_cursor": null, "has_more": false }`, not an error.

### Sorting rules

- **`sort=newest` (default):**
  - Primary sort key: `created_at` descending (`DESC`).
  - Deterministic secondary tie-breaker: `id` ascending (`ASC`).
- **`sort=rating`:**
  - Primary sort key: `star_rating` descending (`DESC NULLS LAST`).
  - Unrated recipes (`star_rating: null`) appear strictly after all rated recipes.
  - Deterministic tie-breaker for equal ratings: `created_at` descending (`DESC`), then `id` ascending (`ASC`).

### Cursor pagination rules

- First-page cursor requests pass `pagination=cursor` (e.g., `GET /recipes?pagination=cursor` or `GET /recipes?pagination=cursor&limit=20&sort=rating`). Requests omitting pagination parameters default to legacy offset pagination (limit 1000, offset 0).
- When more results are available, the response includes `has_more: true` and an opaque `next_cursor` string.
- Continuation requests pass `cursor=<next_cursor>` along with identical `sort`, `title`, and `ingredient` query parameters.
- Cursors are serialized using URL-safe, UTF-8-safe Base64 without padding, supporting arbitrary Unicode search terms and emojis. Cursors encode sort keys and tie-breakers from the last row of the previous page. Keyset filtering ensures no skipped rows and no duplicate rows across ordinary page boundaries.
- When no more results exist, the response includes `has_more: false` and `next_cursor: null`.
- Malformed, corrupt, or non-base64 cursors are rejected with `400 VALIDATION_ERROR`.
- Cursors that do not match the active `sort`, `title`, or `ingredient` parameters are rejected with `400 VALIDATION_ERROR`.
- Supplying both `cursor` and `offset` is rejected with `400 VALIDATION_ERROR`.

### Owner isolation

All search, sorting, and pagination queries strictly enforce caller ownership:
- Database queries include `.eq("user_id", user.id)` alongside PostgreSQL RLS policies (`recipes_select_own`).
- The handler verifies every returned record belongs to `user.id`.
- Keyset cursors represent pagination state only; submitting a cursor originating from another user's request never accesses or reveals another user's recipes.

### Example requests

**First page request (default sorting):**
```http
GET /functions/v1/recipes?pagination=cursor&limit=20 HTTP/1.1
Host: your-project.supabase.co
Authorization: Bearer <user-jwt>
```

**Search and sort request:**
```http
GET /functions/v1/recipes?pagination=cursor&title=rice&ingredient=garlic&sort=rating&limit=20 HTTP/1.1
Host: your-project.supabase.co
Authorization: Bearer <user-jwt>
```

**Continuation request:**
```http
GET /functions/v1/recipes?title=rice&ingredient=garlic&sort=rating&limit=20&cursor=eyJzb3J0IjoicmF0aW5nIiwidGl0bGUiOiJyaWNlIiwiaW5ncmVkaWVudCI6ImdhcmxpYyIsImlkIjoiMzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMzIiwiY3JlYXRlZEF0IjoiMjAyNi0xMC0yMFQwNjowMDowMC4wMDBaIiwic3RhclJhdGluZyI6NX0 HTTP/1.1
Host: your-project.supabase.co
Authorization: Bearer <user-jwt>
```

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
  ],
  "next_cursor": "eyJzb3J0IjoicmF0aW5nIiwidGl0bGUiOiJyaWNlIiwiaW5ncmVkaWVudCI6ImdhcmxpYyIsImlkIjoiMzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMzIiwiY3JlYXRlZEF0IjoiMjAyNi0xMC0yMFQwNjowMDowMC4wMDBaIiwic3RhclJhdGluZyI6NX0=",
  "has_more": true
}
```

When there are no more pages:
```json
{
  "recipes": [],
  "next_cursor": null,
  "has_more": false
}
```

Internal columns (`image_path` and `is_public`) are excluded from serialization.

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
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid pagination parameters.` | Collection `GET` has an invalid, duplicate, or out-of-range `limit` or `offset`, or combines `cursor` and `offset`. |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid pagination cursor.` | Collection `GET` has a malformed, corrupt, or incompatible `cursor`. |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid sort parameter.` | Collection `GET` has an invalid or duplicate `sort` query parameter. |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid search parameter.` | Collection `GET` has duplicate `title` or `ingredient` query parameters. |
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
- **Deterministic offline tests (48 tests in `recipes_test.ts`):** Run completely offline without database or Auth dependencies, verifying search filtering, sorting, cursor keyset pagination, schema envelopes, CRUD behavior, validation, and owner isolation.
- **Database migration tests:** Run offline via `node test-migrations.mjs`.
- **RLS remote guard test:** Run offline via `node test-rls-guard.mjs`.
- **Command:**
  ```sh
  deno test --frozen-lockfile --node-modules-dir=auto --allow-env supabase/functions/tests/recipes_test.ts
  ```

### Test database isolation

Hosted integration tests use dedicated non-production projects configured through `NON_PRODUCTION_TEST_DATABASE_SUPABASE_URL`. The guarded test migration runner requires the expected test-project reference and rejects loopback and the primary production project as targets.

### Schema and migration history

- **Initial schema:** `20261013000000_initial_schema.sql` creates base tables, RLS policies, indexes, and triggers.
- **Recipe visibility:** `20261017000001_add_is_public_to_recipes.sql` adds `is_public boolean not null default false` to `public.recipes`.
- **Dedicated recipe notes:** `20261023000002_add_notes_to_recipes.sql` adds nullable `notes text` column to `public.recipes`, enabling personal chef/cooking notes without modifying or colliding with `raw_input`. All CRUD routes (`GET`, `POST`, `PATCH`) support `notes` independently of `raw_input`.
- **Search and keyset pagination indexes:** `20261026000003_add_recipe_search_indexes.sql` creates composite indexes `idx_recipes_user_created_id` (`user_id, created_at desc, id asc`) and `idx_recipes_user_rating_created_id` (`user_id, star_rating desc nulls last, created_at desc, id asc`) supporting owner-scoped newest listing and rating keyset pagination.
- **Ingredient search column and index:** `20261026000004_add_recipe_ingredient_search.sql` adds stored generated column `ingredients_text text generated always as (ingredients::text) stored` and index `idx_recipes_user_ingredients_text` on `public.recipes(user_id, ingredients_text)`, enabling supported PostgREST `ilike` filtering over `ingredients` without unsupported casts.

### Search indexing and performance evaluation

The authenticated search operation evaluates substring filters against `title` (`title ILIKE '%term%'`) and `ingredients` (`ingredients_text ILIKE '%term%'`).

- **Index evaluation:** In PostgreSQL, arbitrary case-insensitive substring searches with leading and trailing wildcards require GIN trigram indexing using the `pg_trgm` extension. The project database currently enables only the `pgcrypto` extension (`20261013000000_initial_schema.sql`). In accordance with repository constraints prohibiting the introduction of unapproved PostgreSQL extensions, `pg_trgm` has not been added.
- **Intended index support:** The composite B-tree indexes `idx_recipes_user_created_id` (`user_id, created_at desc, id asc`) and `idx_recipes_user_rating_created_id` (`user_id, star_rating desc nulls last, created_at desc, id asc`) are intended to support caller isolation and deterministic ordering and pagination bounds. When search filters (`title ILIKE '%term%'` or `ingredients_text ILIKE '%term%'`) are supplied alongside owner and sort clauses, PostgreSQL can filter by `user_id` and order by `created_at` or `star_rating`, evaluating substring predicates as filter rechecks. However, actual planner selection depends on table statistics, data volume, and planner heuristics; without an inspected query execution plan against a live populated database, index selection by the planner is not claimed.
- **Performance limitation:** Because arbitrary substring matching with wildcards cannot use B-tree index lookups directly, tables with exceptionally large numbers of recipes per user may experience linear scan costs during substring filtering until a dedicated trigram extension (`pg_trgm`) is enabled and indexed in an approved future migration.
