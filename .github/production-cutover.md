# Production cutover record — issue #73

The reversible production-ownership migration is complete. This file is retained as the concise operational record for why the legacy caller can be retired.

## Final state

- `modular-main.yml` is the intended permanent production caller.
- `ci.yml` is retired in the cleanup PR after both modular cutover and legacy rollback were executed successfully.
- The temporary `MODULAR_PRODUCTION_ENABLED` selector is no longer part of the permanent release contract after legacy retirement.
- The shared production release remains in `reusable-production.yml` and can be called only from `modular-main.yml` on `refs/heads/main`.

## Cutover proof

On `main` SHA `46809319eb23394a45d6f1ea79f8ee41f541011b` with `MODULAR_PRODUCTION_ENABLED=true`:

- CI #337 (`41206888611`) passed validation and skipped its legacy production job.
- Modular Main Validation #27 (`41206888572`) passed validation and executed `Modular Main Production`.
- `recipes` deployment, Cloudflare deployment, production URL verification, production runtime smoke, outcome recording, and artifact preservation all succeeded.
- retained artifact: `production-runtime-smoke-41206888572-1`.

This proved modular production ownership without duplicate legacy deployment.

## Rollback proof

After draining production work, the selector was changed to a non-true value on the same `main` SHA:

- CI #340 (`41208052779`) executed the legacy production release successfully.
- Modular Main Validation #28 (`41208066744`) completed validation while `Modular Main Production` was skipped.
- retained legacy artifact: `production-runtime-smoke-41208052779-1`.

This proved the documented recovery path before legacy retirement. The variable was then restored to exact `true` before cleanup.

## Required-check handoff

Before the cleanup PR, branch protection used an overlap period containing both legacy and modular core contexts. Positive execution and a disposable modular failure test proved the modular contexts are real GitHub Actions checks and can block merge.

The final retirement sequence is:

1. Open the cleanup PR while the overlap policy is still active.
2. Confirm both legacy and modular PR validation execute on the cleanup branch before `ci.yml` is removed from `main`.
3. Remove only the three obsolete legacy required contexts from `Protect main`, retaining the three modular contexts and the existing review policy.
4. Verify the cleanup PR remains protected by the modular contexts.
5. Merge the reviewed cleanup PR.
6. Verify the merged `main` executes modular validation and production release, passes runtime smoke, and preserves evidence.
7. Record the final run in issue #73 and close the issue only after documentation matches the observed steady state.

## Permanent release contract

The modular release continues to require successful frontend, database, and Edge/API validation. Hosted RLS is mandatory for the main Edge/API call. E2E remains non-gating for production.

The shared production workflow deploys only:

- `recipes` Supabase Edge Function
- Cloudflare production Worker/static frontend

It does not apply production database migrations. `demo-recipe` remains operator-managed, and additional AI functions require their own reviewed deployment decision.

The `cloudflare-production` concurrency group remains serialized with `cancel-in-progress: false`. Deployment command outcomes and runtime-smoke outcomes are recorded separately, and `runtime-smoke.json` is retained as a workflow artifact.

## Local validation

```sh
node --test scripts/production-workflow.test.mjs scripts/runtime-smoke.test.mjs scripts/pr-secretary.test.mjs
actionlint -shellcheck= -pyflakes=
git diff --check
```

GitHub execution after merge remains required evidence; local/static checks alone do not prove production delivery.
