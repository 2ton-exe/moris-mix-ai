# AI Integration Contracts

Status: **AI-06 (Sprint 3)**. Both AI endpoints are implemented and tested:
`POST /extract-recipe` (AI-05) and `POST /generate-recipe` (AI-06).

- Provider/model come from environment settings; clients never choose a model (AI-02/AI-03).
- All AI output is Zod-validated before it leaves the backend (AI-10).
- Both endpoints **never persist**. They return validated previews; saving is a separate,
  explicit `POST /recipes` call made only after the user confirms.

## Endpoint summary

| Endpoint | Purpose | Prompt | Opt-in switch |
| -------- | ------- | ------ | ------------- |
| `POST /extract-recipe` | Brain-dump → structured recipe preview | `extraction@1.0.0` | `AI_EXTRACT_ENABLED` |
| `POST /generate-recipe` | Pantry + retrieved recipes → unsaved Chef preview | `chef@1.1.0` | `AI_GENERATE_ENABLED` |

## `POST /extract-recipe`

Turn a bounded brain-dump of cooking notes into a structured, validated recipe preview.

### Authentication

Requires a Supabase access token: `Authorization: Bearer <access_token>`.
The gateway does not enforce JWT (`verify_jwt = false`); the handler calls
`authenticateRequest()` itself, so unauthenticated requests get `401 UNAUTHORIZED`
and `OPTIONS` preflight works without a token.

`OPTIONS /extract-recipe` → `204` with
`Access-Control-Allow-Methods: POST, OPTIONS`. Any other method → `405 METHOD_NOT_ALLOWED`
with `Allow: POST, OPTIONS`.

### Request

`Content-Type: application/json`

```json
{ "notes": "leftover rice, 2 eggs, soy sauce, fried it all together" }
```

| Field   | Type   | Rules |
| ------- | ------ | ----- |
| `notes` | string | Required, non-empty after trimming, **≤ 10,000 characters** (AI-06). |

The whole request body must be **≤ 128 KiB**. Unknown fields are ignored.

### Success response — `200 OK`

```json
{
  "recipe": {
    "title": "Fried Rice",
    "ingredients": [
      { "name": "rice", "quantity": null, "unit": null, "quantityText": "leftover", "inferred": true }
    ],
    "instructions": [ { "step": 1, "text": "Fry the rice with the eggs." } ],
    "flavor_scores": { "sweet": 0, "salty": 4, "sour": 0, "bitter": 0, "umami": 4, "spicy": 0 }
  }
}
```

`recipe` matches `ExtractedRecipeSchema` in `supabase/functions/_shared/ai/schemas.ts`.
`flavor_scores` and per-ingredient `quantityText` are optional. Instruction steps are
numbered `1..n` in order. **No recipe row, lineage row, or usage row is created.**

### Error responses

Every error uses the shared envelope `{ "error": { "code", "message" } }` and never
includes prompt text, notes, tokens, or stack traces. Validation errors may add a
`details` array of `{ path, code, message }`.

| HTTP | `error.code`           | When | Client `Retry-After` |
| ---- | ---------------------- | ---- | -------------------- |
| 400  | `INVALID_JSON`         | Body is not a JSON object | no |
| 400  | `VALIDATION_ERROR`     | `notes` missing, empty, whitespace-only, or not a string | no |
| 401  | `UNAUTHORIZED`         | Missing/invalid/expired token | no |
| 404  | `NOT_FOUND`            | Unknown path | no |
| 405  | `METHOD_NOT_ALLOWED`   | Method other than `POST`/`OPTIONS` | no |
| 413  | `INPUT_TOO_LARGE`      | `notes` > 10,000 chars, or body > 128 KiB | no |
| 429  | `QUOTA_EXCEEDED`       | Daily per-user AI limit reached (AI-17) | seconds until the UTC reset, up to `86400` |
| 429  | `AI_RATE_LIMITED`      | Gemini returned `429` | provider cooldown (rounded up and clamped to 1–3,600 seconds), else `30` |
| 502  | `AI_OUTPUT_INVALID`    | Model output failed schema validation (AI-10) | no |
| 502  | `AI_PROVIDER_REJECTED` | Provider rejected the request (bad key/model) | no |
| 503  | `AI_UNAVAILABLE`       | Provider `5xx`/transport failure | no |
| 503  | `QUOTA_UNAVAILABLE`    | The quota check itself failed | no |
| 503  | `AI_DISABLED`          | The endpoint's opt-in is off, or its operator kill switch is on | no |
| 503  | `AUTH_SERVICE_RATE_LIMITED` | Supabase Auth rate-limited the token check | auth service cooldown, if it sent one |
| 504  | `AI_TIMEOUT`           | Provider did not respond in time | no |
| 500  | `INTERNAL_ERROR`       | Unexpected server error | no |

