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

The unified `.github/workflows/ci.yml` runs two parallel required PR validation jobs:

| Job | Workload |
| :--- | :--- |
| Frontend Checks (`frontend`) | Install dependencies, lint, frontend tests, and build |
| Database Tests (`test-db`) | PostgreSQL 16 service, dependency installation, database migrations, migration lifecycle tests, and RLS tests |

PR runs validate the application and skip deployment. Branch protection requires both **Frontend Checks** and **Database Tests**, at least one teammate approval, and resolved review conversations before merge.

**Deploy to Cloudflare** runs on qualifying `main` pushes or permitted main `workflow_dispatch` runs. It validates public Supabase build configuration, installs frontend dependencies, builds the frontend, and deploys through Wrangler. The temporary frontend-existence mechanism remains, with deployment requiring `needs.frontend.outputs.exists == 'true'`.

The deployment job currently has **`needs: frontend`**, not `needs: [frontend, test-db]`. It waits only for Frontend Checks. Production deployment can begin before the main-run Database Tests finish. This limitation concerns post-merge deployment-job gating; branch protection still requires both jobs before PR merge. Section 5 records the observed evidence.

## 2. Preliminary Sprint 1 Comparable Baseline

These samples reflect the current application pipeline. PR workflow durations and main/deployment workflow durations are tracked separately because their workloads differ. They are workflow durations, not precise merge-to-live measurements or individual deployment-job durations.

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
| Current comparable main/deployment sample | 2 successful runs (#73 and #77) |
| Failed production deployments in this comparable sample | 0 observed |
| Deployment incidents requiring rollback in reviewed evidence | None observed |
| Production deployment rollback | Not tested |
| Failed-deployment recovery time | Not measured; no failed deployment recovery event was observed |
| Application/API request recovery | Verified separately; this is not deployment recovery |

The total Sprint 1 production deployment count has not been fully enumerated.

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

The `main` branch requires pull requests, at least one approving teammate review, both **Frontend Checks** and **Database Tests**, and resolved review conversations. Force pushes and branch deletion are restricted. Protection rules have been observed blocking merge when approval requirements were unsatisfied.

Both validation jobs must pass before a PR merges. On the subsequent main run, however, Deploy to Cloudflare depends only on `frontend`. The observed execution order confirms this limitation:

| Main run | Observed ordering |
| :--- | :--- |
| #73 | Frontend Checks completed before deployment started; deployment started while Database Tests were still running |
| #77 | Frontend Checks completed at about **15:30:54Z**; Cloudflare deployment started at about **15:30:56Z**; Database Tests completed at about **15:31:06Z** |

**Production deployment can begin before the main-run Database Tests finish.** Requiring both jobs as deployment dependencies is a reliability / quality-gate improvement opportunity. No workflow change is made or claimed as part of DEVOPS-03.

Historically, a manual feature-branch run of the standalone deployment workflow skipped the production job. The unified workflow has a configured main-only condition; that feature-branch manual-dispatch guard has not been separately re-tested.

## 6. Bottlenecks and Other Limitations

- **Database Tests are the longer PR critical path in some observed runs.** PostgreSQL service-container initialization is a major contributor. This is a future optimization candidate; no optimization or measured benefit is claimed.
- The frontend-existence check still permits validation/deployment to be skipped when the frontend is absent. Replacing it with a failure for missing required frontend files remains a follow-up candidate.
- Docs-only pushes to `main` can proceed through deployment. Trigger scope is a possible future efficiency improvement; no benefit has been measured.
- TypeScript validation runs within `pnpm build` rather than as a separately named step.
- Four comparable PR observations and two comparable main/deployment observations provide only preliminary evidence. Historical samples have different workloads and are excluded from these calculations.
- Precise merge-to-live time, production rollback, and failed-production-deployment recovery time remain unmeasured or untested.
- A historical deployment reported its configured Wrangler version as outdated; any upgrade should be evaluated separately.

## 7. Baseline and Optimization Status

Sprint 1 establishes the baseline. **No performance optimization is claimed for Sprint 1.** The current preliminary PR mean is 41.75s (approximately 42s) across four runs; the preliminary main/deployment mean is approximately 51s across two runs. These observations describe the measured sample, not a guaranteed duration or stable long-term reliability level.

The earlier bootstrap and frontend runs remain useful historical evidence, but differences in workload prevent using them to prove an improvement or regression against the current pipeline.

## 8. Measurements Still Needed

Continue collecting naturally occurring comparable runs and record:

- PR workflow durations and results for the current two-job validation workload.
- Main/deployment workflow durations and results, keeping workflow and job timings distinct.
- Production deployment and failed-deployment counts for a clearly defined observation period.
- Precise merge-to-live time.
- Any CI or deployment incident reaching `main`.
- Production rollback test results and recovery time from a failed production deployment when tested or observed.

Keep future measurements separate if the workload or deployment dependencies change. Record small-sample limitations instead of manufacturing artificial results solely to increase the sample count. Application/API retry evidence must remain distinct from deployment recovery evidence.

## 9. Next DevOps Improvements

1. Evaluate requiring both Frontend Checks and Database Tests before post-merge deployment starts.
2. Investigate Database Tests timing, including PostgreSQL service-container initialization, as a future optimization candidate.
3. Continue collecting comparable pipeline observations and precise merge-to-live measurements.
4. Test and document production deployment rollback and failed-deployment recovery.
5. Evaluate docs-only trigger scope, replacement of the frontend-existence skip, and any Wrangler upgrade separately.

These are follow-up opportunities, not implemented or proven optimizations.

## 10. Sprint 1 Metrics Assessment

DEVOPS-03 now records a preliminary Sprint 1 PR baseline from four comparable successful runs and a separate two-run successful main/deployment sample. Both frontend and database validation are required before PR merge. Main-run deployment currently waits only for Frontend Checks, leaving a documented post-merge quality-gate improvement opportunity.

The production walking skeleton and deployed application/API request retry are verified. Precise merge-to-live timing, production deployment rollback, and recovery time from a failed production deployment remain outstanding. Sprint 1 establishes measured evidence without claiming a performance optimization or a stable long-term baseline.
