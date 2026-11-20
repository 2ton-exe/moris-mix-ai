# PR Secretary

PR Secretary maintains one GitHub Actions bot comment per eligible Mori’s Mix
pull request. The comment reports review and delivery evidence using Node 24
built-ins and GitHub APIs. Existing merge policy and delivery workflows still
make their own decisions. CodeRabbit is optional.

## Events and PR association

| Event | Refresh behavior |
| --- | --- |
| `pull_request_target` | Main-target open, reopen, synchronize, edit, draft, ready, close, reviewer request, and reviewer removal. The resolver validates the repository and PR number, then fetches fresh PR state. |
| `pull_request_review` / `pull_request_review_comment` | Review submit, edit, dismissal, and inline create, edit, or delete start **PR Secretary Review Signal**. Approvals and changes requested are submitted reviews. A successful signal completion wakes the trusted writer. |
| `workflow_run` for Modular PR Validation | Requested, in progress, and completed. A refresh reads the applicable run and current jobs, including retries, failures, and skips. GitHub omits the requested phase on reruns. |
| `workflow_run` for Modular Main Validation | Requested, in progress, and completed on a same-repository `main` push or dispatch. The triggering SHA must be the actual merge SHA of a PR returned by GitHub’s commit-to-PR lookup. |
| `issue_comment` | Conversation comment create, edit, or delete is filtered to structured CodeRabbit bot identity on a PR. |
| Schedule | At minutes 17 and 47 past the hour, refresh open main-target PRs and up to ten recent closures. Scans the 30 most recently updated closed PRs and selects closures from the last seven days. |
| Manual | Run **PR Secretary** on the `main` branch with one decimal PR number. Eligible open, merged, and closed-unmerged PRs can be refreshed, including older PRs. |

Review signals and PR validation runs must have the expected workflow path,
event type, repository, head repository, head branch, and SHA. The resolver
starts with GitHub’s run-to-PR association. When the run lists no PRs, it looks up
the exact commit’s PRs and, if that yields no candidates, asks GitHub for the
encoded head owner and branch. The fallback requires exactly one current,
main-target PR whose head matches the run’s repository, branch, and SHA. A
missing or ambiguous association, stale revision, fork restriction, or
withheld signal leaves recovery to another qualifying event, manual refresh,
or the schedule.

The triggering event chooses which PR to refresh. The writer rereads reviews,
checks, and lifecycle from GitHub after acquiring the per-PR concurrency lock.
Individual GitHub Actions job transitions become visible on the next supported
refresh. Review thread resolution or reopening without a review or inline
comment event is picked up on reconciliation. Schedules and workflow dispatch
are subject to GitHub’s queue and event delivery.

## Dashboard

- **Lifecycle and revision** show draft, open, merged, or closed without merge.
  Merged comments include the full PR head and actual merge SHA and time.
- **Human reviews** show actual reviewer and team requests separately from
  affected ownership. Effective reviews use submitted time and ID, ignore bots
  and pending drafts, and keep an approval or change request through a later
  comment-only review. Dismissals and earlier-revision decisions are explicit.
  Terminal views display historical reviews and remove reviewer prompts.
- **Required checks** use the active branch rules with bound app identities
  where available. The three documented main contexts are a fallback when the
  rules endpoint is unavailable or empty. Fallback success is labeled
  integration-unverified. Final-head checks on terminal PRs use the policy
  visible at collection time.
- **Other PR delivery** displays E2E and staging separately. Draft, fork,
  Dependabot, and documentation-only staging exclusions require observed skip
  evidence. A failed deploy and its dependent smoke skip are attributed only
  within the same run and attempt. An unexpected PR production job remains a
  diagnostic. Hosted RLS on the PR caller is expected to skip when observed.
- **CodeRabbit** reports structured bot activity and unresolved bot-rooted
  threads. A conversation comment shows activity. A submitted, non-dismissed
  bot review on the PR head shows REVIEWED. Only humans appear in human review
  history. The script never interprets finding prose or infers severity.
  When thread inventory is unavailable, its count is unknown.
