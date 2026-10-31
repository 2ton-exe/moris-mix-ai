# Modular CI/CD architecture — issue #73

This document describes the steady-state GitHub Actions architecture after the modular cutover. Historical experiment and transition evidence remains in issue #73.

## Active workflow ownership

- `.github/workflows/modular-pr-validation.yml` is the pull-request validation/staging caller.
- `.github/workflows/modular-main.yml` is the only `main` validation and production-release caller.
- `.github/workflows/reusable-frontend.yml`, `reusable-database.yml`, `reusable-edge-api.yml`, `reusable-e2e.yml`, `reusable-staging.yml`, and `reusable-production.yml` contain the reusable implementation.
- `.github/workflows/ci.yml` is retired after the production ownership and rollback proofs recorded in issue #73.
- `modular-gate-experiment.yml` and `reusable-gate-fixture.yml` remain non-production evidence utilities only.

## Pull-request path

PR targeting `main`
→ Modular Frontend / Frontend Checks
→ Modular Database / Database Tests
→ Modular Edge/API / Edge/API Tests
→ Modular E2E / Playwright E2E Tests (non-gating)
→ eligible same-repository non-draft PR staging deployment and smoke
→ required teammate review and required modular contexts
→ merge.

The required protection contexts are intended to be:

- `Modular Frontend / Frontend Checks`
- `Modular Database / Database Tests`
- `Modular Edge/API / Edge/API Tests`

E2E remains useful execution evidence but is not a required merge context unless a later reviewed policy change promotes it.

## Main / production path

Push to `main` or permitted manual dispatch on `main`
→ Modular Main Frontend
→ Modular Main Database
→ Modular Main Edge/API with mandatory Hosted RLS integration
→ Modular Main E2E (non-gating for production)
→ `Modular Main Production`
→ shared `reusable-production.yml`
→ validate production configuration
→ build frontend
→ deploy the `recipes` Edge Function
→ deploy Cloudflare Worker/static assets
→ verify the Wrangler deployment URL
→ run production runtime smoke
→ preserve `runtime-smoke.json` as `production-runtime-smoke-<run>-<attempt>`.

Production database migrations are not automated by this release workflow.

## Production gate

`Modular Main Production` depends on successful frontend, database, and Edge/API validation. The Edge/API reusable workflow is called with `require-hosted-rls: true` on `main`, so Hosted RLS remains a release prerequisite. The production job also requires the frontend project to exist and restricts execution to `main` push/manual-dispatch events.

`reusable-production.yml` accepts only the frontend-existence boolean plus explicit deployment secrets. It independently verifies that its caller is `modular-main.yml` on `refs/heads/main`, preventing another workflow from reusing the production job as an alternate release path.

The previous `MODULAR_PRODUCTION_ENABLED` ownership selector was a reversible migration control. After the modular release and legacy rollback paths were both executed successfully, the permanent architecture no longer needs a legacy/modular selector because the legacy caller is retired.

## Production targets and safety boundaries

The automated production release deploys:

- Supabase Edge Function: `recipes`
- Cloudflare production Worker/static frontend

It does not automatically deploy `demo-recipe`, `extract-recipe`, or `generate-recipe`, and it does not apply production database migrations. Changes to the production target set require separate review and evidence.

The `cloudflare-production` concurrency group uses `cancel-in-progress: false` so a newer release cannot cancel an in-flight deployment/smoke sequence. Deployment success and runtime-smoke success remain separate evidence states.

## Cutover evidence

Issue #73 contains the complete transition evidence. Key runtime proofs on SHA `46809319eb23394a45d6f1ea79f8ee41f541011b`:

- CI #337 (`41206888611`): legacy caller healthy; legacy production skipped while modular ownership was enabled.
- Modular Main Validation #27 (`41206888572`): modular production executed successfully, including `recipes`, Cloudflare, URL verification, runtime smoke, and artifact `production-runtime-smoke-41206888572-1`.
- CI #340 (`41208052779`): rollback test executed the legacy production path successfully and retained `production-runtime-smoke-41208052779-1`.
- Modular Main Validation #28 (`41208066744`): modular production skipped during rollback as intended.

Required-check migration also used an overlap period in which legacy and modular contexts were simultaneously required before the legacy contexts were retired. The disposable failure test recorded in issue #73 proved a failing modular required context blocks merge.

## Evidence rules

Do not describe configuration as execution. For each release, preserve the distinction between:

- configured
- executed
- passed
- deployed
- runtime verified

A green workflow is insufficient if the production job was skipped. Production evidence should identify the main SHA, workflow/run, deploy step outcomes, runtime-smoke result, and retained artifact.

## Local validation for workflow changes

Run, at minimum:

```sh
node --test scripts/production-workflow.test.mjs scripts/runtime-smoke.test.mjs scripts/pr-secretary.test.mjs
actionlint -shellcheck= -pyflakes=
git diff --check
```

The production-workflow regression suite asserts the modular-only caller contract, PR isolation, main/ref guards, mandatory Hosted RLS, non-gating E2E, explicit deployment targets, smoke/evidence ordering, concurrency, and absence of production migration commands.
