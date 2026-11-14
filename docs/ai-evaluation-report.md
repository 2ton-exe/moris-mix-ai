# AI Failure Evaluation Report

Status: **AI-09 (Sprint 3)**. Measured results for the AI failure contract and the
versioned evaluation set. The fixtures themselves are documented in
[AI evaluation fixtures](ai-evaluation.md); the system-level explanation is in
[AI architecture and operations](ai-architecture.md).

- Dataset: `EVALUATION_DATASET` **2.1.1**
  (`supabase/functions/_shared/ai/eval_dataset.ts`)
- Model: `AI_MODEL` override, otherwise the pinned `gemini-3.5-flash-lite`
- Report date: **2026-10-31**
- Baseline commit: **`0aeaaea`** (AI-08 merged); this report and its tests are
  the AI-09 change on top of it.

## What is measured

| Layer | Command | Provider call? |
| ----- | ------- | -------------- |
| Versioned offline acceptance | `tests/eval_dataset_test.ts` | No |
| Endpoint failure contract | `tests/extract_recipe_test.ts`, `tests/generate_recipe_test.ts` | No (mock transport) |
| Full Edge/API regression | the modular Edge/API workflow's deterministic suite | No |
| Live extraction spot check | `tests/ai_extraction_live.ts` (opt-in) | Yes |

The endpoint failure tests inject the **real `GeminiAdapter`** and mock only the
model transport. That means the adapter's classification, bounded retry and
error mapping run exactly as they do in production, while the test stays
deterministic and offline. Every failure assertion also proves that no
`POST`/`PATCH`/`DELETE` reached `recipes` or `recipe_lineage`.

## Failure contract results

Both route variants (`/functions/v1/...` and `/...`) are exercised for both AI
operations. All cases pass.

The first four rows are measured **end-to-end by the AI-09 tests**: the real
`GeminiAdapter` classifies the failure, applies the bounded retry, and the
endpoint maps it to the public error. The remaining rows are covered by the
existing deterministic contract tests in the same suite.

Safety blocks are detected in both shapes: the SDK's thrown
`GoogleGenerativeAIResponseError`, and blocked finish reasons such as
`PROHIBITED_CONTENT` that the pinned SDK does not throw for and would
otherwise return empty text. Both map to `AI_PROVIDER_REJECTED`.

| Failure | HTTP | Error code | Retry behavior | Persists recipe/lineage? |
| ------- | ---- | ---------- | -------------- | ------------------------ |
| Timeout / abort | `504` | `AI_TIMEOUT` | one bounded retry (2 calls asserted) | No |
| Provider outage (`5xx`) | `503` | `AI_UNAVAILABLE` | one bounded retry (2 calls asserted) | No |
| Malformed / non-JSON output | `502` | `AI_OUTPUT_INVALID` | not retried (1 call asserted) | No |
| Provider safety block (thrown or blocked finish reason) | `502` | `AI_PROVIDER_REJECTED` | not retried (1 call asserted) | No |
| Schema-invalid output | `502` | `AI_OUTPUT_INVALID` | not retried | No |
| Orphan substitution | `502` | `AI_OUTPUT_INVALID` | not retried | No |
| Parent ID outside candidates | `502` | `AI_OUTPUT_INVALID` | not retried | No |
| Rate limit (`429`) | `429` | `AI_RATE_LIMITED` | one retry when the cooldown fits | No |
| Unexpected exception | `500` | `INTERNAL_ERROR` | not retried | No |

Provider rate-limit errors carry a `Retry-After` header, using the provider
cooldown when available and a default otherwise. Outages and timeouts do not;
permanent failures never do. Error bodies contain no prompt text, recipe text,
provider detail, stack traces or file paths.

The successful paths are also checked: extraction and generation return a
validated preview and write no recipe or lineage row. The AI-09 baseline
(`0aeaaea`) predated BE-12, so it made no quota claims and recorded no usage
row. The endpoint tests added with BE-12 do exercise settlement orchestration
against a mocked PostgREST transport: the reservation is confirmed and charged
on success or provider-consumed failure, refunded on definite non-consuming
failures, and a failed confirm call still returns the preview. Those mocks
cannot prove hosted-database atomicity, concurrency or role enforcement; that
is BE-12's own hosted database suite. Generation is a stateless preview;
saving remains an explicit later call.

## Versioned dataset results

A fresh offline run of the versioned set:

```text
EVALUATION_DATASET is versioned, uniquely identified and within the request caps ... ok
extraction evaluation fixtures meet their declared expectations offline ... ok
Chef generation fixtures meet their declared expectations offline ... ok
provider failure fixtures follow the documented recoverable-error contract ... ok
ok | 4 passed | 0 failed
```

Version 2.1.1 corrects the `pf-08` safety-block fixture to throw the SDK's real
`GoogleGenerativeAIResponseError`, which has no HTTP status; its expectation is
unchanged.

Coverage: **14 extraction cases, 8 generation cases and 8 provider-failure
cases** (30 total). Every valid case asserts ingredient recall, declared exact
amounts (quantity, unit and `inferred`), `quantityText` for vague amounts,
flavor-score presence, parent IDs and substitution originals. Every invalid case
asserts the exact `AIError` code and field path. Chef candidates are recomputed
with BE-10's `computeIngredientOverlap` before they are accepted.

