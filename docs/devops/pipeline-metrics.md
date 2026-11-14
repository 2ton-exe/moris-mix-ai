# Project-wide DevOps Pipeline Metrics

> Current architecture and policy are dated to the inspected main SHA in section 1.
> Sections 2–12 preserve Sprint 1/2 measurements and their historical scope;
> references to a "current" sample within those records mean that checkpoint.
> Sections 13–14 record Sprint 3 optimization and preliminary Sprint 4 evidence.

**Project:** Mori's Mix\
**Team:** 2ton.exe  
**Maintainer:** Haresco  
**Scope:** Continuing weekly and multi-sprint DevOps metrics log\
**Reconciled:** 2026-11-14, preliminary Sprint 3/4 evidence; the 2026-10-30 reconciliation and merged-main optimization verification at `7278f92e0fc67348efa60a14293dcdfde9329709` remain historical records\
**Status:** Sprint 1/2 measurements and both controlled optimization experiments are preserved. Sprint 4 uses a frozen preliminary sample; comparable full-validation PR timing, merge-to-live and formal recovery time remain pending.

## Sprint metrics summary

Update this log before every consultation. Different pipeline generations and workflow/job timing scopes remain separate; no single average represents an entire sprint with incompatible workloads.

| Sprint | Avg PR pipeline time | Main pipeline time | Pipeline success rate | Production deploys | Avg merge-to-live | Failed deploys | Time to recover | Change made |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- |
| Sprint 1 | Historical two-job sample: 41.75s (4); later three-job sample: 39.5s (2) | Historical sample: approximately 51s (2); later run #90: approximately 65s (1) | Historical samples: PR 4/4, main 2/2; later samples: PR 2/2, main 1/1. No sprint-wide denominator. | Not fully enumerated | Not yet measured | No failures in historical two-run deployment sample; sprint total not fully enumerated | Production recovery not measured; no qualifying production recovery event in reviewed sample | Add real frontend/DB/Edge validation and all-checks deployment gate |
| Sprint 2 | Pre-refactor: 35.5s (2). Expanded-workload whole-PR workflow average not yet measured; E2E job samples below are not pipeline averages. | Pre-refactor: 74.5s (2); current expanded-workload main sample not yet measured | Pre-refactor PR 2/2 and main 2/2; experiment E2E 5/5. Sprint-wide observation period/denominator not yet defined. | Not fully enumerated; two successful pre-refactor deployments recorded, not a sprint total | Not yet measured | Not fully enumerated for a defined period | Production recovery not measured; Secretary tooling recovery has no measured interval | Modular shadow validation, hosted/E2E validation, staging frontend delivery, Secretary repair; headless-shell experiment human-approved, merged and verified on main (CI #284; one E2E sample, approximately 83s) |
| Sprint 3 | Controlled docs-only experiment: 91 s before, 37 s after; not an all-PR mean | Separate merged-main verification; no sprint mean | No sprint-wide denominator | Not enumerated | Pending | Not enumerated | Pending | Conservative docs-only path selection; see section 13 |
| Sprint 4 preliminary | Docs-only proxy: 39.0 s (8); full-validation mean pending | Single-attempt job span: 156.9 s (10) | Eventual PR runs: 61/67; main runs: 11/11; attempt outcomes separate | 11 successful release runs / distinct SHAs | Pending | 2 failed attempts in 1 release run | Formal interval pending | Frozen observation sample; no new optimization claimed; see section 14 |

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

The historical main inspection snapshot was `f36b1fc17ff34601995ca38d183e0a4fb28cccb8`. The architecture below was rechecked against current main `3775730f4604dee99398c008bc8eec6d00a3a369` on 2026-11-14; the frozen measurements in section 14 remain unchanged. `ci.yml` is retired. [Modular PR Validation](../../.github/workflows/modular-pr-validation.yml) owns PR validation and eligible staging delivery; [Modular Main Validation](../../.github/workflows/modular-main.yml) is the sole production caller. These are active workflows, not shadow duplicates.

The validation paths at that current-main checkpoint are:

| Job | Workload |
| :--- | :--- |
| Frontend Checks | Reusable frontend validation: dependencies, retained policy/safety regressions, application lint/tests/build on the full path |
| Database Tests | Reusable PostgreSQL service, migrations, migration lifecycle and RLS validation on the full path |
| Edge/API Tests | Reusable type-checking, deterministic API/AI tests and guarded non-production hosted validation on the full path |
| Hosted RLS Integration | Nested in the Edge/API reusable workflow; mandatory on main through `require-hosted-rls: true` |
| Playwright E2E Tests | Reusable browser validation; outside the production deployment dependency list and not a required PR context |

PR workflows do not call production. The three required PR contexts are `Modular Frontend / Frontend Checks`, `Modular Database / Database Tests`, and `Modular Edge/API / Edge/API Tests`; current review controls are recorded in section 5. Explicit conservative documentation-only classification retains these core checks through lightweight paths and intentionally skips E2E and staging. Other changes retain full validation; staging also requires successful core checks and a non-draft same-repository PR. Main always uses full validation. An intentional skip is not a passed application test, deployment or smoke check.

**Deploy to Supabase and Cloudflare** runs through [Reusable Production Release](../../.github/workflows/reusable-production.yml) on qualifying main push/manual events. It validates the target and caller, installs dependencies, builds the frontend, rejects stale revisions, deploys `recipes`, `extract-recipe`, and `generate-recipe`, then deploys Cloudflare assets through Wrangler. Its `Verify production deployment URL` step checks that Wrangler's reported deployment URL matches configured `PRODUCTION_FRONTEND_URL`, allowing a trailing slash; this checks configured URL consistency. `Production runtime smoke` provides the separate live application check. Deployed AI-route checks also run, and evidence artifacts are preserved. Frontend existence remains required; production concurrency is serialized. The `deploy-upload-signing` job (`Deploy protected upload-signing function`) in `modular-main.yml` is disabled with `if: false`. Separately, the `Deploy recipe image upload cleanup Edge Function` step in `reusable-production.yml` is disabled with `if: false`.

The current main production caller declares **`needs: [frontend, test-db, test-edge-api]`**. The Edge/API reusable caller includes mandatory Hosted RLS on main, so its nested result participates in the gate. E2E runs separately and is not a production dependency. Frontend existence and main/caller guards also apply. Historical PR #43, run #90 and PR #68's failure-propagation experiment retain their earlier scope; section 14 supplies the new release execution evidence.

Production database migrations remain separate and are not applied by the inspected main release workflow. [Open PR #154](https://github.com/2ton-exe/moris-mix-ai/pull/154) proposes migration automation and overlaps this document; its proposal is not current-main behavior. Section 14 records automated deployment/smoke evidence, not exhaustive application acceptance, rollback or database restore proof. See the [runbook](deployment-runbook.md) for separately scoped procedures and evidence.

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

At the 2026-11-14 inspection, the active [Protect main ruleset](https://github.com/2ton-exe/moris-mix-ai/rules/24943171) requires pull requests, one approval, code-owner review, stale-approval dismissal after pushes, and resolved review conversations. Required GitHub Actions contexts are **Modular Frontend / Frontend Checks**, **Modular Database / Database Tests**, and **Modular Edge/API / Edge/API Tests**. Force pushes and branch deletion are restricted. E2E, staging and Security Audit are not required PR contexts. The evidence below retains the historical legacy-gate experiments.

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

One baseline and three after-runs do not prove a general pipeline speedup or reliability gain. Application, workflow, configuration, migration, mixed and unknown changes retain full validation. Experiment 1's approximately **92 s → 86.8 s E2E job** result remains separate from this workflow-level docs-only experiment; neither is a merge-to-live measurement.

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
