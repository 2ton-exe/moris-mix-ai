# AI Evaluation Fixtures

Status: **AI-08 (Sprint 3)**. Versioned fixtures with reproducibility guarantees,
plus the exact commands to run them.

The suite has two layers. Both use the shared Zod schemas and the real parsers,
so an expectation here can never drift from the code that serves users.

| Layer | What it measures | Needs a provider call? |
| ----- | ---------------- | ---------------------- |
| **Offline acceptance** (`tests/eval_dataset_test.ts`) | Parser, schema, boundary and error-contract behavior against versioned fixtures | No — no network, no API key |
| **Live extraction** (`tests/ai_extraction_live.ts`) | Actual Gemini output quality on messy notes | Yes — opt-in, quota-limited |

## Dataset

- File: `supabase/functions/_shared/ai/eval_dataset.ts`
- Version: `EVALUATION_DATASET.version` (`2.0.0`). Bump it whenever a case is
  added, removed, or changes its expectation.
- Everything is **synthetic**: invented notes, invented recipes, invented IDs.
  Never put real user data, tokens, or secrets in this file.

| Suite | Cases | Covers |
| ----- | ----- | ------ |
| `extraction` | Happy path, ambiguous quantities (`"a handful"`, `"a splash"`), messy notes (bullets, all-caps, emoji), safety refusal, injection resilience, fenced JSON, null optionals, and malformed model output (negative quantity, non-sequential steps, non-JSON, wrong types) | AI-04/AI-06 input caps and AI-10 output validation |
| `generation` | Matched context, cold start, no pantry overlap, foreign parent ID, orphan substitution, malformed output, invalid flavor score, fenced JSON | AI-06/AI-13 generation contract |
| `providerFailures` | `429` with and without `RetryInfo`, `5xx`, `408`, permanent `403`, transport failure, abort | AI-18 bounded retry and the documented recoverable errors |

Each case declares its expected outcome. Valid cases must parse and satisfy
checkable properties (expected ingredient names, vague amounts kept as
`quantityText`, flavor-score presence, parent IDs, substitution originals).
Invalid cases must fail with the exact `AIError` code and field path, and must
never be retried.

## Run the offline acceptance suite

```sh
deno test --frozen-lockfile --node-modules-dir=auto --allow-env \
  supabase/functions/tests/eval_dataset_test.ts
```

This file is part of the required Edge/API CI check, so it runs on every push
and pull request. It requires no API key and makes no network calls.

## Run the live extraction evaluation (optional)

```sh
RUN_LIVE_AI_TESTS=1 GEMINI_API_KEY=... \
  deno test --allow-env --allow-net \
  supabase/functions/tests/ai_extraction_live.ts
```

The live suite is intentionally manual: the free tier allows roughly 20
requests per project per model per day, and every case costs one call. Use it
to spot-check model quality before consultation or Demo Day, not in CI.

## Adding or changing a case

1. Edit `supabase/functions/_shared/ai/eval_dataset.ts` (keep IDs stable and
   descriptive; add new IDs instead of repurposing old ones).
2. Bump `EVALUATION_DATASET_VERSION`.
3. Run the offline command above. The first test also validates that every
   case stays inside the request caps and that every Chef context matches
   `ChefRecipeContextResultSchema`.
4. If the case changes what the API promises, update `docs/api/ai-integration.md`
   in the same change.

## Limitations

- The offline suite measures **contract and robustness**, not model quality:
  its provider output is hand-crafted to represent a well-behaved or broken
  model. Model-quality numbers must come from live runs and are recorded
  separately (see AI-09's evaluation report).
- Fixtures are English-only and use a small synthetic recipe vocabulary.
- The provider-failure suite exercises the adapter's classification and retry
  rules, not Gemini's real failure distribution.
- Ingredient expectations are substring checks, so a renamed but semantically
  equal ingredient can still pass; the prompt, not the fixture, owns wording.
