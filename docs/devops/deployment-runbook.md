# Deployment Runbook and CI/CD Pipeline

**Project:** Mori's Scraps  
**Team:** 2ton.exe  
**Maintainer:** Haresco — DevOps Engineer  
**Sprint:** 1–2\
**Status:** Cloudflare deployment and the demo API path were historically verified. The gated `recipes` deployment executed successfully on `main` in CI #284, while production runtime/CRUD smoke verification remains pending. A read-only production check confirmed the notes migration is applied. Gemini generation remains pending.

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
| Deployment CLI         | Supabase CLI and Wrangler             |

The validated-main deployment job sends the `recipes` Edge Function to the configured Supabase project, then deploys the frontend to Cloudflare. Production database migrations remain a separate process and are not applied by CI.

## 3. CI/CD Pipeline Architecture

### Pull Request Validation

Developer feature branch  
↓\
Pull request targeting `main`  
↓\
GitHub Actions — `ci.yml`\
↓\
`Frontend Checks`, `Database Tests`, `Edge/API Tests`, and `Hosted RLS Integration` run before deployment; Playwright E2E is non-gating\
↓\
Required checks: `Frontend Checks`, `Database Tests`, and `Edge/API Tests`; production deployment is skipped on PR runs and main deployment requires all deploy dependencies to succeed\
↓\
At least one teammate approval and resolved review conversations\
↓\
Merge into `main`

### Production Deployment

Approved merge into `main` produces a push event; permitted `workflow_dispatch` on `main` is an alternative\
↓\
GitHub Actions — `ci.yml`\
↓\
`Frontend Checks`, `Database Tests`, `Edge/API Tests`, and `Hosted RLS Integration` complete\
↓\
All deploy dependencies succeed and `needs.frontend.outputs.exists == 'true'`\
↓\
`Deploy to Supabase and Cloudflare` (`deploy`): validate target, build frontend, deploy only `recipes`, then deploy Cloudflare assets\
↓\
Wrangler uploads static assets to Cloudflare Workers\
↓\
Manual production verification

The temporary frontend-existence mechanism remains: `frontend` exposes the detection result as a job output. If `frontend/package.json` is absent, frontend validation steps and deployment are skipped. Since FE-01 is merged into `main`, this behavior should eventually become a hard failure if the required frontend project disappears.

A green workflow alone is not considered sufficient deployment evidence. The relevant build and deployment steps must actually execute.

### PR Staging Delivery (PR #81 / #76)

PR #81 introduces frontend staging delivery through `.github/workflows/modular-pr-validation.yml` and `.github/workflows/reusable-staging.yml`. This describes the configured PR path, not evidence that the remaining #76 verification work is complete.

PRs targeting `main` run the normal Frontend / Database / Edge API validations. After all three modular validation jobs succeed, trusted, non-draft PRs can deploy to staging. The staging gate requires a source branch in this repository and an author association of `OWNER`, `MEMBER`, or `COLLABORATOR`. Draft and fork PRs do not deploy staging. The modular PR workflow handles `opened`, `synchronize`, `reopened`, and `ready_for_review` events.

The reusable workflow builds the frontend in the isolated GitHub `staging` environment and deploys to the Cloudflare Worker `moris-mix-ai-staging` with `wrangler deploy --config wrangler.jsonc --env staging`. The target is explicitly named in `wrangler.jsonc` under `env.staging.name`; the workflow also guards `STAGING_WORKER_NAME`. The workflow concurrency group `moris-mix-staging` serializes staging deployment and its dependent smoke job, with `cancel-in-progress: false`, so another run cannot replace the staging deployment while its smoke check is running.

Configure these Actions variables under **Settings → Environments → staging**:

