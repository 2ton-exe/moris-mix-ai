# DevOps Pipeline Metrics

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco  
**Sprint:** 1\
**Status:** Preliminary Sprint 1 PR baseline recorded; main/deployment sample remains small; production walking skeleton and application/API request recovery verified; approval-gated production migration is configured in CI, with environment setup and execution pending

## 1. Current Delivery System

- **Continuous Integration:** GitHub Actions
- **Frontend:** React, Vite, and TypeScript
- **Package Manager:** pnpm
- **Deployment Platform:** Cloudflare Workers with Static Assets
- **Cloudflare Worker:** `moris-mix-ai`
- **Production Branch:** `main`

The unified [CI workflow](../../.github/workflows/ci.yml) runs three parallel validation jobs:

| Job | Workload |
| :--- | :--- |
| Frontend Checks (`frontend`) | Install dependencies, lint, frontend tests, and build |
| Database Tests (`test-db`) | PostgreSQL 16 service, dependency installation, database migrations, migration lifecycle tests, and RLS tests |
| Edge/API Tests (`test-edge-api`) | Type-checking and deterministic recipe CRUD, demo, and AI tests |

PR runs execute all three validation jobs and skip both production jobs. Verified current GitHub ruleset evidence requires **Frontend Checks**, **Database Tests**, and **Edge/API Tests**, one approving teammate review, and resolved review conversations before merge.

**Migrate Production Database** runs on qualifying `main` pushes or main `workflow_dispatch` runs after all three validation jobs succeed. It waits for approval in the `production-db` environment, checks the target configuration, and runs the guarded migration runner. Production migration runs are serialized.

**Deploy to Cloudflare** runs after `migrate-production` succeeds. It validates public Supabase build configuration, installs frontend dependencies, builds the frontend, and deploys through Wrangler. The temporary frontend-existence mechanism remains, with deployment requiring `needs.frontend.outputs.exists == 'true'`.

The production migration job declares **`needs: [frontend, test-db, test-edge-api]`**; deployment additionally needs **`migrate-production`**. Normal GitHub Actions dependency semantics block migration and deployment when a required job fails, is cancelled, or is skipped. PR #43, merged as `7b577e70750ab3ec930ef265211c0fd541834aad`, closed the earlier frontend-only deployment-gate gap. Main run #90 verifies the earlier three-check deployment path. The new approval and migration path still requires `production-db` setup and a main-branch run before its execution is verified.

Supabase Edge Function deployment remains separate from this workflow.

## 2. Preliminary Sprint 1 Comparable Baseline

