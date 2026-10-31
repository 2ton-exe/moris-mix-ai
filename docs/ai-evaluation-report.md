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
validated preview and never write a recipe, lineage or usage row. Generation is
a stateless preview; saving remains an explicit later call.

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

The full deterministic Edge/API suite (exact modular `reusable-edge-api.yml`
command) is
**266 passed / 0 failed / 5 ignored** at the time of this report. The five
ignored tests are the opt-in live PostgreSQL hosted-integration checks; none is
an AI failure test.

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
- **Quota accounting is read-only.** AI-17's atomic usage accounting is tracked
  separately (BE-12); this report does not claim quota writes.

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
