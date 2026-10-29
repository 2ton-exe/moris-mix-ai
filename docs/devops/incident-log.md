# DevOps incident log

Record genuine CI/main/production incidents and recovery evidence. Separate production deployment/runtime failures from failures of delivery tooling; neither count nor recovery time can be transferred between those populations.

Qualifying incidents include production deployment failure, main/release pipeline failure with operational impact, production outage/degradation, rollback/recovery operations, and delivery-system failures requiring remediation. Record impact and evidence before assigning a category; an unsuccessful check alone is insufficient.

Do not count intentional controlled failure experiments, deliberately failing gate tests, PR-only expected failures, expected production-deploy skips on PRs, CodeRabbit comments, local test failures, forced staging failures or application retry tests that were not real production incidents. Those belong in task evidence or the [optimization log](optimization-log.md), not production incident totals.

Use [pipeline metrics](pipeline-metrics.md) for defined-period counts/rates and the [deployment runbook](deployment-runbook.md#12-recovery-and-rollback) for rollback procedures. No qualifying production deployment/runtime incident is entered from this reviewed evidence; that is not a claim of zero incidents across the sprint. The genuine delivery-tooling incident below is not a production outage or failed production deployment.

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