| Variable | Expected configuration |
| :--- | :--- |
| `STAGING_WORKER_NAME` | `moris-mix-ai-staging` |
| `STAGING_FRONTEND_URL` | The staging Worker's HTTPS `workers.dev` URL |
| `STAGING_SUPABASE_PROJECT_REF` | The isolated staging Supabase project reference |
| `VITE_SUPABASE_URL` | `https://<STAGING_SUPABASE_PROJECT_REF>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The staging project's public publishable key |

These staging environment values provide the public Supabase build configuration instead of production configuration. The workflow validates that the URL matches the staging project reference before building. Do not put privileged Supabase keys into frontend build variables.

**Before pushing the staging workflow changes**, configure `STAGING_CLOUDFLARE_API_TOKEN` and `STAGING_CLOUDFLARE_ACCOUNT_ID` as secrets under **Settings → Environments → staging**, using the intended staging deployment credentials. The caller explicitly passes these staging-specific names, and the reusable workflow declares both required and validates both are non-empty before building/deploying. Missing staging credentials fail closed: there is no fallback to the production-named `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID`. Keep the production secrets unchanged; do not populate repository-level staging-specific names with production credentials.

Cloudflare credentials are scoped to the configuration-validation step's environment and the deployment action's inputs; checkout, setup, dependency installation, and frontend build do not inherit them. The deploy job has a 10-minute timeout and the smoke job has a 5-minute timeout. The smoke timeout accommodates the existing request retry budget of about 190 seconds across both requests, leaving about 110 seconds for setup and other job overhead.

After deployment, the workflow requires the official `cloudflare/wrangler-action@v4` `deployment-url` output to be non-empty and equal to `STAGING_FRONTEND_URL`, normalizing only one optional trailing slash on each. Missing or mismatched output fails the deployment job before smoke can run. The verified Wrangler URL is exposed as the deploy job's `deployment-url` output and passed directly to the smoke job; smoke does not independently read the configured URL. Both deployment and smoke evidence record this verified URL.

The current frontend smoke requests `/home?revision=${GITHUB_SHA}` and the first referenced built JavaScript asset. Each request allows up to five attempts with five-second sleeps between failures and no sleep after the last attempt. Both require curl success and final HTTP 200. `/home` must have final `text/html` content type; the asset must have a final JavaScript MIME type containing `javascript` or `ecmascript` (optional charset parameters are accepted). HTML asset responses are rejected even with HTTP 200 because Cloudflare SPA fallback can serve `index.html` for a missing bundle. Missing asset references and exhausted retries fail the smoke job.

Deployment and smoke summaries record **PR head** from `github.event.pull_request.head.sha` separately from **Tested merge revision** from `GITHUB_SHA`. On this PR path, checkout, build/deployment, and the smoke cache-busting revision use the tested merge revision; the source head is traceability evidence, not a claim that it was the exact deployed checkout.

Production deployment remains separate: the authoritative `.github/workflows/ci.yml` owns the existing main-only production path. Staging is not yet a required branch-protection check; the existing required validation checks remain unchanged. API/database-backed staging smoke under #76, controlled staging smoke-failure evidence, and backend staging revision evidence are still pending. Frontend smoke success does not establish backend revision or API/database integration evidence.

## 4. Repository Structure

The relevant DevOps files are organized as follows:

- `.github/workflows/ci.yml` — Frontend, database, Edge/API, and Hosted RLS validation plus gated `recipes` and Cloudflare production deployment
- `.github/workflows/modular-pr-validation.yml` — Modular PR validation and trusted PR staging gate introduced by PR #81
- `.github/workflows/reusable-staging.yml` — Serialized staging frontend deployment, smoke, and revision summaries
- `wrangler.jsonc` — Cloudflare Worker configuration
- `docs/devops/pipeline-metrics.md` — Pipeline measurements and results
- `docs/devops/deployment-runbook.md` — Deployment and recovery documentation

The frontend application is stored under `frontend/`.

The frontend production build output is generated at `frontend/dist/`.

## 5. Continuous Integration

The unified CI workflow runs through GitHub Actions when a pull request targets `main`, on any push to `main`, or through manual dispatch. PR runs execute the validation jobs and skip the production `Deploy to Supabase and Cloudflare` job; the separate modular PR staging path is described in section 3. Main pushes and permitted manual main runs deploy only after every `deploy.needs` job succeeds and the frontend-existence output is true. Playwright E2E remains non-gating.

Its frontend validation stages are:

1. Check out repository source code.
2. Detect whether `frontend/package.json` exists.
3. Set up pnpm and Node.js.
4. Install dependencies using `pnpm install --frozen-lockfile`.
5. Run `pnpm lint`.
6. Run `pnpm test`.
7. Run `pnpm build`.

In parallel, `Database Tests` validates migrations, migration lifecycle behavior, and RLS against a PostgreSQL service container. `Edge/API Tests` type-checks and tests recipe CRUD, demo, and AI schemas and handlers; when configured, it also applies pending migrations to and runs RLS integration tests against a dedicated hosted non-production database. These validation jobs do not deploy production functions or change the production database.

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

The ruleset was previously observed blocking a pull request that passed CI but had not yet received the required approval. All three required PR validation jobs are also dependencies of production deployment in the subsequent main run, alongside `test-hosted-rls`; the current production gate requires `frontend`, `test-db`, `test-edge-api`, and `test-hosted-rls`.

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
| `SUPABASE_ACCESS_TOKEN` | Authorizes Supabase CLI deployment        |

The `SUPABASE_PROJECT_REF` repository variable identifies the Supabase target and must match `project_id` in `supabase/config.toml`. CI also checks that `VITE_SUPABASE_URL` targets the same project before deploying.

Secrets are managed in:

GitHub Repository → Settings → Secrets and variables → Actions

Secret values must never be committed to Git, included in pull request descriptions, printed in CI logs, or shared in screenshots.

The Cloudflare API token is restricted to the intended Cloudflare account.

## 9. Automated Deployment Procedure

Production deployment is the `deploy` job inside `.github/workflows/ci.yml`. An approved merge into `main` produces the push event that starts CI; deployment follows successful `Frontend Checks`, `Database Tests`, `Edge/API Tests`, and `Hosted RLS Integration` jobs in the same run. Permitted `workflow_dispatch` runs on `main` use the same gate. PR runs skip production deployment.

The job declares `needs: [frontend, test-db, test-edge-api, test-hosted-rls]` and uses this condition:

```text
needs.frontend.outputs.exists == 'true' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
```

The `deploy.needs` configuration and normal GitHub Actions dependency semantics prevent deployment when a dependency fails, is cancelled, or is skipped. Failed-dependency blocking is verified by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`. Run #90 verifies successful production ordering separately.

