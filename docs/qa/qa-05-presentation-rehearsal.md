# QA-05 presentation rehearsal

Status: automated local rehearsal passed; human presentation rehearsal remains open.

## Candidate and controls

- Candidate code revision: `0ccdc563b1131cb2ca14fec4f99d538eb39bc44f`.
- Environment: isolated local Supabase Auth, database, and Edge Functions started by `frontend/e2e/run-local.mjs`.
- Accounts and recipe data are local synthetic fixtures. No hosted Supabase project, production data, Gemini credentials, or paid AI calls are used.
- The quota drill uses the exact `QA05_QUOTA_EXHAUSTED` input marker in the copied local function fixtures. Those fixtures return a quota-exceeded decision for the marked request; production handlers and quota policy are unchanged.
- The fallback uses the deterministic local extraction fixture. Call it prepared output, never a live Gemini result.

## Repeatable rehearsal

Run from `frontend/`:

```sh
pnpm test:e2e:local -- e2e/authenticated-crud.spec.ts e2e/extraction-save.spec.ts e2e/ai-critical-journeys.spec.ts
```

The headed fallback segment can run by itself:

```sh
pnpm test:e2e:local -- --headed --grep "QA-05 deterministic fallback browser walkthrough"
```

The local runner provisions the synthetic account, starts the isolated stack, drives the UI, and cleans up afterward. The headed fallback is a visible scripted walkthrough, not a persistent manually driven session. Before showing it, say: “This is prepared local fallback output, not live model generation.”

## Result record

Run on candidate `0ccdc563b1131cb2ca14fec4f99d538eb39bc44f` on 2026-11-15:

- `pnpm test:e2e:local -- e2e/authenticated-crud.spec.ts e2e/extraction-save.spec.ts e2e/ai-critical-journeys.spec.ts` — **passed, 7/7**.
- `pnpm test:e2e:local -- --headed --grep "QA-05 deterministic fallback browser walkthrough"` — **passed, 1/1**.
- Before the fixture change, the new quota journey failed as expected: extraction returned HTTP 200 instead of the expected 429.
- After the fixture change, Quick AI and Chef quota drills both returned `QUOTA_EXCEEDED`, retained the cook's inputs, and left recipes and lineage unchanged. Existing malformed-output and provider-failure journeys also passed.

## Rehearsal checklist

- [x] Sign in and create, edit, reopen, and delete a recipe through the integrated UI.
- [x] Preview Quick AI output, edit before saving, and verify explicit-save and recovery behavior.
- [x] Generate a Chef preview, select lineage, save, and verify the persisted parent link.
- [x] Exercise malformed output and provider failures with preserved input and no unintended writes.
- [x] Exercise quota exhaustion for Quick AI and Chef with safe messages and no recipe or lineage writes.
- [x] Run the prepared Quick AI fallback headed through preview, edit, save, reopen, and cleanup.
- [ ] Rehearse the presenter’s spoken order and timing with the intended audience.
- [ ] Verify live Gemini behavior separately if the presentation intends to claim live generation.

Present only the checked local behavior as verified. The unchecked items remain outside this automated record.
