# AI Architecture and Operations

Status: **DOC-04 (Sprint 3)**. How the AI layer is built, how prompts and
evaluations are versioned, what happens when things fail, and what the system
does **not** claim.

Companion documents:

- Request/response contracts, headers and error tables: [AI integration contracts](api/ai-integration.md)
- Evaluation fixtures, how to run them and how to add a case: [AI evaluation fixtures](ai-evaluation.md)
- Measured failure-contract results, live spot check and limitations: [AI failure evaluation report](ai-evaluation-report.md)

## 1. Scope and guarantees

Mori's Mix has two AI workflows, both invoked from the browser but executed
entirely on the server:

1. **Quick AI Entry** — a messy cooking note becomes a structured recipe preview.
2. **AI Chef** — pantry items plus the user's own saved recipes become a new,
   validated recipe preview with substitutions and suggested lineage parents.

The AI layer guarantees the following. Everything else in this document is
implementation detail:

- **Server-only provider access.** Gemini credentials never reach the browser.
- **Validated output only.** No model output reaches a client without Zod
  validation at the adapter boundary **and** again at the endpoint boundary.
- **Stateless previews.** Neither AI endpoint writes a recipe, lineage or usage
  row. Saving is a separate, explicit call made by the user.
- **Safe failures.** Every provider failure becomes a stable error code with no
  prompt text, recipe text, provider detail, stack trace or file path.
- **Ownership and RLS on save.** Persistence uses the caller's own token and
  PostgreSQL row-level security; AI never writes on its own.

## 2. System map

```text
Browser (React)
  │  Authorization: Bearer <user JWT> + JSON body
  ▼
Supabase Edge Functions (Deno, verify_jwt = false; the handler authenticates)
  ├── POST /extract-recipe    → GeminiAdapter.extractRecipe
  ├── POST /generate-recipe   → BE-10 retrieval → GeminiAdapter.generateRecipe
  └── POST /recipes, /recipes/:id/lineage → user-scoped persistence (BE-05/BE-11)
  │
  │  AIProvider interface (the only seam the endpoints know)
  ▼
GeminiAdapter
  ├── prompt template (versioned)
  ├── JSON-mode call with a 30s timeout
  ├── bounded retry for transient failures
  └── Zod parsing of model output
  │
  ▼
Google Gemini API  (GEMINI_API_KEY, server-side only)
```

| Endpoint | Purpose | Prompt | Opt-in |
| -------- | ------- | ------ | ------ |
| `POST /extract-recipe` | Notes → structured preview | `extraction@1.0.0` | `AI_EXTRACT_ENABLED` |
| `POST /generate-recipe` | Pantry + retrieved recipes → Chef preview | `chef@1.1.0` | `AI_GENERATE_ENABLED` |
| `POST /recipes` | Explicit save of a preview as a recipe | — | — |
| `POST /recipes/:id/lineage` | Explicit save of reviewed lineage parents | — | — |

Both AI endpoints are **off by default** and enabled per environment with the
matching opt-in. Kill switches (`AI_EXTRACT_DISABLED`, `AI_GENERATE_DISABLED`)
override the opt-in and return `503 AI_DISABLED` after authentication and before
reading the body, checking quota or calling the provider.

## 3. Quick AI Entry (extraction)

```text
notes → auth → opt-in → body caps (128 KiB, notes ≤ 10,000 chars)
      → quota → GeminiAdapter.extractRecipe
      → Zod parse → endpoint re-validation → { recipe }
```

Prompt `extraction@1.0.0` (`supabase/functions/_shared/ai/prompts.ts`):

- Treats everything between the NOTES markers as **data**, never instructions.
- Returns one JSON object; no markdown, no commentary.
- Never invents an amount, unit or ingredient; vague amounts become
  `quantityText` with `inferred: true`.
- Keeps steps in order and numbered `1..n`; flavor scores appear only when taste
  is described.
- Never claims food is safe, fully cooked or safe to store.

