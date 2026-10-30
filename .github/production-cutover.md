# Production cutover preparation — issue #73

This is local preparation for review, not authorization to change production
ownership or GitHub policy. Baseline: `c7b1bc7147e0d747535e7be46fc760f60e0da757`.
`ci.yml` remains enabled and authoritative for the three existing required checks
and, while the cutover flag is unset/false, production releases. Its production job now
calls `reusable-production.yml`; the release steps have one implementation.
`reusable-cloudflare.yml` remains dormant and is not the coupled release owner.

## Guard and ownership

Repository variable: `MODULAR_PRODUCTION_ENABLED`. This preparation does not set it.
Both callers run the same production-ownership selector, restricted to push/manual
dispatch on main. It uses a strict JavaScript comparison:

```js
const owner = process.env.MODULAR_PRODUCTION_ENABLED === "true" ? "modular" : "legacy";
```

GitHub Actions string equality is case-insensitive, so directly comparing the raw
variable with `== 'true'` would incorrectly accept `TRUE`. See the
[Actions expression reference](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions).
The selector emits only the canonical values `legacy` or `modular`. Caller guards:

- Legacy: `needs.production-ownership.outputs.owner == 'legacy'`.
- Modular: `needs.production-ownership.outputs.owner == 'modular'`.

| Raw flag | Legacy eligible | Modular eligible |
| --- | --- | --- |
| unset | yes | no |
| `false` | yes | no |
| `true` | no | yes |
| `TRUE` | yes | no |
| any other value, including empty or whitespace | yes | no |

These ownership predicates are complementary; normal release eligibility still
requires successful validations, frontend existence, and a main push/manual event.
The selector is a control prerequisite, not a new validation policy.

The reusable release also validates the main-ref caller identity (`ci.yml` for
legacy, `modular-main.yml` for modular). Immediately after checkout and before
configuration/build/deployment, preflight recomputes the strict owner from the raw
flag and exits nonzero unless the declared owner matches exactly. Unknown owner
values fail closed. There are no workflow-file existence checks: both callers can
coexist throughout proof and rollback. A mismatched mode cannot deploy even if a
caller guard is changed or the flag changes between selector and preflight.
Manual dispatch retains existing execution permissions and validation dependencies.

The boolean frontend-existence input is not proof of validation. Each caller
retains its own success gate and dependencies. Legacy production waits for
Frontend Checks, Database Tests, Edge/API Tests, and Hosted RLS Integration.
Modular production waits for frontend, database, the aggregate Edge/API reusable
workflow (including mandatory Hosted RLS Integration on main). E2E still runs
independently and is non-gating for production in both callers. The inert shadow
evidence job may still wait for E2E; production does not depend on that job. Failed,
cancelled, or skipped prerequisites cannot bypass normal success semantics.
Modular PR stays pull-request-only with its existing staging caller; the newly
added mandatory hosted-RLS job defaults off there.

## Preserved release

The shared job retains production configuration validation and frontend build,
then explicitly deploys **recipes only** to `vars.SUPABASE_PROJECT_REF` using the
existing Supabase command and flags. It deploys Cloudflare using
`deploy --config wrangler.jsonc`, verifies the deployment URL against
`PRODUCTION_FRONTEND_URL`, and runs `node scripts/runtime-smoke.mjs` only after
both deployments and URL verification succeed. `demo-recipe` remains
operator-managed. `extract-recipe` and `generate-recipe` are validated, including
AI-06 coverage, but neither is automatically deployed. Their production deployment
is tracked separately in issue #130 and is outside this PR's release target.

The job keeps `contents: read`, explicitly forwarded deployment secrets, and the
`cloudflare-production` concurrency group with cancellation disabled. The lock
covers the complete sequence including smoke and evidence. The outcome summary
and `production-runtime-smoke-${{ github.run_id }}-${{ github.run_attempt }}`
artifact (`runtime-smoke.json`, warn if absent) retain `always()` handling.
There are no production database migration commands. Hosted test migrations
remain restricted to the existing dedicated non-production test path.

The smoke verifier, runtime JSON shape, expected content, production configuration,
and backend revision attestation are unchanged. Smoke still verifies availability
and expected responses, not independent runtime-observed source provenance.
The coupled release retains the existing partial-release risk: Supabase can
succeed before Cloudflare or smoke fails; there is no new automatic rollback.

## Required checks and later GitHub handoff

