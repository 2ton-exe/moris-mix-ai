# Deployment Runbook and CI/CD Pipeline

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco — DevOps Engineer  
**Sprint:** 1  
**Status:** Frontend CI, gated automated production deployment, production UI/API/PostgreSQL smoke check, and production migration-ledger entry verified; Gemini generation remains pending

## 1. Purpose

This document describes the continuous integration and continuous deployment (CI/CD) pipeline, production hosting configuration, deployment verification procedures, and basic recovery steps for Mori's Scraps.

It serves as a reference for team members maintaining the application and as supporting evidence for Sprint 1 DevOps activities.

## 2. Technology Stack

| Component              | Technology                            |
| :--------------------- | :------------------------------------ |
| Source control         | Git and GitHub                        |
| Repository             | `2ton-exe/moris-mix-ai`               |
| Continuous integration | GitHub Actions                        |
| Frontend               | React, Vite, TypeScript               |
| Package manager        | pnpm                                  |
| Backend                | Supabase Edge Functions               |
| Database               | Supabase PostgreSQL                   |
| Frontend hosting       | Cloudflare Workers with Static Assets |
| Deployment CLI         | Wrangler                              |

The unified frontend CI/deployment workflow does not deploy Supabase Edge Functions or the database. Supabase production deployment automation remains DEVOPS-07 work and is not implemented by the current Cloudflare workflow.

## 3. CI/CD Pipeline Architecture

### Pull Request Validation

Developer feature branch  
↓  
Pull request targeting `main`  
↓  
GitHub Actions — `ci.yml`\
↓  
Three parallel jobs: `Frontend Checks`, `Database Tests`, and `Edge/API Tests`\
↓  
Required checks: `Frontend Checks`, `Database Tests`, and `Edge/API Tests`; deployment skipped on PR runs\
↓  
At least one teammate approval and resolved review conversations\
↓  
Merge into `main`

### Production Deployment

Approved merge into `main` produces a push event; permitted `workflow_dispatch` on `main` is an alternative\
↓  
GitHub Actions — `ci.yml`\
↓  
`Frontend Checks`, `Database Tests`, and `Edge/API Tests` run in parallel\
↓  
All three jobs succeed and `needs.frontend.outputs.exists == 'true'`\
↓  
`Deploy to Cloudflare` (`deploy`, `needs: [frontend, test-db, test-edge-api]`): checkout, pnpm/Node setup, dependency installation and frontend build\
↓  
Wrangler uploads static assets to Cloudflare Workers  
↓  
Manual production verification

The temporary frontend-existence mechanism remains: `frontend` exposes the detection result as a job output. If `frontend/package.json` is absent, frontend validation steps and deployment are skipped. Since FE-01 is merged into `main`, this behavior should eventually become a hard failure if the required frontend project disappears.

A green workflow alone is not considered sufficient deployment evidence. The relevant build and deployment steps must actually execute.

## 4. Repository Structure

The relevant DevOps files are organized as follows:

- `.github/workflows/ci.yml` — Frontend, database, and Edge/API validation plus gated Cloudflare production deployment
- `wrangler.jsonc` — Cloudflare Worker configuration
- `docs/devops/pipeline-metrics.md` — Pipeline measurements and results
- `docs/devops/deployment-runbook.md` — Deployment and recovery documentation

The frontend application is stored under `frontend/`.

The frontend production build output is generated at `frontend/dist/`.

## 5. Continuous Integration

The unified CI workflow runs through GitHub Actions when a pull request targets `main`, on any push to `main`, or through manual dispatch. PR runs execute all three validation jobs and skip `Deploy to Cloudflare`. Main pushes and permitted manual main runs deploy only after all three jobs succeed and the frontend-existence output is true.

Its frontend validation stages are:

1. Check out repository source code.
2. Detect whether `frontend/package.json` exists.
3. Set up pnpm and Node.js.
4. Install dependencies using `pnpm install --frozen-lockfile`.
5. Run `pnpm lint`.
6. Run `pnpm test`.
7. Run `pnpm build`.

In parallel, `Database Tests` validates migrations, migration lifecycle behavior, and RLS against a PostgreSQL service container. `Edge/API Tests` type-checks the demo Edge Function and tests, then runs deterministic tests. These jobs validate backend code without deploying Supabase Edge Functions or the database.