- **Attention and detailed evidence** show open-PR issues, affected ownership,
  optional checks, and relevant reviewer guidance. The expandable details use
  GitHub-flavored Markdown with display-only symbols. An unchanged dashboard
  retains its previous update timestamp and makes zero comment writes.

| Symbol | Examples |
| --- | --- |
| ✅ | PASS, VERIFIED, APPROVED, MERGED |
| ⏳ | PENDING, RUNNING, WAITING, DRAFT |
| ❌ | FAIL, CHANGES REQUESTED, CANCELLED, SKIPPED — INVESTIGATE |
| ➖ | UNKNOWN, NOT RUN, SKIPPED, DISMISSED, or earlier-revision approval |

Check and job evidence is read for the exact PR head. The selected Modular PR
Validation run’s jobs take precedence over stale known workflow checks. Active
reruns discard prior-attempt job results while the new attempt is in flight.
GitHub Actions jobs establish app identity through the locally constructed
check-run ID lookup. A matching context name from a different app cannot meet
an app-bound requirement. GitHub’s rules and review decisions remain
authoritative for merging.

## Path classification

Areas are additive and printed in a fixed order. Affected ownership describes
review and delivery impact. GitHub tracks reviewer requests separately. Unmatched
paths are reported as unclassified; renames classify both old and new paths.

| Paths | Affected ownership |
| --- | --- |
| `frontend/**` | Frontend |
| `supabase/functions/**` | Backend/API |
| `supabase/functions/_shared/ai/**`, `supabase/functions/tests/ai_*`, `supabase/functions/tests/eval_dataset*` | Backend/API + AI |
| `fixtures/ai-extracted-recipe.json`, `docs/api/ai-integration.md` | AI |
| `supabase/migrations/**` | Backend/API + Database + DevOps |
| `supabase/seed.sql`, root `test-migrations.mjs`, `test-rls.mjs`, `test-rls-guard.mjs` | Backend/API + Database |
| Root `run-migrations.mjs` | Backend/API + Database + DevOps |
| `.github/workflows/**`, `wrangler.jsonc`, `supabase/config.toml`, `docs/devops/**`, `scripts/pr-secretary*` | DevOps |
| `frontend/e2e/**`, `frontend/playwright.config.mjs`, frontend `*Integration.test.tsx` | Frontend + Integration |
| Hosted RLS/lineage test paths `auth_rls_integration_test.ts`, `cross_user_rls_lineage_test.ts` | Backend/API + Integration |
| Root `run-local-tests.mjs` | Integration |

Migrations affect DevOps because they can change schema and delivery safety. Delivery config and migration
changes produce concrete Attention items. Four or more ownership areas produce
a coordination reminder.

## Exact main delivery

The merge SHA comes from the closed PR’s `merge_commit_sha` after GitHub confirms
`merged: true`. On an open PR that field can identify a synthetic test merge.
A squash, rebase, or merge can produce a different main commit from the PR
head. A newer main run or a run on a different ref is unrelated.

The collector selects the newest **Modular Main Validation** run whose
repository, workflow path, `main` branch, event, and exact head SHA match the
merge. It links the selected attempt and reads its jobs. The main validation
row covers the three core jobs plus Hosted RLS, with E2E shown separately.
Production deployment requires success from the essential Supabase and
Cloudflare deploy steps and accounts for observed feature-dependent steps.
Production smoke requires the deployment URL check, deployed AI-route
verification, and the runtime smoke step in that same attempt, with deployment
established. The workflow run’s overall conclusion is insufficient by itself.

An active run can provide pending evidence. An explicit failed, skipped, or
cancelled job or step retains that outcome. A missing or unrelated run, partial
rerun without the necessary jobs, missing evidence, or API failure leaves the
affected result unknown. Deployment can be verified while smoke fails.
These are historical outcomes for that release attempt. The comment does not
measure the current production revision or run a live probe.

## Trust, concurrency, and API limits