Do not change current rulesets in this preparation. `ci.yml` still produces
`Frontend Checks`, `Database Tests`, and `Edge/API Tests` with their existing
names and behavior. Reusable check names are composed from caller and callee.
Repository-recorded GitHub evidence in `docs/devops/modular-workflows.md` shows:

| Existing requirement | Observed modular PR context |
| --- | --- |
| Frontend Checks | Modular Frontend / Frontend Checks |
| Database Tests | Modular Database / Database Tests |
| Edge/API Tests | Modular Edge/API / Edge/API Tests |

The names are not interchangeable. The production job's reusable extraction also
composes its deployment context; any consumers of that non-required context must
be checked during review. The existing PR Secretary production label already
uses an older name and is not evidence of production status. Its cleanup is
separate from required validation enforcement.

Later, with explicit authorization:

1. Keep `MODULAR_PRODUCTION_ENABLED` unset/false. Merge the reviewed preparation
   with `ci.yml` present and legacy production still authoritative.
2. Collect normal main evidence that the refactored legacy caller still deploys:
   verify the shared release, hosted RLS, URL verification, smoke, and artifact.
   Reconcile PR #126 documentation separately; this preparation does not edit it.
3. Verify actual modular PR check names and GitHub Actions app identity. Add the
   modular core contexts to effective required policy **while retaining existing
   requirements**; verify missing/failing checks block merges before retiring old
   requirements. Keep overlap and no protection gap. This does not promote E2E or
   hosted RLS to new required PR contexts.
4. Drain pending/running production runs and disallow reruns of older revisions
   without the ownership guard. Keep the flag unset/false during preparation.
   Concurrency alone cannot prevent stale runs from deploying sequentially.
5. Explicitly set `MODULAR_PRODUCTION_ENABLED=true`, retaining `ci.yml`. This
   changes the eligible owner directly from legacy to modular; no intentional
   interval has zero owner. Do not change the flag during release execution.
6. Trigger/observe a validated main release. Prove the legacy production caller is
   skipped and only modular production executes. E2E remains non-gating; hosted
   RLS remains a release dependency.
7. Verify recipes-only Supabase deployment, Cloudflare deployment, deployment URL,
   production smoke, summary, runtime artifact, concurrency, and required PR policy.
8. If proof fails, drain in-flight production work and set the flag back away from
   exact `true` to restore legacy ownership without restoring any workflow file.
   Trigger/observe a validated legacy main release. Already-started deployment
   commands cannot be revoked by a variable change; preflight protects subsequent
   deployment starts, not commands that have already passed it.
9. Only after successful modular proof remove obsolete `ci.yml` through a reviewed
   follow-up, updating temporary regression assertions. Until then both workflows
   remain available for reversible ownership. After removal, rollback requires
   restoring the legacy caller as well as changing the flag.

Ownership transfer, ruleset/settings changes, new production targets, migration
automation, source-provenance work, and hosted cutover evidence remain deferred.

## Edge/API coverage difference

Preserve the stronger reusable coverage already present on the baseline. Compared
with `ci.yml`, `reusable-edge-api.yml` additionally type-checks:

- `supabase/functions/_shared/recipe-images/schemas.ts`
- `supabase/functions/tests/recipe_image_schemas_test.ts`

Its deterministic test command also includes
`supabase/functions/tests/recipe_image_schemas_test.ts`, which legacy omits. There
are no legacy-only targets in those lists. Both retain AI-06 extract-recipe and
generate-recipe coverage.
No recipe-image coverage is removed and legacy lists are unchanged. Issue #124
separately tracks final path/test selection; list identity is not required here.

## Local validation

After installing the locked frontend tooling:

```sh
node --test scripts/production-workflow.test.mjs scripts/runtime-smoke.test.mjs scripts/pr-secretary.test.mjs
actionlint -shellcheck= -pyflakes=
git diff --check
```

The workflow safety suite parses all workflow YAML, exercises actual guard
expressions and strict ownership preflight using local Node processes, checks main
validation parity (including extract-recipe, generate-recipe, and preserved recipe-image extras),
asserts exclusive ownership for unset/false/true/TRUE plus other values, checks
failed/cancelled/skipped dependencies and non-gating E2E, and asserts release ordering,
evidence, concurrency, PR isolation, explicit secrets, and absence of production
migration commands. It runs in both frontend validation paths. It does not deploy
or contact production. It uses explicit production-contract assertions for deployment
targets and smoke behavior, checks current-tree Edge/API parity, and scans changed
content for literal credential patterns. Actionlint here disables optional external ShellCheck and
pyflakes integrations; GitHub execution evidence remains required before cutover.
