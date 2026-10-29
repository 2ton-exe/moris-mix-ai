# Project-wide DevOps Pipeline Metrics

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco  
**Scope:** Continuing weekly and multi-sprint DevOps metrics log\
**Reconciled:** 2026-10-29, from `origin/main` at `d54e0f1d76f4a2215aa70ae4ce9cf6ec3e8c53a6` and linked GitHub evidence\
**Status:** Sprint 1 historical baselines preserved. Sprint 2 samples and the first measured E2E experiment are recorded; complete delivery metrics and PR #125 main verification remain pending.

## Sprint metrics summary

Update this log before every consultation. Different pipeline generations and workflow/job timing scopes remain separate; no single average represents an entire sprint with incompatible workloads.

| Sprint | Avg PR pipeline time | Main pipeline time | Pipeline success rate | Production deploys | Avg merge-to-live | Failed deploys | Time to recover | Change made |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- |
| Sprint 1 | Historical two-job sample: 41.75s (4); later three-job sample: 39.5s (2) | Historical sample: approximately 51s (2); later run #90: approximately 65s (1) | Historical samples: PR 4/4, main 2/2; later samples: PR 2/2, main 1/1. No sprint-wide denominator. | Not fully enumerated | Not yet measured | No failures in historical two-run deployment sample; sprint total not fully enumerated | Production recovery not measured; no qualifying production recovery event in reviewed sample | Add real frontend/DB/Edge validation and all-checks deployment gate |
| Sprint 2 | Pre-refactor: 35.5s (2). Expanded-workload whole-PR workflow average not yet measured; E2E job samples below are not pipeline averages. | Pre-refactor: 74.5s (2); current expanded-workload main sample not yet measured | Pre-refactor PR 2/2 and main 2/2; experiment E2E 5/5. Sprint-wide observation period/denominator not yet defined. | Not fully enumerated; two successful pre-refactor deployments recorded, not a sprint total | Not yet measured | Not fully enumerated for a defined period | Production recovery not measured; Secretary tooling recovery has no measured interval | Modular shadow validation, hosted/E2E validation, staging frontend delivery, Secretary repair; headless-shell experiment pending merge/main verification |

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
Proposed -> Configured -> Locally tested -> Executed in CI -> Passed in CI
         -> Required -> Merged -> Deployed -> Verified
```

These are distinct claims, not automatic promotions: passing does not make a check required; requirement is a separate GitHub policy fact. Configured does not mean executed; executed does not mean passed; PR CI passed does not mean main verified; deployed does not mean runtime verified; skipped does not mean passed. Human review and CodeRabbit review are separate from CI results.

## 1. Current Delivery System

- **Continuous Integration:** GitHub Actions
- **Frontend:** React, Vite, and TypeScript
- **Package Manager:** pnpm
- **Deployment Platform:** Cloudflare Workers with Static Assets
- **Cloudflare Worker:** `moris-mix-ai`
- **Production Branch:** `main`

At the reconciled source revision, the authoritative [CI workflow](../../.github/workflows/ci.yml) starts these validation paths:

| Job | Workload |
| :--- | :--- |
| Frontend Checks (`frontend`) | Install dependencies, lint, frontend tests, and build |
| Database Tests (`test-db`) | PostgreSQL 16 service, dependency installation, database migrations, migration lifecycle tests, and RLS tests |
| Edge/API Tests (`test-edge-api`) | Type-checking and deterministic recipe CRUD, demo, and AI tests; optional hosted RLS tests with guarded test-database migrations |
| Hosted RLS Integration (`test-hosted-rls`) | Runs after Edge/API; hosted lineage integration required by the production deployment gate; untrusted fork PRs excluded |
| Playwright E2E (Non-gating) (`test-e2e`) | Reusable job; local Supabase, Chromium and two browser tests using one worker; not an authoritative production deployment dependency |

PR runs execute validation and skip production deployment. Recorded ruleset evidence requires **Frontend Checks**, **Database Tests**, and **Edge/API Tests**, one approving teammate review, and resolved review conversations before merge. Hosted RLS is an additional production dependency, not a fourth required PR context in this record. Modular PR/main workflows run separate shadow validation; eligible modular PRs also run staging frontend deploy/smoke. Do not pool those duplicate executions into the authoritative CI sample.

**Deploy to Supabase and Cloudflare** runs on qualifying `main` pushes or permitted main `workflow_dispatch` runs. It validates the target, installs frontend dependencies, builds the frontend, deploys only the `recipes` Edge Function, then deploys Cloudflare assets through Wrangler. The temporary frontend-existence mechanism remains, with deployment requiring `needs.frontend.outputs.exists == 'true'`.

The current deployment declares **`needs: [frontend, test-db, test-edge-api, test-hosted-rls]`**. All dependencies must succeed in the same run. Normal dependency semantics configure failure/cancellation/skip blocking. Historical PR #43 and main run #90 establish the earlier three-job successful gate; PR #68 / run `39279387584` establishes its controlled failure-propagation mechanism. Those historical observations do not alone verify the later expanded gate or a new production deployment.

Production database migrations remain separate and are not applied by CI. Configuration of `recipes` deployment is established; this reconciliation does not claim a new production runtime/CRUD smoke verification. See the [runbook](deployment-runbook.md) and [dated observability audit](observability-audit.md) for their explicitly scoped evidence.

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

Verified current GitHub ruleset evidence for `main` requires pull requests, one approving teammate review, **Frontend Checks**, **Database Tests**, **Edge/API Tests**, and resolved review conversations. Force pushes and branch deletion are restricted. Protection rules have been observed blocking merge when approval requirements were unsatisfied.

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

The inert downstream job declared `needs: [frontend, test-db, test-edge-api]`, matching the production deploy gate's three-dependency structure. This controlled non-production equivalent dependency-gate experiment verifies GitHub Actions failure propagation: when one required dependency fails and `always()` is not used, the downstream deployment-shaped job is skipped. It used no production credentials, repository secrets, Cloudflare/Supabase deployment commands, or application deployment. Production main was not intentionally failed, and no failed production deployment occurred in this experiment.

The evidence chain is production configuration (`deploy.needs: [frontend, test-db, test-edge-api]`), successful production ordering (main run #90), and safe verification of the failed-dependency blocking mechanism (PR #68 / experimental run `39279387584`). The experiment is separate from run #90's successful production-main evidence.

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

DEVOPS-03 records a historical preliminary Sprint 1 PR baseline from four comparable successful runs and a separate two-run successful main/deployment sample. The verified current ruleset requires Frontend Checks, Database Tests, and Edge/API Tests before PR merge. Following PRs #41 and #43, production deployment waits for all three jobs to succeed in the main run, with the successful path experimentally verified by run #90. The failed-dependency blocking mechanism is verified separately by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`; a separate preliminary duration sample for the current three-job workflow now exists (PR mean 39.5s across two runs; one main/deployment run at approximately 65s), with more comparable observations still needed.

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