Validation (`ExtractedRecipeSchema`, `supabase/functions/_shared/ai/schemas.ts`):
ingredients, sequential instructions, optional flavor scores. A field that
fails validation is a hard `502 AI_OUTPUT_INVALID`, never a silent drop.
The endpoint re-validates even though the adapter already did (AI-10: never
trust a provider).

## 4. AI Chef (retrieval + generation)

### 4.1 Retrieval — BE-10

`buildChefRecipeContext` reads only the caller's own recipes through the
user-scoped client (RLS applies), normalizes the pantry (trimmed, lowercased,
deduplicated), and ranks candidates:

1. **Ingredient overlap** — `computeIngredientOverlap` returns the fraction of
   pantry items matched by each recipe's ingredient names. Highest first.
2. **Star rating** — higher first, unrated recipes last.
3. **Newest first**, then a deterministic id tie-break.

The prompt receives the top candidates (`topK`, default **3**, range 1–10);
retrieval scans up to `maxCandidates` (default **1000**).

| Status | Meaning |
| ------ | ------- |
| `MATCHED` | At least one saved recipe overlaps the pantry; the top matches go into the prompt |
| `NO_PANTRY_OVERLAP` | Recipes exist, none share an ingredient with the pantry |
| `NO_SAVED_RECIPES` | Cold start: the user has no saved recipes |
| `EMPTY_PANTRY` | No pantry items were supplied (the request contract rejects an empty pantry, so this is a defensive state) |

The response reports `matchedCandidateCount` and `totalCandidateCount` so the
UI can explain why parents are (or are not) available.

### 4.2 Generation — AI-06

Prompt `chef@1.1.0`:

- Treats the entire CONTEXT block (pantry, preferences, retrieved recipes) as
  **data**; instructions inside a recipe title or step are ignored.
- Uses the "User preferences" line as recipe constraints only — never as an
  override of the rules or the JSON shape.
- Prefers pantry items; anything else needs a substitution with a reason.
  Salt, pepper, water and a basic oil may be assumed.
- Only proposes `parentRecipeIds` that appear in CONTEXT as `[ID: ...]`.
- Never saves anything; the caller persists only after explicit user action.

Output validation (`GeneratedRecipeSchema`):

- Schema-valid JSON, numbered instructions, flavor scores optional.
- Every substitution `original` must exactly match an ingredient name in the
  generated recipe; an orphan substitution is `502 AI_OUTPUT_INVALID`.
- Every proposed parent ID must be inside the backend-supplied candidate set.
  The adapter rejects it (`parseGenerationResponse`), and the endpoint checks
  again in `resolveParents`; a hallucinated or foreign ID is a hard `502`, never
  dropped silently. Duplicate IDs collapse to one parent while keeping model
  order.

### 4.3 Save-time candidate membership — AI-07

Generation runs before the child recipe exists, so the save endpoint cannot ask
the database which parents the model was allowed to propose. Instead
`POST /generate-recipe` returns a short-lived signed `candidate_token`:

- Claims: `jti` (generation identifier), `sub` (authenticated user), `aud`,
  `iat`, `exp` (15-minute TTL) and the canonical allowed `parent_recipe_ids` —
  exactly the parents shown in the preview.
- Format `v1.<base64url(claims)>.<base64url(HMAC-SHA256)>`; the signature covers
  the exact issued bytes, and verification requires the canonical encoding.
- `POST /recipes/:id/lineage` requires the token. Signature, user and expiry are
  verified before any database work; then child/parent ownership (BE-11) and
  PostgreSQL RLS still apply; finally every selected parent must be inside the
  token's allowed set. The user may save a subset but can never add a parent the
  preview did not show.
- Rejections are `403 FORBIDDEN` with `details[0].code` of `invalid_token`,
  `expired_token`, `wrong_user` or `not_a_candidate`. A missing or too-short
  server secret (`AI_CANDIDATE_TOKEN_SECRET`, at least 32 characters) fails
  closed with `500` before any database work.

