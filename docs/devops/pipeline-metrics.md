# DevOps Pipeline Metrics

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco  
**Sprint:** 1\
**Status:** Initial bootstrap measurements preserved; real frontend CI, gated main deployment, production frontend, and UI/API/PostgreSQL integration verified; representative Sprint 1 baseline still in progress

## 1. Pipeline Overview

- **Continuous Integration:** GitHub Actions
- **Frontend:** React, Vite, and TypeScript
- **Package Manager:** pnpm
- **Deployment Platform:** Cloudflare Workers with Static Assets
- **Cloudflare Worker:** `moris-mix-ai`
- **Production Branch:** `main`

In the reviewed delivery path, an approved merge into `main` produces the push event that triggers GitHub Actions validation and gated Wrangler deployment. Permitted `workflow_dispatch` runs on `main` may also deploy after validation.

The unified `.github/workflows/ci.yml` contains `Frontend Checks` (`frontend`) and `Deploy to Cloudflare` (`deploy`). The deploy job has `needs: frontend` and requires `needs.frontend.outputs.exists == 'true'`. PR runs execute validation and skip deployment; main pushes and permitted manual main runs deploy only after successful validation. The temporary frontend-existence mechanism remains in place.

PR #31, `fix(devops): gate production deploy on CI`, was reviewed, approved, and squash-merged as `8f8e0d8456acf3589184c082bfc9f94375c23e67`. It removed the old standalone deployment workflow. Run #48 verified the main-branch gate in execution. This is a correctness/reliability improvement, not a measured performance optimization.

## 2. Sprint 1 Measurement Summary

### Historical Bootstrap Measurements

These measurements were collected before the real frontend existed on `main`.

| Metric | Result |
| :--- | :--- |
| PR #1 CI duration | 5 seconds |
| Deployment PR CI duration | 7 seconds |
| Bootstrap PR CI average | 6 seconds |
| Bootstrap PR CI success rate | 100% (2/2 observed runs) |

These runs are retained as historical evidence of the initial CI setup, but they are **not representative application-pipeline measurements** because frontend installation, linting, and build stages were skipped.

### Real Frontend Measurements Collected

| Metric | Current Result |
| :--- | :--- |
| FE-01 PR CI duration | 20 seconds |
| FE-01 PR CI result | Passed |
| PR #28 / run #36 CI duration | 18 seconds |
| PR #28 / run #36 CI result | Passed |
| FE-01 main-branch CI duration | 16 seconds |
| FE-01 main-branch CI result | Passed |
| FE-01 production deployment workflow duration | 28 seconds |
| FE-01 production deployment result | Passed |
| Main CI run #48 unified workflow duration / result | Approx. 43 seconds / Passed |
| Run #48 Frontend Checks duration / result | Approx. 12 seconds / Passed |
| Run #48 Deploy to Cloudflare job duration / result | Approx. 25 seconds / Passed |
| Successful automated frontend deployments verified | 2 |
| Failed production deployments observed | 0 |
| Precise merge-to-live time | Not yet measured |
| Recovery time | Not applicable; no production recovery event recorded |

**Baseline status:** Two real frontend PR CI runs, two main-pipeline observations, and two production deployments are recorded. Run #48 uses the unified gated workflow; its overall duration and job durations are distinct from the historical separate-workflow measurements. These observations do not yet establish a representative Sprint 1 baseline or a measured optimization.

## 3. Pipeline Run Log

| Run | Trigger | Duration | Result | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| PR #1 | Pull request | 5s | Passed | Initial CI workflow; frontend validation skipped because the frontend did not yet exist |
| Deployment PR | Pull request | 7s | Passed | Bootstrap CI; frontend validation skipped |
| FE-01 PR #21 CI | Pull request | 20s | Passed | Real frontend present; dependency installation, linting, TypeScript validation through `pnpm build`, and Vite production build executed |
| FE-01 main CI | Push to `main` | 16s | Passed | Real frontend validation executed after PR #21 was merged |
| FE-01 Deploy Production #3 | Push to `main` | 28s | Passed | Dependencies installed, frontend built, and assets deployed to Cloudflare Workers through Wrangler |
| PR #28 / run #36 | Pull request | 18s | Passed | Frozen pnpm install, lint, and production build succeeded |
| Main CI run #48 (ID `38928750840`) | Push to `main` | Approx. 43s | Passed | Commit `8f8e0d8456acf3589184c082bfc9f94375c23e67`; Frontend Checks succeeded before Deploy to Cloudflare started |

