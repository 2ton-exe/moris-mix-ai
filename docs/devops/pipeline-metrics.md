# Project-wide DevOps Pipeline Metrics

> Section 1 records the workflow baseline inspected on main; the current image-readiness integration is described below.
> Sections 2–12 preserve Sprint 1/2 measurements and their historical scope;
> references to a "current" sample within those records mean that checkpoint.
> Section 13 records Sprint 3 optimization; sections 14–15 preserve the preliminary and final Sprint 4 populations.

**Project:** Mori's Mix\
**Team:** 2ton.exe  
**Maintainer:** Haresco  
**Scope:** Continuing weekly and multi-sprint DevOps metrics log\
**Reconciled:** 2026-11-20, final Sprint 4 measurements; the 2026-10-30 reconciliation and merged-main optimization verification at `7278f92e0fc67348efa60a14293dcdfde9329709` remain historical records\
**Status:** Historical Sprint 1–3 measurements and both controlled optimization experiments are preserved. Section 14 remains the preliminary Sprint 4 population; section 15 adds a frozen November 7–17 final population and separate November 18–19 push observations. Cohort timing and merge-to-smoke results are bounded; eight same-SHA smoke endpoints and formal outage/recovery time remain unavailable.

## Sprint metrics summary

Update this log before every consultation. Different pipeline generations and workflow/job timing scopes remain separate; no single average represents an entire sprint with incompatible workloads.

