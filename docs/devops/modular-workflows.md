# Modular workflow migration (issue #73)

## Stage 1 authority

`.github/workflows/ci.yml` remains the source of the required `Frontend Checks`,
`Database Tests`, and `Edge/API Tests` checks and the active production path. On
main pushes and manual dispatches, its protected `migrate-production` job runs
after validation, and Cloudflare deployment depends on migration success as well
as all three checks and frontend existence. Pull requests skip both production
jobs.

| File in `.github/workflows/` | Responsibility in stage 1 |
| --- | --- |
| `ci.yml` | Authoritative PR/main validation, protected production migration, and gated Cloudflare deployment |
| `modular-pr-validation.yml` | PRs targeting main only; comparison runs of the reusable validations |
| `reusable-frontend.yml` | Existing frontend steps and exported `exists` output |
| `reusable-database.yml` | Existing PostgreSQL service, environment, migration and RLS tests |
| `reusable-edge-api.yml` | Deno checks, deterministic tests, and optional hosted database migration and integration tests |
| `reusable-cloudflare.yml` | Dormant deployment implementation; `workflow_call` only, no caller |

The reusable jobs retain their internal names and existing validation commands.
Edge/API credentials, the expected test project reference, and dedicated
database URL are optional; the PR caller forwards configured secrets, and
repository variables remain available through `vars`. When the hosted
credentials, expected reference, and database URL are configured, the reusable
Edge/API workflow applies pending migrations before the hosted suite. The PR
caller does not forward Cloudflare secrets to any reusable workflow. Public
Supabase build variables remain read through `vars` inside the reusable
deployment job.

Duplicate validation work on PRs is intentional during migration. The comparison
caller uses distinct `Modular ...` job names because GitHub can compose reusable
check names from caller and callee names. Do not assume that retaining the callee
name preserves the exact required-check context. The existing required checks
continue to come from `ci.yml`; do not change rulesets during this stage.

The reusable Cloudflare job preserves the main push/manual-dispatch guard,
`contents: read` permission, public build-variable checks, and job concurrency
`cloudflare-production` with `cancel-in-progress: false`. It accepts a boolean
frontend-existence input in place of the old job output expression. It is not
called, cannot be dispatched directly, and has no push, PR, or workflow-run
trigger. Its guard also excludes PR callers.

## Reusable workflow constraints

Reusable workflows are called with job-level `uses`, not from steps. A caller's
`needs` refers to jobs in that caller, not jobs inside another workflow. The
frontend output is therefore explicitly exported through
`on.workflow_call.outputs.exists` for a future downstream caller job to consume.
Caller workflow `env` values do not automatically propagate; secrets must be
passed and repository variables are available through `vars`. See GitHub's
[reusable configuration reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)
and [workflow reuse guide](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

## Evidence needed before retiring ci.yml

Stage 1 has passed actionlint and local architecture and parity assertions.
Both the authoritative CI workflow and Modular PR Validation executed
successfully on PR #74. The observed GitHub checks were:

| Authoritative CI check | Conclusion | Composed modular check | Conclusion |
| --- | --- | --- | --- |
| `Frontend Checks` | success | `Modular Frontend / Frontend Checks` | success |
| `Database Tests` | success | `Modular Database / Database Tests` | success |
| `Edge/API Tests` | success | `Modular Edge/API / Edge/API Tests` | success |

`Deploy to Cloudflare` was skipped on the pull request as expected. This confirms
PR validation without production deployment and establishes the actual composed
modular check names. The existing `ci.yml` remains authoritative.

The modular checks are not yet required by the active ruleset. No modular main
orchestration has executed, frontend-output propagation into a modular main
deployment gate remains unproven, and `reusable-cloudflare.yml` has not been used
for production deployment. No production/main cutover has occurred; `ci.yml`
must not yet be retired.

Local YAML/static validation alone cannot establish runtime behavior. PR #74
provides GitHub PR execution and check-name evidence; it does not establish
modular main output propagation or production concurrency behavior. Retain real
PR run URLs, commit SHAs, jobs and conclusions with the migration evidence.

1. PR #74 confirms both CI and Modular PR Validation ran and all three modular
   validation jobs passed under the composed names recorded above. For the
   remaining detailed parity review, compare the reusable jobs with their
   authoritative counterparts,
   including frontend lint/tests/build, PostgreSQL readiness/migrations/lifecycle/
   RLS tests, Deno type checks/deterministic tests, and the hosted integration or
   missing-secret fallback path. Confirm the existing exact required checks still
   satisfy branch protection before any required-check handoff; the observed
   modular names do not establish ruleset enforcement.
2. PR #74 confirms validation without production deployment, with the existing
   deployment job skipped. Continue to ensure no Cloudflare secrets are passed
   by the modular PR caller and no workflow calls `reusable-cloudflare.yml`
   during stage 1.
3. In a later, reviewed migration, prove frontend output propagation and the
   future main caller's gate using an inert downstream job with no production
   credentials or deployment commands. It must declare
   `needs: [frontend, test-db, test-edge-api]`, use normal success semantics
   (no `always()` or `continue-on-error` bypass), and require
   `needs.frontend.outputs.exists == 'true'`. Demonstrate success and blocking
   for failed, cancelled and skipped dependencies, missing frontend, PR events
   and non-main refs. Preserve the push/manual-dispatch restriction.
4. Only after that evidence, prepare the production handoff as a separate change:
   wire a main caller to all three reusable validations and then deployment with
   those same dependencies/conditions, explicitly pass Cloudflare secrets, and
   convert the string frontend output to a boolean input. Do not use a separate
   `workflow_run` deployment or trust a boolean input as proof of validation.
   The reusable deployment cannot express `needs` on the caller's validation
   jobs; the caller must enforce that gate.
5. Resolve required-check naming using actual GitHub results before retiring the
   old check producers. Any ruleset/check-context change requires a separately
   authorized handoff. Switch off the old deploy caller when enabling the new
   one in the same reviewed cutover; never leave two active production paths.
   A shared concurrency group serializes jobs but does not prevent duplicate
   deployments. Keep the group only on the deployment job, with cancellation
   disabled. Verify main ordering and concurrency in GitHub during the eventual
   authorized cutover before declaring the migration complete.

The Stage 1 validation did not include a main replacement caller, path filters,
pipeline optimizations, Supabase function deployment, or a modular production
handoff. Subsequent changes added protected production database migrations to
the existing `ci.yml` path. Keep `ci.yml` authoritative until the modular
replacement behavior has execution evidence and the required-check and
deployment handoff is ready.