The review signal has empty permissions, no checkout, no action dependencies or
secrets, and a fixed no-op command. Its definition can run in a PR context.
The privileged pipeline consumes only GitHub-generated run metadata. It does
not take a PR number or status from an artifact, output, log, cache, or
user-controlled text.

The resolver and writer check out only this repository’s `refs/heads/main`,
with credential persistence disabled and checkout/Node actions pinned. Workflow
permissions start empty. The resolver grants contents and pull requests read.
The writer grants contents, actions, checks and statuses read plus pull
requests write, the permission used by the PR conversation comment endpoint.
GitHub scopes this token to PR operations, so trusted code restricts its writes
to creating or updating the owned comment. No production credentials or
provider services participate.

The writer recognizes the bot-owned `<!-- moris-pr-secretary:v1 -->` comment and
refuses unsafe IDs. Event content flows through validated fields and constructed
API paths. Titles, logins, and paths are escaped before display, including
mentions. Review and comment prose are excluded. The bot does not match its own
issue-comment filter and the writer does not subscribe to its own runs.

One writer per repository/PR runs at a time, with active jobs protected from
cancellation by a newcomer. GitHub may replace pending jobs. Each surviving
job collects fresh state and checks the lifecycle before publishing, again
immediately before a write. A changed lifecycle gets one recollection attempt.
Observation timestamps guard against stale snapshots, with the legacy run
marker used for legacy comments. The API offers no atomic compare-and-swap for
a PR lifecycle and its comment. A PR can change after the final check or a
same-head review/check can change between API reads. The next event or
reconciliation rereads state.

Each job has a 120-request cap, a 30-second request timeout, a 32-page REST
limit per collection, and a ten-page review-thread limit. Workflow signals
consider at most 20 associated PR candidates. The matrix has a 256-entry limit
and a concurrency cap of four within each run. Rate-limit exhaustion or a
reported retry window halts further requests to that API resource in the same
job. Comment mutations have no automatic transport retry. A later refresh
looks up the owned comment again, covering a response lost after a successful
write.

## Troubleshooting and verification

Check **PR Secretary** for resolver and writer results. An empty resolver
matrix means no eligible association was established. For a review, first
check whether the signal ran, then check its event, head metadata, and
association. For a missing merge release, check the exact main run and attempt
in Actions, including named steps. Use the single-PR manual refresh on
`main` if necessary. The writer’s `created`, `updated`, and `unchanged`
results distinguish writes from reads. For stale, permission, or rate-limit
failures, inspect the run and wait for the next eligible refresh.

