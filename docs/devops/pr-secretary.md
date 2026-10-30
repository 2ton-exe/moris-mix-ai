# PR Secretary v1

PR Secretary is a deterministic PR operations view for Mori's Scraps (#86).
It reports changed areas, requested reviewers, affected ownership, delivery
evidence, human reviews, and optional CodeRabbit activity in one PR conversation
comment. It uses Node 24 built-ins, with no LLM, runtime package installation,
provider API, or production API calls. It does not review code, decide approval,
merge, deploy, or change delivery gates.

## Architecture and security

The comment workflow remains informational and non-gating. Its deterministic
regression tests run inside the existing `Frontend Checks` job in authoritative
`ci.yml` and reusable frontend validation, from the repository root, using Node's
built-in test runner with no added dependencies. A regression fails that existing
CI check. Required check names, staging and production deployment configuration,
and branch rules are unchanged.

- `.github/workflows/pr-secretary.yml` resolves event metadata in a read-only job,
  then renders and upserts a comment in a separate per-PR job.
- `scripts/pr-secretary.mjs` collects GitHub state, classifies paths, normalizes
  checks/reviews, renders Markdown, and maintains the comment. Pure functions
  accept ordinary objects; tests mock all API calls.

The comment workflow uses only default-branch event definitions (`workflow_run`,
`issue_comment`, schedule). No Secretary workflow runs in PR-controlled
workflow definitions. Both jobs explicitly check out `github.repository` at
`github.event.repository.default_branch`, sparse-checkout `scripts`, and disable
persisted credentials. They never check out a PR head/merge ref, import a PR
module, install PR dependencies, consume artifacts/caches, or execute PR content.
The only executed repository code comes from the trusted default branch.
Protecting the default branch remains part of the repository's trust model.

Workflow-level permissions are empty. The resolver grants `contents: read` and
`pull-requests: read`. The writer grants `contents: read`, `actions: read`,
`checks: read`, and `statuses: read`, with `pull-requests: write` as its only
PR-comment write permission. It does not grant `issues: write`. The Actions
installation token previously returned 403 with Issues write and PR read.
There is no contents write, administration, deployments, or OIDC permission.
GitHub does not offer a token
permission limited to one comment. PR write technically permits other PR API
mutations; the trusted module uses only issue-comment create/update mutations,
and the resolver stays read-only. Default-branch-only execution is essential.

Only `GITHUB_TOKEN` is supplied. No Cloudflare, Supabase, AI-provider,
environment, or production secrets are read. Untrusted titles/logins/paths are
escaped, including mentions and HTML. Review/comment prose is never reproduced
or evaluated. API URLs are constructed locally; redirects are refused and
returned URLs are never followed with the token.

## Triggers and event-to-PR resolution

| Event | Handling |
| --- | --- |
| `workflow_run` | In progress and completed for `CI` and `Modular PR Validation`. Only PR-origin runs from this repository are considered. These existing workflows provide the primary near-real-time signal for normal PR updates. |
| `issue_comment` | Created/edited/deleted conversation comments only when the structured author is `coderabbitai[bot]` with type `Bot`, on a PR. Arbitrary human/Secretary comments skip the resolver job. |
| Schedule | At minutes 17 and 47 each hour, re-read all open main-target PRs. Covers human review submit/edit/dismiss, reviewer request/remove, draft conversion, thread resolve/unresolve, missed CodeRabbit inline activity, missed events, and intermediate check progress. Scheduled execution can be delayed by GitHub. |

The v1 consistency model is explicit:

| State change | Consistency |
| --- | --- |
| CI-related PR state | Near real time through `workflow_run`. |
| CodeRabbit conversation | Near real time through filtered `issue_comment`. |
| Review/thread-only state | Eventual through scheduled reconciliation. |
| Missed-event recovery | Scheduled reconciliation. |

Human review changes, reviewer request/removal, and draft conversion are not
immediate if they do not start one of the existing CI workflows. Thread-only
activity and resolution are also eventually consistent. The next qualifying
workflow/comment event or scheduled reconciliation re-reads all state.
There is no additional PR-controlled workflow to make these updates immediate.

