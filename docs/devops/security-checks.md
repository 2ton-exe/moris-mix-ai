# Security and Release Checks

## Scope

The initial [#163 / DEVOPS-09 (S4)](https://github.com/2ton-exe/moris-mix-ai/issues/163) slice documented the dependency-audit observation and did not change GitHub settings, required checks, application dependencies or deployment behavior. This document also records later dated GitHub UI configuration and workflow-review evidence. The dependency audit is still observation-only, no new merge/release gate is established here, and #163 is not complete.

Inventory observed on 2026-11-02 against main `d1dbba6c001c39c65d74d6856a83058f750a93ff`. Configuration, local execution and future hosted execution are distinguished below. API results and advisory databases can change.

**Reading this document:** The 2026-11-02 inventory is retained below as a historical baseline; it is *not* the current native-control state. The 2026-11-06 operator walkthrough supersedes it for GitHub security settings. Source-code/workflow facts are independently inspected at `main` commit `f051d52f8c7b19a4f837794b1d26720dc78219ae`; UI-only settings are reported explicitly as operator-confirmed.

## GitHub-native security controls — 2026-11-06

| Control | Observed status | Evidence boundary |
| --- | --- | --- |
| Secret Protection / secret scanning | **On** (operator-confirmed in repository Settings) | GitHub Security and quality → Secret scanning showed **0 open / 0 closed** alert records at the time inspected; no claim of universal secret absence |
| Repository Push protection | **On** (operator-confirmed by repository administrator) | Blocks supported secret patterns on eligible pushes; no live push-block test, bypass event or override attempted |
| Dependency graph | **On** (operator settings + subsequent Dependabot alert results) | GitHub resolved dependency paths from checked-in manifest/lockfiles |
| Dependabot alerts | **On** (observed 10 open alert records after enablement) | Alert records include duplicate advisory/path occurrences; not necessarily 10 unique vulnerabilities |
| Dependabot automated security updates | Not confirmed enabled; manual Tinypool repair was attempted | The manual attempt failed because `vitest@3.2.7` keeps transitive `tinypool@1.1.1`; separate frontend fix [#180](https://github.com/2ton-exe/moris-mix-ai/issues/180) assigned |
| CodeQL / code scanning | Not configured in the inspected Security settings | Separate SAST work should be risk- and time-justified, not inferred from the zero secret-alert count |

Security settings are *operator-observed*, not validated with an authenticated administrative API call. They are not a claim that secret detection blocked a representative credential. Do **not** push real or fake-valid credentials just to test coverage.

## Historical repository security inventory (2026-11-02)

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

## GitHub Actions permissions and action-source follow-up — 2026-11-06

A read-only reinspection of the **15** checked-in workflow YAML files on `main` `f051d52f8c7b19a4f837794b1d26720dc78219ae` identified the following. These findings are a *configuration audit*, not a successful hardened-workflow execution:

- `modular-main.yml`, `database-backup.yml`, `project-sync.yml` and `security-audit.yml` declare explicit workflow-level `contents: read`. The `modular-pr-validation.yml` entrypoint has **job-scoped** read permission for its classifier, but no workflow-level baseline. Reusable `frontend` and `database` jobs also rely on inherited/default permissions; the November 2 repository settings observation reported read-only default. **Re-verify** the active default in GitHub Settings → Actions → General before declaring least privilege fully established.
- `pr-secretary.yml` grants `pull-requests: write` to its narrow comment-writing job and read permissions to its reader; `project-sync.yml` mints a GitHub App token only in a guarded privileged path. These writes are intentional and should not be removed without regression testing.
- `database-backup.yml` and `security-audit.yml` use full-length SHA-pinned action references. Several existing frontend, database, E2E, staging and production workflows still reference mutable action tags (`actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4`, `cloudflare/wrangler-action@v3/v4`, among others). This is a supply-chain hardening opportunity, not proof of compromise.
- Several validation and deployment checkouts still use the default credential-persistence behavior. In a focused later hardening PR, evaluate `persist-credentials: false` where subsequent steps do not require authenticated Git operations; verify Cloudflare/Supabase deployment and CI before changing production workflows.
- `database-backup.yml` declares the `production-backup` environment; its main-only branch restriction was operator-confirmed earlier in DEVOPS-10. `reusable-staging.yml` declares staging environments. Other environment approval/actor restrictions, App scopes, deployment-token privileges and provider settings were **not** independently audited from these YAML files.

**Decision:** preserve current required validation, deployment and production smoke. Audit findings justify a **separate** small hardening PR with current-head CI, independent review and main verification. Do not promote advisory-only audit jobs to required contexts while path-filtered and non-blocking. GitHub's native Push protection is an enforcement mechanism for supported secrets, not a required PR status check.

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

The following package versions and advisory counts are the historical PR #167
scan from November 2, 2026; they describe that lockfile snapshot, not this PR's
current dependency state. The current Deno and frontend lockfiles resolve Zod
4.6.6.

Frontend returned these package/advisory entries (counts can reflect dependency occurrences and need not equal the number of distinct advisories):

| Package/version | Severity | Advisory |
| --- | --- | --- |
| tinypool 1.1.1 | critical | GHSA-5gmw-xhrv-c9v3; GHSA-85c8-ppgw-ccpr |
| zod 3.22.4 | high | GHSA-mrhx-c7xc-m3w5 (historical version) |
| vitest 3.2.7 and @vitest/mocker 3.2.7 | moderate | GHSA-82fw-gwwq-j7x9 |
| @vitest/mocker 3.2.7 | moderate | GHSA-qxg6-89mg-rqv8 |
| vite 6.4.4 | moderate | GHSA-8g5g-mxqh-grgj |
| minimatch 3.1.5 / 10.2.6 | moderate | GHSA-g3hv-75wg-m249 |

Deno returned Zod / GHSA-mrhx-c7xc-m3w5 (high) in that historical scan. Its lockfile now resolves Zod 4.6.6. Build/test-tool findings remain relevant to CI supply-chain risk even when not production runtime dependencies.

## Hosted execution evidence — November 2026

The first hosted execution, [Security Audit #1](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41469565159), ran on PR #167 head `55e3f5bb19fcd6f1d0c73c353428e20ddba96562` (November 2). The three **observation jobs completed successfully**, but their underlying audit steps reported: root pnpm exit 0/no advisories, frontend pnpm exit 1 (6 moderate, 1 high, 2 critical), and Deno exit 1 (1 high). This demonstrates why job-level green is not a clean audit.

The second hosted execution, [Security Audit #2](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42179871388), ran on PR #167 repair head `67f79eaf4c0a8f3527e6e4696d8011fdbf45b8ba` (November 6). All three observation jobs again completed successfully:

| Ecosystem | Observed result from audit output | Interpretation |
| --- | --- | --- |
| Root pnpm | Audit exit 0; no advisories returned | No findings in that registry response, not repo-wide security certification |
| Frontend pnpm | Audit exit 1; 5 moderate, 1 high, 2 critical | Findings remain open for frontend/build-tool owner triage; counts differ from the November 2 registry response |
| Deno | Underlying audit exited 1 and reported one high-severity Zod advisory (GHSA-mrhx-c7xc-m3w5); observation job completed successfully because the audit step is allowed to fail | Job success is not a clean dependency-audit result |

The third hosted execution, [Security Audit #3](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42180130293), ran on PR head `956df55f91d8636d4c07369460d16a3f76c463e0` (November 6). Root pnpm returned exit 0/no advisories; frontend pnpm returned exit 1 with 5 moderate, 1 high and 2 critical findings; Deno audit returned exit 1 with one high Zod finding. All three **observation jobs** completed successfully, but this does not clear the findings.

All hosted runs are **observation evidence only**. The tool's report or advisory database may change without repository changes. None validates source/history secret scanning, runtime exploitability, or release-grade gating.

Initial [Modular PR Validation #263](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41469565206) failed the Frontend workflow-safety regression because it incorrectly applied the no-path-filters invariant to this optional audit. Commit `67f79ea` narrowed that invariant to required PR/main entrypoints, while explicitly asserting the audit remains read-only, path-scoped and non-push. [Modular PR Validation #287](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42180130098) then **completed successfully** on PR head `956df55f91d8636d4c07369460d16a3f76c463e0`: Frontend, Database, Edge/API, Playwright E2E, Staging Deploy and Staging Smoke passed; main-only Hosted RLS Integration was intentionally skipped. A future integrated-head run is separate evidence and must be recorded separately.

## Secret scanning coverage and credential-response procedure — 2026-11-06

**Current choice:** use GitHub-native Secret Protection plus repository Push protection for supported patterns. GitHub states that native secret scanning examines **Git history across branches** and rescans as patterns are added. That is our default *history strategy*; no separate scanner is installed without identifying a concrete coverage gap. The operator saw 0 open and 0 closed alerts when inspecting GitHub Security and quality → Secret scanning. No scanner can certify that unsupported credentials, logs, archived artifacts, forks or out-of-band exposures are absent.

**On an alert or blocked push:**

1. **Do not paste the secret** into a PR, issue, CI log, screenshot, discussion or test fixture. Share the alert URL/number, provider or secret *type*, source location only if safe, and response status with authorized maintainers.
2. If a push is blocked, remove the credential from **all commits being pushed** and retry. Do not bypass simply to make CI green; routine test fixtures should use clearly invalid, non-secret placeholders.
3. For a real or potentially live credential, contact the service/project owner, **rotate or revoke promptly**, assess scope and exposure, then clean the repository/history with coordinated maintainer approval if necessary. Deleting a file alone does not invalidate a leaked credential.
4. For a false positive, maintainers should review the detection and document a reason before any approved bypass/dismissal. Repository push-protection bypasses may create alerts, including closed false-positive/test alerts and open deferral alerts; examine **both open and closed** states, and use `bypassed:true` when checking for bypass records. Prefer no bypass for real credentials.
5. Recheck the alert state after action and record only sanitized outcome, owner, date, rotation/revocation status and any follow-up incident ticket. Do not close an incident as verified just because an alert was dismissed.

**Verification boundary:** GitHub settings and the zero-alert view were operator-observed; repository Push protection is **configured/confirmed On**, but a real push rejection was *not* exercised. Native coverage is limited to supported patterns and eligible pushes; a no-alert result is not a history-wide guarantee. The current dependency audit remains advisory-only and cannot substitute for secret scanning.

References: [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning), [Push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection), [Detection scope](https://docs.github.com/en/code-security/reference/secret-security/secret-scanning-scope).

## Deno dependency coverage

Local `deno --version` confirmed 2.9.7, matching current CI. `deno help audit` explicitly documents lockfile auditing, and `deno audit --lock=deno.lock` successfully queried advisory data and reported the Zod finding. That validates the command for inclusion; it does not establish exhaustive advisory coverage of all JSR, npm or remote modules. No `--fix`, ignored advisory, severity exclusion, registry-error suppression or lockfile rewrite is used. Dependency integrity locks and advisory auditing provide different controls. Hosted Deno audit execution is recorded in the evidence section above. Advisory output and step exit state must be interpreted separately; a successful observation job does not establish zero vulnerabilities.

## Deferred hardening work

- Triage current frontend high/critical and Deno findings with component owners; do not silently upgrade application dependencies here.
- Native Secret Protection, repository Push protection, Dependency graph and Dependabot alerts are now operator-confirmed enabled (November 6). Dependency alert remediation, optional updates, bypass governance and any justified supplemental secret scanning remain separate follow-ups.
- Review inherited permissions, persisted checkout credentials, privileged secret jobs and existing mutable action tags after inventory review. API/environment protections and secret configuration not inspected here remain unknown.
- Historical coordination note (November 2): PRs #154, #160, #161, #156 and #166 represented overlapping delivery, backend, backup, Project automation and metrics work at the initial audit baseline. Their later merge/closure state must be checked live; this documentation-only follow-up does not modify their files.
- At the initial audit baseline, PRs #152 and #153 also changed frontend/UI areas; #152 changed the frontend manifest/lockfile. Initial dependency counts reflect that recorded `main` snapshot, not unmerged PR contents. Re-audit after dependency changes merge.
- Establish hosted execution evidence before proposing any required merge/release security threshold or broader hardening. This does not complete #163.

## Evidence

- Initial-audit Git baseline: `main` at `d1dbba6c001c39c65d74d6856a83058f750a93ff`, synchronized with origin/main; working tree was recorded clean before branching. Open PR files were checked at that time via `gh pr list` / `gh pr view --json files` for #152, #153, #154, #156, #160, #161 and #166. That list is historical, not a current PR-status report.
- Read-only API paths under `repos/2ton-exe/moris-mix-ai`: repository metadata, `vulnerability-alerts`, `dependabot/alerts`, `secret-scanning/alerts`, `code-scanning/alerts`, `actions/permissions/workflow`. Only feature state and sanitized alert metadata were requested; no secret values were requested.
- Repository evidence: root/frontend manifests and locks, `deno.lock`, frontend workspace policy and all 13 existing `.github/workflows/*.yml`; search found no existing dependency-audit/secret-scanner/code-scanning workflow.
- Local command evidence: Node/Deno versions, `npx --yes pnpm@10 --version`, pnpm audit help, `deno help audit`, and the three audits above. Advisory identifiers are registry-reported findings, not independently reproduced exploits.
- Action provenance: read-only `releases/latest` and `git/ref/tags/<release>` APIs for [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0), and [setup-deno](https://github.com/denoland/setup-deno/releases/tag/v2.0.5).
- Local static validation passed with the existing frontend ESLint installation's `js-yaml` parser, as existing workflow tests use. Embedded shell blocks passed `bash -n`; summary handling was checked for clean, finding, error and malformed reports. Permissions, SHA pins, secret references and the two-file scope were checked. `git diff --check` passed; `actionlint` was not installed. Local checks cannot prove hosted workflow execution. Hosted Security Audit evidence is recorded below. Job success is **not** interpreted as an all-clear.