**Required PR status checks:** `Frontend Checks`, `Database Tests`, and `Edge/API Tests`, as confirmed by the verified current GitHub ruleset evidence.

The frontend build command currently performs TypeScript validation before the Vite production build:

```text
tsc -p tsconfig.app.json --noEmit && vite build
```

Therefore, TypeScript checking is currently executed as part of the build step rather than as a separately named CI step.

### Verified CI Execution

After FE-01 was merged into `main`, the CI workflow executed against the real frontend project and successfully completed:

- frontend project detection
- pnpm setup
- Node.js setup
- dependency installation
- linting
- TypeScript validation through the build command
- Vite production build

This establishes that the frontend CI path is now executing meaningful application validation rather than only the earlier bootstrap/skip path.

## 6. Branch Protection and Pull Requests

The default branch, `main`, is protected through a GitHub repository ruleset.

The verified current GitHub ruleset requirements include:

- Changes must be submitted through pull requests.
- One approving teammate review is required.
- The `Frontend Checks`, `Database Tests`, and `Edge/API Tests` status checks must pass.
- Review conversations must be resolved.
- Force pushes are blocked.
- Branch deletion is restricted.

The ruleset was previously observed blocking a pull request that passed CI but had not yet received the required approval. All three required validation jobs are also dependencies of production deployment in the subsequent main run.

Development should take place on feature branches. Approved changes are merged into `main` through GitHub's pull request interface.

Under the previous standalone deployment workflow, a manual run from a feature branch was tested and the production job was skipped. After PR #31 consolidation, the unified workflow has a configured main-only condition, but its feature-branch manual-dispatch guard has not been separately re-tested.

## 7. Production Hosting Configuration

**Cloudflare Worker:** `moris-mix-ai`

**Production URL:** [Mori's Scraps — Production](https://moris-mix-ai.diofelgwenharesco.workers.dev)

Cloudflare Workers hosts the frontend through Static Assets. Wrangler reads the repository's `wrangler.jsonc` configuration and publishes the generated files from `frontend/dist/`.

The configuration supports single-page application routing.

### Current Production State

The React/Vite frontend is deployed through GitHub Actions to Cloudflare Workers and is accessible at the production URL.

The production root route was verified to serve the Mori's Scraps React application.

The `/app` client-side route was also verified to load successfully during the historical FE-01 verification. After run #48, the production URL was manually opened again and the React frontend loaded successfully. On 2026-10-17, the production UI loaded the demo recipe through the Supabase Edge Function, and a direct endpoint request returned the seeded PostgreSQL row with `200 OK`. Full response and qualification notes are in the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).

The smoke check verifies the runtime schema and demo-row state required by the `is_public` migration. A read-only query of the production migration ledger confirmed version `20261017000001` is applied; the query and result are in the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17). Gemini generation returned `403 PERMISSION_DENIED` and remains unverified.

## 8. Deployment Credentials

GitHub Actions uses the following repository secrets:

| Secret                  | Purpose                                  |
| :---------------------- | :--------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Authorizes Cloudflare Worker deployment  |
| `CLOUDFLARE_ACCOUNT_ID` | Identifies the target Cloudflare account |

Secrets are managed in:

GitHub Repository → Settings → Secrets and variables → Actions

Secret values must never be committed to Git, included in pull request descriptions, printed in CI logs, or shared in screenshots.

The Cloudflare API token is restricted to the intended Cloudflare account.

## 9. Automated Deployment Procedure

Production deployment is a `deploy` job inside `.github/workflows/ci.yml`. In the reviewed delivery path, an approved merge into `main` produces the push event that starts CI; deployment follows successful `Frontend Checks`, `Database Tests`, and `Edge/API Tests` in that same run. Permitted `workflow_dispatch` runs on `main` may also deploy after all three succeed. PR runs skip deployment.

The job declares `needs: [frontend, test-db, test-edge-api]` and uses this condition:

```text
needs.frontend.outputs.exists == 'true' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
```

The `deploy.needs` configuration and normal GitHub Actions dependency semantics prevent deployment when a dependency fails, is cancelled, or is skipped. A failed required validation preventing production deployment from running remains experimentally unverified; run #90 verifies the successful path only.