Workflow events first use `workflow_run.pull_requests`. An empty association
falls back to the structured commit-to-PR API, using only a validated SHA.
Every candidate is fetched afresh and must be open, target `main` in this
repository, and (for workflow events) match the run's head SHA and head repository.
Stale runs, unrelated pushes, unsafe/missing associations, and closed PRs exit
successfully without writing. No inference from branch names, prose, artifacts,
or shell output is used. Scheduled reconciliation paginates open PRs; more than 256
eligible PRs fails visibly instead of silently dropping matrix entries.

The consumer never subscribes to its own workflow runs. Its comment author is
not CodeRabbit, so its comment writes cannot form an event loop.

## Path classification

Areas are additive and printed in a fixed order. Affected ownership describes
review/delivery impact, not authorship or a GitHub reviewer request. Unmatched
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

Migrations affect DevOps because schema/environment delivery safety matters;
this does not claim DevOps authored the migration. Delivery config and migration
changes produce concrete Attention items. Four or more ownership areas produce
a coordination reminder.

## Reviewers and human reviews

`TEAM` in the module is the single identity mapping:

| GitHub identity | Name | Role |
| --- | --- | --- |
| DaeSaster | Haresco | DevOps |
| DanielRamos1186 | Ramos | Backend |
| adnro2 | Ong | Frontend |
| KleinRheePagulongSioson | Sioson | AI |
| myntchoc | Belen | Integration / Full-stack |

Requested users/teams come exclusively from fresh GitHub metadata. Affected
ownership never implies a reviewer was requested. Unknown users get a general
section with no invented role. Teams are listed without inventing membership.
Role-specific checklists appear only for currently requested human users and
are shortened to relevant areas, with a general evidence item when unrelated.

Human reviews use structured submitted review states, ordered by submission
time/ID. Bot reviews and pending drafts are excluded. A later comment-only
review does not erase an approval/change request; a dismissal is displayed as
`DISMISSED`, never approval. Earlier-revision approvals/change requests are
explicitly labeled. The Secretary does not calculate merge approval or enforce
review dismissal rules. Submitted human reviewers remain visible after GitHub
removes their review request. A ready PR without a requested human/team or
current-revision human approval gets an Attention item; drafts do not.

## Delivery evidence and required checks

Collection reads check runs and commit statuses for the current PR **head SHA**.
It also reads jobs from the newest head-SHA PR run of the known CI workflow
paths, so pending/rerunning jobs take precedence over older successful checks.
Known workflow paths accept GitHub's optional `@ref` suffix while still requiring
the exact workflow file path before the suffix.
Nested reusable job names are matched explicitly, including
`Playwright E2E (Non-gating) / Playwright E2E Tests`, modular validation jobs,
`Modular E2E / Playwright E2E Tests`, and
`Modular Staging / Staging Deploy` / `Modular Staging / Staging Smoke`.
A skipped caller named `Modular Staging` supplies skip evidence for its absent
children. The table omits unrelated checks; dynamically required extra contexts
are included. GitHub Actions gates exclude external check-app/status name
lookalikes. This summary is evidence display, not branch-protection enforcement.

The read-only branch-rules endpoint is tried first. Structured active
`required_status_checks` objects preserve both `context` and `integration_id`
(represented as `integrationId`) and take precedence. If unavailable (403/404/422)
or absent, `PROJECT_REQUIRED` is the centralized documented **main-only policy
fallback**: `Frontend Checks`, `Database Tests`, `Edge/API Tests`. Its source is
`docs/devops/deployment-runbook.md` and `docs/devops/modular-workflows.md`.
Each fallback entry has `integrationId: null` and `integrationUnverified: true`.
The comment labels the fallback as live enforcement unconfirmed, and a successful
fallback context displays `PASS (fallback; integration unverified)`. Empty branch
rules are not proof of no requirements: legacy branch protection is outside
that endpoint. No administration permission is added to read it. Other base
branches have unknown requirements and are currently excluded from writing.
Unexpected rule API failures fail the run visibly. Rules are never changed.

