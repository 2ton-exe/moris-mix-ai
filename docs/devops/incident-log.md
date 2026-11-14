# DevOps incident log

Record genuine CI/main/production incidents and recovery evidence. Separate production deployment/runtime failures from failures of delivery tooling; neither count nor recovery time can be transferred between those populations.

Qualifying incidents include production deployment failure, main/release pipeline failure with operational impact, production outage/degradation, rollback/recovery operations, and delivery-system failures requiring remediation. Record impact and evidence before assigning a category; an unsuccessful check alone is insufficient.

Do not count intentional controlled failure experiments, deliberately failing gate tests, PR-only expected failures, expected production-deploy skips on PRs, CodeRabbit comments, local test failures, forced staging failures or application retry tests that were not real production incidents. Those belong in task evidence or the [optimization log](optimization-log.md), not production incident totals.

Use [pipeline metrics](pipeline-metrics.md) for defined-period counts/rates and the [deployment runbook](deployment-runbook.md#12-recovery-and-rollback) for rollback procedures. The 2026-11-13 entry below records a production deployment failure, not a proven application outage. The older DEVOPS-86 record concerns non-gating delivery tooling and must not be counted as a production deployment failure. Neither entry establishes a complete sprint incident count.

## Incident 2026-11-13 — Cloudflare Workers API failure during production release

**Category:** Production deployment failure / partial release; no production outage demonstrated.  
**State:** Two failed release attempts followed by successful attempt 3 on the same revision; automated production deployment and smoke verification completed on 2026-11-14 PHT. Original partial-release failure retained.  
**Affected revision:** `f36b1fc17ff34601995ca38d183e0a4fb28cccb8` (squash merge of PR #195).

### What happened

After [PR #195](https://github.com/2ton-exe/moris-mix-ai/pull/195) merged, automatic [Modular Main Validation #43451688823](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823) ran on the exact merge SHA. Attempts **1** and **2** both passed the main validation jobs and deployed three Supabase Edge Functions, but failed at `Deploy to Cloudflare Workers`. Wrangler `3.90.0` reported Cloudflare API error `10013` while uploading the `moris-mix-ai` Worker version. [Attempt **3**](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823/attempts/3) later succeeded on the **same source SHA**, including Cloudflare deployment and automated production verification.

### Impact

During attempts 1 and 2 the release was **partial**: `recipes`, `extract-recipe`, and `generate-recipe` deployed, but the new Cloudflare Workers frontend version was not confirmed deployed. Production URL verification, deployed AI-route checks, and runtime smoke were skipped after the failed uploads. The operator opened the existing `/demo-recipe` page and observed the expected recipe rendered, while the Cloudflare deployment dashboard showed an older active Worker version. This was **point-in-time availability evidence**, not a successful automated post-deployment check or proof of full production health. No rollback was performed. Compatibility of the updated API functions with the previous frontend was not independently tested during the partial-release window. Attempt 3 subsequently completed automated production deployment and smoke verification; no application outage was demonstrated.

### Detection

- [Main run #43451688823](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823), attempt 1, failed at approximately **23:23 PHT** (15:23 UTC). Attempt 2 failed at approximately **23:31 PHT** (15:31 UTC), on the same revision and step.
- Cloudflare audit logs recorded failed `Upload Version` actions. The **2026-11-13 23:31:05 PHT** entry identified the `moris-mix-ai` Worker, an HTTP `500` response to the Worker versions upload API, and Wrangler `3.90.0`. Audit Ray ID: `a59ed244799b2158`. No credentials or account identifiers are retained here.
- [PR #195 post-merge verification](https://github.com/2ton-exe/moris-mix-ai/pull/195#issuecomment-6857371063) records the initial failure and distinguishes passed, failed, and skipped steps. Attempt 2 independently reproduced the same failure.

### Root cause

**Possible Cloudflare-side Workers API incident; exact cause unverified.** Cloudflare [reported elevated 5xx errors during Worker deployments](https://www.cloudflarestatus.com/incidents/e7ktq32gphhe). Attempt 2's Wrangler error was logged at **15:31:09.064 UTC**, approximately **4.7 seconds before** Cloudflare's published incident start of **15:31:13.772 UTC** ([status record](https://www.cloudflarestatus.com/api/v2/incidents/e7ktq32gphhe.json)). The close timing and HTTP 500 are consistent with the reported issue but do not prove the request was affected. Attempt 1 at approximately 23:23 PHT also predates the published start. Cloudflare later identified the issue around **23:39 PHT** and announced a fix with **Monitoring** status around **23:42 PHT**. An HTTP 500 does not rule out a request-specific trigger.

### Fix

Cloudflare reported implementing a provider-side fix at 23:42 PHT and monitoring its results. **No repository, token, Wrangler version, configuration, or production rollback change was made to address this incident.** The subsequent successful attempt 3 demonstrates this application's deployment recovery, but does not prove Cloudflare's fix was the specific cause.

### Recovery

**Automated release recovery verified on 2026-11-14 PHT.** [Attempt 3 of main run #43451688823](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823/attempts/3) succeeded on the original `f36b1fc17ff34601995ca38d183e0a4fb28cccb8` revision. The production job successfully deployed the three intended Supabase Edge Functions and Cloudflare Worker, then passed production deployment URL verification, deployed AI-route verification, and production runtime smoke. Both evidence-preservation steps passed; the `production-runtime-smoke-43451688823-3` and `production-ai-route-smoke-43451688823-3` artifacts are available in the run. The recipe-image cleanup and protected upload-signing function deployments were skipped as configured, not passed. No rollback or repository/configuration change was required. This verifies the automated deployment and its smoke scope, **not** exhaustive authenticated application acceptance or a DEVOPS-10 database restore. The exact Cloudflare dashboard version identifier was not separately cross-checked here.

### Recovery time

**Not measured as a formal recovery interval.** Attempt 3 completed the deployment and smoke verification on 2026-11-14 PHT, but a consistently defined start/restore timestamp pair was not assembled for an operational recovery-time metric. The older frontend's availability is not used as a recovery timestamp.

### Prevention / follow-up

- Retain the exact SHA, all three run attempts, Cloudflare audit evidence, and successful smoke artifacts; do not erase the earlier failed deployment attempts.
- If the Cloudflare upload failure recurs, investigate request/response evidence and current provider status before changing secrets, permissions, or Wrangler versions. Provider attribution remains unconfirmed.
- For future incidents, record compatible detection and verified-restoration timestamps if a recovery-time metric is needed; a green rerun alone does not prove a root cause.
- Keep unrelated DEVOPS-10 [restore issue #159](https://github.com/2ton-exe/moris-mix-ai/issues/159) open until its own isolated-restore criteria pass; this deployment incident does not prove or refute database recovery.

### Evidence

- [Merged PR #195 and original delivery record](https://github.com/2ton-exe/moris-mix-ai/pull/195).
- [Exact-merge main run, attempts 1 and 2](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823).
- [Same-SHA recovery: main run attempt 3](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823/attempts/3) — successful Cloudflare deployment, production URL check, AI-route check, runtime smoke and artifact preservation; artifacts `production-runtime-smoke-43451688823-3` and `production-ai-route-smoke-43451688823-3`.
- [Cloudflare Workers API incident timeline](https://www.cloudflarestatus.com/incidents/e7ktq32gphhe).
- Cloudflare account audit log, 2026-11-13 23:31:05 PHT: `Upload Version`, failed HTTP 500, Ray ID above (operator screenshot, not committed because it includes account information).
- Manual Cloudflare deployment-history and `/demo-recipe` page observations from 2026-11-13 (operator screenshots, not automated checks).

## Incident DEVOPS-86 / 2026-10-28 — PR Secretary publication failure

**Category:** DevOps delivery-tooling incident / non-gating PR Secretary visibility\
**State:** Failure executed in GitHub Actions; repair merged; post-merge publication/update recovery recorded in issue #86. Recovery interval not measured.\
**Reconciled:** 2026-10-29

### What happened

After the initial Secretary implementation merged to trusted `main` in PR #87, real PR #88 exposed repeated HTTP 403 failures when publishing the PR Ops Summary. A separate execution incorrectly treated unrelated `updated_at` changes as stale state. These were observed operational failures, not intentionally injected gate failures.

### Impact

Informational PR Secretary publication/refresh behavior failed, affecting DevOps visibility and automation for the PR's delivery/reviewer summary. Production application availability was not affected by this tooling failure. No production deployment failure is claimed. The Secretary remained informational and non-gating; required validation checks were not changed.

### Detection

[Secretary run #35 / 40676161057](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40676161057) resolved PR metadata successfully but failed the summarize job on the comment POST with HTTP 403. The [repository repair record](pr-secretary.md#runtime-repair-evidence-for-issue-86-2026-10-28) preserves that failure and the separately observed false-stale behavior.

### Root cause

The failed writer had Issues write and PullRequests read. A permission mismatch was the strongest documented explanation; the original client discarded GitHub's error body, so the exact server-side rejection reason was not retained and must not be asserted as conclusively proven. Separately, equality on PR `updated_at` rejected valid summaries after unrelated metadata activity.

### Fix

[PR #89](https://github.com/2ton-exe/moris-mix-ai/pull/89) merged as `d54e0f1d76f4a2215aa70ae4ce9cf6ec3e8c53a6`. It targeted `pull-requests: write` to the trusted writer, removed Issues write, added bounded credential-redacted diagnostics, and based stale protection on PR revision/target identity. Deterministic regressions and required Frontend-path execution were added in that historical repair; no implementation is changed by this log.

### Recovery

The current [issue #86 record](https://github.com/2ton-exe/moris-mix-ai/issues/86) reports real post-merge PR #88 verification: creation of one summary comment (`6482390605`), updates to that same comment as workflow/revision/reviewer state changed, and no observed bot loop or older-state overwrite in the exercised scenarios. Issue #86 is closed as completed. The PR #89 description and repository guide retain older pending-verification wording; the later issue record supplies the recovery state. This reconciliation did not rerun that lifecycle or independently reconstruct every recovery run.

### Recovery time

**Not measured.** A matched first-impact/detection timestamp and confirmed-restoration timestamp were not assembled. Issue closure time or PR merge time is not substituted for restoration. This delivery-tooling recovery cannot supply production time-to-recover or rollback duration.

### Prevention / follow-up

Retain least-privilege trusted-main execution, safe diagnostics, publication/stale-state regressions and real-PR lifecycle evidence. On recurrence, capture failed run/job, revision, detection/restoration timestamps, relevant permissions and sanitized error details. Reconcile the Secretary guide's historical pending statements separately if a full lifecycle-documentation refresh is needed.

### Evidence

- [Issue #86: current lifecycle acceptance and recovery record](https://github.com/2ton-exe/moris-mix-ai/issues/86).
- [PR #89: reviewed repair and merge](https://github.com/2ton-exe/moris-mix-ai/pull/89).
- [Raw failure run 40676161057](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40676161057).
- [Recovered persistent summary comment on PR #88](https://github.com/2ton-exe/moris-mix-ai/pull/88#issuecomment-6482390605), identified by issue #86.
- [Historical repair analysis and verification plan](pr-secretary.md#runtime-repair-evidence-for-issue-86-2026-10-28).

## Reusable incident template

```markdown
## Incident <ID / date>

### What happened

### Impact

### Detection

### Root cause

### Fix

### Recovery

### Recovery time

### Prevention / follow-up

### Evidence
```
