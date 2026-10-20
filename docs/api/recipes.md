# Authenticated recipe creation API contract (`POST /recipes`)

This contract defines the authenticated recipe creation endpoint (`supabase/functions/recipes/index.ts`) and shared Zod schemas (`CreateRecipeRequestSchema`, `RecipeSchema`, `RecipeResponseSchema` in `supabase/functions/_shared/ai/schemas.ts`, re-exported via `supabase/functions/_shared/schemas.ts`) implemented for BE-05 (#47).

## Request

- **Method and path:** `POST /functions/v1/recipes` (also accepts `POST /recipes` when invoked directly)
- **Headers:**
  - `Authorization: Bearer <supabase-access-token>` (required)
  - `apikey: <supabase-anon-or-publishable-key>`
  - `Content-Type: application/json`
- **Query parameters:** none (any caller-supplied query parameters are ignored)
- **Access:** authenticated users only. Verified through `authenticateRequest(req, deps)` (`supabase/functions/_shared/auth.ts`).

### Request body (`CreateRecipeRequestSchema`)

```json
{
  "title": "Crispy Garlic Shallot Rice",
  "raw_input": "Leftover jasmine rice, shallots, garlic, soy sauce.",
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

#### Field rules

| Field | Required | Type / Constraints | Default / Normalization |
| --- | --- | --- | --- |
| `title` | Required | `string`, trimmed, minimum 1 non-whitespace character | Trimmed via `.trim()` |
| `raw_input` | Optional | `string \| null` | `null` when omitted |
| `ingredients` | Required | `Ingredient[]` (`IngredientSchema`: `name: string`, `quantity: number \| null`, `unit: string \| null`, `quantityText?: string`, `inferred?: boolean`) | `inferred` defaults to `false` |
| `instructions` | Required | `Instruction[]` (`InstructionSchema`: `step: number`, `text: string`) | Preserved as validated array |
| `flavor_scores` | Optional | `FlavorScores \| null` (`FlavorScoreSchema`: `sweet`, `salty`, `sour`, `bitter`, `umami`, `spicy`, each `number` in `0..5`) | `null` when omitted |
| `star_rating` | Optional | `number` (integer `1..5`) or `null` | `null` when omitted |
| `cooked_at` | Optional | `string` (valid calendar date `YYYY-MM-DD`) or `null` | `null` when omitted |

### Ownership and server-controlled fields

- Recipe ownership (`user_id`) is derived exclusively from `auth.context.user.id` after `authenticateRequest(req, deps)` verifies the Bearer token against Supabase Auth.
- Any client-supplied ownership or server-managed fields (`id`, `user_id`, `userId`, `owner_id`, `ownerId`, `is_public`, `image_url`, `image_path`, `created_at`, `updated_at`) in the request body, query parameters, or headers are stripped/ignored.
- User-created recipes are always inserted with `user_id = auth.context.user.id` and `is_public = false`.
- The database insert runs through the request-scoped RLS-aware Supabase client (`auth.context.supabase`), so PostgreSQL Row-Level Security (`recipes_insert_own` with `WITH CHECK (auth.uid() = user_id)` and `recipes_select_own` with `USING (auth.uid() = user_id)`) remains active.

## Successful response

Returns `201 Created` with `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Access-Control-Allow-Methods: POST, OPTIONS`:

```json
{
  "recipe": {
    "id": "33333333-3333-4333-8333-333333333333",
    "user_id": "99999999-9999-9999-9999-999999999999",
    "title": "Crispy Garlic Shallot Rice",
    "raw_input": "Leftover jasmine rice, shallots, garlic, soy sauce.",
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

Internal columns (`image_path` and `is_public`) are excluded from the public response envelope.

## Errors

All error responses use `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Access-Control-Allow-Methods: POST, OPTIONS`.

| HTTP status | Code | Message | When |
| --- | --- | --- | --- |
| `400 Bad Request` | `INVALID_JSON` | `Request body must be a valid JSON object.` | Request body is empty, malformed JSON, or not a plain JSON object (e.g., array or primitive). |
| `400 Bad Request` | `VALIDATION_ERROR` | `Invalid recipe payload.` | Request body fails `CreateRecipeRequestSchema` validation. Includes `error.details` array of `{ path, code, message }`. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Missing or invalid Authorization header.` | `Authorization` header is missing, empty, not `Bearer`, or not a compact 3-part JWS. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Invalid or expired authentication credentials.` | Supabase Auth rejects the Bearer JWT as invalid, expired, revoked, or unauthenticated. |
| `404 Not Found` | `NOT_FOUND` | `Route not found.` | Request targets an unsupported sub-path under `/recipes`. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only POST and OPTIONS methods are supported.` | Request uses an HTTP method other than `POST` or `OPTIONS`. Includes `Allow: POST, OPTIONS`. |
| `503 Service Unavailable` | `AUTH_SERVICE_RATE_LIMITED` | `Authentication service is temporarily unavailable. Please try again later.` | Upstream Supabase Auth returns `429 Too Many Requests` during token verification. Propagates a validated `Retry-After` header when present. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | `Internal server error.` | Missing/invalid server configuration, upstream Auth failure, database persistence error, RLS denial, or response schema validation failure. Never exposes secrets, tokens, SQL details, or stack traces. |

## CORS behavior

- `OPTIONS` preflight requests are handled before authentication and return `204 No Content` with `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`, and `X-Content-Type-Options: nosniff`.
- In `supabase/config.toml`, `[functions.recipes]` sets `verify_jwt = false` at the gateway so unauthenticated browser `OPTIONS` preflight requests reach the handler while `POST` strictly enforces `authenticateRequest(req, deps)`.