The historical samples below reflect the earlier two-job validation workload, before Edge/API validation (PR #41) and the all-checks deployment gate (PR #43). They remain a historical preliminary baseline, not measurements of the workflow with production migration approval. PR workflow durations and main/deployment workflow durations are tracked separately because their workloads differ. They are workflow durations, not precise merge-to-live measurements or individual deployment-job durations.

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

### Preliminary Three-Job Sample Before the Production Migration Gate

These observations cover the three validation jobs before the production migration gate was added and are recorded separately from the historical two-job baseline. Approximate workflow durations are calculated from the supplied creation and completion timestamps; they are not individual job durations or precise merge-to-live measurements.

| Run | Workflow scope | Created (UTC) | Completed (UTC) | Approx. duration | Result |
| :--- | :--- | :--- | :--- | ---: | :--- |
| #91 | PR, three-job validation | 2026-10-19T10:08:53Z | 2026-10-19T10:09:30Z | 37s | Success |
| #92 | PR, three-job validation | 2026-10-19T10:45:23Z | 2026-10-19T10:46:05Z | 42s | Success |
| #90 | Main/deployment, three-check gate before production migrations | 2026-10-19T07:04:59Z | 2026-10-19T07:06:04Z | 65s | Success |

- PR sample: **2** runs (#91 and #92); preliminary mean = (37 + 42) / 2 = **39.5s**; observed success rate = **2/2**.
- Main/deployment sample: **1** run (#90), approximately **65s**, successful; it verifies the earlier three-check path, not the new production migration approval gate.

This sample is too small to establish a stable baseline or stable reliability. Workload differences prevent direct comparison with the historical two-job sample as proof of improvement or regression; no optimization is claimed. More comparable observations of the validation, migration-approval, and deployment path are needed. Failed-dependency blocking is verified by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`. This mechanism evidence is separate from the duration sample. Precise merge-to-live time remains unmeasured; production rollback and failed-deployment recovery remain untested and unmeasured.

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

The `migrate-production` job depends on `frontend`, `test-db`, and `test-edge-api`; it runs only for main pushes or manual dispatches from `main` and waits for approval in `production-db`. The `deploy` job additionally depends on `migrate-production`, so a failed migration blocks Cloudflare deployment. The environment protection rules and credentials must be configured before this new gate can run safely.

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

The earlier successful three-check gating path is verified by main run #90. The new approval-gated migration path is configured in the workflow but has not yet been exercised. Failed-dependency blocking is verified by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`. Run #90 is successful-path ordering evidence, not an addition to the earlier two-job duration baseline. No performance optimization is claimed for DEVOPS-06.

### Controlled Non-Production Failure-Gate Experiment (DEVOPS-06)

Draft PR #68, `[DEVOPS-06] Verify failed validation blocks deployment`, executed controlled experimental run `39279387584` with these results:

| Experimental job | Result |
| :--- | :--- |
| Gate Test - Frontend | Success |
| Gate Test - Edge/API | Success |
| Gate Test - Intentional Database Failure | Failure by design |
| Gate Test - Would Deploy | Skipped |

The inert downstream job declared `needs: [frontend, test-db, test-edge-api]`, matching the production deploy gate's three-dependency structure. This controlled non-production equivalent dependency-gate experiment verifies GitHub Actions failure propagation: when one required dependency fails and `always()` is not used, the downstream deployment-shaped job is skipped. It used no production credentials, repository secrets, Cloudflare/Supabase deployment commands, or application deployment. Production main was not intentionally failed, and no failed production deployment occurred in this experiment.

The evidence chain for the earlier gate is production configuration (`deploy.needs: [frontend, test-db, test-edge-api]`), successful production ordering (main run #90), and safe verification of failed-dependency blocking (PR #68 / experimental run `39279387584`). The new migration and approval stage has not yet been exercised. The experiment is separate from run #90's successful production-main evidence.

Normal CI run #98 on the same PR completed Frontend Checks, Database Tests, and Edge/API Tests successfully; production migration and Cloudflare deployment were skipped because this was a PR. Run #98 is PR validation evidence, not production deployment evidence. Neither the controlled experiment nor the unusually delayed workflow runs associated with PR #68 are added to a performance baseline; no comparable-duration justification or performance optimization is claimed.

Historically, a manual feature-branch run of the standalone deployment workflow skipped the production job. The unified workflow has a configured main-only condition; that feature-branch manual-dispatch guard has not been separately re-tested.

## 6. Bottlenecks and Other Limitations

- **Database Tests are the longer PR critical path in some observed runs.** PostgreSQL service-container initialization is a major contributor. This is a future optimization candidate; no optimization or measured benefit is claimed.
- The frontend-existence check still permits validation/deployment to be skipped when the frontend is absent. Replacing it with a failure for missing required frontend files remains a follow-up candidate.
- Docs-only pushes to `main` can proceed through deployment. Trigger scope is a possible future efficiency improvement; no benefit has been measured.
- TypeScript validation runs within `pnpm build` rather than as a separately named step.
- The historical two-job sample (four PR runs and two main/deployment runs) and the separate pre-migration three-check sample (two PR runs and one main/deployment run) provide only preliminary evidence; their workloads differ and their calculations are kept separate.
- Precise merge-to-live time, production rollback, and failed-production-deployment recovery time remain unmeasured or untested.
- A historical deployment reported its configured Wrangler version as outdated; any upgrade should be evaluated separately.

## 7. Baseline and Optimization Status

Sprint 1 establishes the baseline. **No performance optimization is claimed for Sprint 1.** The historical preliminary PR mean is 41.75s (approximately 42s) across four runs; the preliminary main/deployment mean is approximately 51s across two runs. These observations describe the earlier two-job sample, not the current workflow with production migration approval, a guaranteed duration, or a stable long-term reliability level.

The earlier bootstrap and frontend runs remain useful historical evidence, but differences in workload prevent using them to prove an improvement or regression against the current pipeline.

## 8. Measurements Still Needed

A preliminary three-check sample before the production migration gate exists in section 2. More comparable observations are still needed; continue collecting naturally occurring runs and record:

- PR workflow durations and results for the current three-job validation workload, collected separately from the historical two-job sample.
- Main/deployment workflow durations and results, including migration approval wait and job timings where available.
- Production deployment and failed-deployment counts for a clearly defined observation period.
- Precise merge-to-live time.
- Any CI or deployment incident reaching `main`.
- Production rollback test results and recovery time from a failed production deployment when tested or observed.

Keep future measurements separate if the workload or deployment dependencies change. Record small-sample limitations instead of manufacturing artificial results solely to increase the sample count. Application/API retry evidence must remain distinct from deployment recovery evidence.

## 9. Next DevOps Improvements

1. Configure and verify the `production-db` approval environment and migration path.
2. Investigate Database Tests timing, including PostgreSQL service-container initialization, as a future optimization candidate.
3. Continue collecting comparable pipeline observations and precise merge-to-live measurements.
4. Test and document production deployment rollback and failed-deployment recovery.
5. Evaluate docs-only trigger scope, replacement of the frontend-existence skip, and any Wrangler upgrade separately.

These are follow-up opportunities, not implemented or proven optimizations.

## 10. Sprint 1 Metrics Assessment

DEVOPS-03 records a historical preliminary Sprint 1 PR baseline from four comparable successful runs and a separate two-run successful main/deployment sample. The verified current ruleset requires Frontend Checks, Database Tests, and Edge/API Tests before PR merge. The new `migrate-production` job waits for all three checks and approval in `production-db`; Cloudflare deployment depends on migration success. Environment setup and the main-branch migration path remain unverified. Run #90 verifies the earlier three-check path, while failed-dependency blocking is verified separately by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`. The separate pre-migration duration sample (PR mean 39.5s across two runs; one main/deployment run at approximately 65s) is historical, with more comparable observations still needed.

The production walking skeleton and deployed application/API request retry are verified. Precise merge-to-live timing, production deployment rollback, and recovery time from a failed production deployment remain outstanding. Sprint 1 establishes measured evidence without claiming a performance optimization or a stable long-term baseline.