PR #28 / run #36 provides additional frontend CI validation evidence. FE-01 Deploy Production #3 and run #48 provide deployment execution evidence, with manual production checks recorded below.

### Verified FE-01 Execution

FE-01 PR #21 introduced the real React/Vite/TypeScript frontend and was merged into `main`.

The observed pull-request CI run successfully executed:

- frontend project detection
- pnpm setup
- Node.js setup
- dependency installation
- linting
- production build
- TypeScript validation as part of the build command

After the merge to `main`, the main-branch CI workflow also completed successfully.

The same merge triggered `Deploy Production #3`, which successfully executed:

- repository checkout
- frontend availability check
- pnpm setup
- Node.js setup
- frontend dependency installation
- frontend production build
- Wrangler deployment to Cloudflare Workers

The deployment workflow completed successfully in 28 seconds.

### Verified Gated Main Execution: Run #48

Main CI run #48 (GitHub Actions ID `38928750840`) succeeded at merge commit `8f8e0d8456acf3589184c082bfc9f94375c23e67`.

| Scope | Approx. duration | Result |
| :--- | :--- | :--- |
| Overall workflow | 43s | Success |
| Frontend Checks | 12s | Success |
| Deploy to Cloudflare | 25s | Success |

Deployment started after Frontend Checks completed, verifying CI-to-production gating on main. The deployment job successfully executed checkout, pnpm setup, Node setup, dependency installation, frontend build, and Cloudflare Wrangler deployment.

The production URL was manually opened after run #48 and the React frontend loaded successfully. That check verified frontend delivery only; the live API/PostgreSQL path was smoke-tested separately on 2026-10-17. Recovery remains unverified.

## 4. Production Verification

**Cloudflare Worker:** `moris-mix-ai`  
**Hosting:** Cloudflare Workers with Static Assets\
**Deployment Method:** GitHub Actions + Wrangler

### Historical FE-01 Verification

The FE-01 merge produced the first verified automated deployment of the real React/Vite frontend.

Verification performed after the deployment confirmed:

- the production URL served the React application rather than the original Hello World Worker
- the production root route was manually verified to load successfully
- the `/app` client-side route was manually verified to load successfully
- the deployment workflow's Wrangler step completed successfully

### Verification After Run #48

After the gated deployment, `https://moris-mix-ai.diofelgwenharesco.workers.dev` was manually opened and the React frontend loaded successfully. The `/app` route checks above remain historical FE-01 evidence.

### QA-01 Smoke Check — 2026-10-17

The production browser loaded the demo recipe through the Supabase Edge Function, and a direct request returned `200 OK` with the seeded PostgreSQL row. The response, CI/PR evidence, Gemini result, and migration-ledger limitation are recorded in the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).

### Still Unverified

The following are **not** yet claimed as verified:

- Gemini Interactions API generation (the configured model returned `404 NOT_FOUND`; a supported model returned `403 PERMISSION_DENIED` because the project was denied access)
- direct inspection of the production migration-history ledger
- exact merge-to-live time measured from merge event to confirmed production availability
- production rollback behavior
- recovery time after a failed production deployment
- Sprint 1 project-board state (the linked repository Projects view contains no projects)

The production frontend deployment and browser → API → PostgreSQL demo read path are verified. Gemini generation, migration-ledger inspection, project-board state, and recovery remain open.

## 5. Branch Protection and Quality Gates

The `main` branch uses repository rules requiring:

- pull requests before merge
- at least one approving teammate review
- the `Frontend Checks` status check
- resolved review conversations
- restricted force pushes
- restricted branch deletion

