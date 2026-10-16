# Deployment Runbook and CI/CD Pipeline

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco — DevOps Engineer  
**Sprint:** 1  
**Status:** Frontend CI and automated production deployment verified; frontend-to-backend-to-database integration pending verification

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

The frontend deployment workflow is separate from the Supabase backend and database deployment processes.

## 3. CI/CD Pipeline Architecture

### Pull Request Validation

Developer feature branch  
↓  
Pull request targeting `main`  
↓  
GitHub Actions — `ci.yml`  
↓  
Frontend dependency installation, linting, TypeScript validation through the build command, and production build\
↓  
Required CI status check  
↓  
At least one teammate approval  
↓  
Merge into `main`

### Production Deployment

Approved merge into `main`  
↓  
GitHub Actions — `deploy.yml`  
↓  
Verify that the frontend project exists\
↓  
Install dependencies using pnpm  
↓  
Build React/Vite frontend  
↓  
Wrangler uploads static assets to Cloudflare Workers  
↓  
Production verification

The current workflow still contains a conditional frontend-existence check. If `frontend/package.json` is absent, frontend-specific CI and deployment steps can be skipped. Since FE-01 is now merged into `main`, this behavior should be reviewed and eventually replaced with a hard failure if the required frontend project unexpectedly disappears.

A green workflow alone is not considered sufficient deployment evidence. The relevant build and deployment steps must actually execute.

## 4. Repository Structure

The relevant DevOps files are organized as follows:

- `.github/workflows/ci.yml` — Pull request and main-branch CI checks
- `.github/workflows/deploy.yml` — Cloudflare production deployment
- `wrangler.jsonc` — Cloudflare Worker configuration
- `docs/devops/pipeline-metrics.md` — Pipeline measurements and results
- `docs/devops/deployment-runbook.md` — Deployment and recovery documentation

The frontend application is stored under `frontend/`.

The frontend production build output is generated at `frontend/dist/`.

## 5. Continuous Integration

The CI workflow runs through GitHub Actions when a pull request targets `main` or when commits are pushed to `main`.

Its frontend validation stages are:

1. Check out repository source code.
2. Detect whether `frontend/package.json` exists.
3. Set up pnpm and Node.js.
4. Install dependencies using `pnpm install --frozen-lockfile`.
5. Run `pnpm lint`.
6. Run `pnpm build`.

**Required status check:** `Frontend Checks`

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

The configured requirements include:

- Changes must be submitted through pull requests.
- At least one approving review is required.
- The `Frontend Checks` status check must pass.
- Review conversations must be resolved.
- Force pushes are blocked.
- Branch deletion is restricted.

The ruleset was previously observed blocking a pull request that passed CI but had not yet received the required approval.

Development should take place on feature branches. Approved changes are merged into `main` through GitHub's pull request interface.

The production deployment workflow also includes a main-branch guard. A manually triggered run from a feature branch was previously tested and the production deployment job was skipped, confirming that the workflow does not deploy a feature branch to production through that path.

## 7. Production Hosting Configuration

**Cloudflare Worker:** `moris-mix-ai`

