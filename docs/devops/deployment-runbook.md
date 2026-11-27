# Deployment Runbook and CI/CD Pipeline

> **Current modular pipeline (2026-11-21):** See [PIPELINE.md](PIPELINE.md). Dated sections below preserve historical implementation/evidence; verify current GitHub workflows before relying on them.

**Project:** Mori's Mix\
**Team:** 2ton.exe  
**Maintainer:** Haresco — DevOps Engineer  
**Sprint:** 1–2\
**Status:** Cloudflare deployment and the demo API path were historically verified. The gated production deployment and automated post-deployment runtime smoke executed successfully on `main` in CI #290. The runtime smoke verified production frontend HTML, its referenced JavaScript asset, and the approved public demo API/database path; full authenticated CRUD and runtime-observed backend source provenance are not established by that smoke. Automated staging deployment and combined frontend/API/database smoke passed on PR #88. A read-only production check confirmed the notes migration is applied. Gemini provider transport, model availability, and SDK compatibility were verified locally on 2026-11-14 (see the [AI evaluation report](../ai-evaluation-report.md#dedicated-gemini-project-re-verification-2026-11-14)); Quick AI Entry and AI Chef are enabled and were verified on the deployed site on 2026-11-15. See [production AI runtime configuration](#production-ai-runtime-configuration).

