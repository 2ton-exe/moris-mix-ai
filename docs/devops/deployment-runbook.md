# Deployment Runbook and CI/CD Pipeline

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco — DevOps Engineer  
**Sprint:** 1  
**Status:** Initial deployment infrastructure configured; frontend deployment pending verification

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
Frontend dependency installation, linting, and build when the frontend exists  
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
Verify that the frontend scaffold exists  
↓  
Install dependencies using pnpm  
↓  
Build React/Vite frontend  
↓  
Wrangler uploads static assets to Cloudflare Workers  
↓  
Production verification

**Current limitation:** If `frontend/package.json` is absent, the deployment workflow skips the build and deployment steps. A successful workflow result therefore does not necessarily indicate that a production deployment occurred.

## 4. Repository Structure

The relevant DevOps files are organized as follows:

- `.github/workflows/ci.yml` — Pull request and main-branch CI checks
- `.github/workflows/deploy.yml` — Cloudflare production deployment
- `wrangler.jsonc` — Cloudflare Worker configuration
- `docs/devops/pipeline-metrics.md` — Pipeline measurements and results
- `docs/devops/deployment-runbook.md` — Deployment and recovery documentation

The frontend build output is expected at `frontend/dist/`.

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

The initial CI workflow conditionally skips frontend-specific steps until the frontend scaffold becomes available.

**Pending verification:** Confirm that the complete installation, linting, and build stages succeed after FE-01 is merged.

## 6. Branch Protection and Pull Requests

The default branch, `main`, is protected through a GitHub repository ruleset.

The configured requirements include:

- Changes must be submitted through pull requests.
- At least one approving review is required.
- The `Frontend Checks` status check must pass.
- Review conversations must be resolved.
- Force pushes are blocked.
- Branch deletion is restricted.

The ruleset was observed blocking a pull request that passed CI but had not yet received the required approval.

Development should take place on feature branches. Approved changes are merged into `main` through GitHub's pull request interface.

## 7. Production Hosting Configuration

**Cloudflare Worker:** `moris-mix-ai`

**Production URL:** [Mori's Scraps — Production](https://moris-mix-ai.diofelgwenharesco.workers.dev)

Cloudflare Workers hosts the frontend through Static Assets. Wrangler reads the repository's `wrangler.jsonc` configuration and publishes the generated files from `frontend/dist/`.

The configuration supports single-page application routing.

**Current production state:** The Cloudflare Hello World Worker has been created. Deployment of the React frontend is pending.

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

`github.ref == 'refs/heads/main'`

This prevents manually dispatched workflow runs from feature branches from executing the production deployment job.

### Expected Deployment Steps

1. Changes are reviewed and merged into `main`.
2. GitHub Actions starts the deployment workflow when its trigger conditions match.
3. The workflow checks for the frontend scaffold.
4. Dependencies are installed and the production build is generated.
5. Wrangler deploys the built assets to Cloudflare Workers.
6. The deployed application is checked at the production URL.

**Pending verification:** Complete a real production deployment after the frontend scaffold becomes available.

## 10. Deployment Verification Checklist

After the first frontend deployment, verify the following:

- [ ] GitHub Actions deployment workflow completes successfully.
- [ ] Frontend installation step executes.
- [ ] Frontend build step executes.
- [ ] Wrangler deployment step executes.
- [ ] Production URL serves the React application instead of Hello World.
- [ ] Main application routes load correctly.
- [ ] Frontend can communicate with the designated Supabase Edge Function.
- [ ] The deployed integration can retrieve the expected demonstration data.
- [ ] Deployment duration and merge-to-live time are recorded.

These checks should not be marked complete before actual verification.

## 11. Troubleshooting

### CI Fails During Dependency Installation

- Confirm `frontend/package.json` exists.
- Confirm the pnpm lockfile is committed.
- Check that the configured pnpm version matches the frontend project.
- Inspect the failed installation step in GitHub Actions.

### CI Fails During Linting or Build

- Open the failed job logs.
- Identify the relevant lint or TypeScript/Vite errors.
- Ask the responsible developer to correct the issue.
- Re-run CI through an updated pull request.

### Deployment Fails During Wrangler Execution

- Inspect the deployment job logs.
- Verify that the frontend build generated `frontend/dist/`.
- Confirm the Worker name and asset directory match the configuration.
- Check that the Cloudflare API token and account ID are correctly configured.
- Verify that the token still has the required deployment permissions.

### GitHub Actions Is Green but the Website Has Not Changed

- Check whether the deployment step was skipped.
- Confirm `frontend/package.json` exists on `main`.
- Confirm that the workflow was triggered for the expected commit.
- Inspect the latest Cloudflare Worker deployment.
- Check the production URL independently.

A green workflow alone is not sufficient evidence of successful deployment.

## 12. Recovery and Rollback

If a production deployment fails or introduces a defect:

1. Identify the affected commit and deployment.
2. Inspect GitHub Actions and Cloudflare logs.
3. Determine whether the issue involves frontend code, build configuration, credentials, or hosting.
4. If necessary, prepare a corrective or revert pull request targeting `main`.
5. Obtain the required approval and CI validation.
6. Merge the corrective change to trigger the deployment workflow.
7. Verify the restored application at the production URL.
8. Record the incident, recovery action, and recovery duration.

Cloudflare deployment history may provide an alternative rollback mechanism, but its availability and behavior must be verified before relying on it.

**Recovery status:** Documented procedure only. No production rollback or recovery drill has been completed yet.

## 13. Pipeline Metrics

Pipeline performance is recorded in `docs/devops/pipeline-metrics.md`.

Tracked measurements include:

- Pull request CI execution duration
- CI success and failure rate
- Main-branch pipeline duration
- Production deployment duration
- Merge-to-live time
- Failed deployments
- Recovery time
- Pipeline improvements

Measurements must be based on observed workflow runs rather than estimated results.

## 14. Known Limitations and Pending Work

- Frontend-specific validation currently uses a temporary conditional skip.
- Full frontend CI validation remains unverified.
- The first automated production frontend deployment remains unverified.
- Supabase backend and database deployment procedures are not yet covered by this frontend deployment workflow.
- Production rollback and recovery procedures have not yet been tested.
- Deployment metrics must be updated after a real deployment.

Once the frontend is integrated, the temporary skip should be removed or replaced with a failing validation when required frontend files are missing.

## 15. Sprint 1 Completion Criteria

The DevOps deployment setup can be considered operational when:

- [x] Initial CI workflow is merged.
- [x] Branch protection ruleset is active.
- [x] Deployment workflow and Cloudflare configuration are merged.
- [x] Cloudflare deployment credentials are configured securely.
- [x] Initial pipeline metrics are documented.
- [ ] Frontend install, lint, and build execute successfully.
- [ ] Frontend automatically deploys through GitHub Actions.
- [ ] Production URL serves the React application.
- [ ] Deployed frontend-to-backend-to-database integration is verified.
- [ ] Actual deployment measurements are recorded.

The outstanding criteria will be completed after the dependent application components become available.