| Sprint | Avg PR pipeline time | Main pipeline time | Pipeline success rate | Production deploys | Avg merge-to-live | Failed deploys | Time to recover | Change made |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- |
| Sprint 1 | Historical two-job sample: 41.75s (4); later three-job sample: 39.5s (2) | Historical sample: approximately 51s (2); later run #90: approximately 65s (1) | Historical samples: PR 4/4, main 2/2; later samples: PR 2/2, main 1/1. No sprint-wide denominator. | Not fully enumerated | Not yet measured | No failures in historical two-run deployment sample; sprint total not fully enumerated | Production recovery not measured; no qualifying production recovery event in reviewed sample | Add real frontend/DB/Edge validation and all-checks deployment gate |
| Sprint 2 | Pre-refactor: 35.5s (2). Expanded-workload whole-PR workflow average not yet measured; E2E job samples below are not pipeline averages. | Pre-refactor: 74.5s (2); current expanded-workload main sample not yet measured | Pre-refactor PR 2/2 and main 2/2; experiment E2E 5/5. Sprint-wide observation period/denominator not yet defined. | Not fully enumerated; two successful pre-refactor deployments recorded, not a sprint total | Not yet measured | Not fully enumerated for a defined period | Production recovery not measured; Secretary tooling recovery has no measured interval | Modular shadow validation, hosted/E2E validation, staging frontend delivery, Secretary repair; headless-shell experiment human-approved, merged and verified on main (CI #284; one E2E sample, approximately 83s) |
| Sprint 3 | Controlled docs-only experiment: 91 s before, 37 s after; not an all-PR mean | Separate merged-main verification; no sprint mean | No sprint-wide denominator | Not enumerated | Pending | Not enumerated | Pending | Conservative docs-only path selection; see section 13 |
| Sprint 4 preliminary | Docs-only proxy: 39.0 s (8); full-validation mean pending | Single-attempt job span: 156.9 s (10) | Eventual PR runs: 61/67; main runs: 11/11; attempt outcomes separate | 11 successful release runs / distinct SHAs | Pending | 2 failed attempts in 1 release run | Formal interval pending | Frozen observation sample; no new optimization claimed; see section 14 |
| Sprint 4 final window | Docs-only job-span mean: 37.13 s (23); modern three-browser PR job-span mean: 360.46 s (39) | Pre-readiness validation spans: push 327.33 s (6 single-attempt), manual dispatch 339.67 s (6); successful production jobs 49.90 s (48); Cloudflare steps 8.88 s (49) | PR 196/231 runs (196/232 attempts); main push 42/51 (42/56 attempts); manual 6/6 separate | 62 production attempts: 48 successful jobs; 49 successful Cloudflare commands | 43/51 same-SHA successful smokes; mean 791.84 s, median 172 s; eight unavailable | 2 Cloudflare command failures; 1 smoke failure; 6 readiness blocks; 5 stale-revision rejections | 86m17s release-step-to-smoke interval; formal outage/recovery unavailable | Frozen cohorts, not a sprint-wide trend; see section 15 |

Sprint 4 final validation values are single-attempt job spans, while production-job and Cloudflare-step timings use successful executions only; none is an end-to-end pipeline duration. Section 15 defines each scope.

Sample success fractions describe only their named samples. Rerun attempts are not independent changes or production deployments. Missing values are not zero. Application/API retry recovery is separate from delivery-tooling recovery and production deployment recovery.

## Evidence map

| Record | Responsibility |
| --- | --- |
| [Pipeline metrics](pipeline-metrics.md) | Weekly/sprint pipeline and DORA-style delivery measurements |
| [Optimization log](optimization-log.md) | Chronological controlled before/after experiments |
| [Incident log](incident-log.md) | Genuine operational incidents and postmortems; production incidents distinguished from delivery tooling |
| [Deployment runbook](deployment-runbook.md) | Pipeline architecture/diagram, deploy, smoke, rollback and recovery procedure/evidence |
| [Modular workflow guide](modular-workflows.md) | Migration architecture, gate experiments and handoff limits |
| [Observability audit](observability-audit.md) | Dated 2026-10-24 production observations, not an automatically current inventory |
| [PR Secretary guide](pr-secretary.md) | Delivery reporting implementation and historical repair evidence; later recovery evidence is linked in the incident log |
| GitHub Actions | Raw execution evidence: run/attempt/job IDs, logs, timestamps and conclusions |
| GitHub issues / PRs | Task acceptance evidence / reviewed implementation and CI evidence |
| Consultation / Demo Day | Presentation of reconciled repository evidence, with raw GitHub traceability and limitations |

Course evidence inventory: workflow configuration exists under `.github/workflows/`; the runbook contains the pipeline diagram and rollback procedure. A standalone `docs/devops/PIPELINE.md` course deliverable has not yet been confirmed/created. The deployment runbook currently contains pipeline architecture information, but equivalence to the named course deliverable has not been established. Record this as a later documentation follow-up; creating that file is outside this reconciliation.

## Evidence Recording Workflow

1. Workflow/deployment actually executes.
2. Capture workflow run number/ID and attempt, commit SHA (distinguish PR head from tested merge revision), trigger, relevant job names, start/completion timestamps, pass/fail/skipped outcomes, and deployment/runtime evidence where applicable. Keep evidence sanitized.
3. Classify as PR validation, main/release, deployment, runtime verification, optimization experiment, or incident/recovery. Label workflow duration separately from job/step duration and merge-to-live.
4. Record task-specific evidence in the relevant GitHub issue/PR.
5. Update `pipeline-metrics.md` when evidence changes weekly/sprint metrics; define observation period, population, denominator, exclusions and rerun treatment.
6. Update `optimization-log.md` when a controlled experiment produces before/after evidence. Retain failed attempts in reliability evidence.
7. Update `incident-log.md` only for a qualifying operational incident.
8. Update deployment/rollback documentation when release, smoke, rollback or recovery behavior changes.
9. Before every consultation or Demo Day, compare repository logs with live GitHub evidence, reconcile missing measurements and preserve workload/version boundaries. Present those reconciled records with their source links and limitations.
10. Never overwrite old incomparable measurements merely to produce a cleaner trend.

Evidence states, where applicable:

```text
Implementation / execution evidence:
Proposed -> Configured -> Locally tested -> Executed in CI -> Passed in CI
         -> Merged -> Deployed -> Verified

GitHub policy evidence:
Required
```

These are distinct claims, not automatic promotions: a check may pass without being required; requirement is an independently configured GitHub policy condition, and a required check still needs its own execution/pass evidence. Configured does not mean executed; executed does not mean passed; PR CI passed does not mean main verified; deployed does not mean runtime verified; skipped does not mean passed. Human review and CodeRabbit review are separate from CI results.

## 1. Current Delivery System

- **Continuous Integration:** GitHub Actions
- **Frontend:** React, Vite, and TypeScript
- **Package Manager:** pnpm
- **Deployment Platform:** Cloudflare Workers with Static Assets
- **Cloudflare Worker:** `moris-mix-ai`
- **Production Branch:** `main`

The historical main inspection snapshot was `f36b1fc17ff34601995ca38d183e0a4fb28cccb8`. Baseline workflow configuration was inspected against `main` SHA `0dd27d0fbba8f5cca5a7153229bda68b985be78c` on 2026-11-15; the frozen preliminary measurements in section 14 remain unchanged. `ci.yml` is retired. [Modular PR Validation](../../.github/workflows/modular-pr-validation.yml) owns PR validation and eligible staging delivery; [Modular Main Validation](../../.github/workflows/modular-main.yml) is the sole production caller. These are active workflows, not shadow duplicates.

The current validation paths are:

| Context / path | Configured workload |
| :--- | :--- |
| Modular Frontend / Frontend Checks | Reusable frontend validation; offline policy/safety regressions still run on documentation-only PRs, while frontend lint, application tests and build run on other PRs. |
| Modular Database / Database Tests | Reusable database validation; the PostgreSQL service starts on documentation-only PRs, but migration, lifecycle and RLS commands are skipped and an explicit skip record is written. |
| Modular Edge/API / Edge/API Tests | Reusable type-checking and deterministic tests; documentation-only PRs use the lightweight path. PR callers receive no hosted credentials. |
| Hosted RLS Integration | Nested in the Edge/API reusable workflow and mandatory on `main` through `require-hosted-rls: true`; it is not a fourth required PR context. |
| Modular E2E / Playwright E2E Tests | PR path classification skips E2E only for a verified documentation-only diff; otherwise the reusable workflow runs local Supabase journeys in Chromium, Firefox and WebKit. Main E2E runs separately from production dependencies. |
| Modular Staging | Runs only after successful core PR validation for a non-draft, same-repository PR, unless a verified documentation-only classification selects the staging skip. |

The active `Protect main` ruleset was checked on 2026-11-15. It requires the three Modular Frontend, Modular Database and Modular Edge/API contexts above, one approving review, and resolved review conversations. The PR classifier examines the complete diff; a failed or incomplete classification falls back to full validation. A documentation-only no-op or an intentional E2E/staging skip is not a passed application test, deployment or smoke check. PR workflows do not call production.

`modular-main.yml` runs on pushes to `main` and accepts `workflow_dispatch` on a selected ref; manual dispatch is not limited to `main`. The production gate requires `github.ref == 'refs/heads/main'` and a reusable caller from `.github/workflows/modular-main.yml@refs/heads/main`, in addition to successful frontend, database and aggregate Edge/API jobs plus `frontend/package.json`. The aggregate Edge/API workflow requires its nested Hosted RLS job on main. Main runs full validation and has no push path filter. Main E2E is separate from the production dependency list.

**Deploy to Supabase and Cloudflare** runs through [Reusable Production Release](../../.github/workflows/reusable-production.yml). Its unconditional function targets are `recipes`, `extract-recipe`, `generate-recipe`, and `recipe-image-attach`. The `account-export` step is explicitly disabled with `if: false`. `recipe-image-upload-url` and `recipe-image-download-url` run only when `VITE_RECIPE_IMAGES == 'true'`; `recipe-image-upload-cleanup` runs only when `RECIPE_IMAGE_CLEANUP_ENABLED == 'true'`. With both image and cleanup flags enabled, Modular Main automatically runs the read-only readiness verifier for the same main commit; the `recipe-image-upload-production` environment remains main-restricted without reviewer approval. Production also requires the image migrations in the ledger. The separate cleanup workflow is scheduled every 15 minutes and manually dispatchable, but its job runs only on main when the cleanup opt-in is true and the protected cleanup environment is configured. The release validates its caller and target, rejects stale revisions, deploys Cloudflare assets, checks deployment URL consistency, probes AI routes, runs production runtime smoke, and preserves evidence artifacts. These are configured conditions; this description does not claim the conditional image paths executed.

At current main SHA `1add77018d46d26def068748d4df513bfe654248`, production database migrations remain separate and are not applied by the main release workflow. [Open PR #154](https://github.com/2ton-exe/moris-mix-ai/pull/154) proposes migration automation; it remains unmerged and is not deployed current-main behavior. Section 14 records frozen workflow observations, not exhaustive application acceptance, rollback or database restore proof. See the [runbook](deployment-runbook.md) for separately scoped procedures and evidence.

## 2. Preliminary Sprint 1 Comparable Baseline

The historical samples below reflect the earlier two-job validation workload, before Edge/API validation (PR #41) and the all-checks deployment gate (PR #43). They remain a historical preliminary baseline, not measurements of the current three-job workflow. PR workflow durations and main/deployment workflow durations are tracked separately because their workloads differ. They are workflow durations, not precise merge-to-live measurements or individual deployment-job durations.

### PR Workflow Observations

| Run | Duration | Result |
| :--- | ---: | :--- |
| #72 | 39s | Success |
| #74 | 43s | Success |
| #75 | 36s | Success |
| #76 | 49s | Success |

| Metric | Result |
| :--- | :--- |
| Sample size | **4** comparable PR runs |
| Mean | (39 + 43 + 36 + 49) / 4 = **41.75s**, approximately **42s** |
| Median | (39 + 43) / 2 = **41s** |
| Range | **36–49s** |
| Observed success rate | **4/4 = 100%** |

This is a **preliminary Sprint 1 PR baseline based on four observed comparable runs**. It describes the sample and does not guarantee a permanent or future pipeline duration or success rate.

### Main/Deployment Workflow Observations

| Run | Approx. duration | Result |
| :--- | ---: | :--- |
| #73 | 47s | Success |
| #77 | 55s | Success |

| Metric | Result |
| :--- | :--- |
| Sample size | **2** comparable main/deployment runs |
| Preliminary mean | (47 + 55) / 2 = **51s**, based on approximate durations |
| Observed success rate | **2/2 = 100%** |

This two-run sample is preliminary and too small to establish a stable long-term baseline. The observed success rate is not a reliability guarantee.

### Deployment/Incident Status

| Metric | Sprint 1 evidence |
| :--- | :--- |
| Historical comparable main/deployment sample | 2 successful runs (#73 and #77), before PRs #41 and #43 |
| Failed production deployments in this comparable sample | 0 observed |
| Deployment incidents requiring rollback in reviewed evidence | None observed |
| Production deployment rollback | Not tested |
| Failed-deployment recovery time | Not measured; no failed deployment recovery event was observed |
| Application/API request recovery | Verified separately; this is not deployment recovery |

The total Sprint 1 production deployment count has not been fully enumerated.

### Preliminary Current Three-Job Workflow Sample

These current-workflow observations are recorded separately from the historical two-job baseline. Approximate workflow durations are calculated from the supplied creation and completion timestamps; they are not individual job durations or precise merge-to-live measurements.

| Run | Workflow scope | Created (UTC) | Completed (UTC) | Approx. duration | Result |
| :--- | :--- | :--- | :--- | ---: | :--- |
| #91 | PR, three-job validation | 2026-10-19T10:08:53Z | 2026-10-19T10:09:30Z | 37s | Success |
| #92 | PR, three-job validation | 2026-10-19T10:45:23Z | 2026-10-19T10:46:05Z | 42s | Success |
| #90 | Main/deployment, three-job gate | 2026-10-19T07:04:59Z | 2026-10-19T07:06:04Z | 65s | Success |

- PR sample: **2** runs (#91 and #92); preliminary mean = (37 + 42) / 2 = **39.5s**; observed success rate = **2/2**.
- Main/deployment sample: **1** run (#90), approximately **65s**, successful; this also verifies the successful three-job deployment gate described in section 5.

This sample is too small to establish a stable baseline or stable reliability. Workload differences prevent direct comparison with the historical two-job sample as proof of improvement or regression; no optimization is claimed. More comparable current-workflow observations are needed. Failed-dependency blocking is verified by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`. This mechanism evidence is separate from the duration sample. Precise merge-to-live time remains unmeasured; production rollback and failed-deployment recovery remain untested and unmeasured.

## 3. Historical Measurements

These observations preserve bootstrap and early frontend history. They are excluded from the current comparable baseline because the workload or workflow scope differed.

### Bootstrap Measurements

| Metric | Result |
| :--- | :--- |
| PR #1 CI duration | 5s |
| Deployment PR CI duration | 7s |
| Bootstrap PR CI average | 6s |
| Bootstrap PR CI success rate | 100% (2/2 observed runs) |

The real frontend did not yet exist on `main`, so frontend installation, linting, and build stages were skipped. The **5s/7s bootstrap measurements are not comparable to the current application pipeline** and cannot demonstrate a performance regression or improvement.

### Early Frontend and Deployment Run Log

| Run | Trigger | Duration | Result | Historical evidence / scope |
| :--- | :--- | :--- | :--- | :--- |
| FE-01 PR #21 CI | Pull request | 20s | Passed | Dependency installation, lint, TypeScript validation through `pnpm build`, and Vite production build |
| FE-01 main CI | Push to `main` | 16s | Passed | Frontend validation after PR #21 merged |
| FE-01 Deploy Production #3 | Push to `main` | 28s | Passed | Separate deployment workflow installed dependencies, built frontend, and deployed with Wrangler |
| PR #28 / run #36 | Pull request | 18s | Passed | Frozen pnpm install, lint, and production build |
| Main CI run #48 (ID `38928750840`) | Push to `main` | Approx. 43s | Passed | Unified workflow; Frontend Checks approx. 12s, Deploy to Cloudflare approx. 25s |

PR #31, `fix(devops): gate production deploy on CI`, was reviewed, approved, and squash-merged as `8f8e0d8456acf3589184c082bfc9f94375c23e67`. It removed the old standalone deployment workflow. Run #48 at that commit verified that deployment waited for Frontend Checks. That historical change established a frontend gate; it does not establish a Database Tests deployment gate or a measured performance improvement.

FE-01 Deploy Production #3 and run #48 were two verified automated frontend deployments at that stage, not the total count of current production deployments. Overall workflow durations and individual job durations have different scopes and should not be combined.

## 4. Production Verification

**Production URL:** <https://moris-mix-ai.diofelgwenharesco.workers.dev>\
**Hosting:** Cloudflare Workers with Static Assets\
**Deployment Method:** GitHub Actions + Wrangler

### Historical Frontend Verification

After FE-01, the production URL served the React application in place of the original Hello World Worker. Both the root route and `/app` client-side route were manually verified, and Wrangler completed successfully. After run #48, the production URL was opened again and the React frontend loaded successfully.

### Sprint 1 Walking Skeleton: Verified

Production verification is complete for this path:

**Cloudflare frontend → Supabase Edge Function → hosted PostgreSQL → matching demo recipe returned → frontend renders recipe.**

The hosted PostgreSQL row was independently confirmed. The QA-01 smoke check on 2026-10-17 recorded a direct request returning `200 OK` with the seeded row and the production browser loading the demo recipe. The response, CI/PR evidence, Gemini result, and applied migration version are recorded in the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).

This verifies the demo recipe read path. The historical QA-01 Gemini `generateContent` request returned `403 PERMISSION_DENIED`; successful Gemini generation is not claimed by this verification.

### Application/API Request Recovery: Verified

The deployed frontend was tested with the API request blocked:

1. The blocked API request produced a safe error UI with no mock fallback.
2. The API request was unblocked.
3. Selecting **Try again** issued a new request that returned **200**.
4. The recipe was restored in the frontend.

This is verified **application/API request recovery**. It does not measure or verify production deployment rollback or recovery from a failed production deployment.

### Still Not Measured or Tested

- Precise merge-to-live time, from the merge event to confirmed production availability.
- Production deployment rollback.
- Recovery time from a failed production deployment.

## 5. Branch Protection and Deployment Quality Gates

At the 2026-11-15 inspection, the active [Protect main ruleset](https://github.com/2ton-exe/moris-mix-ai/rules/24943171) requires pull requests, one approval, code-owner review, stale-approval dismissal after pushes, and resolved review conversations. Required GitHub Actions contexts are **Modular Frontend / Frontend Checks**, **Modular Database / Database Tests**, and **Modular Edge/API / Edge/API Tests**. Force pushes and branch deletion are restricted. E2E, staging and Security Audit are not required PR contexts. The evidence below retains the historical legacy-gate experiments.

The expanded deployment gate is described in section 1. The three-dependency evidence below is historical Sprint 1 evidence, separate from required PR checks and later hosted/E2E additions.

Before PR #43, Deploy to Cloudflare depended only on `frontend`. The following historical observations documented the gap that PR #43 has since closed:

| Main run | Observed ordering |
| :--- | :--- |
| #73 | Frontend Checks completed before deployment started; deployment started while Database Tests were still running |
| #77 | Frontend Checks completed at about **15:30:54Z**; Cloudflare deployment started at about **15:30:56Z**; Database Tests completed at about **15:31:06Z** |

**The frontend-only deployment-gate limitation is resolved by PR #43.** It adds both Database Tests and Edge/API Tests as deployment dependencies. Verified main CI run #90 ran on commit `7b577e70750ab3ec930ef265211c0fd541834aad` and completed successfully:

| Job | Verified result / ordering |
| :--- | :--- |
| Edge/API Tests | Completed successfully before deployment |
| Frontend Checks | Completed successfully before deployment |
| Database Tests | Completed successfully at approximately 07:05:40 UTC |
| Deploy to Cloudflare | Started afterward at approximately 07:05:43 UTC and completed successfully |

The successful three-job gating path is verified by main run #90. Failed-dependency blocking is verified by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`. Run #90 is successful-path ordering evidence, not an addition to the earlier two-job duration baseline. No performance optimization is claimed for DEVOPS-06.

### Controlled Non-Production Failure-Gate Experiment (DEVOPS-06)

Draft PR #68, `[DEVOPS-06] Verify failed validation blocks deployment`, executed controlled experimental run `39279387584` with these results:

| Experimental job | Result |
| :--- | :--- |
| Gate Test - Frontend | Success |
| Gate Test - Edge/API | Success |
| Gate Test - Intentional Database Failure | Failure by design |
| Gate Test - Would Deploy | Skipped |

The inert downstream job declared `needs: [frontend, test-db, test-edge-api]`, matching the historical production deploy gate's three-dependency structure in effect when PR #68 ran. The later legacy production gate had four direct dependencies: `frontend`, `test-db`, `test-edge-api`, and `test-hosted-rls`; the current modular structure is described in section 1. This controlled non-production equivalent dependency-gate experiment verifies GitHub Actions failure propagation: when one required dependency fails and `always()` is not used, the downstream deployment-shaped job is skipped. It used no production credentials, repository secrets, Cloudflare/Supabase deployment commands, or application deployment. Production main was not intentionally failed, and no failed production deployment occurred in this experiment.

The historical evidence chain is the production configuration in effect for the PR #68 experiment (`deploy.needs: [frontend, test-db, test-edge-api]`), successful production ordering (main run #90), and safe verification of the failed-dependency blocking mechanism (PR #68 / experimental run `39279387584`). The experiment is separate from run #90's successful production-main evidence.

Normal CI run #98 on the same PR completed Frontend Checks, Database Tests, and Edge/API Tests successfully; Deploy to Cloudflare was skipped because this was a PR. Run #98 is PR validation evidence, not production deployment evidence. Neither the controlled experiment nor the unusually delayed workflow runs associated with PR #68 are added to a performance baseline; no comparable-duration justification or performance optimization is claimed.

Historically, a manual feature-branch run of the standalone deployment workflow skipped the production job. The unified workflow has a configured main-only condition; that feature-branch manual-dispatch guard has not been separately re-tested.

## 6. Historical Sprint 1 Bottlenecks and Other Limitations

The observations in this section explain the Sprint 1 workload. The later repeated E2E bottleneck is recorded in section 11; these historical candidates are not current optimization conclusions.

- **Database Tests are the longer PR critical path in some observed runs.** PostgreSQL service-container initialization is a major contributor. This is a future optimization candidate; no optimization or measured benefit is claimed.
- The frontend-existence check still permits validation/deployment to be skipped when the frontend is absent. Replacing it with a failure for missing required frontend files remains a follow-up candidate.
- Docs-only pushes to `main` can proceed through deployment. Trigger scope is a possible future efficiency improvement; no benefit has been measured.
- TypeScript validation runs within `pnpm build` rather than as a separately named step.
- The historical two-job sample (four PR runs and two main/deployment runs) and the separate current three-job sample (two PR runs and one main/deployment run) provide only preliminary evidence; their workloads differ and their calculations are kept separate.
- Precise merge-to-live time, production rollback, and failed-production-deployment recovery time remain unmeasured or untested.
- A historical deployment reported its configured Wrangler version as outdated; any upgrade should be evaluated separately.

## 7. Sprint 1 Baseline and Optimization Status

Sprint 1 establishes the baseline. **No performance optimization is claimed for Sprint 1.** The historical preliminary PR mean is 41.75s (approximately 42s) across four runs; the preliminary main/deployment mean is approximately 51s across two runs. These observations describe the earlier two-job sample, not the current three-job workflow, a guaranteed duration, or a stable long-term reliability level.

The earlier bootstrap and frontend runs remain useful historical evidence, but differences in workload prevent using them to prove an improvement or regression against the current pipeline.

## 8. Historical Sprint 1 Measurement Follow-ups

These retain the historical collection requirements. Section 12 is the ongoing Sprint 2 collection checklist.

A preliminary current three-job workflow sample now exists in section 2. More comparable observations are still needed; continue collecting naturally occurring runs and record:

- PR workflow durations and results for the current three-job validation workload, collected separately from the historical two-job sample.
- Main/deployment workflow durations and results, keeping workflow and job timings distinct.
- Production deployment and failed-deployment counts for a clearly defined observation period.
- Precise merge-to-live time.
- Any CI or deployment incident reaching `main`.
- Production rollback test results and recovery time from a failed production deployment when tested or observed.

Keep future measurements separate if the workload or deployment dependencies change. Record small-sample limitations instead of manufacturing artificial results solely to increase the sample count. Application/API retry evidence must remain distinct from deployment recovery evidence.

## 9. Historical Sprint 1 Follow-up Candidates

1. Investigate Database Tests timing, including PostgreSQL service-container initialization, as a future optimization candidate.
2. Continue collecting comparable pipeline observations and precise merge-to-live measurements.
3. Test and document production deployment rollback and failed-deployment recovery.
4. Evaluate docs-only trigger scope, replacement of the frontend-existence skip, and any Wrangler upgrade separately.

These are follow-up opportunities, not implemented or proven optimizations.

## 10. Sprint 1 Metrics Assessment

DEVOPS-03 records a historical preliminary Sprint 1 PR baseline from four comparable successful runs and a separate two-run successful main/deployment sample. The ruleset recorded at that historical checkpoint required Frontend Checks, Database Tests, and Edge/API Tests before PR merge. Following PRs #41 and #43, the historical production gate waited for `frontend`, `test-db`, and `test-edge-api` to succeed in the main run, with the successful path experimentally verified by run #90. The later legacy production gate also required `test-hosted-rls`; current modular policy and dependencies are recorded in sections 1 and 5. The failed-dependency blocking mechanism is verified separately by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`; a separate preliminary duration sample for the current three-job workflow now exists (PR mean 39.5s across two runs; one main/deployment run at approximately 65s), with more comparable observations still needed.

The production walking skeleton and deployed application/API request retry are verified. Precise merge-to-live timing, production deployment rollback, and recovery time from a failed production deployment remain outstanding. Sprint 1 establishes measured evidence without claiming a performance optimization or a stable long-term baseline.

## 11. Sprint 2 Measurement History (DEVOPS-09 / #62)

### Pre-refactor sample

Source: [issue #62 pre-refactor record](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6365963408). Run numbers below identify workflows, not PR numbers.

| Population | Workflow observations | Preliminary mean | Sample outcomes |
| --- | --- | ---: | --- |
| PR validation | CI #127: 34s; CI #128: 37s | 35.5s (2) | 2/2 success; production deployment skipped |
| Main/deployment | CI #125: 81s; CI #131: 68s | 74.5s (2) | 2/2 success; required validation and Cloudflare deployment executed successfully |

These are small pre-refactor workflow samples, not precise merge-to-live measurements. They are not comparable to the later expanded hosted/E2E workload as evidence of improvement.

### Modularization observation

[PR #74's side-by-side observation](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6367211185) records existing CI #134 at approximately 40s and Modular PR Validation #1 at approximately 39s, both successful on the same commit with equivalent frontend/database/Edge validation. This is one architecture/migration runtime-parity observation, not an optimization: running both systems temporarily increased total CI work. Gate and handoff evidence remains in the [modular workflow guide](modular-workflows.md).

### Expanded-pipeline E2E baseline

Source: [bottleneck observation](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6495630306). Scope is the non-gating `Playwright E2E (Non-gating) / Playwright E2E Tests` job, not the whole workflow.

| Authoritative CI run | Approximate E2E job duration |
| --- | ---: |
| #258 | 88s |
| #263 | 98s |
| #264 | 90s |
| Sample summary | 3 observations; mean approximately 92s; median approximately 90s; range approximately 88-98s |

CI #263 recorded approximately 19s for Chromium installation, 67s for `test:e2e:local`, and 36s for the two browser tests within that step. Browser environment setup plus local Supabase preparation and browser execution became the repeated longest PR job. These rounded timings identify a bottleneck; they do not alone establish an optimization or full-pipeline improvement.

### First controlled optimization: headless-shell installation

The [declared hypothesis](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6495878254), five after-attempts and limitations are recorded in [Optimization Experiment 1](optimization-log.md#experiment-1--playwright-chromium-headless-shell-installation). [PR #125](https://github.com/2ton-exe/moris-mix-ai/pull/125) contains one command change at `ead889176e12862d86e644b1406830c3687ea4f2`; this documentation branch does not contain or modify that implementation.

| Metric | Declared baseline | After: CI #266 attempts 1-5 |
| --- | --- | --- |
| E2E job durations | Approximately 88s, 98s, 90s | 90s, 78s, 88s, 84s, 94s |
| Sample size | 3 | 5 |
| Mean / median | Approximately 92s / 90s | 86.8s / 88s |
| Range | Approximately 88-98s | 78-94s |
| Chromium install | Approximately 19s in #263 only; no matched five-run baseline | 12s, 13s, 15s, 12s, 19s |
| Reliability and scope | Small observed baseline | 5/5 E2E attempts passed; same experiment SHA; 2 tests, 1 worker; production deployment skipped |

**Conclusion: Improved — modest measured reduction in the sampled Playwright E2E job duration.** The sampled mean is approximately 5.2s lower (approximately 92s baseline minus 86.8s after). This does not establish that the entire pipeline or merge-to-live is 5.2s faster. Three approximate baseline observations, visible runner/network variance and an unmatched installation-step baseline limit attribution and generalization.

Attempt 1 is canonically **90s**, confirmed by independently verified GitHub job timestamps: `2026-10-29T12:00:36Z` to `2026-10-29T12:02:06Z`. Its Chromium installation took exactly **12s**, from `2026-10-29T12:00:46Z` to `2026-10-29T12:00:58Z`. An earlier live-monitoring estimate was superseded by these exact timestamps; it is not a competing measurement. The [consolidated sample](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6496396449) remains unchanged.

Belen / `myntchoc` approved PR #125, confirming that headless-shell installation matches Playwright's existing default headless execution and that E2E passed. PR #125 merged on 2026-10-30 at `2026-10-30T04:29:29Z` as `7278f92e0fc67348efa60a14293dcdfde9329709` (`ci(e2e): install only chromium headless shell (#125)`), the exact `main` SHA at verification. [CI #284](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41003182840) passed on that SHA: `Playwright E2E (Non-gating) / Playwright E2E Tests` passed in approximately 83s, Chromium installation took 15s, and `Run Playwright E2E against local Supabase` passed in 59s. [Modular Main Validation #16](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41003182843) also passed on the same SHA. This single merged-main verification sample is separate from the five PR after-run attempts; their 86.8s mean is unchanged and no new statistical average is calculated.

CI #284's `Deploy to Supabase and Cloudflare` job passed, including production configuration validation, `recipes` Edge Function deployment and Cloudflare Worker deployment. This proves normal production deployment success after #125 merged; it does not establish post-deployment runtime smoke or independently runtime-verified production availability. PR #125 did not introduce or test PR #88's separate production runtime smoke. At that reconciliation checkpoint, #62 remained open pending PR #126 and remaining evidence work. [PR #126](https://github.com/2ton-exe/moris-mix-ai/pull/126) subsequently merged as `0092f9bd59b98466f7fba27d55fdcfcc883dc32f`; [#62](https://github.com/2ton-exe/moris-mix-ai/issues/62) is closed at the 2026-11-14 inspection. Path/test filtering belongs to [#124](https://github.com/2ton-exe/moris-mix-ai/issues/124), not this experiment.

## 12. Historical Sprint 2 Metrics and Evidence Follow-ups

This checklist preserves the earlier collection gaps and does not assert that #62 or PR #126 is still open. Current DEVOPS-11 pending measurements are listed in section 14.

- Define the Sprint 2 observation period, authoritative workflow population and rerun handling before calculating pipeline success rate. Do not substitute E2E 5/5 for pipeline reliability.
- Enumerate production deployment frequency and failed production deployment count for that same defined period. Two pre-refactor successes are not a complete sprint count.
- Measure current expanded-workload PR workflow and main workflow durations separately from E2E job/step timings and modular duplicates.
- Capture merge timestamp and confirmed production availability with revision linkage before computing average merge-to-live.
- Establish a production change-failure-rate denominator and attributable failures; no rate is currently established.
- Record time to recover only from a qualifying production deployment/runtime failure with defined detection/restoration endpoints. None is measured in this reviewed evidence. Secretary tooling recovery and application retries do not supply production recovery time.
- At the historical checkpoint, PR #126 review/merge and #62 closure were pending. PR #126 subsequently merged as `0092f9bd59b98466f7fba27d55fdcfcc883dc32f`; issue #62 is closed at the 2026-11-14 inspection. PR #125 human approval, merge and successful main execution remain recorded. Production runtime-smoke verification remains separately scoped under PR #88.
- Retain future production smoke, rollback and recovery evidence under the [runbook](deployment-runbook.md), and real incidents under the [incident log](incident-log.md).
- Complete the named course evidence inventory, including confirmation of the `PIPELINE.md` deliverable. Update these records before each consultation.

## 13. Sprint 3 Optimization Summary (DEVOPS-08 / #124)

[Optimization Experiment 2](optimization-log.md#experiment-2--conservative-documentation-only-ci-path-selection) records one controlled documentation-only baseline of **91 s** ([run 41277951140](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41277951140)) and three after-runs of **37 s** each ([41316881204](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41316881204), [41317009174](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41317009174), [41318752140](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41318752140)). The measured reduction is `91 - 37 = 54 s`, or `54 / 91 × 100 ≈ 59.3%`, for this narrow workload.

Implementation [PR #144](https://github.com/2ton-exe/moris-mix-ai/pull/144) and evidence [PR #150](https://github.com/2ton-exe/moris-mix-ai/pull/150) merged. Required core contexts succeeded through lightweight paths; E2E and staging intentionally skipped. [Main run 41323141459](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41323141459) separately verified evidence merge `b2f77b8802675429091a0b4f98f27be60617f900` with full main validation. It is not a docs-only after-run.

One baseline and three after-runs do not prove a general pipeline speedup or reliability gain. Application, workflow, configuration, migration, mixed and unknown changes retain full validation. Sprint 2 Experiment 1's approximately **92 s → 86.8 s E2E job** result remains separate from this Sprint 3 workflow-level docs-only experiment; neither is a merge-to-live measurement.

## 14. Preliminary Sprint 4 Observations (DEVOPS-11 / #164)

### Frozen population and methodology

- **Frozen preliminary observation period: 2026-11-07 00:00:00 UTC through 2026-11-13 17:23:38 UTC**, inclusive by workflow-run `created_at`, for both PR and main populations. This is not a complete calendar-week census or final Sprint 4 result.
- PR population: the **67 completed Modular PR Validation runs #317–#383**, ending with [43472237837](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43472237837). [Newer run #384 / 43474077949](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43474077949) and all later PR runs are excluded. Later runs or reruns must not silently change this snapshot.
- Main population: the **11 Modular Main Validation push runs on main, #48–#58**, listed below, selected by the same frozen `created_at` period. Main #59 onward, manual runs and other workflows are excluded.
- Sources: GitHub Actions [PR runs API](https://api.github.com/repos/2ton-exe/moris-mix-ai/actions/workflows/modular-pr-validation.yml/runs), [main runs API](https://api.github.com/repos/2ton-exe/moris-mix-ai/actions/workflows/modular-main.yml/runs), per-run Jobs API and per-attempt metadata. Date filters, cutoff, workflow identity, event and main branch restrictions define membership; counts are workflow runs, not distinct PRs.
- **Eventual run outcome** means its recorded conclusion at the snapshot after any reruns. **Attempt outcome** describes each attempt separately. Reruns are not independent changes or additional distinct releases.
- PR elapsed proxy: `updated_at - created_at` from run metadata, in seconds. This is not an exact execution-duration API; the rerun's proxy includes waiting between attempts. Single-attempt proxies are reported separately.
- Main job span: `max(completed_at) - min(started_at)` across non-skipped jobs, in seconds. It includes overlapping work and dependency waits, excludes pre-job queue time, and differs from the PR metadata proxy. Only the ten single-attempt main runs enter the routine mean; the incident run is retained outside that timing cohort.
- Retain failures and skips. The separate [Security Audit run 42339925688](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42339925688) is excluded from the modular PR denominator. That path-filtered, observation-only workflow is not a required PR gate; a green audit job does not establish a clean vulnerability report.

### PR outcomes and descriptive timing

| Measurement | Frozen observation |
| --- | --- |
| Eventual workflow-run conclusions | **61 successful / 67 = 91.0%**; **6 failed / 67 = 9.0%**; no cancellations in this sample |
| Individual attempts | **68 total: 61 successful, 7 failed**; attempt success fraction `61 / 68 × 100 = 89.7%` |
| Rerun treatment | [43284525482](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43284525482): [attempt 1 failed](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43284525482/attempts/1), [attempt 2 succeeded](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43284525482/attempts/2); all other 66 runs had one attempt |
| Mixed-population elapsed proxy, including rerun gap | Mean `7496 / 67 = 111.88 s`; median **107 s** |
| Mixed-population single-attempt elapsed proxy | **66 runs**; mean `7292 / 66 = 110.48 s` |

These mixed-population timing statistics describe the frozen workload only. They are not the comparable full-validation PR mean, a docs-only mean, or evidence of improvement over earlier sprints.

The six eventual failed runs are [43385274125](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43385274125), [42495143095](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42495143095), [42394158247](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42394158247), [42373700155](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42373700155), [42373312415](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42373312415), and [42351256122](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42351256122). Their failures remain in both applicable outcome denominators.

### Confirmed documentation-only timing cohort

Each listed run has a successful explicit classifier documentation-only marker and skipped frontend lint. Core lightweight contexts succeeded; E2E and staging intentionally skipped rather than passed.

| Run | Elapsed proxy |
| --- | ---: |
| [43472237837](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43472237837) | 41 s |
| [43467964518](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43467964518) | 37 s |
| [43458229537](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43458229537) | 42 s |
| [42380527017](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42380527017) | 41 s |
| [42375971430](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42375971430) | 43 s |
| [42374572673](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42374572673) | 33 s |
| [42372445106](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42372445106) | 40 s |
| [42348730770](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42348730770) | 35 s |

Mean: `(41 + 37 + 42 + 41 + 43 + 33 + 40 + 35) / 8 = 39.0 s`. This is an observational cohort, not another controlled before/after experiment.

**Full-validation PR timing remains pending.** The other **59 runs** require systematic job-step classification before they can form a confirmed full-validation cohort. Skipped lint in a failed run alone does not prove docs-only classification. Do not label these 59 runs full-validation by subtraction or compare their unclassified timing with the docs-only cohort.

### Main/release outcomes and routine job spans

| Main run | SHA prefix | Job span | Eventual conclusion / attempts |
| --- | --- | ---: | --- |
| [#48 / 42346767555](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42346767555) | `dfc7eba4b3` | 156 s | Success / 1 |
| [#49 / 42347021588](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42347021588) | `2eb315a04c` | 142 s | Success / 1 |
| [#50 / 42347638085](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42347638085) | `3081e5ed38` | 171 s | Success / 1 |
| [#51 / 42347931470](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42347931470) | `21b3d45da7` | 132 s | Success / 1 |
| [#52 / 42377674093](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42377674093) | `94ec34e7fa` | 165 s | Success / 1 |
| [#53 / 42385846372](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42385846372) | `bbab7bb84d` | 154 s | Success / 1 |
| [#54 / 42449585928](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42449585928) | `423920628c` | 156 s | Success / 1 |
| [#55 / 42449845166](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42449845166) | `f8efb6ff6a` | 159 s | Success / 1 |
| [#56 / 42519377169](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42519377169) | `8d60be0784` | 194 s | Success / 1 |
| [#57 / 42759223280](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42759223280) | `05bb122afd` | 140 s | Success / 1 |
| [#58 / 43451688823](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823) | `f36b1fc17f` | Excluded from routine mean | Success / 3; first two failed |

Ten routine single-attempt job spans: mean `1569 / 10 = 156.9 s`, median **156 s**, range **132–194 s**. This is not directly comparable to PR metadata elapsed time, deployment-job duration, or historical workflows with different workloads.

All **11 runs eventually succeeded**, including their production jobs, URL verification, deployed AI-route checks and runtime smoke. This records **11 successful release runs across 11 distinct SHAs**, not 13 independent deployments. First-attempt workflow success was **10/11**; across **13 workflow attempts**, **11 succeeded and 2 failed**. The two failed production attempts belong to one release run; these counts do not establish a formal production change-failure rate.

### Cloudflare deployment exception: main run #58

Exact main SHA: `f36b1fc17ff34601995ca38d183e0a4fb28cccb8`. Incident analysis is maintained separately in [PR #196](https://github.com/2ton-exe/moris-mix-ai/pull/196); this metrics entry does not replace that record or assert a confirmed provider root cause.

| Attempt | Production job start–completion (2026-11-13 UTC) | Deployment and verification |
| --- | --- | --- |
| [1](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823/attempts/1) | 15:22:33–15:23:22 | Three Edge Function deployments succeeded; Cloudflare deployment failed; subsequent URL, AI-route and runtime smoke steps skipped |
| [2](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823/attempts/2) | 15:30:15–15:31:11 | Three Edge Function deployments succeeded; Cloudflare deployment failed; subsequent URL, AI-route and runtime smoke steps skipped |
| [3](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823/attempts/3) | 16:48:45–16:49:40 | Cloudflare deployment, URL verification, AI-route checks and runtime smoke succeeded |

Successful validation jobs retain their original attempt-1 execution timestamps in later attempt metadata; do not claim those validations freshly executed on attempt 3. The successful production runtime smoke completed at **16:49:34 UTC**. Retained artifacts are `production-runtime-smoke-43451688823-3` and `production-ai-route-smoke-43451688823-3`.

The calendar span across retries is not ordinary pipeline execution time or an agreed recovery interval. Automated release/smoke recovery does not establish exhaustive authenticated application acceptance, rollback or isolated database restore.

### Remaining measurements and interpretation limits

- **Full-validation PR timing:** pending job-step classification and comparable cohort selection for the 59 unclassified runs; preserve failures, cancellations and skips in any later analysis.
- **Merge-to-live:** pending a per-SHA join between actual PR merge timestamps and the first successful matching production smoke, with origin/endpoint and incident-delay treatment stated.
- **Formal recovery time:** pending agreed detection/restoration boundaries with the incident record owner / PR #196. Do not substitute rerun waiting time, production-job duration, application retry time or zero.
- **Change-failure rate:** pending an explicit qualifying-change and failure definition; two failed attempts are not two independently failed changes.
- **Third optimization:** no new experiment is claimed. This mixed observation sample does not establish a new bottleneck with a controlled comparable baseline; retain the two existing experiments and their scope limits.
- **Completeness:** this frozen preliminary sample is not a whole-sprint reliability guarantee, a complete final-week census, or completion evidence for every acceptance criterion in [#164](https://github.com/2ton-exe/moris-mix-ai/issues/164).

## 15. Final Sprint 4 Measurement Window and Supplemental Main Push Evidence

### Reporting window, population and source

- **Frozen final reporting window:** `2026-11-07T00:00:00Z` inclusive through `2026-11-18T00:00:00Z` exclusive. Membership uses workflow-run `created_at`; outcomes and attempts reflect the evidence extraction on 2026-11-18. This bounded sample is not a whole-sprint reliability guarantee.
- The extraction enumerated **2,427 unique repository runs** across eleven daily partitions and selected the modular PR and main workflows by workflow ID: `394115230` and `395099303`. It contains **288 unique workflow runs and 294 unique run-attempt pairs**: 231 PR `pull_request`, 51 main `push`, and 6 main `workflow_dispatch` runs. There were no cancelled runs. These counts are workflow runs, not distinct PRs or code changes.
- The extraction inspected main at `359c9facb993f4adf3b5a673e84f28c2b20c0b99`; current main workflow source was rechecked at `1add77018d46d26def068748d4df513bfe654248`. The earlier preliminary population in section 14 remains intact and separate. Later November 18–19 pushes are reported in a supplemental subsection below and are excluded from every frozen count and mean here.
- The [evidence extraction record](https://github.com/2ton-exe/moris-mix-ai/issues/164#issuecomment-6981417219) records the selected population and exact-SHA merge-to-smoke join. [PR #224](https://github.com/2ton-exe/moris-mix-ai/pull/224), merged as `a0a929d81535dc796bb28384414518843dcf698f`, introduced the reusable parallel Chromium, Firefox and WebKit job graph: [caller at that SHA](https://github.com/2ton-exe/moris-mix-ai/blob/a0a929d81535dc796bb28384414518843dcf698f/.github/workflows/reusable-e2e.yml) (`1d836abb…`) and [browser workflow at that SHA](https://github.com/2ton-exe/moris-mix-ai/blob/a0a929d81535dc796bb28384414518843dcf698f/.github/workflows/reusable-e2e-browser.yml) (`333a83b7…`). [PR #232](https://github.com/2ton-exe/moris-mix-ai/pull/232), merged as `3068d12696eae3c0ff89c8bfb8f5c76a3e505e83`, integrated conditional recipe-image readiness into Modular Main; only one push with that readiness job is in this frozen window.
- **Workflow-run outcome** is the latest recorded conclusion at extraction, after any reruns. **Attempt outcome** is each execution separately. Reruns are not new changes or independent releases. A failed or skipped production step is not a deployment success or a smoke pass.

| Population | Workflow-run outcome | Attempt outcome | Denominator interpretation |
| --- | --- | --- | --- |
| Modular PR Validation, `pull_request` | **196/231 success (84.8%); 35/231 failure (15.2%)** | **196/232 success (84.5%); 36/232 failure (15.5%)** | The 232nd attempt is a failed attempt followed by a successful rerun of one PR run. |
| Modular Main Validation, `push` to `main` | **42/51 success (82.4%); 9/51 failure (17.6%)** | **42/56 success (75.0%); 14/56 failure (25.0%)** | Push runs and their retries stay distinct from manual dispatches. |
| Modular Main Validation, `workflow_dispatch` on `main` | **6/6 success (100%)** | **6/6 success (100%)** | Manual validation is not added to the push denominator. |

PR path selection classified **23 runs as documentation-only** (23/23 eventual success) and **208 as full-path selections** (173 success, 35 failure). Full-path attempts were 173 successful and 36 failed because one failed PR attempt was retried successfully. Documentation-only runs retained lightweight core checks; E2E and staging were intentionally skipped, not passed.

### Comparable PR timing cohorts

A **job span** is `max(completed_at) - min(started_at)` across non-skipped jobs in one workflow attempt. It includes parallel work and dependency waits, excludes queue time before the first job starts, and may include inter-job scheduling or runner waits. It is not a workflow elapsed proxy or merge-to-live measurement. Timing means below use single-attempt runs only. Failures remain in their named run/outcome denominator. The separate `updated_at - created_at` PR metadata proxy includes queue time and, for a rerun, the interval between attempts.

| PR cohort | Workflow runs / outcomes; attempts | Single-attempt job-span calculation | Mean / median; range | Evidence anchors |
| --- | --- | --- | --- | --- |
| Confirmed documentation-only | 23 runs; 23 success; 23 attempts | `854 s / 23` | **37.13 s / 38 s; 31–46 s** | Per-run ledger below |
| Modern parallel three-browser orchestration | 39 runs; 26 success / 13 failure; 39 attempts | `14,058 s / 39` | **360.46 s / 355 s; 193–557 s** | Per-run ledger below |

The source-version review separated the 39-run parallel reusable-call generation from four workflow-transition records in the broader 43-run three-browser-by-job-name set. In the recorded source snapshots, [run 43705622067](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43705622067) has the earlier matrix wrapper (`reusable-e2e.yml` blob `e24cfb017f`), while [43711961309](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43711961309), [43713113634](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43713113634), and [43713795108](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43713795108) have the earlier combined all-browser wrapper (blob `9818c5f761`). All four excluded transition runs succeeded. The selected 39 use the parallel source: 26 local revisions match caller/callee blobs `1d836abb82` / `333a83b7c6`, and GitHub source views for the remaining 13 revisions show the same separate Chromium, Firefox and WebKit reusable calls. The wrapper requires all three browser jobs to pass. This is a workflow-generation boundary, **not** proof of identical E2E inventories: frontend features and browser journeys changed during this period, so the 39-run timing is descriptive within a common orchestration shape and not a controlled before/after result. The remaining 165 full-path runs without three-browser job names also span different E2E generations and early failures; they are not pooled into one full-validation mean.

### Per-run PR cohort ledger

This in-document ledger provides run IDs, workflow-run `head_sha` prefixes, eventual outcomes and single-attempt job spans for both comparable cohorts above. The `head_sha` prefixes are run metadata and do not necessarily identify the exact PR checkout or tested merge revision. Run links open the source GitHub Actions records. Durations are calculated from per-job timestamps in the frozen November 18 evidence extraction using the job-span definition above, not the run-metadata elapsed proxy.

#### Confirmed documentation-only cohort (23 runs)

| Run | Workflow-run `head_sha` prefix | Outcome | Job span |
| --- | --- | --- | ---: |
| [42348730770](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42348730770) | `7705fe2f` | success | 31 s |
| [42372445106](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42372445106) | `f98e3fcc` | success | 38 s |
| [42374572673](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42374572673) | `f98e3fcc` | success | 31 s |
| [42375971430](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42375971430) | `20f7806a` | success | 40 s |
| [42380527017](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42380527017) | `95917831` | success | 38 s |
| [43458229537](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43458229537) | `82bb2d40` | success | 38 s |
| [43467964518](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43467964518) | `9c3285c5` | success | 35 s |
| [43472237837](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43472237837) | `18c7bd95` | success | 38 s |
| [43553098798](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43553098798) | `d9c38fd5` | success | 31 s |
| [43554653652](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43554653652) | `89c977f1` | success | 39 s |
| [43554828220](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43554828220) | `89c977f1` | success | 33 s |
| [43557026270](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43557026270) | `3aef9624` | success | 46 s |
| [43582464761](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43582464761) | `29623c28` | success | 42 s |
| [43594958907](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43594958907) | `f6249bb4` | success | 34 s |
| [43596603961](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43596603961) | `cda69e2f` | success | 43 s |
| [43601098355](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43601098355) | `34107404` | success | 33 s |
| [43603522035](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43603522035) | `de9a96cb` | success | 42 s |
| [43605428450](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43605428450) | `de9a96cb` | success | 35 s |
| [43614676098](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43614676098) | `3fef4148` | success | 36 s |
| [43657252339](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43657252339) | `4f973ef0` | success | 37 s |
| [43674466928](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43674466928) | `4f40e315` | success | 40 s |
| [43682162273](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43682162273) | `52b72b70` | success | 32 s |
| [43701831840](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43701831840) | `fd2531b0` | success | 42 s |

#### Modern parallel three-browser cohort (39 runs)

| Run | Workflow-run `head_sha` prefix | Outcome | Job span |
| --- | --- | --- | ---: |
| [43707607563](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43707607563) | `45583d53` | failure | 336 s |
| [43707783525](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43707783525) | `35f56487` | success | 311 s |
| [43714967878](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43714967878) | `9cb43e0c` | success | 323 s |
| [43715540055](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43715540055) | `4ee07a5e` | success | 346 s |
| [43717915128](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43717915128) | `981e2258` | success | 350 s |
| [43719299197](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43719299197) | `02c06db6` | success | 270 s |
| [43719589857](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43719589857) | `59280c5d` | success | 330 s |
| [43720280591](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43720280591) | `19edba4e` | success | 360 s |
| [43724635080](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43724635080) | `d7ce5d17` | success | 356 s |
| [43725367923](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43725367923) | `f9fd0bd4` | success | 310 s |
| [43730361058](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43730361058) | `222128be` | success | 313 s |
| [43733486444](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43733486444) | `27a95b9c` | success | 369 s |
| [43737378352](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43737378352) | `84557127` | failure | 308 s |
| [43738433002](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43738433002) | `fc140aef` | failure | 320 s |
| [43738739663](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43738739663) | `cc2a8ae3` | success | 363 s |
| [43742776316](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43742776316) | `79e78044` | failure | 303 s |
| [43754689252](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43754689252) | `c91f24ac` | success | 316 s |
| [43835099233](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43835099233) | `67941a75` | success | 326 s |
| [43931821111](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43931821111) | `07683830` | failure | 404 s |
| [43942311632](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43942311632) | `e4ed4525` | success | 355 s |
| [44072167683](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44072167683) | `09b0d2b6` | success | 316 s |
| [44075363410](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44075363410) | `7d2307fd` | failure | 347 s |
| [44076191966](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44076191966) | `497b8c10` | failure | 381 s |
| [44076591171](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44076591171) | `1b7f0a1c` | failure | 193 s |
| [44076712248](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44076712248) | `cafd9b39` | success | 314 s |
| [44078480074](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44078480074) | `4d80159b` | success | 378 s |
| [44078891000](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44078891000) | `a7ef0215` | success | 356 s |
| [44081440768](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44081440768) | `5f248b69` | failure | 413 s |
| [44081483071](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44081483071) | `5f248b69` | failure | 395 s |
| [44086582120](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44086582120) | `3575667e` | success | 369 s |
| [44125678613](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44125678613) | `b06d78b0` | failure | 547 s |
| [44132257799](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44132257799) | `482da864` | success | 557 s |
| [44143607481](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44143607481) | `d1090f4b` | success | 377 s |
| [44149942315](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44149942315) | `57cc6c52` | success | 358 s |
| [44152052639](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44152052639) | `695d9425` | success | 391 s |
| [44159009575](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44159009575) | `d875f35f` | failure | 419 s |
| [44160611719](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44160611719) | `28f5eb96` | success | 462 s |
| [44168992154](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44168992154) | `c46a3f1b` | failure | 353 s |
| [44170266348](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44170266348) | `7f08bde8` | success | 463 s |

### Pre-readiness Modular Main timing

Main comparisons are **grouped by observed job shape and readiness presence**; push events and manual dispatches remain separate. Main E2E executes separately from production and may finish after production smoke; main job spans are not deployment duration. The source-generation boundary is explicit: the successful [push run 43711905456](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43711905456) on `a0a929d81535dc796bb28384414518843dcf698f` is the initial workflow-transition push for PR #224 and is excluded from the steady pre-readiness timing cohort. The next readiness generation is visible in [run 44104029368](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44104029368) at the #232 integration; that one run is not used as a trend.

| Trigger / cohort | Workflow runs / outcomes; attempts | Single-attempt spans | Calculation | Mean / median; range |
| --- | --- | --- | --- | --- |
| Main push, three-browser orchestration before integrated readiness | 8; 4 success / 4 failure; 10 attempts (4 success / 6 failure) | [43720961699](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43720961699) 320 s; [43719078328](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43719078328) 284 s; [43716111783](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43716111783) 349 s; [43715518195](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43715518195) 300 s; [43803260383](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43803260383) 346 s; [43802925719](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43802925719) 365 s | `1,964 s / 6` | **327.33 s / 333 s; 284–365 s** |
| Main manual dispatch, three-browser orchestration before integrated readiness | 6; 6 success; 6 attempts | [43735285840](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43735285840) 325 s; [43726522748](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43726522748) 337 s; [43722288753](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43722288753) 337 s; [43717449398](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43717449398) 339 s; [43717107066](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43717107066) 289 s; [43883011168](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43883011168) 411 s | `2,038 s / 6` | **339.67 s / 337 s; 289–411 s** |

The eight push runs include two multi-attempt runs with eventual success: [43726091203](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43726091203) and [43835920734](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43835920734), each with two attempts. All 10 attempts remain in outcome counts; only the other six one-attempt runs enter the job-span mean. Push-trigger counts and manual-dispatch counts remain separate. The larger 41-push group without three-browser job names is excluded from this comparison because it spans earlier orchestration, failed runs before browser jobs, and different job inventories.

### Production-job, deployment-command and runtime-smoke outcomes

There were **62 main production-job attempts** in the frozen window: 56 from pushes and 6 from manual dispatches. This job-level denominator differs from the run-level push/manual table above.

| Measure across 62 production attempts | Outcome | What the count means |
| --- | --- | --- |
| Production job | **48 success; 14 failure** | Failures comprise 2 Cloudflare deployment-command failures, 1 runtime-smoke failure, 6 recipe-image readiness blocks and 5 stale-revision rejections. The 14 failed jobs are not 14 failed deployments. |
| Cloudflare deployment command | **49 success; 2 failure; 11 skipped** | Commands that completed successfully; skips are not successes. |
| Runtime smoke | **48 pass; 1 failure; 13 skipped** | The 48 passed smoke attempts cover **43 distinct source SHAs**. A skipped smoke is not a pass. |

Successful production-job duration was `2,395 s / 48 = 49.90 s` (n=48 successful jobs; job `started_at` to `completed_at`). Successful Cloudflare deployment-step duration was `435 s / 49 = 8.88 s` (n=49 successful step executions; step timestamps). The Cloudflare step is nested within the production job and is not the job duration. Failures and skips remain in the outcome table above; these two means include successful executions only. They are descriptive across the changing release configurations in this window, not a controlled comparable-workload benchmark.

On [run 43530661641 attempt 1](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43530661641/attempts/1), the configured deployment commands and URL verification succeeded, but production runtime smoke failed because the JavaScript asset returned an unexpected content type after **three attempts**; frontend HTML and the demo database checks passed. Attempt 2 on the same SHA passed runtime smoke. Preserve this as one failed production-job attempt and one failed smoke attempt; the available evidence does not establish user impact or an outage.

For the 2026-11-13 release attempt sequence, the observed interval from the first failed Cloudflare step completion (`2026-11-13T15:23:17Z`) to successful runtime-smoke completion (`2026-11-13T16:49:34Z`) is **5,177 s (86m17s)**. It includes retries and waiting and is a release-step-to-smoke interval only; it does not establish detection time, user impact, first public restoration, or formal outage/recovery time. See the [incident recovery record](incident-log.md), which retains formal outage/recovery time as unavailable.

### Exact-SHA merge-to-smoke and missing endpoints

The extraction joins each PR merge SHA to the first successful production runtime-smoke completion for that exact SHA, considering push and manual main runs and every attempt. This is merge-to-confirmed-smoke elapsed time, including queue and retry waits; it does not identify the exact first instant the version became publicly available.

- **43/51** merge SHAs have an observed successful same-SHA smoke endpoint. Among those endpoints, mean is **791.84 s**, median **172 s**, range **133–20,181 s**.
- The following **eight endpoints remain unavailable** in this selected population; they are not zero-duration joins: PRs **#227, #216, #192, #214, #219, #209, #215 and #201**.
- The 20,181 s long endpoint includes a delayed retry on [run 43835920734 attempt 2](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43835920734/attempts/2). Do not replace the median with a per-attempt workflow duration or discard delayed joins without a stated rule.

### Supplemental main-push observations: November 18–19 UTC

These seven `push` events were independently checked in the live [Modular Main Validation run list](https://github.com/2ton-exe/moris-mix-ai/actions/workflows/modular-main.yml?query=branch%3Amain+created%3A2026-11-18..2026-11-19). They are outside the frozen November 7–17 population and do not change any denominator above. No manual dispatch is included in this supplement.

| Run | Main SHA | Overall workflow | Production job | Cloudflare deployment command | Runtime smoke | Evidence / distinction |
| --- | --- | --- | --- | --- | --- | --- |
| [#105 / 44255817102](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44255817102) | `359c9fa` | Success | Success | Success | Passed | Push on the frozen extraction SHA; later than the Nov 7–17 population by run creation time. |
| [#107 / 44284529577](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44284529577) | `790bd75` | Success | Success | Success | Passed | Main push. |
| [#108 / 44529297150](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44529297150) | `e9b7309` | Failure | Failure | Skipped | Skipped | Stale-revision guard rejected this SHA because current main was `b6d9e58`; no production deployment command ran. |
| [#109 / 44529624203](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44529624203) | `b6d9e58` | Success | Success | Success | Passed | Main push. |
| [#110 / 44538439561](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44538439561) | `b245452` | Success | Success | Success | Passed | Main push. |
| [#111 / 44596125585](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44596125585) | `0f6ac02` | Failure | Success | Success | Passed | Overall E2E failed (Chromium and WebKit); production deployment and runtime smoke still succeeded. |
| [#112 / 44631829103](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44631829103) | `1add770` | Success | Success | Success | Passed | Main push; latest listed run in the bounded supplement. |

Across this supplement: **5/7 overall workflow runs succeeded and 2/7 failed**. Production jobs were **6 success / 1 failure**; Cloudflare deployment commands were **6 success / 1 skipped / 0 failed**; runtime smoke was **6 passed / 1 skipped / 0 failed**. In [run 44529297150](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44529297150), the production job failed at stale-revision rejection before deployment; this is not a failed deployment or outage. [Run 44596125585](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44596125585) is a different case: the overall workflow failed in E2E despite successful production deployment and smoke. Configured `account-export` steps are skipped in these releases; that skip is not a passed deployment.

### Optimization conclusion and remaining limits

- **Sprint 2, Experiment 1 — Chromium headless-shell install:** the approximate E2E-job baseline averaged **92 s** across three observations; five after-attempts on one workflow run averaged **86.8 s**. The approximately **5.2 s** reduction is limited to that Playwright E2E job. It is not a whole-workflow or merge-to-live gain; see [Optimization Experiment 1](optimization-log.md#experiment-1--playwright-chromium-headless-shell-installation).
- **Sprint 3, Experiment 2 — conservative documentation-only path selection:** one **91 s** baseline and three **37 s** after-runs measured a **54 s (about 59.3%)** reduction for that documentation-only workload. Lightweight core contexts remained; E2E and staging were intentionally skipped. It is not an all-PR speed or reliability claim; see [Optimization Experiment 2](optimization-log.md#experiment-2--conservative-documentation-only-ci-path-selection).
- **No third optimization is justified by this evidence.** The full-path PR test inventory changed; only one integrated-readiness push is in the frozen window; and the seven later pushes do not establish a repeatable bottleneck with a matched baseline. Preserve both existing experiments and their narrow scopes. Do not claim a single full-validation PR mean, a pipeline-wide speedup, a production change-failure rate, or a reliability trend from these cohorts.
- **Remaining limits:** the eight merge-to-smoke endpoints, first public-availability timestamps, formal outage/recovery time, production rollback evidence, and isolated database-restore evidence remain unavailable or unproven. The supplemental November 18–19 pushes are a small separate observation, not an extension of the frozen denominator or trend.