For an active app-bound requirement, a matching name alone is insufficient:
the check's structured `app.id` must match the ruleset's integration ID. A
same-name result from a different app displays `INTEGRATION MISMATCH`, with
Attention. If no compatible app identity can be established, it displays
`IDENTITY UNVERIFIED`, with Attention, rather than PASS. No matching context
displays NOT RUN. Commit statuses' creator IDs and app slugs are not substitutes
for a numeric check-app ID. Active requirements without an integration binding
use the context; their absent binding is preserved as null. Distinct bindings
for one context remain distinct required rows.

Actions jobs retain their newest-run state and obtain app identity by joining
their `check_run_url` numeric ID to structured check-run data. A missing head-SHA
check run is fetched by that ID through a locally constructed, same-repository
endpoint; returned URLs are never followed. The join checks the exact ID and job
name. Missing/unsafe links, unavailable check data, or an invalid identity leave
the app unknown. A job's workflow name alone never proves its numeric app ID.
No Actions integration ID is hard-coded into the runtime policy.

| Display | Meaning |
| --- | --- |
| PASS | Observed success conclusion/status. |
| FAIL | Failure/error, timeout, startup failure, or action required. |
| RUNNING | Queued, pending, waiting, requested, or in progress. |
| SKIPPED — EXPECTED | Observed skip explained by a known PR condition below. |
| SKIPPED — INVESTIGATE | Observed skip without a known eligibility explanation; inspect upstream dependencies too. |
| NOT RUN | No matching evidence for an applicable gate. It is not a failure or a pass. |
| NOT REQUIRED | No evidence and gate not applicable to the base branch. It does not claim GitHub enforcement state. |
| CANCELLED / NEUTRAL / STALE | Preserved terminal state, never recast as PASS. |
| INTEGRATION MISMATCH | Same context observed, but no check from the required app was established. |
| IDENTITY UNVERIFIED | Context observed without enough structured app identity to establish the binding. |

Missing/failed/skipped/cancelled/stale or identity-unverified/mismatched required contexts generate
Attention, including the policy source. Pending checks do not become failures.
Validation success never implies staging or production deployment success.

Expected skips follow the inspected existing workflows:

- **Production:** `Deploy to Cloudflare` runs only on main push/dispatch after
  validation; only an observed `status: completed`, `conclusion: skipped` is
  expected. Any other observed PR production-job state produces Attention,
  including queued, requested, waiting, in progress, success, failure, cancelled,
  or incomplete conclusion data. Absence is NOT RUN. Validation never establishes
  production execution or success.
- **Staging:** `modular-pr-validation.yml` requires a non-draft PR whose head
  repository matches this repository, plus successful frontend/database/Edge
  dependencies. Draft/fork skips are expected; author-association labels do
  not affect eligibility. An otherwise eligible PR's skip is investigated,
  with an upstream-check reminder; the Secretary does not invent credential
  or deployment evidence.
- **Hosted RLS:** `ci.yml` skips the separate hosted job on forks. For internal
  PRs, a skip needs investigation (including upstream Edge/API failure).
  Missing dedicated hosted credentials cause the separate job to fail closed.
  Optional hosted-test steps inside Edge/API may skip when credentials are
  absent; the Secretary neither inspects secrets nor claims those steps ran
  from their parent job's success.

## CodeRabbit boundary

CodeRabbit is optional. Only structured `Bot` identity with login
`coderabbitai[bot]` (REST) or `coderabbitai` (GraphQL) is recognized. A user
mentioning CodeRabbit or severity words has no special meaning.

- `NOT DETECTED`: no recognized GitHub-visible evidence was found.
- `ACTIVITY DETECTED`: recognized conversation/review/inline activity exists.
- `REVIEWED`: a submitted, non-dismissed CodeRabbit review is attached to the
  current head SHA. A conversation comment alone never establishes this state.

