# DevOps Pipeline Metrics

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco  
**Sprint:** 1\
**Status:** Preliminary Sprint 1 PR baseline recorded; main/deployment sample remains small; production walking skeleton and application/API request recovery verified

## 1. Current Delivery System

- **Continuous Integration:** GitHub Actions
- **Frontend:** React, Vite, and TypeScript
- **Package Manager:** pnpm
- **Deployment Platform:** Cloudflare Workers with Static Assets
- **Cloudflare Worker:** `moris-mix-ai`
- **Production Branch:** `main`

The unified [CI workflow](../../.github/workflows/ci.yml) runs three required validation jobs. Frontend and database checks start in parallel; Edge/API checks follow the database job:

| Job | Workload |
| :--- | :--- |
| Frontend Checks (`frontend`) | Install dependencies, lint, frontend tests, and build |
| Database Tests (`test-db`) | PostgreSQL 16 service, dependency installation, database migrations, migration lifecycle tests, and RLS tests |
| Edge/API Tests (`test-edge-api`) | Type-checking and deterministic demo-recipe tests |

PR runs execute all three validation jobs and skip both production jobs. Verified current GitHub ruleset evidence requires **Frontend Checks**, **Database Tests**, and **Edge/API Tests**, one approving teammate review, and resolved review conversations before merge.

**Migrate Production Database** runs on `main` pushes or `workflow_dispatch` runs from `main` after all three validation jobs succeed and an eligible reviewer approves the `production-db` environment. It runs the guarded migration runner with environment-scoped production credentials. **Deploy to Cloudflare** then validates public Supabase build configuration, installs frontend dependencies, builds the frontend, and deploys through Wrangler. The temporary frontend-existence mechanism remains, with deployment requiring `needs.frontend.outputs.exists == 'true'`.

The migration job declares **`needs: [frontend, test-db, test-edge-api]`**, and deployment additionally needs `migrate-production`. Normal GitHub Actions dependency semantics block migration or deployment if a dependency fails, is cancelled, or is skipped. The new environment approval and migration path is configured but has not yet been verified in a main-branch run. PR #43, merged as `7b577e70750ab3ec930ef265211c0fd541834aad`, closed the earlier frontend-only deployment-gate gap. Main run #90 verifies the prior successful three-check deployment path; section 5 records that evidence separately from the historical observations.

Supabase database migrations now run through the approval-gated job. Supabase Edge Function deployment remains a separate process.

## 2. Preliminary Sprint 1 Comparable Baseline