**Conclusion: Improved — modest measured reduction in the sampled Playwright E2E job duration.** The sampled mean is approximately 5.2s lower (86.8s minus approximately 92s). This does not establish that the entire pipeline or merge-to-live is 5.2s faster. Three approximate baseline observations, visible runner/network variance and an unmatched installation-step baseline limit attribution and generalization.

Attempt 1 is canonically **90s**, confirmed by independently verified GitHub job timestamps: `2026-10-29T12:00:36Z` to `2026-10-29T12:02:06Z`. Its Chromium installation took exactly **12s**, from `2026-10-29T12:00:46Z` to `2026-10-29T12:00:58Z`. An earlier live-monitoring estimate was superseded by these exact timestamps; it is not a competing measurement. The [consolidated sample](https://github.com/2ton-exe/moris-mix-ai/issues/62#issuecomment-6496396449) remains unchanged.

As checked on 2026-10-29, PR #125 is open/unmerged, human review and merged-main verification remain pending, and #62 remains open. CodeRabbit's no-actionable-comments/minimal-risk review and zero open threads are review evidence, not CI or merge proof. CI #266 and modular #114 passed; staging evidence is separate from production. Path/test filtering belongs to [#124](https://github.com/2ton-exe/moris-mix-ai/issues/124), not this experiment.

## 12. Outstanding Sprint 2 Metrics and Evidence

- Define the Sprint 2 observation period, authoritative workflow population and rerun handling before calculating pipeline success rate. Do not substitute E2E 5/5 for pipeline reliability.
- Enumerate production deployment frequency and failed production deployment count for that same defined period. Two pre-refactor successes are not a complete sprint count.
- Measure current expanded-workload PR workflow and main workflow durations separately from E2E job/step timings and modular duplicates.
- Capture merge timestamp and confirmed production availability with revision linkage before computing average merge-to-live.
- Establish a production change-failure-rate denominator and attributable failures; no rate is currently established.
- Record time to recover only from a qualifying production deployment/runtime failure with defined detection/restoration endpoints. None is measured in this reviewed evidence. Secretary tooling recovery and application retries do not supply production recovery time.
- Obtain PR #125 human review/merge and successful main execution evidence for the merged installation behavior before closing #62. Production verification remains separately scoped; a PR deployment skip is not a deployment success.
- Retain future production smoke, rollback and recovery evidence under the [runbook](deployment-runbook.md), and real incidents under the [incident log](incident-log.md).
- Complete the named course evidence inventory, including confirmation of the `PIPELINE.md` deliverable. Update these records before each consultation.