The protection rules have been observed blocking merge while approval requirements were unsatisfied.

Under the previous standalone deployment workflow, a manual run from a feature branch was tested and the production job was skipped. After PR #31 consolidation, the unified workflow has a configured main-only condition, but its feature-branch manual-dispatch guard has not been separately re-tested.

## 6. Current Pipeline Limitations

The following limitations remain relevant to Sprint 1:

- The unified CI workflow retains the temporary frontend-existence check and exposes its result as a job output used by deployment.
- Now that `frontend/` is required on `main`, missing frontend files should eventually fail instead of silently skipping application validation or deployment.
- Docs-only pushes to `main` can currently proceed through the gated deployment job. Trigger scope is a possible efficiency improvement to evaluate later, not a correctness failure or a proven optimization opportunity.
- TypeScript validation runs inside `pnpm build` rather than appearing as a separately named CI step.
- Two real-frontend PR CI runs and two main-pipeline/deployment observations are recorded; additional comparable observations are still needed.
- Precise merge-to-live time has not yet been measured.
- The UI/API/PostgreSQL demo read path passed on 2026-10-17; Gemini generation returned `403 PERMISSION_DENIED`, and production migration-ledger access remains unavailable.
- Production rollback and recovery have not yet been tested.
- The configured Wrangler version should be reviewed separately because the deployment run reported it as outdated.

## 7. Baseline and Optimization Status

The original 5-second and 7-second CI runs remain useful as bootstrap-history measurements, but they should not be compared directly with real frontend runs as evidence of performance regression or improvement because the workloads are different.

The representative application baseline should be based on comparable runs in which the real frontend validation stages execute.

Current representative observations:

- PR CI samples with real frontend: **2** (FE-01 PR #21 and PR #28 / run #36)
- Main-pipeline observations with real frontend: **2** (historical FE-01 CI and unified run #48; workflow scopes differ)
- Verified real frontend production deployments: **2**

More comparable runs are required before calculating a stable average or claiming a measured optimization.

No pipeline optimization is claimed yet.

## 8. Measurements Still Needed

Before finalizing the Sprint 1 baseline, collect additional comparable runs and record:

- at least three representative PR CI durations
- at least three representative main/deployment observations where possible
- pipeline success rate using comparable real-application runs
- production deployment count
- failed deployment count
- precise merge-to-live time
- any deployment or CI incident that reaches `main`
- recovery time if a production recovery event occurs

If the Sprint 1 schedule does not provide enough naturally occurring comparable runs, record the limitation rather than manufacturing artificial results solely to improve the sample count.

## 9. Next DevOps Improvements

Planned follow-up work should be prioritized by delivery risk and measurable value:

1. Evaluate trigger scope for docs-only main pushes as a possible efficiency improvement; no benefit has been measured.
2. Remove or replace the temporary frontend-existence skip now that the frontend is part of the required repository structure.
3. Continue collecting representative pipeline measurements.
4. Integrate deterministic unit/API/security tests as those test suites become available from the development team.
5. Verify the deployed frontend → Edge Function → PostgreSQL path.
6. Test and document production rollback/recovery.
7. Establish a comparable baseline before implementing and claiming performance optimizations.
8. Evaluate the Wrangler upgrade separately and measure any relevant effect if changed.

## 10. Sprint 1 Metrics Assessment

Sprint 1 has moved beyond bootstrap-only pipeline evidence.

The project now has verified evidence that:

- a real frontend pull request can pass CI
- the merged frontend can pass main-branch CI
- a qualifying merge can trigger an automated production deployment
- run #48 deployed only after successful main-branch Frontend Checks
- Wrangler can deploy the built React frontend to Cloudflare Workers
- the deployed frontend can be reached through the production URL

However, the metrics baseline is **not finalized**. The deployed browser → Edge Function → PostgreSQL path passed its QA-01 smoke check on 2026-10-17; representative pipeline averages still require additional comparable observations.

Rollback and recovery remain documented procedures rather than tested capabilities.
