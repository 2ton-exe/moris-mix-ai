# Security and Release Checks

## Scope

First independently reviewable slice of [#163 / DEVOPS-09 (S4)](https://github.com/2ton-exe/moris-mix-ai/issues/163): inventory and standalone dependency-audit observation. This is not the complete security/release implementation or a new merge/release gate. No settings, required checks, dependencies, existing delivery workflows or deployment behavior are changed.

Inventory observed on 2026-11-02 against main `d1dbba6c001c39c65d74d6856a83058f750a93ff`. Configuration, local execution and future hosted execution are distinguished below. API results and advisory databases can change.

## Current repository security inventory

### Dependency ecosystems

| Ecosystem | Checked-in inputs | Observed CI/runtime tooling |
| --- | --- | --- |
| Root Node project | `package.json`, `pnpm-lock.yaml` (lock format 9.0); database/test tooling including dotenv and pg in devDependencies | Existing reusable workflows use Node 24 and pnpm major 10 |
| Frontend Node project | `frontend/package.json`, `frontend/pnpm-lock.yaml` (format 9.0), `frontend/pnpm-workspace.yaml`; React, Vite, Vitest, Playwright and related tooling | Node 24 and pnpm major 10; frontend workspace allows the esbuild build script during normal installs |
| Deno | Root `deno.lock` (format 5); JSR and npm dependencies including standard assertions, AI SDK, backend client and Zod | `reusable-edge-api.yml` uses Deno 2.9.7 |

Local tools were Node 24.17.0 and Deno 2.9.7. pnpm was not on PATH; `npx --yes pnpm@10 --version` resolved 10.34.9. Audits were then confirmed with exact pnpm 10.34.9, matching the existing CI major. Neither project manifest pins a packageManager version. Root and frontend are audited independently, including development/build dependencies; the audit metadata's devDependencies count is not evidence that those dependencies were excluded.

### GitHub-native security features

Read-only REST observations; no feature was enabled or disabled by this task.

| Control | Observed evidence / interpretation |
| --- | --- |
| Visibility | Repository endpoint reports `public` |
| Dependency alerts | Vulnerability-alerts endpoint explicitly returns `Vulnerability alerts are disabled.`; Dependabot alerts endpoint explicitly returns `Dependabot alerts are disabled for this repository.` Counts/status of individual alerts are **Not independently verifiable with current credentials/API access**; no zero-alert claim |
| Dependabot security updates | Repository `security_and_analysis.dependabot_security_updates.status` reports `disabled`; this is distinct from dependency alert availability |
| Secret scanning | Repository metadata explicitly reports secret scanning, push protection, non-provider patterns and validity checks `disabled`; secret-scanning alerts endpoint also explicitly says scanning is disabled. Individual alert counts are not established |
| Code scanning | Alerts endpoint returns `no analysis found`; no checked-in CodeQL/code-scanning workflow was found. Feature enablement and complete historical coverage are **Not independently verifiable with current credentials/API access**; this is not proof that code scanning is disabled |
| Actions default token | Workflow-permissions endpoint reports `default_workflow_permissions: read`, `can_approve_pull_request_reviews: false` |

Some API errors also included an `admin:repo_hook` scope suggestion. The disabled observations above rely on explicit feature metadata/messages, not HTTP denial alone. Any unreported feature state remains unverified. No installed third-party security service coverage was independently established.

### Workflow permissions and secret exposure

Confirmed controls and boundaries from current YAML, not proof of every hosted execution:

- `modular-main.yml` declares `contents: read`; production is guarded by main ref, push/manual event, validated dependencies and a trusted workflow-ref check in `reusable-production.yml`.
- PR path classification declares `contents: read` and disables checkout credential persistence. PR Secretary starts with empty permissions, checks out the default branch with persistence disabled, and scopes its writer to `pull-requests: write` plus explicit read permissions.
- `project-sync.yml` uses `contents: read`, default-branch checkout without persisted credentials and explicit activation guards before minting an App token. Its App private-key reference and requested Project write permission make it a privileged metadata path; activation/runtime state was not independently checked here.
- Production/Cloudflare workflows reference deployment credentials; Edge/API callers pass non-production database credentials to reusable validation/Hosted RLS; eligible same-repository non-draft PRs can call staging. `reusable-staging.yml` declares the `staging` environment for deploy and smoke. Current production YAML has no explicit job environment. Environment protection settings and actual secret configuration were not inspected.

Confirmed hardening opportunities: `modular-pr-validation.yml` has no workflow-level permissions baseline; reusable frontend/database and the primary Edge/API job inherit caller/default permissions rather than all declaring a local minimum. This does not prove broad write access, especially with the observed read default. Many reusable delivery/validation checkouts omit `persist-credentials: false`, retaining the action default. Review narrower token/credential lifetimes in a later slice; do not infer that secrets were leaked from configuration references. No secret values were fetched or recorded.

### Action pinning / supply-chain observations

All external action references in the existing 13 workflow files use mutable version tags, rather than immutable SHAs. Observed families: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `pnpm/action-setup@v4`, `denoland/setup-deno@v2`, `cloudflare/wrangler-action@v3`/`@v4`, and `actions/create-github-app-token@v3`. Local reusable workflow paths are a different reference class. Mutable tags are a confirmed hardening opportunity, not evidence of compromise.

The new workflow uses only SHA-pinned checkout, setup-node and setup-deno actions, with release comments. GitHub release/ref APIs resolved checkout v7.0.1 to `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node v7.1.0 to `949feb2413d6458794dcd2491c4babbbce0c15c1`, and setup-deno v2.0.5 to `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed`. pnpm is requested at exact registry version 10.34.9 through npx; it is not a SHA-pinned action. Runner images and Node 24 remain moving platform inputs. Pinning reduces action-reference drift, not all supply-chain risk.

## Automated dependency audit — observation phase

### Trigger

`Security Audit` is configured for pull requests targeting main when either pnpm manifest/lockfile, the frontend workspace policy, `deno.lock`, or the security workflow changes; it also supports `workflow_dispatch`. No push trigger, schedule, production caller or deployment is added. Documentation-only changes alone do not trigger it. Path-filtered jobs must not become required contexts without redesigning the trigger/always-present check policy.

### What is checked

Separate root/frontend matrix executions run `npx --yes pnpm@10.34.9 audit --json` from their respective directories. There is no `--prod`/`--dev` exclusion, severity filter, registry-error suppression, project install, lifecycle execution or automatic remediation. A separate Deno job runs `deno audit --lock=deno.lock` on Deno 2.9.7. Every job has only `contents: read`; checkout persistence and setup-node automatic package-manager caching are disabled. No repository secret or environment is required.

The pnpm summaries retain registry severity counts and every returned affected-package/severity/advisory entry, without dumping arbitrary advisory prose or credential/configuration data. Deno's native log contains its counts and advisory details; its job summary links interpretation to the audit step outcome.

### What is not checked

This is not a source/history secret scan, application exploitability assessment, SAST/CodeQL analysis, container scan, deployment verification or complete release policy. Registry/advisory availability and lockfile contents bound the signal. Deno is a separate ecosystem; neither pnpm result implies Deno coverage. No scan proves the repository is secure.

### Current gating decision

Observation only; do not add these checks to protected-main required contexts. The audit steps use `continue-on-error: true` to collect findings and tool failures without an unproven new gate. Setup/summary failures can still fail the standalone job; it remains non-required. Later gating thresholds require hosted execution, noise/actionability review, owner triage and an explicit follow-up decision. High/critical findings require triage, not automatic dependency rewriting.

### Failure/result interpretation

Audit failure can mean advisories or incomplete execution (network, registry, tool or lockfile error); inspect the audit outcome and summary/logs. The pnpm summary records exit code, step outcome and report counts; absent/malformed/error reports explicitly establish no coverage. The Deno summary records step outcome and directs readers to native logs. A green observation job can contain a failed audit step. Cancellation/skips are not successful scans. Do not interpret a zero-finding report from one project as a clean repository.

### Local execution baseline

No remediation was performed. These are local advisory observations, not hosted CI evidence or proof of exploitability.

| Project | Exact confirmed command | Exit | Severity counts returned |
| --- | --- | ---: | --- |
| Root | `npx --yes pnpm@10.34.9 audit --json` | 0 | info 0, low 0, moderate 0, high 0, critical 0 |
| Frontend | `npx --yes pnpm@10.34.9 --dir frontend audit --json` | 1 | info 0, low 0, moderate 6, high 1, critical 2 |
| Deno | `deno audit --lock=deno.lock` | 1 | low 0, moderate 0, high 1, critical 0 |

Frontend returned these package/advisory entries (counts can reflect dependency occurrences and need not equal the number of distinct advisories):

| Package/version | Severity | Advisory |
| --- | --- | --- |
| tinypool 1.1.1 | critical | GHSA-5gmw-xhrv-c9v3; GHSA-85c8-ppgw-ccpr |
| zod 3.22.4 | high | GHSA-mrhx-c7xc-m3w5 |
| vitest 3.2.7 and @vitest/mocker 3.2.7 | moderate | GHSA-82fw-gwwq-j7x9 |
| @vitest/mocker 3.2.7 | moderate | GHSA-qxg6-89mg-rqv8 |
| vite 6.4.4 | moderate | GHSA-8g5g-mxqh-grgj |
| minimatch 3.1.5 / 10.2.6 | moderate | GHSA-g3hv-75wg-m249 |

Deno returned Zod / GHSA-mrhx-c7xc-m3w5 (high); `deno.lock` resolves Zod 3.22.4. Frontend/component owners should assess reachability, supported upgrades and regressions; the backend owner should triage locked Deno Zod usage. Build/test-tool findings remain relevant to CI supply-chain risk even when not production runtime dependencies. This slice leaves all manifests and lockfiles intact.

## Secret scanning strategy

Native scanning is explicitly reported disabled, so adequate active native coverage is not established. No additional secret-scanning product is introduced merely for tool count. A later #163 slice must decide between native feature configuration and a justified scanner with PR/history coverage, based on access, coverage and operating requirements. No successful source/history scan is claimed. Settings changes and credential investigation/rotation require their own authorized work; this inventory contains no credential values.

## Deno dependency coverage

Local `deno --version` confirmed 2.9.7, matching current CI. `deno help audit` explicitly documents lockfile auditing, and `deno audit --lock=deno.lock` successfully queried advisory data and reported the Zod finding. That validates the command for inclusion; it does not establish exhaustive advisory coverage of all JSR, npm or remote modules. No `--fix`, ignored advisory, severity exclusion, registry-error suppression or lockfile rewrite is used. Dependency integrity locks and advisory auditing provide different controls. Hosted Deno execution remains unproven until Actions runs this workflow.

## Deferred hardening work

- Triage current frontend high/critical and Deno findings with component owners; do not silently upgrade application dependencies here.
- Decide secret-scanning coverage and dependency-alert/security-update configuration in a later authorized slice. No native setting was changed.
- Review inherited permissions, persisted checkout credentials, privileged secret jobs and existing mutable action tags after inventory review. API/environment protections and secret configuration not inspected here remain unknown.
- Coordinate active owners: PR #154 owns production migration/main/CODEOWNERS/deployment documentation; #160 owns Edge/API/production/backend changes; #161 owns backup/Cloudflare/production changes; #156 owns Project synchronization/template work; #166 owns the optimization log. None of these files is changed here.
- Open PRs #152 and #153 also change frontend/UI areas; #152 changes the frontend manifest/lockfile. Local counts reflect current main, not those unmerged dependencies. Re-audit the eventual merged state.
- Establish hosted execution evidence before proposing any required merge/release security threshold or broader hardening. This does not complete #163.

## Evidence

- Git baseline: main SHA above, synchronized with origin/main; clean working tree before branching. Open PR file lists checked via `gh pr list` and `gh pr view --json files`: #152, #153, #154, #156, #160, #161, #166. None edits either new file.
- Read-only API paths under `repos/2ton-exe/moris-mix-ai`: repository metadata, `vulnerability-alerts`, `dependabot/alerts`, `secret-scanning/alerts`, `code-scanning/alerts`, `actions/permissions/workflow`. Only feature state and sanitized alert metadata were requested; no secret values were requested.
- Repository evidence: root/frontend manifests and locks, `deno.lock`, frontend workspace policy and all 13 existing `.github/workflows/*.yml`; search found no existing dependency-audit/secret-scanner/code-scanning workflow.
- Local command evidence: Node/Deno versions, `npx --yes pnpm@10 --version`, pnpm audit help, `deno help audit`, and the three audits above. Advisory identifiers are registry-reported findings, not independently reproduced exploits.
- Action provenance: read-only `releases/latest` and `git/ref/tags/<release>` APIs for [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0), and [setup-deno](https://github.com/denoland/setup-deno/releases/tag/v2.0.5).
- Local static validation passed with the existing frontend ESLint installation's `js-yaml` parser, as existing workflow tests use. Embedded shell blocks passed `bash -n`; summary handling was checked for clean, finding, error and malformed reports. Permissions, SHA pins, secret references and the two-file scope were checked. `git diff --check` passed; `actionlint` was not installed. Local checks cannot prove hosted workflow execution. No hosted Security Audit result is claimed by this document.