The workflow currently has no push path filter: docs-only main pushes can also proceed through deployment. Evaluating trigger scope is possible future efficiency work, not a correctness failure or a proven optimization opportunity.

### Deployment Steps

1. Changes are reviewed and merged into `main`; the resulting push event triggers the unified CI workflow. Alternatively, use a permitted `workflow_dispatch` run on `main`.
2. Frontend, database, Edge/API, and hosted RLS validation run; Playwright E2E runs separately and is non-gating.
3. Confirm every `deploy.needs` job succeeded and the frontend-existence output is true.
4. The deployment job validates the Supabase token and project reference, then installs frontend dependencies and builds the site.
5. Supabase CLI deploys only `recipes` with gateway JWT verification disabled, matching `supabase/config.toml` so the handler enforces authentication.
6. Wrangler deploys the static assets to Cloudflare after the function deployment succeeds.
7. Confirm both deployment steps executed. Production runtime and CRUD smoke verification is tracked under [DEVOPS-08](https://github.com/2ton-exe/moris-mix-ai/issues/61).

The deployment does not apply database migrations. Before relying on recipe CRUD, verify the production migration ledger and apply any pending recipe migrations through the separately managed database release process.

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

The successful three-job gating path is verified by main run #90. Failed-dependency blocking is verified by the controlled non-production equivalent dependency-gate experiment in PR #68 / run `39279387584`. Run #90 is separate from the historical two-job baseline in [pipeline metrics](pipeline-metrics.md); DEVOPS-06 does not claim a performance optimization.

### Controlled Non-Production Failure-Gate Experiment (DEVOPS-06)

Draft PR #68, `[DEVOPS-06] Verify failed validation blocks deployment`, executed controlled experimental run `39279387584` with these results:

| Experimental job | Result |
| :--- | :--- |
| Gate Test - Frontend | Success |
| Gate Test - Edge/API | Success |
| Gate Test - Intentional Database Failure | Failure by design |
| Gate Test - Would Deploy | Skipped |

The inert downstream job declared `needs: [frontend, test-db, test-edge-api]`, matching the historical production deploy gate's three-dependency structure in effect when PR #68 ran. The current production gate has four dependencies: `frontend`, `test-db`, `test-edge-api`, and `test-hosted-rls`. This controlled non-production equivalent dependency-gate experiment verifies GitHub Actions failure propagation: when one required dependency fails and `always()` is not used, the downstream deployment-shaped job is skipped. It used no production credentials, repository secrets, Cloudflare/Supabase deployment commands, or application deployment. Production main was not intentionally failed, and no failed production deployment occurred in this experiment.

The historical evidence chain is the production configuration in effect for the PR #68 experiment (`deploy.needs: [frontend, test-db, test-edge-api]`), successful production ordering (main run #90), and safe verification of the failed-dependency blocking mechanism (PR #68 / experimental run `39279387584`). The experiment is separate from run #90's successful production-main evidence.

Normal CI run #98 on the same PR completed Frontend Checks, Database Tests, and Edge/API Tests successfully; Deploy to Cloudflare was skipped because this was a PR. Run #98 is PR validation evidence, not production deployment evidence. Neither the controlled experiment nor the unusually delayed workflow runs associated with PR #68 are added to a performance baseline; no comparable-duration justification or performance optimization is claimed.

## 10. Deployment Verification Checklist

Historical FE-01 checks, run #48, the 2026-10-17 smoke check, main run #90, and the controlled PR #68 experiment establish the following:

- [x] GitHub Actions deployment completes successfully.
- [x] Historical frontend-only deployment gate verified: main deployment waited for successful Frontend Checks (run #48).
- [x] Successful runtime execution of the three-job deployment gate is verified by main run #90.
- [x] Verify failed-dependency blocking through the controlled non-production equivalent dependency-gate experiment (PR #68 / run `39279387584`); the inert downstream job was skipped.
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

### Staging Configuration or Deployment Failure

- For `Missing staging configuration`, check the named variable under **Settings → Environments → staging** or the named Cloudflare Actions secret. Confirm both jobs reference the `staging` environment; do not print secret values.
- For an unexpected Worker or frontend URL, check `STAGING_WORKER_NAME` and `STAGING_FRONTEND_URL` against the isolated staging Worker rather than the production Worker.
- For a Supabase project-reference mismatch, make `VITE_SUPABASE_URL` match `https://<STAGING_SUPABASE_PROJECT_REF>.supabase.co` and confirm the public publishable key belongs to that staging project. Do not substitute production configuration to bypass the guard.
- For Cloudflare authentication or deployment failure, inspect `Deploy staging Worker`, verify the caller passes `STAGING_CLOUDFLARE_API_TOKEN` and `STAGING_CLOUDFLARE_ACCOUNT_ID`, and check both staging environment secrets and the token's permissions for the intended account. Missing values must fail; do not restore access by falling back to production secrets. Confirm `frontend/dist/` exists and Wrangler uses `--env staging` with explicit `env.staging.name: moris-mix-ai-staging`.
- For a missing or mismatched deployment URL, inspect `Verify staging deployment URL` and Wrangler's output. Confirm `env.staging.name`, the account's `workers.dev` subdomain, and `STAGING_FRONTEND_URL` describe the same staging Worker. Only a trailing-slash difference is accepted. Correct the configuration or deployment-output issue; do not bypass the verification or smoke an older configured URL.

### Staging Frontend Smoke Failure

- For a final effective URL origin failure on `/home` or the JavaScript asset, inspect the redirect configuration. Redirects are followed, but each final URL must have the same origin (scheme, hostname, and effective port) as the verified `STAGING_FRONTEND_URL`. Cross-origin redirects, including redirects to production, fail smoke immediately even when the final status and content type would otherwise pass.
- For `/home` failure, check the staging URL, Worker deployment, routing, and final HTTP status/content type after redirects. HTTP 200 with final `text/html` is required; an intermediate redirect's HTML header is insufficient.
- For `Could not find the built JavaScript asset.`, inspect the deployed HTML and build output for the expected `src="...assets/...js"` reference. Missing references fail explicitly.
- For JavaScript asset failure, inspect the referenced URL and ensure that bundle was uploaded. HTTP 200 with `text/html` can be Cloudflare SPA fallback for a missing asset and is intentionally rejected. Check final JavaScript content type as well as HTTP status; do not disable this assertion.
- For transient network errors, inspect curl diagnostics and Cloudflare availability. Both requests retry up to five times; repeated network, status, or content-type failures exhaust retries and fail smoke. Investigate the cause before rerunning; a green deployment job alone does not mean smoke passed.
- Compare both **PR head** and **Tested merge revision** in the run summary when investigating stale content. The `/home` revision query uses the tested merge revision. A rerun must still be checked against the intended revision.

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
- Confirm the unified CI workflow ran for the expected commit, the `frontend`, `test-db`, `test-edge-api`, and `test-hosted-rls` jobs all succeeded, and the frontend-existence output is true.
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

Weekly/sprint performance and evidence-recording responsibilities are maintained in [pipeline-metrics.md](pipeline-metrics.md). Use the [optimization log](optimization-log.md) for controlled before/after experiments and the [incident log](incident-log.md) for genuine incidents/postmortems. This runbook owns deploy, smoke, rollback and recovery procedures; GitHub Actions runs remain raw execution evidence and issues/PRs retain task-specific acceptance/review records. The Sprint 2 headless-shell result concerns a sampled E2E job, not whole-pipeline or merge-to-live performance.

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
- The gated `recipes` production deployment executed successfully on `main` in [CI #284](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41003182840) at PR #125 merge SHA `7278f92e0fc67348efa60a14293dcdfde9329709`: the `Deploy to Supabase and Cloudflare` job passed production configuration validation, `recipes` Edge Function deployment, and Cloudflare Worker deployment. Production runtime/CRUD smoke verification remains pending under [DEVOPS-08](https://github.com/2ton-exe/moris-mix-ai/issues/61); CI #284 did not perform PR #88's separate post-deployment runtime smoke.
- A read-only production migration-ledger query on 2026-10-26 confirmed `20261023000002_add_notes_to_recipes.sql` is applied and `public.recipes.notes` exists. CI does not apply production migrations.
- Production rollback and recovery procedures have not yet been tested.
- The historical preliminary Sprint 1 metrics baseline has a small sample. A separate preliminary current three-job sample now exists, including successful-gate evidence from run #90; more comparable observations are needed. Failed-dependency blocking is verified separately by the controlled non-production PR #68 experiment (run `39279387584`).
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
- [x] Failed-dependency blocking is verified by the controlled non-production equivalent dependency-gate experiment (PR #68 / run `39279387584`).
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

Sprint 1 delivery tracking remains open for Gemini generation verification and further comparable pipeline measurements. The all-checks deployment gate is merged and its successful main path is verified by run #90; the failed-dependency blocking mechanism is verified separately by the controlled non-production PR #68 experiment (run `39279387584`).
