# DevOps incident log

Record genuine CI/main/production incidents and recovery evidence. Separate production deployment/runtime failures from failures of delivery tooling; neither count nor recovery time can be transferred between those populations.

Qualifying incidents include production deployment failure, main/release pipeline failure with operational impact, production outage/degradation, rollback/recovery operations, and delivery-system failures requiring remediation. Record impact and evidence before assigning a category; an unsuccessful check alone is insufficient.

Do not count intentional controlled failure experiments, deliberately failing gate tests, PR-only expected failures, expected production-deploy skips on PRs, CodeRabbit comments, local test failures, forced staging failures or application retry tests that were not real production incidents. Those belong in task evidence or the [optimization log](optimization-log.md), not production incident totals.

Use [pipeline metrics](pipeline-metrics.md) for defined-period counts/rates and the [deployment runbook](deployment-runbook.md#12-recovery-and-rollback) for rollback procedures. The 2026-11-13 entry below records a production deployment failure, not a proven application outage. The older DEVOPS-86 record concerns non-gating delivery tooling and must not be counted as a production deployment failure. Neither entry establishes a complete sprint incident count.

## Incident 2026-11-13 — Cloudflare Workers API failure during production release

**Category:** Production deployment failure / partial release; no production outage demonstrated.  
**State:** Two failed release attempts recorded; existing frontend manually reachable; automated recovery and current-release smoke verification pending.  
**Affected revision:** `f36b1fc17ff34601995ca38d183e0a4fb28cccb8` (squash merge of PR #195).

### What happened

After [PR #195](https://github.com/2ton-exe/moris-mix-ai/pull/195) merged, automatic [Modular Main Validation #43451688823](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823) ran on the exact merge SHA. Attempts **1** and **2** both passed the main validation jobs and deployed three Supabase Edge Functions, but failed at `Deploy to Cloudflare Workers`. Wrangler `3.90.0` reported Cloudflare API error `10013` while uploading the `moris-mix-ai` Worker version.

### Impact

The release was **partial**: `recipes`, `extract-recipe`, and `generate-recipe` deployed, but the new Cloudflare Workers frontend version was not confirmed deployed. Production URL verification, deployed AI-route checks, and runtime smoke were skipped after the deployment failure. The operator opened the existing `/demo-recipe` page and observed the expected recipe rendered, while the Cloudflare deployment dashboard showed an older active Worker version. This is **point-in-time availability evidence**, not a successful automated post-deployment check or proof of full production health. No rollback was performed. Whether the API functions and previous frontend have compatibility differences was not independently tested.

### Detection

- [Main run #43451688823](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823), attempt 1, failed at approximately **23:23 PHT** (15:23 UTC). Attempt 2 failed at approximately **23:31 PHT** (15:31 UTC), on the same revision and step.
- Cloudflare audit logs recorded failed `Upload Version` actions. The **2026-11-13 23:31:05 PHT** entry identified the `moris-mix-ai` Worker, an HTTP `500` response to the Worker versions upload API, and Wrangler `3.90.0`. Audit Ray ID: `a59ed244799b2158`. No credentials or account identifiers are retained here.
- [PR #195 post-merge verification](https://github.com/2ton-exe/moris-mix-ai/pull/195#issuecomment-6857371063) records the initial failure and distinguishes passed, failed, and skipped steps. Attempt 2 independently reproduced the same failure.

### Root cause

**Strongly correlated with a Cloudflare-side Workers API incident; exact internal cause unverified.** In the [official Workers API incident](https://www.cloudflarestatus.com/incidents/e7ktq32gphhe), Cloudflare reported elevated 5xx errors during Worker deployments beginning at **23:31 PHT**, identified the problem at **23:39**, and announced a fix with **Monitoring** status at **23:42**. This directly overlaps the second failed attempt. The first failure at 23:23 predates the published incident start, so it cannot be attributed conclusively. HTTP 500 and the acknowledged incident do not, by themselves, rule out a request-specific trigger.

### Fix

Cloudflare reported implementing a provider-side fix at 23:42 PHT and monitoring its results. **No repository, token, Wrangler version, configuration, or production rollback change was made to address this incident.** The announced provider fix is not proof that this application's deployment recovered.

### Recovery

**Pending.** Do not infer recovery from the older Worker being reachable or from the provider's Monitoring announcement. After confirming provider readiness, authorize a controlled, revision-specific deployment recovery; then verify the new Worker version, intended deployed URL, AI-route checks, and production runtime smoke. Any rerun may repeat already successful Supabase deployments, so scope and side effects must be reviewed first.

### Recovery time

**Not measured.** There is no confirmed timestamp when the intended release became successfully deployed and verified. The older frontend's availability is not a recovery timestamp.

### Prevention / follow-up

- Retain the exact SHA/run/attempt and Cloudflare audit evidence; check the official incident resolution before attempting recovery.
- If failure recurs after the provider incident, investigate the API response and request details before changing secrets, permissions, or Wrangler versions.
- Verify recovery using real deployment and runtime evidence. Record any new run, status, artifacts, deployed Worker version, and time before changing this entry to recovered.
- Keep unrelated DEVOPS-10 [restore issue #159](https://github.com/2ton-exe/moris-mix-ai/issues/159) open until its own isolated-restore criteria pass; this deployment incident does not prove or refute database recovery.

### Evidence

- [Merged PR #195 and original delivery record](https://github.com/2ton-exe/moris-mix-ai/pull/195).
- [Exact-merge main run, attempts 1 and 2](https://github.com/2ton-exe/moris-mix-ai/actions/runs/43451688823).
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