Baseline observed on November 20, 2026 at about 16:45 Manila time. PR #240
opened at 12:34:40 and its Secretary comment appeared at 12:35:07, a 27-second
observed creation delay. The latest update was at 14:41:44. Approval at 16:04:43
and merge at 16:17:42 left the comment displaying Ready for review and Belen
WAITING. The approval and merge refresh latencies were unobserved after about
40 and 27 minutes respectively. The old workflow omitted direct review
and close triggers, and the resolver, collector, and publisher excluded closed
PRs. GitHub returned the actual merge SHA and the associated successful main
run with named deployment and smoke steps.
[PR #240 Secretary comment](https://github.com/2ton-exe/moris-mix-ai/pull/240#issuecomment-7030522088)
[Exact main run](https://github.com/2ton-exe/moris-mix-ai/actions/runs/44701388892)

To compare after rollout, use the same server timestamps and poll the same
comment ID at a fixed interval. Record `created_at` from PR and comment for
creation, `submitted_at` for reviews, `merged_at` for merge, and the exact job
or run completion time for release. Record the first matching dashboard state,
its comment `updated_at`, and the writer run URL. Record the polling window
when a change remains unobserved. Send a repeat signal with unchanged evidence
and check that the writer logs `unchanged` and the comment timestamp does not
move. Include representative approval, changes-requested, dismissal,
reviewer-change, fork, closed-without-merge, and successful/failed exact-main
cases. Compare the same event classes and report unobserved transitions
separately from measured latency.

The local Secretary suite passed 149 tests on Node 24, including associations,
Markdown, staging, retries, stale writes, and closure and release races.
Actionlint 1.7.7 passed on both Secretary workflows. The existing Frontend
Checks job runs the Secretary suite. A separate related suite on Windows
passed 118 of 123 tests, with the same five shell-dependent failures on clean
`main` and the implementation branch. A read-only check of #240’s exact main
run and attempt classified its recorded validation, E2E, deployment, and smoke
outcomes as VERIFIED. GitHub-hosted delivery of this new workflow, fork
approvals, live comment permissions, exact-head PR CI, and production
behavior after rollout remain to be verified. No post-rollout latency is
available.

[GitHub Actions event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
[GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
[GitHub Actions REST jobs reference](https://docs.github.com/en/rest/actions/workflow-jobs)

## Runtime repair evidence for issue #86 (2026-10-28)

### Later recovery status

[Issue #86](https://github.com/2ton-exe/moris-mix-ai/issues/86) was subsequently
completed and closed after [PR #89](https://github.com/2ton-exe/moris-mix-ai/pull/89)
merged and recorded post-merge verification on real PR #88 confirmed persistent
summary creation/update behavior, with no observed bot loop or older-state
overwrite in the exercised scenarios. This status reconciliation relies on the
recorded GitHub evidence; it does not claim a new lifecycle rerun. Recovery time
was not measured. This was a DevOps delivery-tooling incident, not a production
application outage. See the [reconciled incident record](incident-log.md#incident-devops-86--2026-10-28--pr-secretary-publication-failure).

### Historical pre-repair record

At the time of this 2026-10-28 observation, main was inspected at
`7af713040beb6dbaba271867f559149f9d21bce6`, the merge of PR #87. Real PR #88
exposed failures; issue #86 was still incomplete. The failure evidence below
is retained as the pre-repair record, superseded in status by the recovery above.

- [PR Secretary run #35](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40676161057)
  was an `issue_comment` run from trusted main. Resolve succeeded; summarize (88)
  failed on `POST /repos/2ton-exe/moris-mix-ai/issues/88/comments` with HTTP 403.
  Its token reported Issues write and PullRequests read alongside the expected
  Actions/Checks/Contents/Statuses reads. A prior run also failed with a comment
  403. The old client discarded GitHub's error JSON, so the original server
  message and accepted-permissions header were not retained.
- PR #88 was open, unlocked, and same-repository; the repository was not archived
  or disabled and Issues were enabled. The failing consumer was not a
  `pull_request` job downgraded to a read-only fork token. The script receives
  `github.token` directly, with no alternate-token setup. Private Actions policy
  settings were not accessible through the unauthenticated read-only settings
  request, and have not been changed.
- The `/issues/.../comments` endpoint is correct for PR conversation comments.
  Its [reference](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment)
  documents Issues write or Pull requests write as alternatives. A matching
  [upstream API issue](https://github.com/github/rest-api-description/issues/6994)
  reports an installation-token 403 with Issues write plus PR read, resolved by
  adding PR write. This supports the narrowly targeted writer permission repair;
  it was not itself proof that our repaired workflow had succeeded. No PAT, broader
  workflow-wide permissions, alternate event, or repository-policy change is added.
- A separate CodeRabbit-triggered run was reported to collect successfully but
  return `stale` after `updated_at` changed. The old equality check explains
  that false stale result independently of the comment authorization failure.

The repair retains HTTP status on API errors and reports only bounded,
single-line, credential-redacted `message`, a validated HTTPS `docs.github.com`
`documentation_url`, and strictly validated permission/request-ID headers when
present. Raw response bodies, request payloads, arbitrary headers, and JSON parse
errors are not logged. Missing/malformed error JSON still produces the status.
Future 403 evidence can therefore distinguish permission rejection from another
GitHub policy, abuse/rate limit, or resource restriction without blindly adding
more permissions. Write failures are not automatically retried, avoiding duplicate
comments after uncertain outcomes.

At the repair stage, local validation still required a later authorized merge
and real default-branch event to establish successful creation and subsequent
update of the same bot-owned summary. No comments or workflow reruns were
performed during that repair task. Issue #86 was kept open pending that proof;
the later recovery status above records its completion.

Known limits at the time of the #86 repair:

- Only open PRs targeting `main` are maintained. Closed PR comments remain as
  historical snapshots. Unclassified paths need policy updates when new areas
  appear.
- Events may arrive before checks exist. The next workflow event or scheduled
  reconciliation refreshes the table. Individual job transitions and thread
  resolve/unresolve have eventual rather than immediate updates. Workflow-run
  associations with nonmatching/missing head metadata safely skip that event.
- Human review submit/edit/dismiss, reviewer request/remove, draft conversion,
  thread resolve/unresolve, and missed CodeRabbit inline activity can remain
  stale until scheduled reconciliation when no qualifying event occurs.
  There is no immediate review-only event path. Fork metadata is still read
  without executing fork code.
- GitHub API rate limits, permissions, scheduled delays, checks recorded only
  on another SHA, naming changes, and unavailable APIs can limit evidence.
  Required core collection failures fail visibly without publishing partial
  state. An incomplete changed-file listing (including the REST 3,000-file cap)
  fails closed. Optional CodeRabbit APIs degrade as described above.
- The active-rules lookup and app-aware evidence do not establish legacy
  protections, merge queues, bypass rights, or full mergeability.
  The fallback policy needs maintenance if required contexts change.
- The draft flag is current state, while older staging evidence may come from
  an earlier ready/draft state on the same SHA. Existing evidence is reported,
  not fabricated into a new workflow execution.

## Post-merge lifecycle verification for issue #86

The following historical pre-closure verification plan is retained for traceability
and future regression checks. It is not a current instruction to keep the completed
issue open; the later recovery status is recorded above and in the incident log.

**configured ≠ executed**; **local tests ≠ GitHub Actions evidence**;
**merged ≠ runtime-verified**.

The safe consumer and module must exist on trusted `main`. It is acceptable for
the implementation PR not to receive a working Secretary comment. Do not execute
its head with a write token to manufacture that evidence.

The pre-closure plan called for subsequent real PR activity after Haresco reviewed,
committed, pushed, and merged the implementation, while #86 was open. It specified
collecting run URLs, PR/comment URLs, revision SHAs, comment IDs, timestamps, and
observed gate names for:

1. Open/reopen and rapid synchronize through CI-related workflow activity.
   Confirm one comment, fresh revision, and per-PR cancellation. Test ready/draft
   changes and reviewer addition/removal, allowing scheduled refresh when
   CI does not run; removed reviewers must lose their checklist after refresh.
2. Human review submit/edit/dismiss and inline review-comment/thread activity.
   Confirm effective human review and thread state after scheduled
   reconciliation without requiring an immediate event-driven write.
3. CI/modular start/completion and reruns, including failed/pending/missing
   required contexts, app identity bindings (including unknown/wrong app evidence),
   and actual nested reusable check names. Confirm expected
   fork/draft staging and hosted skips, and investigate eligible skips using
   existing workflow evidence. Never trigger production as a Secretary test.
4. CodeRabbit absence, conversation-only activity, current-revision review,
   unresolved/resolved threads, path routing, and scheduled refresh. Confirm
   ordinary user comments and Secretary updates cause no writer loop.
5. Fork PR metadata handling, no PR-head execution, least-privilege token use,
   and no application credentials in Secretary jobs. Confirm existing required
   checks and delivery behavior remain unchanged.

Record configured, locally tested, GitHub-executed, and real-PR-runtime-verified
states separately. At that stage, #86 required lifecycle evidence to be collected
and reviewed before closure; implementation alone was insufficient. That later
evidence is now recorded and the issue is completed/closed.

GitHub references: [event semantics and privileged-event boundaries](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[read-only active branch rules](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch),
[issue conversation comments](https://docs.github.com/en/rest/issues/comments),
and [token permissions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication).