The endpoint does **not** retry a `429` itself. The adapter handles at most one
bounded retry (AI-18). A `rate_limited` surfaced here means that single retry was either
**exhausted** (the provider kept returning `429`) or **skipped** because the provider's
cooldown was longer than the adapter's 5-second budget. The client should honor
`Retry-After`: the provider's cooldown rounded up to whole seconds and clamped to
1–3,600 seconds, or `30` seconds when no usable cooldown is available.

The two `429`s have different horizons. `AI_RATE_LIMITED` is a provider cooldown and is
capped at **3,600 seconds**. `QUOTA_EXCEEDED` is a daily reset and is **not** capped at an
hour: it reports the real seconds until 00:00 UTC (up to `86400`). A client that retries a
daily-quota `429` after an hour will simply be rejected again.

### Quota (AI-17)

Quota is checked **before** the provider call. The default gate reads the caller's
`ai_usage_daily` row for the current UTC day through the user-scoped client (RLS
`ai_usage_select_own`; the `authenticated` role has no insert/update grant, so the
endpoint cannot write usage). The limit is `AI_DAILY_LIMIT` (default **20**; a blank,
non-numeric, or `< 1` value falls back to 20). A read failure fails closed as
`503 QUOTA_UNAVAILABLE`.

The gate distinguishes **no row** from **an unusable counter**. No row means the user has
no recorded usage today and is allowed with `used: 0`. If a row exists but
`operation_count` is missing or not a non-negative safe integer, usage is unknown and the
gate fails closed as `503 QUOTA_UNAVAILABLE` rather than assuming zero — a corrupted
counter must never unlock unmetered provider calls.