The historical samples below reflect the earlier two-job validation workload, before Edge/API validation (PR #41) and the all-checks deployment gate (PR #43). They remain a historical preliminary baseline, not measurements of the current workflow with its approval-gated production migration. PR workflow durations and main/deployment workflow durations are tracked separately because their workloads differ. They are workflow durations, not precise merge-to-live measurements or individual deployment-job durations.

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

### Preliminary Three-Job Validation Sample (Before Production Migration Gate)

These observations are recorded separately from the historical two-job baseline and predate the production migration approval gate. Approximate workflow durations are calculated from the supplied creation and completion timestamps; they are not individual job durations or precise merge-to-live measurements.

| Run | Workflow scope | Created (UTC) | Completed (UTC) | Approx. duration | Result |
| :--- | :--- | :--- | :--- | ---: | :--- |
| #91 | PR, three-job validation | 2026-10-19T10:08:53Z | 2026-10-19T10:09:30Z | 37s | Success |
| #92 | PR, three-job validation | 2026-10-19T10:45:23Z | 2026-10-19T10:46:05Z | 42s | Success |
| #90 | Main/deployment, three-job gate | 2026-10-19T07:04:59Z | 2026-10-19T07:06:04Z | 65s | Success |

- PR sample: **2** runs (#91 and #92); preliminary mean = (37 + 42) / 2 = **39.5s**; observed success rate = **2/2**.
- Main/deployment sample: **1** run (#90), approximately **65s**, successful; this verifies the prior three-check deployment gate described in section 5.

This sample is too small to establish a stable baseline or stable reliability. Workload differences prevent direct comparison with the historical two-job sample as proof of improvement or regression; no optimization is claimed. Main-run observations of the new migration approval and deployment path are still needed. Failed-required-validation blocking remains configured but experimentally unverified. Precise merge-to-live time remains unmeasured; production rollback and failed-deployment recovery remain untested and unmeasured.

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

The current `migrate-production` job depends on `frontend`, `test-db`, and `test-edge-api`, so all three must succeed before migration can start on an eligible main run. It also waits for `production-db` environment approval. The Cloudflare deployment job additionally depends on migration success. This post-merge gate is separate from required PR status checks.

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

The successful three-check gating path is verified by main run #90 for the workflow version at that time. The current production migration approval and deployment dependency have not yet been exercised in a main-branch run. Run #90 is historical successful-path ordering evidence, not an addition to the earlier two-job duration baseline. No performance optimization is claimed for DEVOPS-06.

Historically, a manual feature-branch run of the standalone deployment workflow skipped the production job. The unified workflow has a configured main-only condition; that feature-branch manual-dispatch guard has not been separately re-tested.

## 6. Bottlenecks and Other Limitations

- **Database Tests are the longer PR critical path in some observed runs.** PostgreSQL service-container initialization is a major contributor. This is a future optimization candidate; no optimization or measured benefit is claimed.
- The frontend-existence check still permits validation/deployment to be skipped when the frontend is absent. Replacing it with a failure for missing required frontend files remains a follow-up candidate.
- Docs-only pushes to `main` can proceed through deployment. Trigger scope is a possible future efficiency improvement; no benefit has been measured.
- TypeScript validation runs within `pnpm build` rather than as a separately named step.
- The historical two-job sample (four PR runs and two main/deployment runs) and the separate three-check sample from before the production migration gate (two PR runs and one main/deployment run) provide only preliminary evidence; their workloads differ and their calculations are kept separate.
- Precise merge-to-live time, production rollback, and failed-production-deployment recovery time remain unmeasured or untested.
- A historical deployment reported its configured Wrangler version as outdated; any upgrade should be evaluated separately.

## 7. Baseline and Optimization Status

Sprint 1 establishes the baseline. **No performance optimization is claimed for Sprint 1.** The historical preliminary PR mean is 41.75s (approximately 42s) across four runs; the preliminary main/deployment mean is approximately 51s across two runs. These observations describe the earlier two-job sample, not the current three-check workflow plus approval-gated migration, a guaranteed duration, or a stable long-term reliability level.

The earlier bootstrap and frontend runs remain useful historical evidence, but differences in workload prevent using them to prove an improvement or regression against the current pipeline.

## 8. Measurements Still Needed

A preliminary three-check validation sample from before the production migration gate now exists in section 2. More observations of the current post-merge migration and deployment path are needed; continue collecting naturally occurring runs and record:

- PR workflow durations and results for the current three-job validation workload, collected separately from the historical two-job sample.
- Main/deployment workflow durations and results, keeping workflow and job timings distinct.
- Production deployment and failed-deployment counts for a clearly defined observation period.
- Precise merge-to-live time.
- Any CI or deployment incident reaching `main`.
- Production rollback test results and recovery time from a failed production deployment when tested or observed.

Keep future measurements separate if the workload or deployment dependencies change. Record small-sample limitations instead of manufacturing artificial results solely to increase the sample count. Application/API retry evidence must remain distinct from deployment recovery evidence.

## 9. Next DevOps Improvements

1. Record an approved production migration and deployment run, and evidence that a failed required validation prevents both jobs from running.
2. Investigate Database Tests timing, including PostgreSQL service-container initialization, as a future optimization candidate.
3. Continue collecting comparable pipeline observations and precise merge-to-live measurements.
4. Test and document production deployment rollback and failed-deployment recovery.
5. Evaluate docs-only trigger scope, replacement of the frontend-existence skip, and any Wrangler upgrade separately.

These are follow-up opportunities, not implemented or proven optimizations.

## 10. Sprint 1 Metrics Assessment

DEVOPS-03 records a historical preliminary Sprint 1 PR baseline from four comparable successful runs and a separate two-run successful main/deployment sample. The verified current ruleset requires Frontend Checks, Database Tests, and Edge/API Tests before PR merge. Main run #90 verified the prior three-check deployment gate. The current workflow adds an approval-gated database migration before deployment; this path and failed-required-validation blocking remain experimentally unverified. A separate preliminary three-check duration sample (PR mean 39.5s across two runs; one main/deployment run at approximately 65s) predates the production migration gate.

The production walking skeleton and deployed application/API request retry are verified. Precise merge-to-live timing, production deployment rollback, and recovery time from a failed production deployment remain outstanding. Sprint 1 establishes measured evidence without claiming a performance optimization or a stable long-term baseline.