Latest activity uses structured timestamps. Paginated GraphQL review threads
count unresolved threads whose **root comment** is CodeRabbit-authored; a bot
reply in a human-rooted thread does not change ownership. Resolved threads are
excluded; unresolved outdated threads remain unresolved evidence. Paths are
classified into affected areas. Only paths present in the PR's changed-file set
route reminders into currently requested reviewers' checklists. At most five
paths are printed, with an overflow count. No finding prose or inferred severity
is copied. API differences/permission failures for optional inline/thread data
do not fail the Secretary: unavailable thread counts print `Unavailable`, with
an Attention note, rather than a misleading zero.

## Comment lifecycle and concurrency

The marker is exactly `<!-- moris-pr-secretary:v1 -->`. Before each write, the
writer lists all conversation comments and selects an existing marker comment
only if authored by `github-actions[bot]` with type Bot. Forged user markers are
ignored. It updates that comment or creates one when absent; identical rendered
content skips the write. Reviewer checkboxes are regenerated from current state
and are not durable manual task tracking.

All writer events share job concurrency group
`pr-secretary-<repository>-<PR number>`, cancelling superseded runs. Each run
collects fresh state instead of replaying the triggering payload. Immediately
before writing it checks that the PR is still open with the same head SHA,
base branch, base SHA, and base repository. It deliberately does not compare
`updated_at`: comments/reviews and unrelated metadata can advance that timestamp
without invalidating the collected code revision. Such activity no longer
suppresses a valid summary. Non-revision metadata remains a collected snapshot
and is refreshed by the next qualifying event or scheduled reconciliation.
A hidden `secretary-run:<run ID>` watermark is an
additional, best-effort stale-write guard: it skips a write when the existing
comment carries a higher run ID. Run IDs do not guarantee event freshness or
write ordering. These protections reduce stale overwrites; GitHub's comment API
has no transactional compare-and-swap,
so cancellation/in-flight write races cannot be eliminated absolutely.
Scheduled reconciliation repairs missed refreshes. The feature never deletes
comments or removes historical duplicates left by manual intervention.

## Local validation and limitations

```sh
node --check scripts/pr-secretary.mjs
node --test scripts/pr-secretary.test.mjs
git diff --check
actionlint -shellcheck= -pyflakes= .github/workflows/pr-secretary.yml
```

Tests use Node's built-in test runner and deterministic mocks, with no live
GitHub access. They cover classification, review/check normalization, skips,
attention/checklists, CodeRabbit boundaries, pagination, event resolution,
fallback policy, comment ownership/idempotency, and stale-write protection.
Regression tests also cover targeted writer permissions, safe non-2xx API
diagnostics, timestamp-only activity, and rejection of changed/closed targets.

## Runtime repair evidence for issue #86 (2026-10-28)

Current main was inspected at `7af713040beb6dbaba271867f559149f9d21bce6`, the merge
of PR #87. Real PR #88 exposed failures; #86 remains incomplete.

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
  it is not proof that our repaired workflow has succeeded. No PAT, broader
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

This repair is locally testable but needs a later authorized merge and real
default-branch event to establish successful creation and subsequent update of
the same bot-owned summary. No comments or workflow reruns were performed during
the repair. Keep #86 open pending that lifecycle proof.

Known limits:

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

**configured ≠ executed**; **local tests ≠ GitHub Actions evidence**;
**merged ≠ runtime-verified**.

The safe consumer and module must exist on trusted `main`. It is acceptable for
the implementation PR not to receive a working Secretary comment. Do not execute
its head with a write token to manufacture that evidence.

After Haresco reviews, commits, pushes, and merges the implementation, use
subsequent real PR activity while #86 remains open. Collect run URLs, PR/comment
URLs, revision SHAs, comment IDs, timestamps, and observed gate names for:

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
states separately. Keep #86 open until the lifecycle evidence has been collected
and reviewed. This implementation alone does not complete the issue.

GitHub references: [event semantics and privileged-event boundaries](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[read-only active branch rules](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch),
[issue conversation comments](https://docs.github.com/en/rest/issues/comments),
and [token permissions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication).
