# AI Integration Contracts

Status: **AI-05 (Sprint 3)**. The extraction endpoint is implemented and tested.
The Chef/RAG generator (`POST /generate-recipe`, AI-06) is not implemented yet.

- Provider/model come from environment settings; clients never choose a model (AI-02/AI-03).
- All AI output is Zod-validated before it leaves the backend (AI-10).
- Extraction **never persists**. It returns a validated preview; saving is a separate,
  explicit `POST /recipes`.

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
| 429  | `QUOTA_EXCEEDED`       | Daily per-user AI limit reached (AI-17) | seconds until the UTC reset |
| 429  | `AI_RATE_LIMITED`      | Gemini returned `429` | provider cooldown, else `30` |
| 502  | `AI_OUTPUT_INVALID`    | Model output failed schema validation (AI-10) | no |
| 502  | `AI_PROVIDER_REJECTED` | Provider rejected the request (bad key/model) | no |
| 503  | `AI_UNAVAILABLE`       | Provider `5xx`/transport failure | no |
| 503  | `QUOTA_UNAVAILABLE`    | The quota check itself failed | no |
| 503  | `AI_DISABLED`          | Operator kill switch (`AI_EXTRACT_DISABLED`) is on | no |
| 503  | `AUTH_SERVICE_RATE_LIMITED` | Supabase Auth rate-limited the token check | auth service cooldown, if it sent one |
| 504  | `AI_TIMEOUT`           | Provider did not respond in time | no |
| 500  | `INTERNAL_ERROR`       | Unexpected server error | no |

The endpoint does **not** retry a `429` itself. The adapter already performed its one
bounded retry (AI-18). A `rate_limited` surfaced here means that single retry was either
**exhausted** (the provider kept returning `429`) or **skipped** because the provider's
cooldown was longer than the adapter's 5-second budget. Either way the client should back
off for the full `Retry-After`: the provider's own cooldown when it named one, otherwise
`30` seconds.

### Quota (AI-17)

Quota is checked **before** the provider call. The default gate reads the caller's
`ai_usage_daily` row for the current UTC day through the user-scoped client (RLS
`ai_usage_select_own`; the `authenticated` role has no insert/update grant, so the
endpoint cannot write usage). The limit is `AI_DAILY_LIMIT` (default **20**; a blank,
non-numeric, or `< 1` value falls back to 20). A read failure fails closed as
`503 QUOTA_UNAVAILABLE`.

Counting/consumption is owned by **BE-12** (issue #100). AI-05 exposes the boundary as
an injected `QuotaCheck` (`supabase/functions/_shared/ai/quota.ts`); BE-12 replaces the
default with atomic accounting without changing the handler.

**Known limitation until BE-12 lands.** AI-05 must never write (extraction is a read-only
preview), so the default gate can only *observe* usage that a writer has already recorded.
It cannot advance the counter itself, which means it does not yet meter a user on its own —
it is the integration seam, not the enforcement point. Two things cover the gap meanwhile:

- The endpoint **fails closed**: if the counter read errors, it returns
  `503 QUOTA_UNAVAILABLE` rather than handing out an unmetered provider call.
- The operator **kill switch** `AI_EXTRACT_DISABLED` (truthy) refuses all extraction with
  `503 AI_DISABLED` before the quota read or any provider spend, so spend/abuse can be cut
  without a deploy. Set it (and redeploy/restart the function) if provider usage must stop
  before BE-12 is live.

## Failure drills (demo only)

Non-production failure states are opt-in environment switches on the function. They are
never reachable from the client and never enabled in production. A drill needs **both** the
master switch and the specific drill, so a single stray variable cannot turn a real
deployment into an outage:

| Env var                  | Role |
| ------------------------ | ---- |
| `AI_ALLOW_FAILURE_DRILLS`| Master switch; without it no drill fires |
| `AI_SIMULATE_OUTAGE`     | With the master switch on, returns `503 AI_UNAVAILABLE` as if Gemini were down |
| `AI_SIMULATE_BAD_OUTPUT` | With the master switch on, returns `502 AI_OUTPUT_INVALID` as if the model misbehaved |

Truthy values are `1`, `true`, `yes`, `on` (case-insensitive).

A separate, production-safe operator switch is `AI_EXTRACT_DISABLED` (truthy): it refuses
all extraction with `503 AI_DISABLED` and is safe to set in production as a stopgap
kill switch (see [Quota](#quota-ai-17)).

## Provider details

- Adapter: `GeminiAdapter` (`supabase/functions/_shared/ai/GeminiAdapter.ts`).
- Model: `AI_MODEL` env override, otherwise the pinned `gemini-3.5-flash-lite`.
- Prompt: versioned template `extraction@1.0.0`.
- JSON mode is requested but not trusted — output is parsed and Zod-validated twice
  (adapter, then endpoint).
- Logs are metadata-only: operation, model, prompt id/version, attempt, latency, outcome.
  Prompt and recipe text are never logged.

## Frontend notes (FE-08)

- Submit the user's notes and keep them in component state; a provider or quota failure
  must not erase them (retry reuses the same text).
- Never call Gemini or application tables directly; go through this endpoint.
- Map `401` → sign-in, `429` → "try again later" (honor `Retry-After`), `4xx` → fix the
  input, `5xx`/`502`/`503`/`504` → transient "try again" with the notes preserved.