The workflow currently has no push path filter: docs-only main pushes can also proceed through deployment. Evaluating trigger scope is possible future efficiency work, not a correctness failure or a proven optimization opportunity.

### Deployment Steps

1. Changes are reviewed and merged into `main`; the resulting push event triggers the unified CI workflow. Alternatively, use a permitted `workflow_dispatch` run on `main`.
2. The three validation jobs run in parallel: frontend detection, install, lint, tests and build; database migrations/lifecycle/RLS tests; and Edge/API type-checking and deterministic tests.
3. Confirm all three jobs succeeded and the frontend-existence job output is true; only then can `Deploy to Cloudflare` start.
4. The deployment job checks out source and configures pnpm and Node.js.
5. Frontend dependencies are installed and the React/Vite production build is generated.
6. Wrangler uploads the generated static assets to Cloudflare Workers.
7. Confirm the deployment steps actually executed, then check the application at the production URL.

### Historical FE-01 Deployment

On October 16, 2026, FE-01 PR #21 was merged into `main` after the required CI check and teammate approval were satisfied.

Under the previous workflow arrangement, the merge automatically triggered:

- the `CI` workflow on `main`
- the `Deploy Production` workflow

The production deployment successfully executed:

- repository checkout
- frontend project detection
- pnpm setup
- Node.js setup
- frontend dependency installation
- frontend production build
- Wrangler deployment to Cloudflare Workers

Wrangler uploaded the generated frontend assets and reported a successful production deployment.

The deployed Worker version for this verification was:

```text
fa7b547a-2e54-4e93-9be4-13e573f11812
```

The resulting application was then manually verified through the production URL.

### Historical Frontend-Gated Main Deployment: Run #48

PR #31, `fix(devops): gate production deploy on CI`, was reviewed, approved, and squash-merged into `main` as `8f8e0d8456acf3589184c082bfc9f94375c23e67`. It removed the old standalone deployment workflow and moved deployment into `ci.yml` with `needs: frontend` and the frontend-existence output condition.

Main CI run #48 (GitHub Actions ID `38928750840`) executed that commit successfully:

| Scope | Approx. duration | Result |
| :--- | :--- | :--- |
| Overall workflow | 43s | Success |
| Frontend Checks | 12s | Success |
| Deploy to Cloudflare | 25s | Success |

Deployment started only after Frontend Checks completed, verifying CI-to-production gating on main. Checkout, pnpm setup, Node setup, dependency installation, frontend build, and Cloudflare Wrangler deployment all executed successfully.

After run #48, the production URL was manually opened and the React frontend loaded successfully. This verifies the gated frontend delivery path, not frontend-to-API-to-PostgreSQL integration or rollback/recovery. The gate is a correctness/reliability improvement; no performance optimization is claimed.

### Verified Three-Job Main Deployment: Run #90 (DEVOPS-06)

PR #41 added Edge/API validation. PR #43, merged as `7b577e70750ab3ec930ef265211c0fd541834aad`, then changed deployment dependencies from `frontend` alone to `frontend`, `test-db`, and `test-edge-api`. The earlier database-gate gap documented for runs #73 and #77 is resolved in the merged configuration. Those runs and run #48 remain historical evidence of the earlier frontend-only gate.

Verified GitHub execution evidence confirms main CI run #90 ran on commit `7b577e70750ab3ec930ef265211c0fd541834aad` and completed successfully:

| Job | Verified result / ordering |
| :--- | :--- |
| Edge/API Tests | Completed successfully before deployment |
| Frontend Checks | Completed successfully before deployment |
| Database Tests | Completed successfully at approximately 07:05:40 UTC |
| Deploy to Cloudflare | Started afterward at approximately 07:05:43 UTC and completed successfully |

The successful three-job gating path is verified by main run #90. The failed-required-validation blocking path remains configured but experimentally unverified. Run #90 is separate from the historical two-job baseline in [pipeline metrics](pipeline-metrics.md); DEVOPS-06 does not claim a performance optimization.

## 10. Deployment Verification Checklist

Historical FE-01 checks, run #48, the 2026-10-17 smoke check, and main run #90 establish the following:

- [x] GitHub Actions deployment completes successfully.
- [x] Historical frontend-only deployment gate verified: main deployment waited for successful Frontend Checks (run #48).
- [x] Successful runtime execution of the three-job deployment gate is verified by main run #90.
- [ ] Experimentally verify that a failed required validation prevents production deployment from running; this path is configured but unverified.
- [x] Frontend installation step executes.
- [x] Frontend build step executes.
- [x] TypeScript validation executes through the frontend build command.
- [x] Wrangler deployment step executes.
- [x] Production URL serves the React application instead of the original Hello World Worker.
- [x] Main application routes load correctly.
- [x] Frontend can communicate with the designated Supabase Edge Function (production smoke check, 2026-10-17).
- [x] The deployed integration retrieves the expected demonstration data from PostgreSQL (production smoke check, 2026-10-17).
- [ ] Representative deployment duration and merge-to-live measurements are recorded in the Sprint 1 metrics baseline.

Checks must only be marked complete after actual execution and verification.

## 11. Troubleshooting

### CI Fails During Dependency Installation

- Confirm `frontend/package.json` exists.
- Confirm the pnpm lockfile is committed.
- Check that the configured pnpm version matches the frontend project.
- Inspect the failed installation step in GitHub Actions.

### CI Fails During Linting or Build

- Open the failed job logs.
- Identify the relevant lint, TypeScript, or Vite errors.
- Determine which application component caused the failure.
- Ask the responsible developer to correct application-level errors.
- Update the affected pull request.
- Confirm the required CI check passes before merge.

The DevOps role owns execution and enforcement of the quality gate. The relevant application developer remains responsible for fixing failures in their application code.

### Deployment Fails During Wrangler Execution

- Inspect the deployment job logs.
- Verify that the frontend build generated `frontend/dist/`.
- Confirm the Worker name and asset directory match `wrangler.jsonc`.
- Check that the Cloudflare API token and account ID are correctly configured.
- Verify that the token still has the required deployment permissions.
- Confirm the deployment originated from `main`.

### GitHub Actions Is Green but the Website Has Not Changed

- Confirm the actual deployment step executed rather than being skipped.
- Confirm `frontend/package.json` exists on `main`.
- Confirm the unified CI workflow ran for the expected commit, all three validation jobs succeeded, and the frontend-existence output is true.
- Inspect the Wrangler deployment output.
- Inspect the latest Cloudflare Worker deployment.
- Check the production URL independently.
- Compare the production application with the expected merged change.

A green workflow alone is not sufficient evidence of successful deployment.

## 12. Recovery and Rollback

If a production deployment fails or introduces a defect:

1. Identify the affected commit and deployment.
2. Inspect GitHub Actions and Cloudflare logs.
3. Determine whether the issue involves application code, build configuration, credentials, or hosting.
4. If necessary, prepare a corrective or revert pull request targeting `main`.
5. Obtain the required approval and CI validation.
6. Merge the corrective change to trigger the unified CI workflow and gated deployment after successful validation.
7. Verify the restored application at the production URL.
8. Record the incident, recovery action, and recovery duration.

Cloudflare deployment history may provide an alternative rollback mechanism, but its availability and behavior must be verified before relying on it as the project's recovery method.

**Recovery status:** Documented procedure only. No production rollback or recovery drill has been successfully tested yet.

A rollback procedure must not be described as verified until an actual rollback or recovery exercise has been completed.

## 13. Pipeline Metrics

Pipeline performance is recorded in `docs/devops/pipeline-metrics.md`.

Tracked measurements include:

- Pull request CI execution duration
- Main-branch CI execution duration
- CI success and failure rate
- Production deployment duration
- Merge-to-live time
- Production deployment count
- Failed deployments
- Recovery time
- Pipeline improvements

Measurements must be based on observed workflow runs rather than estimates.

The earlier bootstrap measurements collected before the real frontend existed must remain distinguished from representative application pipeline measurements.

Historical FE-01 runs and unified main CI run #48 provide real frontend validation and deployment execution data. The separate-workflow and unified-workflow durations have different scopes and should not be directly compared as performance evidence. The metrics log now records a preliminary historical baseline of four PR runs and two main/deployment runs for the earlier two-job workload. A separate preliminary current three-job sample is now recorded; more comparable observations are needed; precise merge-to-live, rollback, and failed-deployment recovery measurements remain outstanding.

No optimization should be claimed until a baseline exists and a before-versus-after comparison demonstrates a measurable improvement.

## 14. Known Limitations and Pending Work

The following limitations or pending items remain:

- The unified CI workflow retains the temporary frontend-existence check and exposes the result as a job output required by deployment.
- Since the frontend is now required on `main`, the temporary skip behavior should be removed or converted into a failing validation when appropriate.
- TypeScript checking currently occurs inside `pnpm build` instead of being exposed as a separately named CI step.
- Frontend CI has been verified against the real FE-01 application.
- Automated Cloudflare frontend deployment has been verified.
- Production routing has been manually verified.
- The production Supabase Edge Function and PostgreSQL demo-row read passed the 2026-10-17 smoke check; see the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).
- Gemini `generateContent` returned `403 PERMISSION_DENIED`; backend AI generation is not verified.
- The production migration ledger records `20261017000001_add_is_public_to_recipes.sql` as applied; see the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).
- The linked repository Projects page has no project board, so board status could not be verified.
- Supabase Edge Functions and database deployment are not handled by the current Cloudflare workflow; Supabase production deployment automation remains DEVOPS-07 work.
- Production rollback and recovery procedures have not yet been tested.
- The historical preliminary Sprint 1 metrics baseline has a small sample. A separate preliminary current three-job sample now exists, including successful-gate evidence from run #90; more comparable observations and failed-required-validation blocking evidence remain outstanding.
- The deployment log reported that the configured Wrangler version is out of date; upgrading it should be evaluated separately rather than mixed into Sprint 1 verification unless necessary.
- Docs-only main pushes can currently proceed through the gated deployment job. Evaluate trigger scope later as a possible efficiency improvement; this is not a correctness failure or a proven optimization opportunity.