> **Baseline workflow configuration checked 2026-11-15 at `main` SHA `0dd27d0fbba8f5cca5a7153229bda68b985be78c`:** [PR #142](https://github.com/2ton-exe/moris-mix-ai/pull/142) merged as `8747e6e605c5eda358c1bb77b27d3d120c87bddc`, retiring `ci.yml`; [issue #73](https://github.com/2ton-exe/moris-mix-ai/issues/73) is closed. [Modular Main Validation #29](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41222561150) ran on that merge SHA and passed core validation, Hosted RLS, production deployment, URL verification, runtime smoke and evidence preservation. That run remains historical evidence and does not establish execution of the current conditional image path.
>
> `modular-main.yml` is the sole production caller. Its release gate requires successful frontend, database and aggregate Edge/API validation, including nested mandatory Hosted RLS, plus frontend existence; main E2E is separate. The reusable release always deploys `recipes`, `extract-recipe`, `generate-recipe` and `recipe-image-attach`. It explicitly disables `account-export`; image upload/download deployments require `VITE_RECIPE_IMAGES == 'true'`, and cleanup deployment/invocation requires `RECIPE_IMAGE_CLEANUP_ENABLED == 'true'`. With both flags enabled, Modular Main runs read-only readiness for the same commit and production continues only after success. The readiness job uses the `recipe-image-upload-production` environment, which is restricted to `main` without reviewer approval. The historical proposal below preserves its original pending conditions; they are not current instructions or evidence gaps.

## Issue #73 final cleanup proposal (2026-10-31)

Baseline main: `46809319eb23394a45d6f1ea79f8ee41f541011b`.
At this 2026-10-31 proposal checkpoint, the branch had not yet provided
merged-main verification and issue #73 remained open. This proposal itself
made no GitHub settings changes.

Operator-provided evidence at that main SHA already proves both ownership modes:

| Experiment | Variable | Legacy production | Modular Main Production |
| --- | --- | --- | --- |
| Cutover | exact `true` | skipped | successful |
| Rollback | `false` | successful | skipped |

The modular release passed recipes deployment, Cloudflare deployment, production
URL verification, runtime smoke, and artifact preservation. The variable was
subsequently restored to exact `true`; this cleanup does not change it. These are
operator-confirmed outcomes supplied for this cleanup, not new runs performed by
this branch; run IDs were not supplied. Earlier run links below remain historical
evidence for their own revisions.

### Proposed permanent architecture and remaining handoff

PRs use `modular-pr-validation.yml`; main uses `modular-main.yml`, the sole
production caller. This branch removes `ci.yml`, the production owner selector,
owner input/preflight and inert shadow gate. It removes runtime reads of
`MODULAR_PRODUCTION_ENABLED` without changing the repository variable.
Successful frontend/database/Edge validation, mandatory hosted RLS on main,
frontend existence, exact caller identity, main push/manual-only restrictions,
explicit production secrets, recipes-only targeting, URL verification, runtime
smoke/evidence, and serialized production concurrency remain. E2E is non-gating.

At this proposal checkpoint, the six-context overlap and separate GitHub
handoff were still being described as planned work. The intended final contexts
were `Modular Frontend / Frontend Checks`, `Modular Database / Database Tests`,
and `Modular Edge/API / Edge/API Tests`. The handoff subsequently completed
without a required-check gap (2026-11-01 PHT), and these three modular contexts
replaced the legacy requirements. PR Secretary's intended-policy fallback does
not substitute for checking live GitHub rules.

The [full cleanup contract and GitHub handoff](../../.github/production-cutover.md#issue-73-final-cleanup-proposal-2026-10-31)
records production targets, release safeguards, and outstanding verification.
At the 2026-10-31 proposal checkpoint, post-merge modular-only validation,
mandatory Hosted RLS, deployment, smoke, artifacts and Secretary refresh still
required verification. The former release-verification gap was subsequently
closed by [main run #29](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41222561150)
on the [PR #142 merge SHA](https://github.com/2ton-exe/moris-mix-ai/commit/8747e6e605c5eda358c1bb77b27d3d120c87bddc);
issue #73 is closed. This run does not independently establish PR Secretary
verification on the new default-branch code.
After retirement, a variable flip cannot restore legacy production; rollback
requires a reviewed repository change. Do not rerun stale production revisions.

## 1. Purpose

This document describes the continuous integration and continuous deployment (CI/CD) pipeline, production hosting configuration, deployment verification procedures, and basic recovery steps for Mori's Mix.

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

At baseline `main` SHA `0dd27d0fbba8f5cca5a7153229bda68b985be78c` (checked
2026-11-15), the production release had four unconditional Edge Function
deployment steps:
`recipes`, `extract-recipe`, `generate-recipe`, and `recipe-image-attach`.
`account-export` is explicitly disabled with `if: false`. The upload signer and
private download URL functions deploy only when `VITE_RECIPE_IMAGES == 'true'`;
the cleanup function deploys only when `RECIPE_IMAGE_CLEANUP_ENABLED == 'true'`.
That configuration required a successful, manually dispatched readiness run for
the exact main SHA with a matching production environment URL when image UI was
enabled, plus the required production image migrations. The frontend deployed to
Cloudflare after the applicable function steps succeeded. Production database
migrations remained separate and were not applied by the ordinary application
release.

In the current workflow, when both image and cleanup are enabled, Modular Main
runs read-only readiness for the same commit before the release continues. The
readiness job uses the `main`-restricted image environment without reviewer
approval. The release still requires the image migrations in the production ledger.

## 3. CI/CD Pipeline Architecture

### Pull Request Validation

Developer feature branch  
↓\
Pull request targeting `main`  
↓\
GitHub Actions - `modular-pr-validation.yml`\
↓\
Complete-diff classifier selects full validation or the conservative prose-only path\
↓\
The three required Modular Frontend, Modular Database and Modular Edge/API contexts remain present; verified prose-only diffs use lightweight core paths and skip E2E/staging\
↓\
Full-path PRs run reusable frontend/database/Edge validation and three-browser Playwright E2E. Staging also requires core success, a non-draft same-repository PR, a non-Dependabot author, and no cancellation.\
↓\
The active `Protect main` ruleset requires one approving review and resolved review conversations. PRs cannot call production.

### Production Deployment

Approved merge into `main` produces a push event; permitted `workflow_dispatch` on `main` is an alternative\
↓\
`modular-main.yml` is the sole production caller; configuration checked 2026-11-15 at main SHA `0dd27d0fbba8f5cca5a7153229bda68b985be78c`\
↓\
Frontend, database and aggregate Edge/API succeed; the Edge/API reusable workflow requires nested Hosted RLS on main. Main E2E runs separately and is not in the production `needs` list\
↓\
All production dependencies succeed and `needs.frontend.outputs.exists == 'true'`\
↓\
`reusable-production.yml` validates caller/target and rejects stale revisions; always deploys `recipes`, `extract-recipe`, `generate-recipe`, and `recipe-image-attach`; explicitly skips `account-export` (`if: false`). Upload signer and private download URL are conditional on `VITE_RECIPE_IMAGES == 'true'`; cleanup deployment is conditional on `RECIPE_IMAGE_CLEANUP_ENABLED == 'true'`\
↓\
When image UI is enabled, same-run readiness must succeed for this main SHA; the check requires no reviewer approval. Cleanup opt-in and required image migrations are also prerequisites. Wrangler then uploads static assets to Cloudflare Workers\
↓\
Verify the production URL and AI routes, then run runtime smoke for HTML, the referenced JavaScript asset and the public demo response. Account-export preflight/401 checks run only if its deployment step succeeds; because the step is currently `if: false`, those checks do not execute. Authenticated export ownership remains unverified by production smoke.

The frontend-existence safety mechanism remains: `frontend` exposes the detection result as a job output. If `frontend/package.json` is absent, frontend validation steps and deployment are skipped. Since FE-01 is merged into `main`, this behavior should eventually become a hard failure if the required frontend project disappears.

A green workflow alone is not considered sufficient deployment evidence. The relevant build and deployment steps must actually execute.

### Enable private recipe images

An authorized release operator should perform these steps in order. Keep the repository variable `VITE_RECIPE_IMAGES` unset or `false` until step 4.

1. Complete the [database recovery requirements](https://github.com/2ton-exe/moris-mix-ai/issues/155), including the [isolated restore drill](https://github.com/2ton-exe/moris-mix-ai/issues/159). Use the separately reviewed [guarded migration release](https://github.com/2ton-exe/moris-mix-ai/pull/154) to preview and apply the pending versioned SQL. For a ledger ending at `20261115000020`, expect `20261115000021_recipe_image_download_outcomes.sql`, `20261115000022_supabase_roundtrip_performance.sql`, and `20261116000023_recipe_image_upload_quota_increase.sql` in order. Stop and reconcile unexpected drift. Record the migration release and confirm all three versions are applied to the intended production project. An ordinary app release does not apply migrations. When both image and cleanup flags are enabled, Modular Main runs the read-only verifier for the same commit and proceeds automatically without reviewer approval. The `recipe-image-upload-production` environment remains restricted to `main` and supplies the verifier secrets.

   The readiness verifier requires `PRODUCTION_FRONTEND_URL` to match the production origin. Before the first deployment, the release also requires that verified same-run origin to match its own `PRODUCTION_FRONTEND_URL`. Production proceeds only after readiness and the required image migrations pass. There is no separate readiness dispatch or reviewer approval; `recipe-image-attach` is deployed unconditionally.

   The [readiness verifier](../../scripts/verify-upload-signing-readiness.mjs) checks the intended Supabase project and HTTPS origin configuration, the verified readiness attestation, accepted project credentials, required migrations, enabled and forced RLS on upload intents, schema limits, and service-role-only table/RPC access. This describes configured prerequisites; it does not claim a readiness run for a later `main` SHA.
2. Confirm the existing recipe-image bucket settings and deployed origin against the [image API contract](../api/recipe-images.md#be-13-implementation-and-deployment-dependencies). In isolated non-production, capture a browser CORS preflight, a successful signed PUT, a same-key PUT rejected with `412`, and successful attach and private read. Confirm expired staging cleanup can list and delete staging objects, free upload quota, and preserve the finalized image. Record results without keys or signed URLs. Non-production evidence does not replace checking the production bucket's CORS rule for `PRODUCTION_FRONTEND_URL`.
3. Configure `RECIPE_IMAGE_CLEANUP_TOKEN` in the Supabase runtime and in the `recipe-image-cleanup-production` GitHub environment. Set `VITE_SUPABASE_URL` and `SUPABASE_PROJECT_REF` for that environment, restrict it to `main`, and allow unattended scheduled runs. The cleanup workflow is scheduled every 15 minutes and supports manual dispatch, but its job runs only on main when `RECIPE_IMAGE_CLEANUP_ENABLED == 'true'`. For the first rollout, pause **Recipe Image Upload Cleanup** so it cannot call an older worker. Set the cleanup opt-in and run **Modular Main Validation** on `main` while the image UI is off to deploy the current worker; the production release checks the required migration ledger when cleanup is enabled. After deployment succeeds, re-enable the cleanup workflow, run it from `main`, and check its outcome before opening uploads.
4. Set the repository variable `VITE_RECIPE_IMAGES=true` and run **Modular Main Validation** on `main` after completing step 1. The same-run readiness job starts automatically and must succeed before production continues. The release also requires the cleanup opt-in and checks the production migration ledger using `PRODUCTION_RELEASE_SUPABASE_ACCESS_TOKEN` (requires `database_migrations_read`). Missing migrations, unavailable history, failed readiness, or a failed image deploy block publication. Check that `recipe-image-attach`, conditional download, cleanup, signer, and Cloudflare steps have the expected outcomes and record the release revision. With an authorized disposable account and recipe, verify that the signer returns a direct R2 URL and the browser can upload, attach, reload the private image, and recover staging quota. Verify a different account cannot obtain the private download URL.

Leave `VITE_RECIPE_IMAGE_UPLOAD_IDEMPOTENCY` unset or `false` until the current deployed signer is verified to accept `request_id`. This client option is independent of the same-key retry for a signed R2 PUT.

To roll back the UI, unset `VITE_RECIPE_IMAGES` or set it to `false` and rerun **Modular Main Validation** on `main`. Keep healthy staging cleanup running to drain outstanding intents. If the cleanup opt-in is unsafe or its release check prevents the rollback, turn it off as well and investigate before resuming it. Rolling back the frontend does not remove the deployed functions or revert database migrations; coordinate a server-side rollback separately if needed.

### Enable finalized image cleanup

This is a separate, **off by default** operation from staging cleanup. This PR prepares the wiring only; it does not deploy a function, configure secrets, or enable a schedule. Keep `RECIPE_IMAGE_FINAL_CLEANUP_ENABLED` unset or `false` until an authorized operator completes these steps. Neither `VITE_RECIPE_IMAGES` nor `RECIPE_IMAGE_CLEANUP_ENABLED` enables finalized cleanup.

1. Verify the intended project matches `project_id` in `supabase/config.toml`. Complete the guarded database recovery/migration release above. Independently verify all recipe-image migrations, especially `20261107000016_recipe_image_final_lifecycle.sql` and `20261115000022_supabase_roundtrip_performance.sql`, the finalization-attempt and cleanup tables, forced RLS, and the service-role-only `claim_recipe_image_final_cleanup` and `finish_recipe_image_final_cleanup` RPC grants. Test replacement, deletion, crashed-copy recovery, and rejection of currently referenced keys in an isolated non-production project. Verify the existing bucket-scoped runtime R2 credential can delete final objects in the intended private bucket. Do not expand permissions or use the staging credential as the final cleanup bearer token.
2. Create the GitHub environment `recipe-image-final-cleanup-production`, restrict deployment branches to `main`, and permit unattended schedule execution. Set its `VITE_SUPABASE_URL` and `SUPABASE_PROJECT_REF` variables to the verified project. Keep the repository opt-in off. Pause **Recipe Image Final Cleanup** before the first rollout so it cannot invoke an older worker:

   ```sh
   gh workflow disable recipe-image-final-cleanup.yml --repo 2ton-exe/moris-mix-ai
   ```

3. Generate a new independent random token of at least 32 characters in the approved secret manager. Configure the same value as Supabase runtime `RECIPE_IMAGE_FINAL_CLEANUP_TOKEN` and as the GitHub environment secret of that name. Never reuse `RECIPE_IMAGE_CLEANUP_TOKEN`. From the release checkout, the following operator-only Bash commands accept the token without echoing it; use the verified project reference in `SUPABASE_PROJECT_REF` and an authorized Supabase CLI session. Do not put tokens in repository files or logs:

   ```sh
   read -rs RECIPE_IMAGE_FINAL_CLEANUP_TOKEN
   token_file="$(mktemp)"
   chmod 600 "$token_file"
   trap 'rm -f "$token_file"; unset RECIPE_IMAGE_FINAL_CLEANUP_TOKEN' EXIT
   printf 'RECIPE_IMAGE_FINAL_CLEANUP_TOKEN=%s\n' "$RECIPE_IMAGE_FINAL_CLEANUP_TOKEN" > "$token_file"
   (cd frontend && pnpm exec supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" --env-file "$token_file")
   printf '%s' "$RECIPE_IMAGE_FINAL_CLEANUP_TOKEN" | gh secret set RECIPE_IMAGE_FINAL_CLEANUP_TOKEN \
     --env recipe-image-final-cleanup-production --repo 2ton-exe/moris-mix-ai
   rm -f "$token_file"
   unset RECIPE_IMAGE_FINAL_CLEANUP_TOKEN
   ```

4. With the cleanup workflow still paused, set the repository variable `RECIPE_IMAGE_FINAL_CLEANUP_ENABLED=true` and dispatch **Modular Main Validation** on the current `main`. This is the production activation step and requires separate authorization. The release verifies the migration ledger, deploys `recipe-image-final-cleanup` using the existing production release credentials, and sends an unauthenticated POST expecting `401` and the handler JSON `{"error":"unauthorized"}`. A missing runtime token yields `503` and blocks release. This probe never claims or deletes objects. Check the deployment and availability outcomes in the release summary. Do not resume scheduling after a failed deployment or probe.

   ```sh
   gh variable set RECIPE_IMAGE_FINAL_CLEANUP_ENABLED --body true --repo 2ton-exe/moris-mix-ai
   gh workflow run modular-main.yml --ref main --repo 2ton-exe/moris-mix-ai
   ```

5. After the release passes, re-enable and manually dispatch **Recipe Image Final Cleanup** from `main`. Require a successful job with `Finalized image cleanup healthy` and `failed=0`, `processed=cleaned` (0–25). The workflow fails on HTTP errors, timeouts, malformed JSON, or inconsistent counters. The schedule runs at UTC minutes 7, 22, 37, 52 with one invocation at a time and five concurrent deletions within a batch.

   ```sh
   gh workflow enable recipe-image-final-cleanup.yml --repo 2ton-exe/moris-mix-ai
   gh workflow run recipe-image-final-cleanup.yml --ref main --repo 2ton-exe/moris-mix-ai
   ```

6. Record the release revision, first manual run, first scheduled run, project/bucket identity and queue-health evidence without keys or signed URLs. Using an authorized privileged database session, run the read-only query below before and after activation. Investigate any `failed` row, expired claimed lease, or growing overdue backlog. A successful empty batch alone does not prove the queue healthy. `watching` rows intentionally remain for uncertain late copies and retry hourly; do not delete these records or treat their existence alone as a failure. The worker rechecks current recipe references before deletion. A non-production test should prove a replaced image drains and the current image remains readable.

   ```sql
   select status, count(*) as total,
          count(*) filter (where next_attempt_at <= now()
            and status in ('queued', 'retry', 'watching')) as due,
          count(*) filter (where status = 'claimed' and lease_until <= now()) as expired_leases,
          min(next_attempt_at) filter (where status in ('queued', 'retry', 'watching')) as oldest_due_at
   from public.recipe_image_final_cleanup
   group by status order by status;
   ```

To pause or roll back activation, set `RECIPE_IMAGE_FINAL_CLEANUP_ENABLED=false` and disable `recipe-image-final-cleanup.yml`. The flag stops future deployments and scheduled/manual jobs; it does not undeploy the worker, stop an in-flight invocation, revert image pointers, or restore deleted obsolete objects. For immediate bearer revocation, rotate or unset only the final cleanup runtime secret through the approved operations process. Keep the independent staging worker healthy. Correct configuration and inspect failed/overdue tasks before re-enabling; do not rewrite cleanup records to force retries without investigating the stored failure.

### DEVOPS-10 / #130: AI function delivery

`modular-main.yml` remains the sole production caller. Successful core validation,
mandatory main Hosted RLS, frontend existence, the main-only caller guards, and
the `cloudflare-production` concurrency lock gate production releases.

The production release order is:

1. Check the dedicated `production-release` secrets before checkout, then validate production deployment configuration.
2. Install frontend dependencies using the frozen lockfile.
3. Build the frontend, reject a stale main revision, and verify the production Cloudflare Worker URL before the first provider write. Unconditionally verify Chef migration `20261127113008` in the intended project ledger, then check recipe image prerequisites when enabled. The release fails before any deployment if the Chef version cannot be verified. The `PRODUCTION_RELEASE_SUPABASE_ACCESS_TOKEN` needs `database_migrations_read` even when images are disabled; apply the additive migration through the separately authorized guarded database release before retrying.
4. Deploy `recipes` (`deploy-recipes`).
5. Skip `account-export` (`deploy-account-export`); its step is explicitly `if: false` pending BE-16 acceptance gates.
6. Deploy `extract-recipe` (`deploy-extract-recipe`).
7. Deploy `generate-recipe` (`deploy-generate-recipe`).
8. Deploy `recipe-image-attach` (`deploy-recipe-image-attach`).
9. Deploy `recipe-image-download-url` only when `VITE_RECIPE_IMAGES == 'true'`.
10. Deploy `recipe-image-upload-cleanup` only when `RECIPE_IMAGE_CLEANUP_ENABLED == 'true'`.
11. Deploy `recipe-image-final-cleanup` and verify its unauthenticated `401` and `{"error":"unauthorized"}` probe only when `RECIPE_IMAGE_FINAL_CLEANUP_ENABLED == 'true'`. Keep this independent opt-in off until the [activation steps](#enable-finalized-image-cleanup) are complete.
12. Deploy `recipe-image-upload-url` only when `VITE_RECIPE_IMAGES == 'true'`.
13. Deploy Cloudflare Workers assets.
14. Verify the production deployment URL.
15. Verify deployed AI routes (`ai-route-smoke`).
16. Run production runtime smoke (`runtime-smoke`); account-export preflight and unauthenticated access checks run only when its deploy step is enabled and succeeds. The current `if: false` means those export checks do not execute.
17. Record each deployment, URL verification, AI route smoke, and runtime smoke
    outcome independently, including failures or skipped downstream steps.
18. Preserve the separate runtime and AI route evidence artifacts.

Each Supabase deployment is a separate explicit target using the repository-pinned
CLI from `frontend`. The workflow maps `PRODUCTION_RELEASE_SUPABASE_ACCESS_TOKEN`
from `production-release` to the CLI's `SUPABASE_ACCESS_TOKEN` and passes
`--project-ref "$SUPABASE_PROJECT_REF"`,
`--no-verify-jwt`, `--use-api`, and `--yes`. There is no broad deploy-all command
or production database migration automation. Partial release is possible if a
later target fails after an earlier deployment succeeds. Any failed deployment
or route check fails the release; later normal steps do not run. The summary and
artifact steps retain their `always()` behavior without turning the release green.

`scripts/ai-route-smoke.mjs` pins its HTTPS origin to the production project in
`supabase/config.toml` and checks both `/functions/v1/extract-recipe` and
`/functions/v1/generate-recipe`. The required `AI_ROUTE_SMOKE_FRONTEND_URL` comes
from `PRODUCTION_FRONTEND_URL` and must be a bare HTTPS origin. OPTIONS simulates
the production browser preflight: it sends that Origin, requests POST and the
four shared request headers, and must return HTTP 204 with
an allowed origin of `*` or exactly the production frontend origin, exactly
POST/OPTIONS allowed methods, all four
shared allowed headers (`authorization`, `x-client-info`, `apikey`, `content-type`),
and `X-Content-Type-Options: nosniff`. POST sends the same production frontend
Origin without Authorization and must return HTTP 401 with JSON content type,
the application's exact `UNAUTHORIZED` response and
`Missing or invalid Authorization header.` message. Its allowed origin must also
be `*` or exactly the production frontend origin so the browser can observe the
401. Both requests send `Cache-Control: no-cache`; `null` and unrelated origins
fail either response check.
A missing-route 404, unexpected 2xx, gateway-shaped 401, malformed error body,
redirect, network error, or timeout fails verification. Each of the four probes
has a 10-second timeout; there are no retries or authenticated probes.

These probes send no Authorization, API key, cookies, or request payload. The
handlers answer OPTIONS and reject missing Authorization before enablement,
quota accounting, retrieval, and provider execution. Route smoke therefore does
not invoke Gemini or consume AI quota. It proves route availability and the
missing-auth contract, not successful extraction/generation, authenticated
authorization, quota/concurrency acceptance, or runtime source provenance.

AI route results are written to `ai-route-smoke.json` and preserved as
`production-ai-route-smoke-${{ github.run_id }}-${{ github.run_attempt }}`.
The existing `runtime-smoke.json` schema and
`production-runtime-smoke-${{ github.run_id }}-${{ github.run_attempt }}` artifact
remain unchanged. If a prior deployment fails, the summary records the skipped
smoke; no missing artifact is represented as a successful check.

### Production AI runtime configuration

Quick AI Entry and AI Chef are enabled on the production Supabase project as of
2026-11-15. The release workflow deploys both function bundles and leaves their
runtime settings in Supabase. A working route with an authenticated
`503 AI_DISABLED` response points to an unset opt-in or an active kill switch.

1. Confirm `PRODUCTION_FRONTEND_URL` and `VITE_SUPABASE_URL` identify the deployed
   site and the project in `supabase/config.toml`. Confirm `extract-recipe` and
   `generate-recipe` are active on that project, and check that `ALLOWED_ORIGIN`
   permits the frontend origin.
2. Verify the quota, bounded Chef retrieval, account rate-limit, and shared
   Gemini capacity migrations are applied. Confirm the
   backend has its Gemini key and Chef candidate token secret. Set the shared
   runtime environment for both AI endpoints to ten logical operations per account
   per UTC day. Production database migrations are operated separately.

   ```sh
   supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" AI_DAILY_LIMIT=10
   ```
   Set `AI_ACCOUNT_BURST_LIMIT=3` when individual account bursts contribute to
   upstream throttling. The original five-operation guard applies when this
   rolling override is unset.

   Enable shared Gemini quotas when project usage warrants enforcement. Confirm
   the deployed model and its active limits in AI Studio using the Google Cloud
   project that owns the provider key. Start with 80% of verified requests per
   minute and per day, rounded down. For a positive quota that rounds to zero,
   one request is the smallest usable ceiling. Deduct capacity needed by other
   callers using the same project and model. Configure the resulting integers
   through `AI_GEMINI_QUOTA_RPM` and `AI_GEMINI_QUOTA_RPD` and set
   `AI_GEMINI_QUOTA_PROJECT` to the project ID. Verify there is available
   capacity before enabling a ceiling. [Gemini active rate limits](https://aistudio.google.com/rate-limit)

3. Restore both opt-ins if they are missing. An active `AI_EXTRACT_DISABLED` or
   `AI_GENERATE_DISABLED` takes precedence. Use the kill switches for an
   intentional pause and inspect their operational status before restoring service.

   ```sh
   supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
     AI_EXTRACT_ENABLED=true AI_GENERATE_ENABLED=true
   ```

4. Sign in to the deployed frontend using a test account. Open **Talk to Mori**
   and choose **Help me organize my cooking notes**. Enter synthetic notes, select
   **Organize my notes**, and check that an unsaved preview has ingredients and
   steps. Then choose **Let's figure out what to cook!**, add pantry items, and
   select **Ask Mori for a recipe**. Check that the generated preview opens in
   the recipe editor. Stop at the previews for this smoke check.
5. Confirm the successful requests settled their quota reservations. If either
   preview fails, use the route's status, application error code, and
   `X-Request-Id` to distinguish enablement, quota, and provider failures.
   Record only those diagnostics and the outcome.

This authenticated check invokes Gemini for each flow and uses the test account's
quota. See the [2026-11-15 restoration evidence](../ai-evaluation-report.md#production-restoration-verification-2026-11-15).

### PR Staging Delivery (PR #81 / #76)

PR #81 introduces frontend staging delivery through `.github/workflows/modular-pr-validation.yml` and `.github/workflows/reusable-staging.yml`. This describes the configured PR path, not evidence that the remaining #76 verification work is complete.

PRs targeting `main` retain the three required Frontend / Database / Edge API
contexts. Staging requires all three to succeed, a non-draft PR from this
repository, an author other than `dependabot[bot]`, no cancellation, and no
verified docs-only staging skip. Author-association labels do not affect
eligibility. Dependabot PRs retain applicable Playwright E2E; a human rerun
does not change PR authorship. The modular PR workflow handles `opened`,
`synchronize`, `reopened`, and `ready_for_review` events.

PR Secretary reports an observed intentional caller skip as
`SKIPPED — EXPECTED`. On a historical run such as
[PR #241](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44680655236),
deploy remains `FAIL` and the observed dependent smoke skip from the same
attempt is `SKIPPED — DEPLOY FAILED`. The revised bot path needs a fresh
Dependabot PR event using the updated workflow, followed by inspection of
the core jobs, applicable E2E, skipped staging caller, and live Secretary
output. Rerunning the historical workflow uses its original revision.

The reusable workflow builds the frontend in the isolated GitHub `staging` environment and deploys to the Cloudflare Worker `moris-mix-ai-staging` with `wrangler deploy --config wrangler.jsonc --env staging`. The target is explicitly named in `wrangler.jsonc` under `env.staging.name`; the workflow also guards `STAGING_WORKER_NAME`. The workflow concurrency group `moris-mix-staging` serializes staging deployment and its dependent smoke job, with `cancel-in-progress: false`, so another run cannot replace the staging deployment while its smoke check is running.

Configure these Actions variables under **Settings → Environments → staging**:

| Variable | Expected configuration |
| :--- | :--- |
| `STAGING_WORKER_NAME` | `moris-mix-ai-staging` |
| `STAGING_FRONTEND_URL` | The staging Worker's HTTPS `workers.dev` URL |
| `STAGING_SUPABASE_PROJECT_REF` | `pjeykhjzqhryjwuoizgh` |
| `STAGING_DEMO_RECIPE_REVISION` | Full 40-character lowercase source SHA of the operator-deployed `demo-recipe` bundle |
| `VITE_SUPABASE_URL` | `https://<STAGING_SUPABASE_PROJECT_REF>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The staging project's public publishable key |

These staging environment values provide the public Supabase build configuration instead of production configuration. The workflow validates that the URL matches the staging project reference before building. Do not put privileged Supabase keys into frontend build variables.

Configure `STAGING_CLOUDFLARE_API_TOKEN` and `STAGING_CLOUDFLARE_ACCOUNT_ID` as secrets under **Settings → Environments → staging**, using the intended staging deployment credentials. The caller references these staging-specific names, and the reusable workflow requires both and validates nonblank values before building or deploying. Missing staging credentials fail closed. Keep production credentials in their dedicated environment and out of staging secret entries.

Cloudflare credentials are scoped to the configuration-validation step's environment and the deployment action's inputs; checkout, setup, dependency installation, and frontend build do not inherit them. The deploy job has a 10-minute timeout and the smoke job has a 5-minute timeout. The shared smoke script has a maximum request/retry budget of about 114 seconds across three checks, leaving time for checkout, setup, and artifact upload.

#### Staging authorization follow-up for DEVOPS-09

GitHub reported no protection rules or deployment branch policy on `staging`
on 2026-11-20. The effective boundary is repository write access and control
of a same-repository PR branch. Its test merge revision supplies the workflow,
build inputs, and Wrangler configuration before independent code review.
Step-scoped credentials, the Worker-name guard, and merge-time CODEOWNERS
review do not enforce deployment authorization against changes to that
revision. A YAML condition in the reviewed branch cannot establish an
independent approval boundary. GitHub listed the two Cloudflare staging
credential names at environment scope and neither at repository scope.
The current Cloudflare token's effective resource scope remains unverified.

Proposed configuration for operator review under
[#163](https://github.com/2ton-exe/moris-mix-ai/issues/163).

1. Configure **Settings → Environments → staging → Required reviewers**
   with an independent maintainer group, enable **Prevent self-review**, and
   disable administrator bypass. Use **Selected branches and tags** with a
   branch rule for `refs/pull/*/merge` if staging is to remain PR-triggered.
   Verify that rule against the test merge ref before rolling it out. Keep the
   Cloudflare credential entries exclusively in the protected environment.
   [GitHub environment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
2. In Cloudflare, verify the token policy and grant only **Editor** on the
   existing `moris-mix-ai-staging` Worker for an approved replacement if
   needed. Omit account-wide Workers access, production resources, and route
   or custom-domain write grants for the unchanged `workers.dev` path. Verify
   Wrangler compatibility with the scoped policy in non-production.
   [Cloudflare Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/)
3. Test the GitHub rule, independent approval, self-review denial, and
   allowed/denied refs in a disposable environment with dummy credentials.
   Check Cloudflare policy metadata without reading token values. If a live
   token test is approved, use pre-existing disposable Workers to verify
   allowed deployment and denied out-of-scope access without touching
   production. Confirm the eligible staging deployment and smoke sequence
   separately before calling the control verified.

This proposal would pause eligible team staging runs for review and add
reviewer handoff time. The three required PR checks and Playwright E2E would
continue independently. The Dependabot exclusion would still skip staging
before any review request. The proposed controls are pending approval.

After deployment, the workflow requires the official `cloudflare/wrangler-action@v4` `deployment-url` output to be non-empty and equal to `STAGING_FRONTEND_URL`, normalizing only one optional trailing slash on each. Missing or mismatched output fails the deployment job before smoke can run. The verified Wrangler URL is exposed as the deploy job's `deployment-url` output and passed directly to the smoke job; smoke does not independently read the configured URL. Both deployment and smoke evidence record this verified URL.

The shared `scripts/runtime-smoke.mjs` verifier requests `/home?revision=${GITHUB_SHA}`, resolves its built JavaScript asset against the document URL, and requests the isolated public `demo-recipe` endpoint. See the runtime smoke setup below for exact checks and backend prerequisites. All redirects are rejected before following them. Missing or invalid responses fail the smoke job.

Deployment and smoke summaries record **PR head** from `github.event.pull_request.head.sha` separately from **Tested merge revision** from `GITHUB_SHA`. On this PR path, checkout, build/deployment, and the smoke cache-busting revision use the tested merge revision; the source head is traceability evidence, not a claim that it was the exact deployed checkout.

`GITHUB_SHA` identifies the tested checkout/merge revision used by the workflow.
The `/home?revision=${GITHUB_SHA}` query parameter provides cache busting and
request differentiation; it is not proof that the deployed frontend serves that
exact revision. Checkout, build, and deployment use the tested workflow revision,
but the returned HTML and JavaScript do not independently expose a runtime-observed
build SHA. Successful frontend smoke verifies the deployed target's availability
and expected content, not independent runtime-observed frontend source provenance.
If exact runtime-observed provenance is required, a separate design could embed
a build revision, expose a build metadata endpoint, or verify an artifact
fingerprint/digest. None of those mechanisms is implemented by this PR.

Production deployment remains separate: the authoritative `.github/workflows/ci.yml` owns the existing main-only production path. Staging is not yet a required branch-protection check; the existing required validation checks remain unchanged. PR #88 successfully executed automated staging deployment and combined smoke for frontend HTML, its referenced JavaScript asset, public `demo-recipe`, and the API/database path. The staging backend source revision remains **operator-attested; not observed from runtime**. Controlled configuration-failure evidence was collected in temporary PR #119; hosted runtime-response failure was not separately exercised (see the evidence record below).

### Shared runtime smoke setup (#76 and #61)

The workflow changes below describe configured automation. The manual staging
bootstrap and verification record is separate, in the evidence section below.
At source revision `7af713040beb6dbaba271867f559149f9d21bce6`, the staging workflow
deployed only the frontend, and production CI deployed `recipes` plus Cloudflare.
Neither workflow deployed `demo-recipe`. The initial staging gateway response
`404 Requested function was not found` preceded the targeted operator deployment;
it differs from the handler's `404 DEMO_RECIPE_NOT_FOUND` for absent/unapproved data.

Reuse `supabase/functions/demo-recipe/index.ts`; no new endpoint, schema change,
or backend deployment on every PR is needed. The handler uses its server-side
service-role configuration to select only recipe
`11111111-1111-1111-1111-111111111111`, owner
`d0d8c0b2-3b1e-4c7b-9e2a-1a2b3c4d5e6f`, and `is_public = true`, returning only
approved fields. Smoke callers use only the environment's public key. No service
role key or Supabase management token is added to the smoke jobs.

Before enabling the new checks, the DevOps owner and backend owner must:

1. Select a reviewed, clean source revision for the function and its shared
   dependencies. Record `git rev-parse HEAD` and ensure the function dependency
   tree has no local edits. A backend source SHA can differ from the frontend SHA.
2. Verify the staging schema, runtime-role privileges, approved demo user, and
   fixed public demo row exist. The runtime `service_role` needs schema `USAGE`
   on `public` and `SELECT` on `public.recipes`; RLS bypass does not supply a
   missing table privilege. Verify both explicitly. The seed's first recipe is
   public; its second recipe is private. Coordinate any missing permission/data
   setup with the backend owner. Do not run `db reset`, blindly apply the entire
   seed, or copy production user data. `ON CONFLICT DO NOTHING` in `seed.sql`
   does not repair an existing incompatible demo row. The manual staging bootstrap
   described below satisfies these prerequisites for the observed check, but the
   workflows do not create or repair them.
3. Using the repository-pinned Supabase CLI from `frontend`, inspect `supabase
   --help`, `supabase functions --help`, and `supabase functions deploy --help`.
   After explicit operator authorization, deploy only the demo function to staging
   with an explicit project reference. From the repository root in Bash:

   ```bash
   repo_root="$PWD"
   cd frontend
   pnpm exec supabase --workdir "$repo_root" functions deploy demo-recipe \
     --project-ref pjeykhjzqhryjwuoizgh --no-verify-jwt --use-api --yes
   ```

   Authenticate with an authorized operator token outside logs. `--project-ref`
   is essential because `supabase/config.toml` identifies production. Disabling
   gateway JWT verification matches the existing public function configuration.
   Confirm the hosted runtime provides its own `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`; do not override these with production values or
   copy the service-role key into GitHub. See the official
   [function deployment guide](https://supabase.com/docs/guides/functions/deploy)
   and [CLI reference](https://supabase.com/docs/reference/cli/supabase-functions-deploy).
4. Save the source SHA, provider function version/deployment ID, target project,
   timestamp, and operator deployment result in the release record. Set staging
   environment variable `STAGING_DEMO_RECIPE_REVISION` to that full source SHA
   only after the targeted deployment succeeds. Update it on each backend release.
   Keep operator backend changes serialized with staging verification, since
   GitHub concurrency cannot lock external operator changes.
5. For production, identify the existing deployed demo function's reviewed source
   SHA and provider version in its release history. Configure repository variables
   `PRODUCTION_DEMO_RECIPE_REVISION` and `PRODUCTION_FRONTEND_URL` (the exact
   Wrangler-reported production origin, currently documented as
   `https://moris-mix-ai.diofelgwenharesco.workers.dev`). If the source cannot be
   established, arrange a separately authorized targeted demo function release;
   do not invent an attestation or assume the frontend SHA is its backend SHA.

The new variables are non-secret configuration. Existing staging variables and
Cloudflare staging secrets above remain required and must be environment-scoped.
Production uses repository variables `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`),
and `SUPABASE_PROJECT_REF`, alongside the
[dedicated release secrets](#8-deployment-credentials). The verifier pins
staging to `pjeykhjzqhryjwuoizgh` and production to `config.toml`'s project,
`gtbwblxskctpsqhbpebg`. Missing revision/origin configuration fails preflight
before deployment; there is no production fallback for staging.

The verifier requires HTTP 200 and the expected MIME type for each check:

- `/home` must contain HTML, the React root, and a built `assets/*.js` script.
- That referenced script must stay on the frontend origin and return nonempty
  JavaScript, rejecting HTML fallbacks even when labeled as JavaScript.
- `GET /functions/v1/demo-recipe` must return the exact approved public fixture
  envelope and content, including recipe identity, ingredients, instructions,
  scores, and rating. Ingredients may include optional `quantityText` strings as
  allowed by the [API contract](../api/demo-recipe.md); their fixed fields must
  still match exactly. `cooked_at` may differ because the seed uses a relative
  date; it must be null or a valid calendar date. Other extra/private fields fail.

Each request gets three attempts, a ten-second timeout covering fetch and body
read, and four-second sleeps between attempts (about 38 seconds per check).
Every redirect, including same-origin redirects, is rejected. Credentials are
sent only to the configured Supabase origin. Requests use `Cache-Control:
no-cache` and revision query parameters on HTML/API; the API also has a unique
run timestamp to reduce cached-response reuse. The existing function's cache
policy is unchanged, so this is an API/database-backed public read, not a direct
uncached database query or a browser end-to-end journey.

Smoke writes `runtime-smoke.json` and a step summary even when checks fail,
including UTC times, environment, tested checkout SHA, PR head SHA (staging),
verified origins, backend source attestation, per-check outcomes/attempts, and
overall smoke outcome. Failure entries expose safe status/validation diagnostics,
never response bodies or key values. Artifacts are uploaded with `if: always()`;
checkout/setup failure or cancellation before the verifier executes may leave
no JSON. Separate always-run workflow summaries record deployment-command and URL
verification results. An upload or summary step does not mask a smoke failure.

The backend SHA is explicitly **operator-attested; not observed from runtime**.
Even a valid Git SHA in `STAGING_DEMO_RECIPE_REVISION` does not prove that the
running `demo-recipe` function exposes or was independently observed at that
source revision. Successful API/database smoke proves expected endpoint behavior,
not exact backend deployment provenance. Runtime-observed backend provenance
remains separate future work if exact provenance is required.
Provider deployment/version evidence must remain in the release record. These
checks do not establish that backend code matches the PR merge SHA, prove all
backend functions, or cryptographically identify served frontend bytes. The
frontend SHA records the checked-out build/deployment input; the smoke verifies
the deployed origin and referenced bundle. Production smoke stays inside the
`cloudflare-production` deployment lock and runs after all four active Supabase
function deployments, the Cloudflare deployment, URL verification, and AI route
smoke succeed. The account-export deployment step is explicitly disabled.
Image upload/download and cleanup deployments remain conditional on their
repository variables; a skipped conditional step is not deployment evidence.
Staging keeps the existing workflow-wide lock and trust gate.

### Manual staging backend evidence (2026-10-28)

Target: `pjeykhjzqhryjwuoizgh`. Attested deployed function source:
`7af713040beb6dbaba271867f559149f9d21bce6`. The targeted CLI deployment of only
`demo-recipe` executed successfully. No backend deployment on every PR was added.

The initial direct request around `2026-10-28T09:13:43Z` returned HTTP 500 with
the safe `INTERNAL_ERROR` envelope. Subsequent log, privilege, corrective-action,
and final-response evidence below was supplied by the staging operator; it was
not produced by the new GitHub smoke job.

| Stage | Observed evidence | Meaning |
| --- | --- | --- |
| Initial runtime failure | Function log: `Database query failed code: 42501`; `service_role` had schema `USAGE` but no `SELECT` on `public.recipes` | The HTTP 500 was caused by insufficient database table privileges |
| Manual staging permission correction | Operator applied `grant select on table public.recipes to service_role;`; the endpoint then returned HTTP 404 | The permission failure was resolved; the approved fixture was still unavailable |
| Manual staging fixture bootstrap | The approved demo user and fixed public recipe were absent; the operator added exactly those records from current `supabase/seed.sql` | Staging received the approved fixture only, through a separate manual operation |
| Final direct runtime check | `GET https://pjeykhjzqhryjwuoizgh.supabase.co/functions/v1/demo-recipe` returned HTTP 200 with recipe ID `11111111-1111-1111-1111-111111111111` and title `Classic Tomato Scraps Pasta` | The staging Edge Function to PostgreSQL path was manually verified |

The progression was **500 / 42501 -> 404 missing fixture -> 200 expected demo
response**. Do not attribute the initial 500 solely to missing seed data: the
missing table grant blocked the query before the handler could report the absent
fixture. The function code/source attestation did not change during these manual
database corrections.

Evidence status:

- Function deployment: executed successfully.
- Database permission correction: manually applied to staging.
- Approved demo user/recipe bootstrap: manually applied to staging.
- API/database runtime path: manually verified.
- Automated GitHub staging deployment and combined HTML/JavaScript/public demo API/database smoke: **executed and passed on PR #88**, separately from the manual checks above.
- Production smoke: **executed and passed on merged main in CI #290**, separately from these earlier staging checks; see the merged-main evidence below.
- Controlled automated staging configuration-failure evidence: **completed in temporary PR #119**; hosted runtime-response failure was not separately exercised.

These manual corrections are not automated by this DevOps change. Durable table
permission and approved seed/bootstrap ownership remains a backend/source-of-truth
follow-up: the backend owner must decide how reviewed database setup preserves the
grant and fixture across new environments or rebuilds. DevOps coordinates that
handoff and records environment evidence. No grant migration, data migration,
automatic seed, broad privilege expansion, or production database change is added
here. Any further staging correction requires separate operator authorization.
Do not use the manual HTTP 200 as proof that the automated verifier's full fixture
validation, frontend checks, GitHub failure behavior, or artifacts have executed.

### Smoke failure handling and remaining runtime evidence

Inspect deployment-command results first. If deployment failed, runtime smoke
is skipped; do not describe the release as verified. If deployment succeeded and
smoke failed, the release may already be live. Use the JSON check outcomes and
provider logs to distinguish:

- Gateway function-not-found: verify project/slug and the operator demo deployment.
- Handler `DEMO_RECIPE_NOT_FOUND`: backend owner checks the fixed ID, owner, and
  public flag. Never relax the filter to make smoke green.
- API 500 with `Database query failed code: 42501`: inspect runtime-role schema
  and table privileges. Coordinate a narrowly scoped correction with the backend
  owner; do not automatically grant access or broaden public/client permissions.
- Other API 500 or response validation failure: inspect server configuration,
  schema, seed values, and function logs without publishing details or secrets.
- HTML/asset MIME, origin, or redirect failure: inspect Wrangler's URL output,
  deployed asset references, SPA routing, and unexpected redirects.
- Missing backend revision/configuration: fix the appropriate environment or
  repository variable from actual release evidence before retrying.

No automated rollback is introduced. Recover through a reviewed fix or the
existing separately authorized provider rollback/redeployment process; preserve
the failed run and do not hide it with `continue-on-error`. Re-running the entire
workflow can redeploy, so inspect the failing step before retrying.

### PR #88 validation and controlled configuration-failure evidence

The historical pre-merge implementation head verified during the earlier documentation cleanup was
`011653a0a2f1ee81192eab5e3c034250cf9a7e3c`, containing Belen's review fix:
`fix(devops): accept optional ingredient quantityText strings in runtime smoke validation`.
That fix accepts the API contract's optional string `quantityText` while preserving
strict fixed-field validation; this documentation cleanup does not modify it or
supply human approval evidence. At that pre-merge point, final human re-review remained separate.

At that head, **CI #259** passed Frontend Checks (including PR Secretary regression
tests and offline runtime-smoke verifier tests), Database Tests, Edge/API Tests,
Hosted RLS Integration, and Playwright E2E. Production deployment was correctly
skipped on the PR. **Modular PR Validation #106** passed Modular Frontend,
Modular Database, Modular Edge/API, Modular E2E, Staging Deploy, staging deployment
URL verification, and Staging Smoke. Frontend HTML, the referenced JavaScript
asset, and the public demo API/database path all passed. These are staging and PR
validation results, not production runtime smoke evidence.

Temporary PR **#119**, branch `experiment/76-staging-smoke-failure`, head
`6e8025d40961f964b29e4ea8db5fc797fc5a5faf`, intentionally changed only the staging
smoke `SMOKE_SUPABASE_URL` to `https://example.invalid`; staging build/deployment
configuration remained unchanged. **CI #257** passed normal PR validation and
kept production deployment skipped. In **Modular PR Validation #104**, normal
validation, Staging Deploy, and staging deployment URL verification succeeded.
Staging Smoke ran and failed with `Supabase origin/project mismatch`. Frontend
HTML, JavaScript asset, and demo API/database runtime checks were not run, so
overall staging validation did not succeed. PR #119 was then closed unmerged.

This completed **configuration-validation failure path** proves a staging smoke
failure is visible, the smoke job fails rather than hiding the failure, and
overall staging validation is unsuccessful while production remains unaffected.
The failure occurred before requests were attempted against the deliberately
invalid Supabase origin. It was not a hosted runtime-response failure experiment:
an unavailable deployed frontend, a missing JavaScript asset, and a deployed
API/database response mismatch were not separately exercised in hosted execution.
Ramos's Finding 1 is technically valid and remains a known evidence limitation;
this experiment does not exercise every runtime smoke failure mode.

Controlled configuration-failure evidence has been collected successfully.
At that historical pre-merge checkpoint, issue #76 still awaited PR #88 review,
merge, and merged-main verification. PR #88 has since merged as
`4cfaf2d5c70634e5c849f34c51668dd1432d8b63`; CI #290 and Modular Main Validation #18
passed on that release. Record actual composed check names before considering
any required-check change.

CodeRabbit's review of that implementation head reported no actionable current-head comments,
minimal merge risk, low security architecture risk, and no established
architecture-level vulnerability. Its earlier workflow-level `permissions: { contents: read }`
recommendation for `ci.yml` is optional least-privilege hardening,
not a regression: the condition predates PR #88 and smoke requires no broader
token permissions. Workflow-wide permissions affect authoritative CI and remain
in the separate security-hardening workstream. The generated AI-agent prompt is
an execution wrapper for that same recommendation, not another finding, and is
not executed here. Generic Generate docstrings, Generate unit tests, and Autofix
features are not independent blockers; existing tests include the `quantityText`
regression. No workflow or unrelated code/test changes are included.

### Merged-main production deployment and runtime evidence (2026-10-30)

PR #88 merged as `4cfaf2d5c70634e5c849f34c51668dd1432d8b63`.
[CI #290](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41007655750)
passed Frontend Checks, Database Tests, Edge/API Tests, Hosted RLS Integration,
Playwright E2E, and Deploy to Supabase and Cloudflare. Modular Main Validation
#18 also passed. The production job successfully completed configuration
validation, frontend dependency installation/build, `recipes` Edge Function
deployment, Cloudflare Workers deployment, production deployment URL verification,
**Production runtime smoke**, deployment/runtime outcome recording, and runtime
evidence preservation.

The retained artifact is `production-runtime-smoke-41007655750-1`, ID
[`12955704435`](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41007655750/artifacts/12955704435).
This is successful automated post-deployment production runtime-smoke evidence
for the merged #88 release: production frontend HTML, its referenced JavaScript
asset, and the approved public `demo-recipe` API/database-backed response passed.
The earlier pending merged-main deployment/runtime evidence for #61 is now recorded;
this does not assert issue closure or full authenticated recipe CRUD verification.
The backend source revision remains **operator-attested; not observed from runtime**,
and successful Gemini generation is not established. This run is deployment/runtime
evidence, not another optimization sample or a merge-to-live measurement. The
#73 ownership evidence has since advanced; see the proposal above for cutover and rollback results.

## 4. Repository Structure

The relevant DevOps files are organized as follows:

- `.github/workflows/modular-main.yml` - Main validation, same-run image readiness, and sole production caller
- `.github/workflows/reusable-production.yml` - Guarded Supabase/Cloudflare deployment and runtime evidence, including the disabled account-export target and recipe-image-attach
- `.github/workflows/recipe-image-upload-cleanup.yml` - Main-only cleanup invocation behind an unattended opt-in gate
- `.github/workflows/modular-pr-validation.yml` — Modular PR validation and trusted PR staging gate introduced by PR #81
- `.github/workflows/reusable-staging.yml` — Serialized staging frontend deployment, smoke, and revision summaries
- `wrangler.jsonc` — Cloudflare Worker configuration
- `docs/devops/pipeline-metrics.md` — Pipeline measurements and results
- `docs/devops/deployment-runbook.md` — Deployment and recovery documentation

The frontend application is stored under `frontend/`.

The frontend production build output is generated at `frontend/dist/`.

## 5. Continuous Integration

Baseline workflow configuration was checked 2026-11-15 at main SHA
`0dd27d0fbba8f5cca5a7153229bda68b985be78c`. The modular PR workflow validates PRs
targeting main with a complete-diff classifier. Its three required core contexts
remain present on every PR; verified prose-only diffs use lightweight core paths
and skip E2E/staging, while other diffs use full validation. Full-path E2E runs
the reusable local-Supabase suite in Chromium, Firefox and WebKit. Staging runs
only after core success for a non-draft PR from this repository. PRs cannot call
production.

The modular main workflow runs on main pushes and manual dispatches. Its
production caller waits for successful frontend/database/aggregate Edge/API
validation, mandatory Hosted RLS nested in Edge/API, and frontend existence. When
both image and cleanup flags are enabled, it also requires same-run read-only
upload-signing readiness from the `main`-restricted image environment before
production continues. Main E2E is a separate job and is not in production's
`needs` list. The active
`Protect main` ruleset, checked 2026-11-15, requires the three modular core
contexts, one approving review and resolved review conversations; E2E is not a
required PR context.

Its frontend validation stages are:

1. Check out repository source code.
2. Detect whether `frontend/package.json` exists.
3. Set up pnpm and Node.js.
4. Install dependencies using `pnpm install --frozen-lockfile`.
5. Run `pnpm lint`.
6. Run `pnpm test`.
7. Run `pnpm build`.

In parallel, `Database Tests` validates migrations, migration lifecycle behavior, and RLS against a PostgreSQL service container. `Edge/API Tests` type-checks and tests recipe CRUD, demo, and AI schemas and handlers; when configured, it also applies pending migrations to and runs RLS integration tests against a dedicated hosted non-production database. These validation jobs do not deploy production functions or change the production database.

**Required PR status checks (live ruleset checked 2026-11-15):** `Modular Frontend / Frontend Checks`, `Modular Database / Database Tests`, and `Modular Edge/API / Edge/API Tests`. The active ruleset also requires one approving review and resolved review conversations. E2E and Hosted RLS are not additional required PR contexts; Hosted RLS is a production dependency on main. This documentation task changes no ruleset.

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

The active `Protect main` ruleset was checked on 2026-11-15. It requires:

- Changes to be submitted through pull requests.
- One approving review, with code-owner review enabled.
- `Modular Frontend / Frontend Checks`.
- `Modular Database / Database Tests`.
- `Modular Edge/API / Edge/API Tests`.
- Resolved review conversations.
- No force pushes or branch deletion.

The former six-context overlap is historical; the three modular contexts replaced the legacy requirements after the handoff. Playwright E2E and Hosted RLS are not additional required PR contexts. Hosted RLS remains part of main's production dependency through the aggregate Edge/API reusable workflow.

The ruleset was previously observed blocking a pull request that passed CI but had not yet received the required approval. At `main` SHA `0dd27d0fbba8f5cca5a7153229bda68b985be78c`, the configured production job requires `frontend`, `test-db`, and `test-edge-api` to succeed and `frontend/package.json` to exist; the aggregate Edge/API reusable workflow includes mandatory Hosted RLS on main. Main E2E is a separate job outside the production `needs` list.

Development should take place on feature branches. Approved changes are merged into `main` through GitHub's pull request interface.

Under the previous standalone deployment workflow, a manual run from a feature branch was tested and the production job was skipped. After PR #31 consolidation, the unified workflow has a configured main-only condition, but its feature-branch manual-dispatch guard has not been separately re-tested.

## 7. Production Hosting Configuration

**Cloudflare Worker:** `moris-mix-ai`

**Production URL:** [Mori's Mix — Production](https://moris-mix-ai.diofelgwenharesco.workers.dev)

Cloudflare Workers hosts the frontend through Static Assets. Wrangler reads the repository's `wrangler.jsonc` configuration and publishes the generated files from `frontend/dist/`.

The configuration supports single-page application routing.

### Current Production State

The React/Vite frontend is deployed through GitHub Actions to Cloudflare Workers and is accessible at the production URL.

The production root route was verified to serve the Mori's Mix React application.

The `/app` client-side route was also verified to load successfully during the historical FE-01 verification. After run #48, the production URL was manually opened again and the React frontend loaded successfully. On 2026-10-17, the production UI loaded the demo recipe through the Supabase Edge Function, and a direct endpoint request returned the seeded PostgreSQL row with `200 OK`. Full response and qualification notes are in the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).

The smoke check verifies the runtime schema and demo-row state required by the `is_public` migration. A read-only query of the production migration ledger confirmed version `20261017000001` is applied; the query and result are in the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17). A historical Gemini generation attempt returned `403 PERMISSION_DENIED`. On 2026-11-14 the dedicated Gemini project was re-verified locally: the API is enabled, the pinned `gemini-3.5-flash-lite` model is available, and the live extraction suite passed 3/3 with the legacy SDK (see the [AI evaluation report](../ai-evaluation-report.md#dedicated-gemini-project-re-verification-2026-11-14)). Production extraction and Chef generation succeeded in a cost-guarded window on 2026-11-15, and the enable flags were removed afterwards. The flags were later restored and both flows verified in the deployed frontend. See the [production restoration evidence](../ai-evaluation-report.md#production-restoration-verification-2026-11-15).

## 8. Deployment Credentials

In **Repository → Settings → Environments → production-release → Environment secrets**,
configure the following required inputs for the main-only release job:

| Secret | Purpose |
| --- | --- |
| `PRODUCTION_RELEASE_CLOUDFLARE_API_TOKEN` | Account-owned token with Individual Workers Editor access to `moris-mix-ai` |
| `PRODUCTION_RELEASE_CLOUDFLARE_ACCOUNT_ID` | Identifies the account that owns the production Worker |
| `PRODUCTION_RELEASE_SUPABASE_ACCESS_TOKEN` | Authorizes production Edge Function deployment and conditional migration-history reads |

The `SUPABASE_PROJECT_REF` repository variable identifies the Supabase target and must match `project_id` in `supabase/config.toml`. CI also checks that `VITE_SUPABASE_URL` targets the same project before deploying.

Use the environment secret location above. The dedicated names should have no
repository or organization fallback. See the [backup runbook](database-backup-restore.md#credentials-and-configuration)
for the separate `production-backup` inputs.

Secret values must never be committed to Git, included in pull request descriptions, printed in CI logs, or shared in screenshots.

## 9. Automated Deployment Procedure

Configuration inspected 2026-11-15 at `main` SHA
`0dd27d0fbba8f5cca5a7153229bda68b985be78c`: `production` in
`.github/workflows/modular-main.yml` calls the `deploy` job in
`reusable-production.yml`. Main push or permitted manual dispatch requires
`needs: [frontend, test-db, test-edge-api]` and this caller condition:

```text
success() && needs.frontend.outputs.exists == 'true' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
```

Hosted RLS is mandatory within Edge/API. Failed, cancelled or skipped gating
validation blocks production. `modular-main.yml` gates successful frontend,
database and Edge/API validation and frontend existence before calling production.
The callee independently checks the exact modular-main caller identity,
`refs/heads/main`, push/workflow_dispatch event and supplied frontend-existence
input; it does not independently re-evaluate upstream validation results. PRs have no
production caller. Earlier run #90 and PR #68 remain historical gate evidence;
operator-confirmed cutover/rollback evidence and post-merge obligations are above.

The workflow currently has no push path filter: docs-only main pushes can also proceed through deployment. Evaluating trigger scope is possible future efficiency work, not a correctness failure or a proven optimization opportunity.

### Deployment Steps

Before merge, complete the DEVOPS-10 AI-disabled operator verification above.
Reviewed changes merged into `main` trigger Modular Main Validation; permitted
manual dispatch on `main` follows the same production path:

1. Run required frontend, database, Edge/API, and mandatory Hosted RLS validation. Confirm every `production.needs` job succeeded and frontend existence is true. Playwright E2E runs separately and is not in the production dependency list or the required PR contexts.
2. Check all three `production-release` secrets for nonblank values before checkout. Validate the Supabase project reference and production deployment configuration.
3. Install frontend dependencies and build the frontend. After the stale-main check, the read-only Cloudflare preflight confirms that the account-owned token is active and that the enabled `moris-mix-ai` Worker exposes the bare HTTPS origin configured in `PRODUCTION_FRONTEND_URL`. Authentication, metadata, or URL failure stops the job before any Supabase or Cloudflare write. When enabled, the recipe image prerequisite check also runs before deployment.
4. Deploy the explicit `recipes` Edge Function target.
5. Skip the explicit `account-export` target; its workflow step is `if: false` pending BE-16 acceptance gates.
6. Deploy the explicit `extract-recipe` Edge Function target.
7. Deploy the explicit `generate-recipe` Edge Function target. Before the first deployment, the unconditional Chef ledger check must verify migration `20261127113008`; a missing version or unavailable ledger blocks the release. Use the separate guarded database release to apply the additive migration before retrying.
8. Deploy the explicit `recipe-image-attach` Edge Function target.
9. Deploy `recipe-image-download-url` only when `VITE_RECIPE_IMAGES == 'true'`.
10. Deploy `recipe-image-upload-cleanup` only when `RECIPE_IMAGE_CLEANUP_ENABLED == 'true'`.
11. Deploy `recipe-image-final-cleanup` and verify its unauthenticated `401` and `{"error":"unauthorized"}` probe only when `RECIPE_IMAGE_FINAL_CLEANUP_ENABLED == 'true'`. Keep this independent opt-in off until the [activation steps](#enable-finalized-image-cleanup) are complete.
12. Deploy `recipe-image-upload-url` only when `VITE_RECIPE_IMAGES == 'true'`. The four unconditional targets and these conditional targets use the Supabase CLI and explicit project reference; handlers enforce authentication.
13. Deploy to Cloudflare only after all active or enabled conditional function deployments succeed.
14. Verify the production deployment URL against `PRODUCTION_FRONTEND_URL`.
15. Verify both AI routes using production-frontend browser preflight CORS and unauthenticated, payload-free 401 probes. Both response types must permit the production frontend; no provider execution or quota behavior is tested.
16. Run production runtime smoke. It verifies the public demo response and checks account-export's preflight and unauthenticated 401 contract only if its deployment step is enabled and succeeds; its current `if: false` means those export checks are skipped. Smoke does not verify authenticated recipe CRUD or export ownership.
17. Inspect the production summary's separate outcomes for recipes, account-export, each image function, extract-recipe, generate-recipe, Cloudflare, URL verification, AI route smoke, and runtime smoke. A failed deployment or smoke fails delivery; it does not roll back earlier deployments.
18. Retain both JSON evidence artifacts and the summary: `production-ai-route-smoke-<run>-<attempt>` and `production-runtime-smoke-<run>-<attempt>`. A skipped or missing smoke artifact is not evidence of a passed execution.

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

The inert downstream job declared `needs: [frontend, test-db, test-edge-api]`, matching the historical production deploy gate's three-dependency structure in effect when PR #68 ran. The current modular production caller has three direct dependencies: `frontend`, `test-db`, and `test-edge-api`. Mandatory Hosted RLS is enforced inside the aggregate Edge/API workflow on main; a failed Hosted RLS integration fails the aggregate `test-edge-api` result and blocks production. This controlled non-production equivalent dependency-gate experiment verifies GitHub Actions failure propagation: when one required dependency fails and `always()` is not used, the downstream deployment-shaped job is skipped. It used no production credentials, repository secrets, Cloudflare/Supabase deployment commands, or application deployment. Production main was not intentionally failed, and no failed production deployment occurred in this experiment.

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

### Production Cloudflare Preflight or Wrangler Failure

- Start with `Verify production Cloudflare Worker URL`. For preflight failures,
  check the two Cloudflare secret names under `production-release`, token status,
  Worker-scoped access, the enabled Worker URL, and `PRODUCTION_FRONTEND_URL`.
  Keep credential values and authenticated response bodies out of diagnostics.
- If preflight succeeded and Wrangler failed, inspect the individual deploy
  outcomes and provider state. Earlier Supabase writes may already have succeeded.
- Verify that the frontend build generated `frontend/dist/`.
- Confirm the Worker name and asset directory match `wrangler.jsonc`.
- Check the dedicated Cloudflare inputs listed in [Deployment Credentials](#8-deployment-credentials).
- Verify that the token still has the required deployment permissions.
- Confirm the deployment originated from `main`.

### GitHub Actions Is Green but the Website Has Not Changed

- Confirm `Modular Main Production / Deploy to Supabase and Cloudflare` actually executed rather than being skipped.
- Confirm `frontend/package.json` exists on `main`.
- Confirm `Modular Main Validation` ran for the expected `main` commit, `frontend`, `test-db`, and `test-edge-api` succeeded, the main Edge/API path executed its mandatory Hosted RLS integration successfully, and the frontend-existence output was true.
- Inspect the Wrangler deployment output.
- Inspect the latest Cloudflare Worker deployment.
- Check the production URL independently.
- Compare the production application with the expected merged change.

A green workflow alone is not sufficient evidence of successful deployment.

## 12. Application recovery and rollback

**Status (2026-11-27 PHT):** The application-only rollback rehearsal restored the sample recipe CTA through reviewed Git revert and automated production redeployment. The standalone rollback SHA was safely rejected as stale after an overlapping merge; its inverse reached production in the next successful release. Teammate runbook walkthrough remains unverified. [Issue #165](https://github.com/2ton-exe/moris-mix-ai/issues/165) retains the execution evidence.

### Executed rehearsal — 2026-11-27 PHT

- Previously verified target: `d329285ce0be5e955ee6ac76751cf97f6e58f799` ([production run](https://github.com/2ton-exe/moris-mix-ai/actions/runs/45998866382)). Forward demonstration #307 deployed `87e320a2e09888c1d1312796fa1534d30eaa7799` ([production run](https://github.com/2ton-exe/moris-mix-ai/actions/runs/46017219840)); CTA changed from `Start a private journal` to `Create your recipe journal` without changing `/signup`. This reused the completed deployment demonstration instead of #296 (closed unmerged).
- #309 reversed exactly the three frontend implementation/test files. Both Belen and Ramos approved `feb33bccaf2fda60aa9112732978046aed5f3370`; [PR run](https://github.com/2ton-exe/moris-mix-ai/actions/runs/46020643414) passed the required checks, nine browser shards, staging deployment and staging smoke. Hosted RLS was skipped on PR. Squash merged at 23:06:41 PHT to `02a6c67d4c8ffc553d12f5464bf7785a50b188eb`, with the identical Git tree of the previous release.
- [Standalone main run](https://github.com/2ton-exe/moris-mix-ai/actions/runs/46021942517) failed at the stale-revision guard before any provider deployment or production smoke because #308 advanced main immediately after #309. Do not retry the obsolete SHA. See the incident log for the release-coordination gap.
- The descendant `66ccff12a63f9640303475b4877bc51acd9dee67` retained the inverse plus #308's unrelated AI revision changes. [Main run 46021982543](https://github.com/2ton-exe/moris-mix-ai/actions/runs/46021982543) passed all validation, hosted RLS, nine browser shards, credential/URL preflight, release prerequisites, seven intended Edge deployments, Cloudflare deployment, deployed AI routes and production runtime smoke. Conditional account export/final image cleanup were skipped. Worker version `4406aef4-4424-49d9-b46f-22c7ac21991a` was reported by the deployment log. Smoke completed at 23:13:52 PHT; elapsed rollback merge to successful smoke: 7m 11s (not outage recovery time). Full workflow passed at 23:16:23 PHT.
- The operator confirmed the live sample recipe page restored `Start a private journal` and indicated retaining the original label; no screenshot, exact browser observation time or separate Belen final-state message was inspected here. Source retains `/signup`; live link verification is not separately recorded. No second restoring release is planned on this interpretation. No schema reversal or database data restore was attempted. This demonstrates source-controlled recovery of the scoped CTA, not a byte-identical provider redeployment of the old SHA, instant provider rollback, or full backend recovery.
- Remaining: teammate walkthrough and explicit release-owner final-state record if not covered by operator confirmation. Do not manufacture evidence or classify the harmless marker as an outage.

### Establish the recovery boundary

1. **Identify the incident and impact.** Record the current `main` SHA, most recent verified production revision, affected GitHub Actions run, observed user impact and relevant provider logs. Distinguish failed/partial deployments, successful deploy commands, successful runtime smoke, and separately verified application behavior.
2. **Classify the failure before changing production.** Application code/assets, deployment configuration, an external AI/provider outage, an optional feature flag, and database schema/data changes need different responses. A Gemini outage is not automatically a reason to roll back the app. Preserve any active failed deployment evidence; do not blindly rerun stale workflows.
3. **Confirm the production state and stop incompatible overlapping actions.** Check currently queued releases, database backups, proposed migrations and feature-flag changes. The `cloudflare-production` lock serializes repository-managed releases and backups, but not every out-of-band provider change. Do not bypass locks or the stale-revision guard.
4. **Get the owners' decisions.** Belen/the release owner identifies the intended running release, a known-good candidate and desired final state, with exact commit/tag identifiers. Ramos/the database owner checks schema/data compatibility, migrations and whether application-only rollback is safe. Record owner agreement and drill approval before production actions.
5. **Keep database recovery separate.** A Git revert, Cloudflare frontend rollback or Supabase Edge Function redeployment does **not** reverse migrations, restore row data or prove database recovery. Isolated restoration remains unsuccessful under [#159](https://github.com/2ton-exe/moris-mix-ai/issues/159); production migration readiness is separately tracked under [#155](https://github.com/2ton-exe/moris-mix-ai/issues/155), and [PR #154](https://github.com/2ton-exe/moris-mix-ai/pull/154) was still open during this documentation audit. Never treat a backup checksum as restore proof.

### Preferred reviewed application recovery path

1. From **current** `main`, prepare a small corrective or `git revert` PR that restores the agreed behavior without altering production data. Specify exactly which application changes the revert includes. A revert makes a **new** commit: other intervening changes can prevent byte-identical reconstruction of a former release.
2. Validate the change through the normal PR process. Obtain independent human approval, all required Frontend/Database/Edge API contexts, and resolve review threads. Inspect relevant browser E2E and staging evidence separately. On `main`, E2E does **not** block production, so a release can succeed while a browser job has not passed. Staging authorization remains under #163 review; do not assume staging deployment waits for human approval.
3. Merge only the approved change, then identify its **new main SHA** and matching `Modular Main Validation` run. Never dispatch an older SHA as a "rollback": the current production workflow rejects stale source revisions.
4. Verify the actual job/step outcomes: frontend and database, Edge/API plus Hosted RLS, applicable image readiness, Supabase Function deployments, Cloudflare Worker deployment, URL and provider-free AI-route checks, and production runtime smoke. Retain run URLs and evidence artifacts. A job that is skipped or pending has not passed.
5. Independently verify the affected user-visible behavior at the deployed URL using non-sensitive, owner-approved test data. Public frontend/demo smoke and unauthenticated AI-route checks alone do not prove recovery of authenticated CRUD, Chef, image or extraction features.
6. Preserve the observed start/end timestamps, run/attempt outcomes, reviewer actions, required user actions and any actual incident details. Do not equate workflow duration or merge-to-smoke time with measured outage recovery time without defined endpoints.

### Controlled DEVOPS-12 rehearsal and return to intended state

**Prerequisites (manual coordination):** Belen designates the release/rollback revisions; Ramos confirms database compatibility and that no migration or data restoration is needed; a teammate reviewer and an explicit production-drill approval exist. Choose a reversible, non-destructive application-only change and a quiet release window. Validate the intended staging test approach without assuming its environment restrictions have already been proven.

- **Phase A — Before state:** Record production URL, exact main source SHA, current deployment run, smoke evidence, relevant feature behavior and the intended final release. Do not call the latest green commit a "known-good rollback target" without release-owner agreement.
- **Phase B — Controlled change:** Deliver a harmless application change through a reviewed PR and the regular main release path. Observe the changed behavior and deployment record. This is a rehearsal, not an incident or an invitation to break production deliberately.
- **Phase C — Recovery:** Use a new reviewed corrective/revert PR to recover the agreed previous behavior. Verify its main validation, production deployment, smoke and the relevant affected behavior. This tests source-controlled application recovery; it does not test PostgreSQL restore or Cloudflare historical deployment-history rollback.
- **Phase D — Final state:** If the rehearsal recovery result differs from the intended current release, deliver the release-owner-approved final source via the reviewed path and perform the same verification again. Production must finish in its agreed state, with separate before/recovered/final evidence.
- **Phase E — Teammate followability:** Have a teammate follow the documented process or safe preflight/rehearsal steps, record which steps were actually performed, and identify any undocumented assumptions. A read-only walkthrough is useful feedback but is **not** proof that a teammate performed the live recovery.

Do not perform any production drill based solely on this written plan. Follow issue #165's explicit authorization and owner-coordination requirements first.

### Alternative provider rollback

A failed Cloudflare preflight occurs before provider mutations, so that attempt
requires no provider rollback. Correct the credential or origin configuration
before an authorized rerun on current main. If a later step failed, establish
which writes actually succeeded before choosing a recovery action. A corrective
main release uses the same protected credentials and preflight.

Cloudflare deployment history may offer a frontend rollback, but it is **not** the default proven recovery mechanism. Before relying on it, investigate permission requirements, backend/frontend source pairing, deployment provenance, concurrency and normal GitHub release behavior in a separate controlled exercise. Never present a historical frontend rollback as proof that Supabase functions or database state were restored.

### Rollback evidence worksheet

| Evidence | Record without guessing |
| --- | --- |
| Starting deployment | Production URL, commit/tag, Cloudflare/Supabase state, run, smoke and affected user behavior |
| Known-good candidate | Release-owner decision, exact source SHA, schema/flag compatibility |
| Change and recovery PRs | Scoped diffs, approvals, resolved threads, required checks and merge SHAs |
| Rolled-back application | Exact main run, relevant deployment steps, URL/AI-route/runtime smoke and independently checked behavior |
| Intended final release | Approved final revision, any restoring PR, deployment and final verification |
| Timing | Source of start/end events and meaning of each measurement; `unavailable` where not captured |
| Teammate rehearsal | Person, date, steps actually followed, feedback and any resulting corrections |
| Boundaries | Explicit confirmation that application rollback does not imply schema/data restoration |

**Current limitation:** The scoped CTA recovery has been executed as recorded above. Provider-history rollback and production database recovery are not established; teammate walkthrough and separate owner final-state evidence remain unverified. The current architecture and stage purposes are summarized in [`PIPELINE.md`](PIPELINE.md); older sections of this runbook preserve historical evidence and do not override current GitHub workflow source.

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

- `modular-main.yml` requires the reusable frontend validation's `exists` output to be true before calling production; frontend absence currently causes the production path to skip.
- Since the frontend is now required on `main`, the temporary skip behavior should be removed or converted into a failing validation when appropriate.
- TypeScript checking currently occurs inside `pnpm build` instead of being exposed as a separately named CI step.
- Frontend CI has been verified against the real FE-01 application.
- Automated Cloudflare frontend deployment has been verified.
- Production routing has been manually verified.
- The production Supabase Edge Function and PostgreSQL demo-row read passed the 2026-10-17 smoke check; see the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).
- A historical Gemini `generateContent` call returned `403 PERMISSION_DENIED`. Local provider transport was re-verified on 2026-11-14: the dedicated project has the Gemini API enabled, `models.list` returned the pinned `gemini-3.5-flash-lite`, and the live extraction suite passed 3/3 with the legacy `@google/generative-ai@0.21.0` SDK. Production backend extraction and Chef generation were observed succeeding on 2026-11-15 with the enable flags set, and the flags were removed immediately afterwards. See the [production enablement verification](../ai-evaluation-report.md#production-enablement-verification-2026-11-15).
- The production migration ledger records `20261017000001_add_is_public_to_recipes.sql` as applied; see the [Sprint 1 QA-01 record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17).
- The linked repository Projects page has no project board, so board status could not be verified.
- The gated `recipes` production deployment executed successfully on `main` in CI #284 at PR #125 merge SHA `7278f92e0fc67348efa60a14293dcdfde9329709`; that run did not perform PR #88's runtime smoke. After PR #88 merged, [CI #290](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41007655750) successfully executed production deployment and automated post-deployment runtime smoke at `4cfaf2d5c70634e5c849f34c51668dd1432d8b63`. The smoke verified production frontend HTML, its referenced JavaScript asset, and the approved public `demo-recipe` API/database response. Full authenticated CRUD remains separate and unverified; backend source revision remains **operator-attested; not observed from runtime**.
- On 2026-10-30, production `demo-recipe` preflight was reconciled separately: only `demo-recipe` was targeted for deployment to project `gtbwblxskctpsqhbpebg` from reviewed source `d54e0f1d76f4a2215aa70ae4ce9cf6ec3e8c53a6` using the repository-pinned Supabase CLI 2.122.0 and the explicit production project reference. Supabase subsequently reported the function as ACTIVE version 2 with `verify_jwt=false`; the deployed bundle contains the reviewed `.eq("is_public", true)` boundary, and a post-deployment GET returned HTTP 200 for recipe `11111111-1111-1111-1111-111111111111` (`Classic Tomato Scraps Pasta`). Repository variables `PRODUCTION_FRONTEND_URL=https://moris-mix-ai.diofelgwenharesco.workers.dev` and `PRODUCTION_DEMO_RECIPE_REVISION=d54e0f1d76f4a2215aa70ae4ce9cf6ec3e8c53a6` are operator-confirmed configured, not independently API-observed through the GitHub connector. The backend revision remains operator-attested rather than runtime-observed; this is production preflight evidence, not PR #88 production runtime-smoke evidence.
- A read-only production migration-ledger query on 2026-10-26 confirmed `20261023000002_add_notes_to_recipes.sql` is applied and `public.recipes.notes` exists. CI does not apply production migrations.
- Production ownership rollback was operator-confirmed at the historical baseline SHA above. Modular-only post-merge deployment and runtime smoke were subsequently verified by main run #29 (linked in the issue #73 status note); application/data recovery remains separately unverified. That earlier ownership rollback is not proof of a tested rollback after retiring legacy CI.
- The historical preliminary Sprint 1 metrics baseline has a small sample. A separate preliminary current three-job sample now exists, including successful-gate evidence from run #90; more comparable observations are needed. Failed-dependency blocking is verified separately by the controlled non-production PR #68 experiment (run `39279387584`).
- The deployment log reported that the configured Wrangler version is out of date; upgrading it should be evaluated separately rather than mixed into Sprint 1 verification unless necessary.
- Docs-only main pushes can currently proceed through the gated deployment job. Evaluate trigger scope later as a possible efficiency improvement; this is not a correctness failure or a proven optimization opportunity.

## 15. Historical Sprint 1 Completion Criteria

The Sprint 1 DevOps delivery setup currently has the following evidence:

- [x] Initial CI workflow is merged.
- [x] Branch protection ruleset is active.
- [x] Historical legacy core required-check enforcement was verified; the current cleanup handoff is tracked above.
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

Sprint 1 delivery tracking remains open for broader provider acceptance (generation quality, repeated reliability, load/safety, and hosted quota/concurrency) and further comparable pipeline measurements. One production extraction and one Chef generation succeeded in a cost-guarded enable window on 2026-11-15, and the enable flags were removed afterwards (see the [production enablement verification](../ai-evaluation-report.md#production-enablement-verification-2026-11-15)). The all-checks deployment gate is merged and its successful main path is verified by run #90; the failed-dependency blocking mechanism is verified separately by the controlled non-production PR #68 experiment (run `39279387584`).
