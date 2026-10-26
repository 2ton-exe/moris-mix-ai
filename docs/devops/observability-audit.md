# Production Observability Baseline

## Scope

This October 24, 2026 audit records what operators can currently observe for Mori's Scraps. It documents existing visibility and supplied, verified manual production observations; it does not implement new monitoring or rerun those checks.

Evidence levels are distinct: **configured** means present in repository configuration; **deployed** means observed in production; **manually verified** means an operator observed the stated behavior; **automated** means an implemented workflow performs that specific activity. CI tests and automated deployment do not establish automated production runtime verification.

Repository references: [deployment runbook](deployment-runbook.md), [workflow migration status](modular-workflows.md), [active CI workflow](../../.github/workflows/ci.yml), [Worker configuration](../../wrangler.jsonc), [Supabase configuration](../../supabase/config.toml), [demo API contract](../api/demo-recipe.md), and [auth contract](../api/auth-session.md). Provider and smoke observations below are dated October 24, 2026. No credentials, account identifiers, request identifiers, or screenshots are included.

## Cloudflare Visibility

Production Worker `moris-mix-ai` serves the frontend through Cloudflare Workers Static Assets at the [documented production URL](https://moris-mix-ai.diofelgwenharesco.workers.dev).

| Capability | Current state | Evidence level | Limitation |
| --- | --- | --- | --- |
| Deployment history/status | Dashboard shows history, timestamps, Wrangler as deployment source, and Ready status. | Deployed; manually verified. Deployment automation is configured in active CI and documented in the runbook. | Ready proves platform deployment status, not application health. |
| Version IDs | Provider version IDs are visible; latest displayed version identifier was `e87d806a`. | Deployed; manually verified. | A provider version alone does not establish its Git revision. |
| Runtime metrics | Normal Worker metrics are unavailable for this currently static-assets-only Worker. | Manually verified. | These metrics cannot establish frontend runtime health or performance. |
| Logs/traces | Workers Logs and Workers Traces are disabled. | Manually verified provider state. | No enabled Worker logs/traces; enabling them is not yet justified for this static-only workload. |
| Revision linkage | Dashboard does not provide established Git commit/GitHub Actions → provider version linkage. | Manual dashboard observation; repository deployment workflow inspected. | Git SHA → provider deployment traceability remains weak; Wrangler source is insufficient. |
| Application health | Production `/demo-recipe` rendered database-backed data in the manual check below. | Deployed; manually verified. | Point-in-time path verification only; no automated production smoke or continuous application-health check is established. |

## Supabase Visibility

Production application project: `moris-scraps`. A separate hosted non-production test database project for RLS and integration testing, `moris-mix-be04-rls-test`, exists. No dedicated staging Supabase project was visible in the current provider inventory; the test project is not evidence of staging.

| Capability | Current state | Evidence level | Limitation |
| --- | --- | --- | --- |
| Project health | Production reports Healthy; dashboard provides database resource/health visibility and Edge Function/Auth/Postgres error summaries. | Deployed; manually verified. | Provider health does not prove every application path works. |
| Function inventory | `demo-recipe` and `auth-session` observed deployed; `recipes` was not deployed at audit time. | Deployed inventory manually verified; all three have repository configuration. | Source/configuration does not prove deployment. BE-06 recipe CRUD is not verified as deployed. |
| Function telemetry/logs | Invocation statuses, error rates, execution timings, and runtime boot logs visible for the observed functions. | Manually verified against deployed invocations below. | Limited samples; no automated production smoke or performance baseline. |
| Git linkage | GitHub repository is not connected in Supabase. | Manually verified provider state. | No provider Git integration establishes deployed source revision. |
| Migration visibility | Dashboard showed Last migration: Unknown. | Manual dashboard observation. | Observation only, not an immediate failure or proof migrations are absent. The runbook separately records historical production migration-ledger verification; this audit did not re-query it. |
| Backup visibility | Dashboard showed No backups. | Manual dashboard observation. | Observation only, not an immediate failure or a restore test; backup/restore remains a later roadmap capability. |

## Manual Production Verification

Both checks below were manually performed on October 24, 2026. Provider telemetry records requests automatically, but the smoke actions and evaluation were manual.

### demo-recipe

- **Action:** Open production Cloudflare frontend `/demo-recipe` and inspect corresponding Supabase request telemetry and runtime logs.
- **Expected behavior:** Render the approved database-backed demo recipe; preflight succeeds with HTTP 204 and the read succeeds with HTTP 200.
- **Observed behavior:** Frontend rendered “Classic Tomato Scraps Pasta.” Supabase recorded `OPTIONS /functions/v1/demo-recipe` → **204** and `GET /functions/v1/demo-recipe` → **200**. Runtime log showed the function booting normally. The overview then showed **2 invocations**, **0% 4xx**, **0% 5xx**, no errors for those observed invocations, **59 ms average execution time**, and **1,388 ms maximum execution time**.
- **Evidence state:** Deployed and manually verified; production smoke automation is absent.
- **What it proves:** The observed frontend → deployed Edge Function → database-backed demo response path worked at the time of the check.
- **What it does NOT prove:** Continuous availability, other API paths, authenticated-user/RLS behavior, or deployed recipe CRUD. The timing sample is too small to be treated as a performance baseline or optimization result; the dashboard values are recorded as displayed without inferring a latency distribution.

### auth-session

- **Action:** Send an unauthenticated browser `GET /functions/v1/auth-session` and inspect Supabase telemetry and runtime logs.
- **Expected behavior:** Reject a missing/invalid Authorization header with HTTP 401 and a safe `UNAUTHORIZED` response.
- **Observed behavior:** Browser received **401** with safe `UNAUTHORIZED` response for a missing/invalid Authorization header. Supabase recorded that GET as **401** and showed a normal function boot log.
- **Evidence state:** Deployed negative authentication boundary manually verified; production smoke automation is absent.
- **What it proves:** The deployed function rejected this unauthenticated request as expected. This 401 is an expected negative check, not evidence of an authentication outage.
- **What it does NOT prove:** Authenticated-user/session success, token validation across all failure cases, or production RLS behavior. Hosted non-production integration tests are separate evidence and do not extend this production check.

## Current Observability Gaps

These are evidence limits and roadmap inputs, not a declaration that every gap must be fixed immediately.

- No automated production frontend/API smoke verification.
- Weak Git SHA → provider deployment traceability; Cloudflare version history does not establish revision linkage, and Supabase has no GitHub connection.
- Cloudflare static frontend telemetry limitation: normal Worker runtime metrics are unavailable for this workload.
- Cloudflare Worker logs/traces are disabled and not yet justified for this static-only workload.
- No deployed `recipes` function yet; BE-06 recipe CRUD must not be represented as deployed.
- Supabase dashboard migration state shown as Unknown; current ledger state was not re-verified by this audit.
- No backups shown in the Supabase dashboard; restore capability was not verified.
- No dedicated staging Supabase project visible yet; the hosted RLS/integration-test project serves a separate purpose.

## Roadmap Impact

- **#61 / DEVOPS-08:** Eventually automate the manual production frontend + safe API smoke, including expected successful demo behavior and expected unauthenticated rejection. Existing CI validation and deployment do not fulfill this runtime verification.
- **#76 staging:** Apply the same configured/deployed/manually verified/automated evidence principle before production cutover; a test project alone does not establish staging readiness.
- **#52 / DEVOPS-07:** Remains responsible for controlled Edge Function deployment after target functions are finalized. Current Cloudflare automation does not deploy Supabase functions or the database.
- **Continuous work:** Maintain observability, evidence, and secret hygiene as deployments and runtime paths change. Keep evidence sanitized and tie claims to their verified scope.
- **Later capabilities:** Backup/restore remains later roadmap work. Caching and performance optimization must wait for comparable stable workloads and representative measurements; the tiny demo sample supports neither optimization claims nor a performance baseline.

## Operator Checklist

- [ ] **Frontend deployment issue:** Inspect GitHub validation/deployment results and Cloudflare history, timestamps, Wrangler source, version, and Ready status. Record any missing Git revision linkage, then manually open the frontend and `/demo-recipe`.
- [ ] **Edge Function/API issue:** Confirm the production project and deployed function inventory first. Compare request method/status with the API contract; inspect invocation/error summaries and runtime logs, then verify the safe response. Do not assume `recipes` is deployed.
- [ ] **Auth issue:** Check whether 401 is expected for the request. Use `auth-session` telemetry and safe error output; investigate Auth/Postgres summaries as relevant. Authenticated-user and RLS verification require separate authorized checks; never record tokens or user data in evidence.
- [ ] **Deployment versus runtime:** Record platform deployment status separately from observed application behavior. Ready/Healthy and passing CI do not replace runtime verification; label manual checks as manual until a workflow actually performs them.

## Evidence Status

Matrix scope is production as observed on October 24, 2026; staging is listed separately. “No” denotes absent evidence/capability for that claim, and “Partial” identifies an explicit limitation. Automated refers to the row's specific claim, not general CI coverage.

| Claim | Configured | Deployed | Manually Verified | Automated |
| --- | --- | --- | --- | --- |
| Production frontend deployment | Yes — Worker assets and active CI | Yes | Yes — dashboard and frontend | Yes — gated Cloudflare deployment; no runtime smoke |
| demo-recipe runtime path | Yes — source/configuration | Yes | Yes — frontend, 204/200, boot log | No — production runtime check is manual |
| auth-session negative auth boundary | Yes — handler/configuration | Yes | Yes — safe 401 and boot log | No — production boundary check is manual |
| recipes function | Yes — source/configuration | No | Inventory absence only; no runtime check | No — production deployment/smoke absent |
| Production smoke verification | No — workflow absent | N/A — manual procedure | Yes — two checks above | No |
| Staging | No dedicated staging configuration established by this audit | No dedicated project visible | Inventory absence only; no staging runtime check | No staging automation established |
| Deployment revision traceability | Partial — CI source checkout/deploy; no established provider mapping | Partial — provider versions visible | Partial — history inspected, Git linkage not established | No established Git SHA → provider version correlation |

OBSERVABILITY BASELINE STATUS: RECORDED — AUTOMATION STILL PENDING