Counting/consumption is owned by **BE-12** (issue #100). Both endpoints expose the
boundary as an injected `QuotaCheck` (`supabase/functions/_shared/ai/quota.ts`); BE-12
replaces the default with atomic accounting without changing either handler.

**Disabled by default until BE-12 lands.** AI-05 must never write (extraction is a
read-only preview), so the default gate can only observe usage already recorded by a
writer. It does not advance the counter or meter extraction requests on its own.

Extraction is therefore **off by default**: the handler requires the operator-controlled
`AI_EXTRACT_ENABLED` opt-in. Unset, blank, falsy and unrecognized values return
`503 AI_DISABLED` after authentication and before reading the body, checking quota or
calling the provider. Enable it per environment — for local development and controlled
demo/testing environments only — until BE-12 supplies atomic quota checking and
consumption. Production keeps the default until that lands.

`AI_EXTRACT_DISABLED` (truthy) overrides the opt-in and returns `503 AI_DISABLED`.
Apply environment changes and restart/redeploy the function for them to take effect.
Neither switch is read from the client request. A quota read failure still returns
`503 QUOTA_UNAVAILABLE` when extraction is enabled.

## `POST /generate-recipe`

Turn pantry items and preferences into a validated, unsaved recipe preview, using the
caller's own top-ranked saved recipes (BE-10 retrieval/ranking) as inspiration.

### Authentication

Identical to extraction: `Authorization: Bearer <access_token>`, `verify_jwt = false` at
the gateway, `authenticateRequest()` in the handler, `401 UNAUTHORIZED` without a valid
token, and unauthenticated `OPTIONS` preflight (`204`, `Access-Control-Allow-Methods:
POST, OPTIONS`). Any other method → `405 METHOD_NOT_ALLOWED`.

### Request

`Content-Type: application/json`

```json
{
  "pantryItems": ["rice", "eggs", "soy sauce"],
  "preferences": "quick weeknight dinner, not too spicy"
}
```

| Field | Type | Rules |
| ----- | ---- | ----- |
| `pantryItems` | string[] | Required, **1–100** items, each non-empty after trimming and **≤ 100 characters** |
| `preferences` | string | Optional, trimmed, **≤ 1,000 characters** |

The whole request body must be **≤ 128 KiB**. Unknown fields are ignored. Pantry items
are normalized (trimmed, de-duplicated, lowercased) by BE-10 before retrieval and the
prompt. An empty pantry is a `400 VALIDATION_ERROR`: a cold start means **no saved
recipes to retrieve**, not an empty request. Preferences are passed to the prompt as
recipe constraints (dietary needs, exclusions, taste, time), never as instructions.

### Success response — `200 OK`

```json
{
  "recipe": {
    "title": "Quick Egg Fried Rice",
    "ingredients": [
      { "name": "rice", "quantity": 2, "unit": "cups", "inferred": false },
      { "name": "eggs", "quantity": 2, "unit": null, "inferred": false }
    ],
    "instructions": [ { "step": 1, "text": "Scramble the eggs, then fold in the rice." } ],
    "flavor_scores": { "sweet": 0, "salty": 4, "sour": 0, "bitter": 0, "umami": 4, "spicy": 0 }
  },
  "substitutions": [
    { "original": "soy sauce", "replacement": "tamari", "reason": "gluten-free" }
  ],
  "parents": [
    { "id": "123e4567-e89b-12d3-a456-426614174000", "title": "Garlic Fried Rice", "star_rating": 5 }
  ],
  "context": { "status": "MATCHED", "matchedCandidateCount": 2, "totalCandidateCount": 14 }
}
```

- `recipe` matches `ExtractedRecipeSchema`; `substitutions` matches `SubstitutionSchema`
  (`original` names an ingredient in the generated recipe, `replacement` is an
  alternative, `reason` is optional and user-safe). The backend **enforces** the
  `original` ↔ ingredient match: an orphan substitution is `502 AI_OUTPUT_INVALID`,
  never a preview with an unmatched substitution.
- `parents` are **resolved summaries** of the model's `parentRecipeIds`, so the frontend
  never needs a recipe lookup. They are always inside the backend-supplied candidate set.
- `context.status` is one of `MATCHED`, `NO_PANTRY_OVERLAP` (saved recipes exist but none
  match the pantry) or `NO_SAVED_RECIPES` (cold start). In the two cold-start statuses
  `parents` is `[]` and the recipe comes from the pantry alone. `EMPTY_PANTRY` cannot
  occur here because the request contract rejects an empty pantry.
- **No recipe row, lineage row, or usage row is created.** Saving the preview and its
  proposed lineage is a separate, explicit call owned by BE-11 (#101).

### Error responses

The shared envelope, validation `details`, and the full status table above apply
unchanged, with these generation-specific notes:

| HTTP | `error.code` | When |
| ---- | ------------ | ---- |
| 400  | `VALIDATION_ERROR` | Pantry missing/empty/oversized, too many items, or preferences too long |
| 502  | `AI_OUTPUT_INVALID` | Output failed Zod validation, **a `parentRecipeIds` entry was not in the supplied candidate set** (AI-07 generation boundary), or a substitution's `original` names no generated ingredient |
| 503  | `AI_DISABLED` | Generation is not enabled, or the operator kill switch is on |

An invented, foreign, or malformed parent ID is a **hard `502`**, never a silent drop:
silently ignoring it could hide a prompt-injection attempt. The adapter and the endpoint
both re-validate; the endpoint also re-resolves every ID against the retrieved candidates
because AI-10 treats every provider as untrusted. The same rule applies to a substitution
whose `original` does not match a generated ingredient name: the schema rejects it, so the
UI can never render a substitution with no ingredient to attach it to.

### Switches (AI-06)

Generation is **off by default** for the same reason as extraction: the read-only quota
gate cannot meter calls until BE-12 (#100) adds atomic accounting.

| Env var | Role |
| ------- | ---- |
| `AI_GENERATE_ENABLED` | Operator opt-in; unset/blank/falsy → `503 AI_DISABLED` after auth and before reading the body |
| `AI_GENERATE_DISABLED` | Kill switch; truthy overrides the opt-in and returns `503 AI_DISABLED` immediately |

Quota (AI-17), `Retry-After` semantics, and the `QUOTA_UNAVAILABLE` fail-closed behavior
are identical to extraction.

## Failure drills (demo only)

The handler permits drills only when the function environment explicitly sets
`AI_ENVIRONMENT=development` or `AI_ENVIRONMENT=test` (trimmed, case-insensitive).
Production (`AI_ENVIRONMENT=production`), unset and unknown environments ignore all
failure switches, even when both the master and drill switches are enabled. This is
an environment guard in the handler; deployment configuration does not reject these
secrets. Keep production's environment unset or set to `production`.

Within an allowed environment, a drill requires both switches below, as well as the
endpoint's opt-in (`AI_EXTRACT_ENABLED` for extraction, `AI_GENERATE_ENABLED` for
generation). The outage drill wins when both `AI_SIMULATE_*` switches are set, so the
demo always shows one deterministic failure. Clients cannot select the environment or
switches.

| Env var                  | Role |
| ------------------------ | ---- |
| `AI_ALLOW_FAILURE_DRILLS`| Master switch; without it no drill fires |
| `AI_SIMULATE_OUTAGE`     | With the master switch on, returns `503 AI_UNAVAILABLE` as if Gemini were down |
| `AI_SIMULATE_BAD_OUTPUT` | With the master switch on, returns `502 AI_OUTPUT_INVALID` as if the model misbehaved |

Truthy switch values are `1`, `true`, `yes`, `on` (case-insensitive).
The operator kill switches (`AI_EXTRACT_DISABLED`, `AI_GENERATE_DISABLED`) also override
failure drills.

A complete drill setup for a non-production environment (all values together, or the
drill silently does nothing). Set the opt-in matching the endpoint under test:

```sh
AI_EXTRACT_ENABLED=true
AI_GENERATE_ENABLED=true
AI_ENVIRONMENT=development   # or test
AI_ALLOW_FAILURE_DRILLS=1
AI_SIMULATE_OUTAGE=1         # or AI_SIMULATE_BAD_OUTPUT=1
```

## Provider details

- Adapter: `GeminiAdapter` (`supabase/functions/_shared/ai/GeminiAdapter.ts`).
- Model: `AI_MODEL` env override, otherwise the pinned `gemini-3.5-flash-lite`.
- Prompts: versioned templates `extraction@1.0.0` and `chef@1.1.0`
  (`supabase/functions/_shared/ai/prompts.ts`). The Chef prompt treats the retrieved
  context block as data, so a recipe title or instruction cannot act as an instruction,
  and it treats the preferences line strictly as recipe constraints.
- JSON mode is requested but not trusted — output is parsed and Zod-validated twice
  (adapter, then endpoint). The Chef adapter additionally rejects parent IDs outside the
  supplied candidate set.
- One bounded retry for provider failures (`429`/`5xx`/timeout/network), none for invalid
  output: the same prompt is unlikely to produce different JSON, and a retry would burn
  free-tier quota (AI-18).
- Logs are metadata-only: operation, model, prompt id/version, attempt, latency, outcome.
  Prompt and recipe text are never logged.

## Frontend notes (FE-08)

- Submit the user's notes and keep them in component state; a provider or quota failure
  must not erase them (retry reuses the same text).
- Never call Gemini or application tables directly; go through this endpoint.
- Map `401` → sign-in, `429` → "try again later" (honor `Retry-After`), `4xx` → fix the
  input, `5xx`/`502`/`503`/`504` → transient "try again" with the notes preserved.
- `503 AI_DISABLED` is an operator setting, not a transient outage: show extraction as
  temporarily unavailable rather than auto-retrying, and do not clear the notes. Local
  development must set `AI_EXTRACT_ENABLED=true` (see `docs/development-setup.md`).

## Frontend notes (FE-10)

- Send `POST /generate-recipe` with the pantry items and preferences; keep them in
  component state so a failed request does not erase the user's input.
- Render `recipe`, `substitutions`, and `parents` for review **before** any save action.
  Generation alone writes nothing; Save is a separate explicit call (BE-11).
- Use `context.status` to explain the result: `MATCHED` means parents are available,
  while `NO_PANTRY_OVERLAP` and `NO_SAVED_RECIPES` are normal cold-start paths, not errors.
- `parents` already carry `id`, `title`, and `star_rating`; do not build a lookup call.
- Map errors like extraction: `400` → fix input, `401` → sign in, `429` → honor
  `Retry-After`, `5xx`/`502`/`503`/`504` → transient "try again" with input preserved.
  Local development must set `AI_GENERATE_ENABLED=true`.