At the report's baseline commit (`0aeaaea`) the then-current legacy `ci.yml`
list passed with **0 failures** and 5 ignored tests. Those totals are a
historical snapshot, not a comparable suite size: the suite has grown
considerably since (candidate tokens, quota reservations, recipe search and
recipe-image schema tests all landed). The modular `reusable-edge-api.yml`
target list is authoritative, and the latest `main` validation run reports
**425 passed / 0 failed / 6 ignored**. The ignored tests are the opt-in live
PostgreSQL hosted-integration checks; none is an AI failure test.

## Live extraction spot check

The live suite is **manual and quota-limited**: the free tier allows roughly 20
requests per project per model per day, and each of the three live cases costs
one call. It is not run in CI and needs `GEMINI_API_KEY`.

```sh
RUN_LIVE_AI_TESTS=1 GEMINI_API_KEY=... \
  deno test --allow-env --allow-net \
  supabase/functions/tests/ai_extraction_live.ts
```

The three cases cover vague amounts, a note with no taste description, and a
note with a described taste. A fresh run on **2026-10-31** used the pinned
`gemini-3.5-flash-lite` (`AI_MODEL` unset) and passed **3/3 in about 4 seconds**
with no provider errors (3 of the roughly 20 daily calls):

| Case | Result |
| ---- | ------ |
| Vague amounts stay null instead of being invented | Pass |
| Omits flavour scores when taste is never described | Pass |
| Keeps described flavours and steps | Pass |

This matches the historical 3/3 note in the adapter's model-selection comment.

### Dedicated Gemini project re-verification (2026-11-14)

The separate Gemini API project `gen-lang-client-0591557078` (project number
`127829836695`) was checked for production readiness on 2026-11-14. The Gemini
API (`generativelanguage.googleapis.com`) is enabled on the project, and the
existing `Gemini API Key` is restricted to that API. The key uses the newer
`AQ.` format (53 characters) rather than the legacy `AIza` format.

A `models.list` call returned `gemini-3.5-flash-lite`, so the pinned model is
available to the project. The live extraction suite then passed **3/3 in about
4 seconds** at commit `b297977` on 2026-11-14, with the pinned model
(`AI_MODEL` unset) and the existing legacy `@google/generative-ai@0.21.0` SDK.
The run made 3 `generateContent` calls.

| Case | Input summary | Expected result | Observed |
| ---- | ------------- | --------------- | -------- |
| Vague amounts stay null instead of being invented | Adobo note with "maybe a kilo", "a splash" and "a handful" | Title present; at least 3 ingredients; soy sauce present with `quantity: null`, `inferred: true` and a `quantityText` value | Pass |
| Omits flavour scores when taste is never described | Boiled kamote note with no taste description | Title present; at least 1 instruction; `flavor_scores` is undefined | Pass |
| Keeps described flavours and steps | Sinigang note described as "sour and a little salty" | At least 4 ingredients; at least 1 instruction; `flavor_scores` present with `sour >= 1` | Pass |

This verifies provider transport, model availability and SDK compatibility for
the shared `generateContent` path. It does not evaluate generation quality, and
the legacy SDK remains deprecated; migrating to `@google/genai` is still a
follow-up task.

## Limitations

- **Contract, not model quality.** The offline fixtures are hand-crafted to
  represent a well-behaved or broken model. They prove that the backend accepts,
  rejects and retries correctly; they do not estimate accuracy on real notes.
- **Small live sample.** Three live extraction cases are a spot check, not a
  statistically meaningful benchmark. Results can vary with model updates,
  region and free-tier load.
- **Live generation is not harnessed.** The live spot check covers extraction
  only. Generation is covered by the offline fixtures and endpoint tests; a
  live generation quality run would need its own opt-in harness and quota.
- **Single model, one language.** The dataset is English-only and synthetic, and
  the pinned model is one Flash-Lite version. A different `AI_MODEL` is not
  covered by these numbers.
- **No live safety measurement.** The `safety` and `injection` extraction cases
  verify parser contracts against predetermined provider output. They are not
  evidence that the live model blocks harmful requests or resists jailbreaks.
  A live safety assessment needs a separate, explicitly approved red-team
  procedure and is out of scope here.
- **Simulated provider distribution.** `providerFailures` exercises the
  adapter's classification and retry rules; real Gemini failure rates and
  error shapes can differ.
- **No latency benchmark.** The suite asserts behavior and error codes, not
  response-time percentiles.
- **Quota settlement coverage is split.** The AI-09 baseline predated BE-12 and
  made no quota claims. BE-12's endpoint tests exercise handler-level
  confirmation and rollback against a mocked PostgREST transport; they do not
  prove hosted-database atomicity, concurrency or role enforcement, which
  BE-12's hosted database tests cover. At runtime settlement is best-effort
  (see `docs/ai-architecture.md` §6).

## Reproduction

```sh
# Versioned offline acceptance (no key, no network)
deno test --frozen-lockfile --node-modules-dir=auto --allow-env \
  supabase/functions/tests/eval_dataset_test.ts

# Endpoint failure contract for both AI operations
deno test --frozen-lockfile --node-modules-dir=auto --allow-env \
  supabase/functions/tests/extract_recipe_test.ts \
  supabase/functions/tests/generate_recipe_test.ts

# Full deterministic Edge/API suite: run the exact `deno test` command from
# .github/workflows/reusable-edge-api.yml (the modular Edge/API workflow).
# That workflow is the authoritative target list; it is not duplicated here so
# this report cannot drift when the suite grows.
```

When the dataset changes, bump `EVALUATION_DATASET_VERSION` and re-run the
offline suite. Record a new dated section here only when a live run is actually
performed; do not copy historical numbers into a new measurement.