**Production URL:** [Mori's Scraps — Production](https://moris-mix-ai.diofelgwenharesco.workers.dev)

Cloudflare Workers hosts the frontend through Static Assets. Wrangler reads the repository's `wrangler.jsonc` configuration and publishes the generated files from `frontend/dist/`.

The configuration supports single-page application routing.

### Current Production State

The React/Vite frontend is deployed through GitHub Actions to Cloudflare Workers and is accessible at the production URL.

The production root route was verified to serve the Mori's Scraps React application.

The `/app` client-side route was also verified to load successfully in production.

Full frontend-to-backend-to-database integration remains pending verification.

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

The deployment workflow runs on pushes to `main` that affect:

- `frontend/**`
- `wrangler.jsonc`
- `.github/workflows/deploy.yml`

The workflow can also be triggered manually through GitHub Actions.

The deployment job includes the restriction:

```text
github.ref == 'refs/heads/main'
```

This prevents manually dispatched workflow runs from feature branches from executing the production deployment job.

### Deployment Steps

1. Changes are reviewed and merged into `main`.
2. GitHub Actions starts the deployment workflow when its trigger conditions match.
3. The workflow verifies that the frontend project exists.
4. pnpm and Node.js are configured.
5. Frontend dependencies are installed.
6. The React/Vite production build is generated.
7. Wrangler uploads the generated static assets to Cloudflare Workers.
8. The deployed application is checked at the production URL.

### Verified Sprint 1 Deployment

On October 16, 2026, FE-01 PR #21 was merged into `main` after the required CI check and teammate approval were satisfied.

The merge automatically triggered:

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

## 10. Deployment Verification Checklist

The first real frontend deployment has now been verified as follows:

- [x] GitHub Actions deployment workflow completes successfully.
- [x] Frontend installation step executes.
- [x] Frontend build step executes.
- [x] TypeScript validation executes through the frontend build command.
- [x] Wrangler deployment step executes.
- [x] Production URL serves the React application instead of the original Hello World Worker.
- [x] Main application routes load correctly.
- [ ] Frontend can communicate with the designated Supabase Edge Function.
- [ ] The deployed integration can retrieve the expected demonstration data.
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
- Confirm the deployment workflow was triggered for the expected commit.
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
6. Merge the corrective change to trigger the deployment workflow.
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

A real frontend CI run and production deployment have now occurred, providing valid execution data. However, the Sprint 1 representative baseline is not complete until enough comparable runs are collected to support the planned baseline calculation.

No optimization should be claimed until a baseline exists and a before-versus-after comparison demonstrates a measurable improvement.

## 14. Known Limitations and Pending Work

The following limitations or pending items remain:

- The CI and deployment workflows still contain a conditional frontend-existence check inherited from the bootstrap stage.
- Since the frontend is now required on `main`, the temporary skip behavior should be removed or converted into a failing validation when appropriate.
- TypeScript checking currently occurs inside `pnpm build` instead of being exposed as a separately named CI step.
- Frontend CI has been verified against the real FE-01 application.
- Automated Cloudflare frontend deployment has been verified.
- Production routing has been manually verified.
- Frontend-to-Supabase Edge Function communication remains unverified.
- Browser-to-API-to-database demonstration-data retrieval remains unverified.
- Supabase backend and database deployment procedures are not handled by the current frontend Cloudflare deployment workflow.
- Production rollback and recovery procedures have not yet been tested.
- The representative Sprint 1 pipeline metrics baseline still needs to be completed.
- The deployment log reported that the configured Wrangler version is out of date; upgrading it should be evaluated separately rather than mixed into Sprint 1 verification unless necessary.
- The production deployment workflow currently starts independently from the main-branch CI workflow after a qualifying push to `main`; it does not explicitly wait for the main-branch `Frontend Checks` job to succeed. This deployment-gating gap should be corrected so production deployment depends on successful validation.

## 15. Sprint 1 Completion Criteria

The Sprint 1 DevOps delivery setup currently has the following evidence:

- [x] Initial CI workflow is merged.
- [x] Branch protection ruleset is active.
- [x] Required pull-request CI check is configured.
- [x] Teammate approval is required before merge.
- [x] Production deployment workflow and Cloudflare configuration are merged.
- [x] Production deployment is restricted to `main`.
- [x] Feature-branch production deployment guard was tested.
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
- [ ] Deployed frontend-to-backend-to-database integration is verified.
- [ ] Representative Sprint 1 pipeline and deployment measurements are recorded.
- [ ] Sprint 1 baseline metrics are finalized.

The frontend delivery path from an approved merge into `main` to a running production frontend has now been verified.

Full Sprint 1 delivery verification remains open until the deployed browser-to-API-to-database path is available and successfully tested, and the representative pipeline baseline is completed.
