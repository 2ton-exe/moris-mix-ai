# Modular workflow migration (issue #73)

## Authority through Stage 2A

`.github/workflows/ci.yml` remains the source of the required `Frontend Checks`,
`Database Tests`, and `Edge/API Tests` checks and the active production path.
Cloudflare deployment follows successful validation and frontend existence on
main pushes and manual dispatches. Pull requests skip deployment.

| File in `.github/workflows/` | Responsibility through Stage 2A |
| --- | --- |
| `ci.yml` | Authoritative PR/main validation and gated Cloudflare deployment |
| `modular-pr-validation.yml` | PRs targeting main only; comparison runs of the reusable validations |
| `modular-main.yml` | Shadow main validation and an inert downstream evidence gate |
| `modular-gate-experiment.yml` | Manual, secret-free dependency-gate experiments |
| `reusable-gate-fixture.yml` | Deterministic, secret-free simulated validation dependencies |
| `reusable-frontend.yml` | Existing frontend steps and exported `exists` output |
| `reusable-database.yml` | Existing PostgreSQL service, environment, migration and RLS tests |
| `reusable-edge-api.yml` | Deno checks, deterministic tests, and optional hosted database migration and integration tests |
| `reusable-cloudflare.yml` | Dormant deployment implementation; `workflow_call` only, no caller |