## 15. Sprint 1 Completion Criteria

The Sprint 1 DevOps delivery setup currently has the following evidence:

- [x] Initial CI workflow is merged.
- [x] Branch protection ruleset is active.
- [x] Frontend Checks, Database Tests, and Edge/API Tests are required by the verified current GitHub ruleset.
- [x] Teammate approval is required before merge.
- [x] Unified validation/deployment workflow and Cloudflare configuration are merged.
- [x] Historical frontend-only deployment gate was verified by main run #48.
- [x] Merged PR #43 configures production deployment to depend on all three validation jobs.
- [x] Main run #90 verifies successful deployment after all three validation jobs succeed.
- [ ] Experimentally verify failed-required-validation blocking; configuration alone establishes this behavior so far.
- [x] Current unified workflow has a configured main-only production condition.
- [x] Previous standalone workflow skipped production in a feature-branch manual-dispatch test (historical evidence).
- [ ] Current unified workflow feature-branch manual-dispatch guard is separately re-tested.
- [x] Cloudflare deployment credentials are configured securely.
- [x] Initial pipeline metrics documentation exists.
- [x] Frontend dependency installation executes successfully in CI.
- [x] Frontend lint executes successfully in CI.
- [x] TypeScript validation executes successfully through the build command.
- [x] Frontend production build executes successfully.
- [x] Frontend automatically deploys through GitHub Actions after a qualifying merge to `main`.
- [x] Wrangler successfully uploads the production frontend assets.
- [x] Production URL serves the React application.
- [x] Client-side application routing works in production.
- [x] Deployed frontend-to-backend-to-database integration is verified by the 2026-10-17 smoke check.
- [x] Preliminary historical Sprint 1 baseline is recorded for four PR runs and two main/deployment runs.
- [x] Preliminary measurements for the current three-job workflow are recorded separately; more comparable observations are needed.

The frontend delivery path from an approved merge into `main` to a running production frontend has now been verified. The demo UI/API/PostgreSQL read path also passed on 2026-10-17.

Sprint 1 delivery tracking remains open for Gemini generation verification and further comparable pipeline measurements. The all-checks deployment gate is merged and its successful main path is verified by run #90; the failed-required-validation blocking path remains configured but experimentally unverified.
