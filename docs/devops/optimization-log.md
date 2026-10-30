# DevOps optimization log

Permanent chronological record of measured DevOps optimization experiments. One controlled change at a time. Do not call a change an optimization until a comparable before/after measurement exists. An unsuccessful or inconclusive experiment remains valid evidence when documented honestly.

Use [pipeline metrics](pipeline-metrics.md) for weekly/sprint delivery measurements, the [incident log](incident-log.md) for genuine operational failures, and the [runbook](deployment-runbook.md) for deployment/rollback procedures. GitHub Actions is raw execution evidence; issues/PRs contain task progress, reviews and acceptance evidence.

## Experiment 1 — Playwright Chromium headless-shell installation

**Date:** 2026-10-29\
**Sprint:** 2\
**Issue:** [#62 / DEVOPS-09](https://github.com/2ton-exe/moris-mix-ai/issues/62)\
**PR:** [#125](https://github.com/2ton-exe/moris-mix-ai/pull/125), human-approved and merged on 2026-10-30\
**Commit:** [`ead889176e12862d86e644b1406830c3687ea4f2`](https://github.com/2ton-exe/moris-mix-ai/commit/ead889176e12862d86e644b1406830c3687ea4f2) — `ci(e2e): install only chromium headless shell`\
**State:** Configured, PR-tested, human-approved, merged, and successfully executed on main. E2E remains non-gating in authoritative CI.

### Problem / observed bottleneck

In the expanded pipeline, the non-gating Playwright E2E job repeatedly became the longest PR job. CI #263 showed approximately 19s in Chromium setup and 67s in `test:e2e:local`, including approximately 36s in two browser tests. The observed cost includes browser environment setup, isolated local Supabase preparation and browser execution.

Older Sprint 1 and Sprint 2 pre-refactor workflow samples exclude later validation work and are not used as the experiment baseline. Modularization's approximately 40s/39s comparison is architecture evidence, not an optimization result.

### Baseline

Declared before the change in [issue #62](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6495878254):

| Authoritative CI run | Approximate E2E job duration |
| --- | ---: |
| #258 | 88s |
| #263 | 98s |
| #264 | 90s |

Sample size: 3. Mean approximately 92s; median approximately 90s; range approximately 88-98s. Values were recorded approximately/rounded. This is a small job-duration sample, not a whole-workflow or merge-to-live baseline. The approximately 19s installation observation from #263 is not a matched five-run installation baseline.

### Hypothesis

Installing only Chromium's headless shell should reduce browser-install overhead without changing test coverage, browser execution mode, worker count, Supabase bootstrap, readiness behavior or pass/fail behavior.

### Controlled change

Only `.github/workflows/reusable-e2e.yml` changes in the experiment implementation:

```diff
- pnpm exec playwright install --with-deps chromium
+ pnpm exec playwright install --with-deps --only-shell chromium
```

The experiment branch is `ci/62-playwright-only-shell`; the separate `docs/62-devops-evidence-reconciliation` branch records evidence and does not carry this workflow change. Both are part of #62. Safe path/test filtering remains separate work under [#124](https://github.com/2ton-exe/moris-mix-ai/issues/124).

### Safety / variables held constant

- Same Playwright test cases and E2E logic; 2 tests using 1 worker.
- Same default headless Chromium execution mode; no browser/channel change.
- Same local Supabase setup, isolation, account preparation and readiness checks.
- Same dependency versions, lockfiles and application code.
- Same workflow/job names, validation gates, permissions, timeouts and artifact handling.
- `--with-deps` retained; no browser cache or test parallelism added.
- Production deployment behavior unchanged; production deployment skipped on the PR.

Local validation at implementation used `git diff --check` and installed Playwright 1.64.1 CLI help confirming `--only-shell`. Local static validation is separate from the CI evidence below.

### After-runs

Authoritative [CI #266, run ID 40869775513](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775513), attempts 1-5, all associated with experiment head `ead889176e12862d86e644b1406830c3687ea4f2`. These are five attempts of one workflow run on the same change, not five independent PRs. PR execution can test a merge revision; retain that checkout SHA separately from the experiment head when extracting raw logs.

| Attempt | E2E job duration | Install Chromium | E2E result | Tests / workers | Production deploy |
| --- | ---: | ---: | --- | --- | --- |
| [1](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775513/attempts/1) | 90s | 12s | Passed | 2 / 1 | Skipped |
| [2](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775513/attempts/2) | 78s | 13s | Passed | 2 / 1 | Skipped |
| [3](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775513/attempts/3) | 88s | 15s | Passed | 2 / 1 | Skipped |
| [4](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775513/attempts/4) | 84s | 12s | Passed | 2 / 1 | Skipped |
| [5](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775513/attempts/5) | 94s | 19s | Passed | 2 / 1 | Skipped |

Sample size 5; mean `(90 + 78 + 88 + 84 + 94) / 5 = 86.8s`; median 88s; range 78-94s. Reliability within the supplied/reconciled attempt set: 5/5 E2E passes. No failed attempt is present in that set; future failures must remain in the reliability record rather than being discarded for a faster average.

Attempt 1 is canonically **90s**, confirmed by independently verified GitHub job timestamps: `2026-10-29T12:00:36Z` to `2026-10-29T12:02:06Z`. Its Chromium installation took exactly **12s**, from `2026-10-29T12:00:46Z` to `2026-10-29T12:00:58Z`. An earlier live-monitoring estimate was superseded by these exact timestamps; it is not a competing measurement. The [consolidated issue record](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6496396449) supplies the unchanged five-attempt sample. The [early report](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6496117807) also records Ubuntu 26.04 / image version `20261025.179.1`; a matched per-attempt runner-image inventory was not independently assembled here.

### Comparison

| Metric | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Mean E2E job duration | Approximately 92s | 86.8s | Approximately 5.2s lower in the sampled job |
| Median E2E job duration | Approximately 90s | 88s | Approximately 2s lower |
| Range | Approximately 88-98s | 78-94s | Visible overlapping run-to-run variance |
| Chromium installation | Approximately 19s in #263 | 12s, 13s, 15s, 12s, 19s | Consistent with intended mechanism; no matched five-run before sample |

This is not a claim that the whole pipeline or total merge-to-live is 5.2s faster. The primary measurement is `Playwright E2E (Non-gating) / Playwright E2E Tests`. Installation duration, `test:e2e:local` duration, test/worker count, individual test durations, runner version and failures are secondary evidence. Full per-attempt substep/test timestamps remain in raw logs rather than being invented here.

### Conclusion

**Improved — modest measured reduction in the sampled Playwright E2E job duration.**

Limitations: only three baseline observations; approximate/rounded baseline values; GitHub-hosted runner/network variance; after range 78-94s; no matched five-run installation-step baseline; reruns on one change are not independent change-frequency observations. This is descriptive sampled evidence, not statistical proof of a stable long-term reduction. Local Supabase/E2E runtime remains a larger cost that the installation change does not remove.

Belen / `myntchoc` approved PR #125, confirming that Chromium headless-shell installation matches the existing Playwright default headless execution and that the E2E job passed. PR #125 merged on 2026-10-30 at `2026-10-30T04:29:29Z` as [`7278f92e0fc67348efa60a14293dcdfde9329709`](https://github.com/2ton-exe/moris-mix-ai/commit/7278f92e0fc67348efa60a14293dcdfde9329709), `ci(e2e): install only chromium headless shell (#125)`; `main` pointed to that exact SHA at verification.

[Authoritative CI #284](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41003182840) passed on that merged SHA. `Playwright E2E (Non-gating) / Playwright E2E Tests` succeeded in approximately 83s (`04:29:34Z`–`04:30:57Z` on 2026-10-30); Chromium installation succeeded in 15s (`04:29:41Z`–`04:29:56Z`), and `Run Playwright E2E against local Supabase` succeeded in 59s (`04:29:56Z`–`04:30:55Z`). [Modular Main Validation #16](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41003182843) also passed on the same SHA. This is one merged-main verification sample, separate from the five PR after-run attempts; the 86.8s PR mean is unchanged and no new statistical average is calculated.

CI #284's `Deploy to Supabase and Cloudflare` job succeeded, including production configuration validation, `recipes` Edge Function deployment and Cloudflare Worker deployment. This establishes normal production deployment success after #125 merged, not post-deployment runtime verification or production availability verified by runtime checks. PR #125 did not introduce or test PR #88's separate production runtime smoke. #62 remains open pending review and merge of the PR #126 evidence follow-up and remaining evidence work.

Reject/revert if later evidence shows introduced launch/E2E failures, intermittent behavior, lost coverage, changed browser mode/workers, worse diagnostics or no useful repeatable reduction relative to normal variation. A single fast run is insufficient.

### What we learned

- A targeted fixed-cost reduction can help without changing coverage or test scheduling.
- Runner/network variance is significant; the fastest after-run alone would overstate the result.
- Multiple after-runs and failure accounting matter.
- Browser installation is only one part of the local-Supabase/browser cost.
- Future optimization must start from new bottleneck evidence; no further candidate is proven by this experiment.

### Evidence

- Issue: [#62 and consolidated comparison](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6496396449).
- PR: [#125 implementation, testing and review state](https://github.com/2ton-exe/moris-mix-ai/pull/125).
- Commit: [ead889176e12862d86e644b1406830c3687ea4f2](https://github.com/2ton-exe/moris-mix-ai/commit/ead889176e12862d86e644b1406830c3687ea4f2).
- Workflow runs: [authoritative CI #266](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775513), attempt links above; [modular #114](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40869775493), excluded from the authoritative timing sample.
- Relevant jobs: `Playwright E2E (Non-gating) / Playwright E2E Tests`; steps `Install Chromium` and `Run Playwright E2E against local Supabase`; production deploy skipped in the PR attempts.
- Reconciliation provenance: issue/PR records supply historical attempt timings. Read-only connector inspection confirmed matching workflow IDs, CI success and latest-attempt E2E success/production skip; its job response did not include timing timestamps or all historical attempts. Independently verified exact GitHub timestamps supplied for this cleanup confirm attempt 1 at 90s and its installation at 12s. Other attempts were not independently retimed during this documentation task.

## Reusable entry template

Copy this template for the next experiment; keep actual entries chronological.

```markdown
## Experiment N — <title>

**Date:**
**Sprint:**
**Issue:**
**PR:**
**Commit:**

### Problem / observed bottleneck

### Baseline

### Hypothesis

### Controlled change

### Safety / variables held constant

### After-runs

### Comparison

### Conclusion

Improved / No meaningful change / Regressed / Insufficient evidence

### What we learned

### Evidence

- Issue:
- PR:
- Commit:
- Workflow run(s):
- Relevant job(s):
```