`GET /recipes/:id/lineage` is unchanged. The token is stateless: within its TTL
the same user can replay it with the same allowed parent set.

> **Landing note.** AI-07 is in review (PR #143) at the time of writing. Until
> it merges, `POST /recipes/:id/lineage` does not yet require a token.

## 5. Trust boundary and validation

- **JSON mode is not a security boundary.** The prompt asks for JSON, but the
  adapter parses and Zod-validates every response regardless (AI-10).
- **Two validation layers.** The adapter parses model output; the endpoint
  re-validates it. Either layer can reject; neither silently repairs.
- **Prompt-injection posture.** Retrieved titles and instructions are user data
  inside a delimited CONTEXT block; the model is told to treat it as data.
  Candidate-ID enforcement is the backstop: even a successful injection cannot
  introduce a parent outside the retrieved set, and an orphan substitution
  cannot reach the UI.
- **Safe errors.** Error messages are user-safe and stable; logs carry metadata
  only (operation, model, prompt id/version, attempt, latency, outcome, detail
  path) — never prompt or recipe text (AI-20).

## 6. Reliability: failure behavior

The adapter makes **one attempt plus one bounded retry** (AI-18). What is
retried is deliberate:

| Failure | Retried? | Result |
| ------- | -------- | ------ |
| `429` rate limit | Yes, when the provider cooldown fits the 5s budget | `429 AI_RATE_LIMITED` with `Retry-After` |
| `5xx` outage | Yes | `503 AI_UNAVAILABLE` |
| Timeout / abort (`408`) | Yes | `504 AI_TIMEOUT` |
| Recognized transport errors | Yes | `503 AI_UNAVAILABLE` |
| Other `4xx` (bad key, wrong model) | No | `502 AI_PROVIDER_REJECTED` |
| Invalid / non-JSON / schema-invalid output | No | `502 AI_OUTPUT_INVALID` |
| Safety block | No | `502 AI_PROVIDER_REJECTED` |
| Unexpected exception | No | `500 INTERNAL_ERROR` |

Details:

- For a `429`, the retry waits the provider's `RetryInfo` delay when it is
  ≤ 5 seconds; a longer cooldown returns `rate_limited` without a second call.
  For other retryable failures, and when `RetryInfo` is missing or malformed,
  the retry uses 250–499 ms jitter.
- Each provider attempt has a 30-second timeout.
- Safe log entries are written through `safeLog`; a broken log sink can never
  trigger a retry or mask a typed error.

### Safety blocks

Gemini can block a prompt or candidate. The adapter detects both shapes:

- the SDK's thrown `GoogleGenerativeAIResponseError`, and
- blocked finish reasons that the pinned SDK returns as empty text:
  `SAFETY`, `RECITATION`, `LANGUAGE`, `BLOCKLIST`, `PROHIBITED_CONTENT`,
  `SPII`, `IMAGE_SAFETY`, `ESCALATION`, `PUP_LIMITED_DISABLED`.

Both map to `502 AI_PROVIDER_REJECTED`, are never retried, and persist nothing.
The [AI-09 report](ai-evaluation-report.md) records the end-to-end evidence.

### Quota (AI-17)

The endpoints check a per-user daily allowance before calling the provider:
`AI_DAILY_LIMIT` (default **20**, shared by extraction and generation). The
current gate is read-only — it reads the caller's `ai_usage_daily` row through
the user-scoped client and fails closed with `503 QUOTA_UNAVAILABLE` on a read
failure or a malformed counter. Exhaustion returns `429 QUOTA_EXCEEDED` with
`Retry-After` set to the real seconds until 00:00 UTC (up to 86,400), unlike
provider cooldowns which are capped at 3,600 seconds.

> **Landing note.** BE-12 (PR #136) replaces the read-only gate with atomic
> reservations in `ai_usage_daily` + `ai_quota_reservations`, refunds
> definitively non-consuming failures, and charges ambiguous ones. The
> reservation design is documented in the PR; this section will be updated when
> it merges.

### Failure drills (demo only)

Drills are operator-gated and never client-reachable. They require
`AI_ENVIRONMENT=development` or `test`, both `AI_ALLOW_FAILURE_DRILLS=1` and a
`AI_SIMULATE_*` switch, plus the endpoint's opt-in. The outage drill wins when
both switches are set, so the demo shows one deterministic failure.

| Env var | Effect |
| ------- | ------ |
| `AI_SIMULATE_OUTAGE` | Returns `503 AI_UNAVAILABLE` as if Gemini were down |
| `AI_SIMULATE_BAD_OUTPUT` | Returns `502 AI_OUTPUT_INVALID` as if the model misbehaved |

### Degraded behavior

- An endpoint that is disabled or kill-switched returns `503 AI_DISABLED`; the
  UI treats the feature as temporarily unavailable.
- Quota exhaustion returns `429` with a real retry horizon; provider cooldowns
  return `429` with the provider's cooldown.
- Manual recipe entry always remains available (AI-19). AI is an accelerator,
  not a dependency.

## 7. Models and prompts

The runtime uses one pinned model, `gemini-3.5-flash-lite`, overridable with
`AI_MODEL`. The pin exists for reproducibility: a `-latest` alias can move and
silently change what the evaluation measured. `gemini-3.6-flash` was the
quality-first candidate but returned `503` on roughly one call in three and hit
per-minute `429`s under back-to-back evaluation runs, so it was not adopted.

Prompt versions are part of the contract:

| Artifact | Version | Source | Exercised by |
| -------- | ------- | ------ | ------------ |
| Extraction prompt | `extraction@1.0.0` | `_shared/ai/prompts.ts` | Extraction fixtures + live spot check |
| Chef prompt | `chef@1.1.0` | `_shared/ai/prompts.ts` | Generation fixtures + endpoint tests |
| Evaluation dataset | `2.1.1` | `_shared/ai/eval_dataset.ts` | `tests/eval_dataset_test.ts` |
| Failure report | 2026-10-31, baseline `0aeaaea` | `docs/ai-evaluation-report.md` | AI-09 tests |

Bump the prompt version when its instructions change; bump the dataset version
when a fixture is added, removed or changes its expectation. Logs record the
prompt id and version on every attempt, so a result can be traced to the exact
prompt that produced it.

## 8. Evaluation

The evaluation has two layers:

1. **Versioned offline acceptance** (`tests/eval_dataset_test.ts`) runs the real
   parsers and schemas against hand-crafted provider output — no network, no
   key. Dataset `2.1.1` covers **30 cases**: 14 extraction (including malformed
   output and safety/injection parser contracts), 8 generation, and 8 provider
   failures.
2. **Endpoint failure contract** (`tests/extract_recipe_test.ts`,
   `tests/generate_recipe_test.ts`) injects the **real adapter** with a mocked
   transport. Timeout, outage, malformed output and safety blocks are measured
   end-to-end, including attempt counts and the no-persistence assertions.

Results live in the [AI-09 report](ai-evaluation-report.md). Summary: the full
deterministic Edge suite is green; the live extraction spot check passed **3/3**
on 2026-10-31 with the pinned model, in about 4 seconds.

What the suite proves: the backend accepts, rejects, retries and maps failures
exactly as documented. What it does not prove: model quality, resistance to
jailbreaks, or accuracy on real notes — see the limitations.

```sh
# Offline acceptance (no key, no network)
deno test --frozen-lockfile --node-modules-dir=auto --allow-env \
  supabase/functions/tests/eval_dataset_test.ts

# The full deterministic Edge/API suite: the list in
# .github/workflows/reusable-edge-api.yml is authoritative.

# Optional live extraction spot check (consumes ~3 of ~20 daily calls)
RUN_LIVE_AI_TESTS=1 GEMINI_API_KEY=... \
  deno test --allow-env --allow-net \
  supabase/functions/tests/ai_extraction_live.ts
```

## 9. Security and privacy

- **Authentication.** Both AI endpoints call `authenticateRequest`; the gateway
  does not enforce JWT (`verify_jwt = false`), so the handler does, and CORS
  preflight still works without a token.
- **Provider key.** `GEMINI_API_KEY` is read only by the adapter on the server.
  It is never logged, returned or exposed to the browser.
- **Retrieval scope.** Candidate recipes are read with the caller's own
  Supabase client; RLS restricts rows to `auth.uid() = user_id`.
- **Persistence scope.** Saves run through the user-scoped client; user IDs are
  server-derived; lineage requires ownership of the child and every parent.
  AI-07 adds the candidate-token check on top.
- **Input caps.** 128 KiB request bodies; extraction notes ≤ 10,000 characters;
  generation pantry ≤ 100 items of ≤ 100 characters and preferences ≤ 1,000.
- **Output caps.** Responses are Zod-validated and bounded; errors never echo
  prompts, recipes or provider payloads.
- **Abuse controls.** Daily quota plus operator opt-ins and kill switches.

## 10. Limitations and non-claims

- **Not a model-quality benchmark.** Offline fixtures are hand-crafted; they
  prove contract behavior, not accuracy on real notes.
- **Small live sample.** Three live extraction cases are a spot check, not a
  statistically meaningful evaluation, and live generation is not yet
  harnessed.
- **Single model, English-only.** The dataset is synthetic English; a different
  `AI_MODEL` is not covered by these numbers.
- **No live safety claim.** Safety and injection fixtures verify parser
  contracts against predetermined output. They are **not** evidence that the
  live model blocks harmful requests or resists jailbreaks.
- **No nutrition, safety or quality guarantees.** The AI never claims food is
  safe, fully cooked or safe to store, and the system makes no dietary,
  nutritional or health claims. Users must apply normal food-safety practice.
- **Quota and cost.** The free tier allows roughly 20 requests per project per
  model per day; live testing consumes real quota. Production uses operator
  opt-ins for the same reason.
- **Latency.** Flash-Lite was chosen for stability; a live extraction measured
  about 4 seconds, and slower runs (12–22 s) have been observed. No latency
  percentiles are benchmarked.
- **Token replay.** A candidate token can be replayed by the same user with the
  same allowed parent set inside its 15-minute TTL by design.
- **Read-only quota today.** Atomic quota accounting arrives with BE-12; until
  it merges, the daily counter is observed, not enforced by the AI layer.

## 11. Operations quick reference

| Env var | Purpose |
| ------- | ------- |
| `GEMINI_API_KEY` | Provider key; server-side only |
| `AI_MODEL` | Override the pinned model (evaluation reproducibility) |
| `AI_EXTRACT_ENABLED` / `AI_GENERATE_ENABLED` | Operator opt-ins; default off |
| `AI_EXTRACT_DISABLED` / `AI_GENERATE_DISABLED` | Kill switches; override the opt-ins |
| `AI_DAILY_LIMIT` | Daily per-user allowance (default 20) |
| `AI_ENVIRONMENT` | `development`/`test` allows demo drills; production ignores them |
| `AI_ALLOW_FAILURE_DRILLS` | Master switch for drills |
| `AI_SIMULATE_OUTAGE` / `AI_SIMULATE_BAD_OUTPUT` | Deterministic demo failures |
| `AI_CANDIDATE_TOKEN_SECRET` | Signs lineage candidate tokens (AI-07; ≥ 32 chars) |

Where to look:

- Contract and status codes: [`docs/api/ai-integration.md`](api/ai-integration.md)
- Fixtures and how to add a case: [`docs/ai-evaluation.md`](ai-evaluation.md)
- Measured results and limitations: [`docs/ai-evaluation-report.md`](ai-evaluation-report.md)
- Source: `supabase/functions/_shared/ai/` (adapter, prompts, schemas, dataset,
  retrieval) and `supabase/functions/{extract,generate}-recipe/`