The reusable jobs retain their internal names. Edge/API validation includes
BE-06 recipe CRUD coverage and the AI contract/evaluation checks from `ci.yml`.
Edge/API credentials, the expected test project reference, and dedicated
database URL are optional; both modular callers forward configured secrets, and
repository variables remain available through `vars`. When the hosted
credentials, expected reference, and database URL are configured, the reusable
Edge/API workflow applies pending migrations to the dedicated non-production
test database before the hosted auth/RLS and recipe CRUD integration suite.
Incomplete configuration retains the explicit hosted-test skip and offline
fallback. Neither caller forwards Cloudflare secrets to any reusable workflow.
Public Supabase build variables remain read through `vars` inside the reusable
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
`on.workflow_call.outputs.exists` for the shadow main gate to consume.
Caller workflow `env` values do not automatically propagate; secrets must be
passed and repository variables are available through `vars`. See GitHub's
[reusable configuration reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)
and [workflow reuse guide](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

## Stage 2A: shadow validation and controlled gate experiments

`modular-main.yml` runs on pushes to main and supports manual dispatch; it has
no PR trigger. Its caller names are `Modular Main Frontend`, `Modular Main
Database`, and `Modular Main Edge/API`. The observed composed main check names are
`Modular Main Frontend / Frontend Checks`,
`Modular Main Database / Database Tests`, and
`Modular Main Edge/API / Edge/API Tests`. The caller forwards all six optional BE04
non-production test secrets: Supabase URL, anon key, service-role key, secret
key, expected project reference, and dedicated database URL. Like the PR caller,
it forwards the expected-reference secret with a legacy `BE04_RLS_TEST_PROJECT_REF`
secret fallback; the reusable workflow also reads repository-variable fallbacks.
It never calls `reusable-cloudflare.yml`, receives no Cloudflare production
secrets, and contains no deployment commands.

The final `gate-evidence` job declares
`needs: [frontend, test-db, test-edge-api]`, requires
`needs.frontend.outputs.exists == 'true'`, and restricts itself to main
push/manual-dispatch events. It uses normal implicit success semantics, with no
`always()` or `continue-on-error`. It has no token permissions, credentials,
checkout, or production actions; it only logs inert evidence. Existing `ci.yml`
continues independently as the sole production deployment path.

`modular-gate-experiment.yml` is manual-dispatch only. It and its reusable fixture
declare `permissions: {}`, accept no secrets, and perform no checkout, network,
provider, or deployment actions. The fixture has boolean inputs for intentional
failure, simulated frontend existence, and a five-minute cancellation window.
Its `exists` output traverses step, job, and reusable workflow outputs. The
experiment's `would-deploy` job mirrors the three validation dependencies and
frontend existence condition with normal success semantics. Its logs explicitly
state that no production deployment occurred. This synthetic gate can run on a
selected ref; main event/ref restrictions are enforced separately by the shadow
main gate, and must remain part of any future production caller.

### Observed Stage 2A runtime evidence

All runs below used merge commit
`3486ac5226e3fe0f917b147af4fa9703029c9d79`. Dependency and gate results are
observed GitHub Actions conclusions, distinct from the configured conditions
described above. The gate experiments are secret-free, synthetic, and inert;
they are not production deployment tests.

| Scenario / workflow | Run ID | Relevant dependency result | Inert gate result | What the run proves |
| --- | --- | --- | --- | --- |
| Main push / Modular Main Validation (overall success) | [40095375790](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40095375790) | All three composed modular validation jobs succeeded | `Modular Main Inert Gate`: success | Shadow main orchestration executes; frontend output propagated into the gate condition and the gate ran after successful dependencies on main |
| Main push / CI (overall success) | [40095375829](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40095375829) | `Frontend Checks`, `Database Tests`, and `Edge/API Tests`: success; `Deploy to Cloudflare`: success | Not applicable: authoritative production CI | `ci.yml` remained the authoritative production deployment path on the same commit; this deployment was not performed by Modular Main |
| `all-success` / Modular Gate Experiment (overall success) | [40096171117](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40096171117) | Frontend, database, and Edge/API fixtures: success | `Would Deploy (Inert Experiment Only)`: success | Successful dependencies allow the inert downstream gate to run |
| `fail-frontend` / Modular Gate Experiment (overall failure) | [40096296474](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40096296474) | Frontend fixture: failure; database and Edge/API fixtures: success | Skipped | Frontend failure blocks the downstream gate as intended |
| `fail-database` / Modular Gate Experiment (overall failure) | [40096414728](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40096414728) | Database fixture: failure; frontend and Edge/API fixtures: success | Skipped | Database failure blocks the downstream gate as intended |
| `fail-edge-api` / Modular Gate Experiment (overall failure) | [40096544882](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40096544882) | Edge/API fixture: failure; frontend and database fixtures: success | Skipped | Edge/API failure blocks the downstream gate as intended |
| `missing-frontend` / Modular Gate Experiment (overall success) | [40096561056](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40096561056) | All three fixtures: success; frontend exported `exists=false` | Skipped | Successful validations alone do not allow the gate when frontend existence is false |
| `skip-database` / Modular Gate Experiment (overall success) | [40096572007](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40096572007) | Frontend and Edge/API fixtures: success; database caller: skipped | Skipped | A skipped required dependency blocks the downstream gate |
| `cancel-window` / Modular Gate Experiment (overall cancelled) | [40097028260](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40097028260) | Frontend and Edge/API fixtures: success; database fixture and `Allow real manual cancellation` step: cancelled | Cancelled without executing steps | A real cancelled dependency prevents the inert downstream action from executing |
| Non-main manual dispatch / Modular Main Validation (overall success) | [40097690202](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40097690202) | All three composed modular validation jobs succeeded on `docs/73-stage2a-runtime-evidence` | `Modular Main Inert Gate`: skipped | Validation can run on a non-main ref, but the downstream gate requires `refs/heads/main` |

The experiment gate is named `Would Deploy (Inert Experiment Only)` (shortened
to `Would Deploy` in the blocking observations). The failure and cancellation
runs provide expected blocking evidence; their overall conclusions remain
failure or cancelled. Run
[40096581724](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40096581724)
is not primary cancellation evidence: it was cancelled too late, after the
database cancellation window had completed successfully. Cancellation in the
valid run was real, not simulated by an exit code.

Stage 2A is now runtime-verified for successful main orchestration, frontend
output propagation, dependency failure blocking, missing frontend blocking,
skipped dependency blocking, real cancellation blocking, and non-main ref
blocking. This does not prove a production handoff or production concurrency
behavior. The PR restriction remains architectural: `modular-main.yml` has no
`pull_request` trigger, and Modular PR Validation handles PR validation.
PR #75 had successful CI and Modular PR Validation evidence before merge; no
additional modular-main PR runtime event is claimed.

The Stage 2A implementation reconciles static Edge/API command parity with authoritative
`ci.yml`: both type-check the recipe and AI contract/evaluation files and run
the same deterministic test files. BE-06's guarded hosted non-production
migration and auth/RLS/recipe integration coverage remains intact, and both
modular callers forward the same optional hosted-test secrets. This static
reconciliation alone does not establish runtime parity. The runs above now
establish successful Stage 2A shadow main execution and inert dependency-gate
behavior; they do not establish production deployment parity.

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

Stage 1 merged to main. The post-merge authoritative main run passed frontend,
database, and Edge/API validations, and its existing Cloudflare production
deployment succeeded. This is evidence for the authoritative path only.

The modular checks are not yet required by the active ruleset. Modular main
orchestration and frontend-output propagation into its inert gate are now
observed, but `reusable-cloudflare.yml` remains dormant and has not been used
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
   through Stage 2A.
3. Stage 2A shadow main and controlled gate experiments now provide the runtime
   evidence recorded above for frontend output propagation and dependency
   gating using inert downstream jobs with no production credentials or
   deployment commands.
   The main gate declares
   `needs: [frontend, test-db, test-edge-api]`, uses normal success semantics
   (no `always()` or `continue-on-error` bypass), and requires
   `needs.frontend.outputs.exists == 'true'`. Observed runs demonstrate success
   and blocking for failed, cancelled and skipped dependencies, missing frontend,
   and non-main refs. PR exclusion follows the absence of a PR trigger; PR #75
   provides separate CI and Modular PR Validation evidence. Preserve the
   push/manual-dispatch restriction.
4. Final production cutover still depends on staging/preview delivery in
   [#76](https://github.com/2ton-exe/moris-mix-ai/issues/76), which remains pending.
   Prepare the production handoff as a separate change after that prerequisite:
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

[Issue #73](https://github.com/2ton-exe/moris-mix-ai/issues/73) remains open.
Stage 2A runtime validation does not complete modular required-check migration,
the ruleset/check-context handoff, production deployment ownership transfer,
use of `reusable-cloudflare.yml` by the modular main caller, or retirement/removal
of `ci.yml`; all remain pending, along with staging/preview delivery from #76.
BE-06 adds recipe/API validation and guarded migrations
for optional hosted non-production test-database integration.
Stage 2A performs no production deployment or production database migration;
production database migration automation remains a separate follow-up. Supabase
function deployment automation and post-deployment smoke verification also
remain unimplemented. This stage adds no path filters, pipeline optimizations,
or production configuration changes.
Keep the original workflow until the replacement behavior has execution evidence
and the required-check and deployment handoff is ready.
