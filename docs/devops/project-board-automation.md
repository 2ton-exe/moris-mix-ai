# Development Board lifecycle synchronization

Tracking issue: [#147](https://github.com/2ton-exe/moris-mix-ai/issues/147).
Target: organization `2ton-exe`, Project **2**, **2ton.exe - Development Board**,
repository `2ton-exe/moris-mix-ai`.

## Delivery and evidence boundary

This implementation **initially shipped disabled by default**; that is its original
deployment safeguard, not the current operational setting. Configuration and local
tests alone never proved live mutation behavior. As the dated checkpoint below
shows, the synchronizer was activated and exercised on November 6, 2026. Do not
close #147 or claim complete verification until its remaining acceptance evidence
is recorded. This workflow is not a required merge check.

The November 1 preflight observed remote main
`bd192be90428da62d00d2d1cae6f22c529c8740e`, #147 OPEN / Todo, and 98 current
Project items. These observations are historical, not runtime configuration.
CODEOWNERS covered `.github/workflows/**`; `Protect main` required code-owner
review. The implementation does not change either policy, existing modular
validation, Hosted RLS, deployments, or #124 path-selection behavior.

## Live activation and runtime verification — 2026-11-06

**Status at this checkpoint:** The previously disabled-by-default synchronizer is now **enabled and has executed successfully** through both manual and event-driven Actions runs. This is observed runtime operation, not a guarantee about future availability or every untested scenario. The tracking issue [#147](https://github.com/2ton-exe/moris-mix-ai/issues/147) stays open until the remaining review, documentation, and lifecycle requirements are satisfied.

The operator configured the dedicated `2ton Dev Board Sync` GitHub App owned by `2ton-exe` and installed only on `moris-mix-ai`. Its repository Issues, Pull requests and Metadata permissions are **read**, with organization Projects **read/write**; the workflow downscopes the Projects token to **read** for manual dry-run. The client ID is held in `PROJECT_AUTOMATION_APP_CLIENT_ID`, the PEM key in the Actions secret `PROJECT_AUTOMATION_APP_PRIVATE_KEY`, and the activation variable is `PROJECT_AUTOMATION_ENABLED=true` in verified reconcile runs. This record does **not** include or disclose credential values. The operator reconfirmed that built-in Project workflows and repository linked-PR auto-close were disabled, and the applicable Actions event policy explicitly allows `issues`, `pull_request_target`, `workflow_dispatch`, and `schedule`.

### First activation and steady-state checks

| Evidence | Result |
| --- | --- |
| [Manual dry-run #132](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42188916117) | Success; **24 proposed, 0 applied, 0 rejected relationships** |
| [First write reconciliation #133](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42191091843) | Success; **24 proposed, 24 applied, 0 rejected** (7 add and 17 status operations) |
| [Event run #134](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42191735611) | Success; **0 proposed / 0 applied** |
| [Event run #135](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42192406990) | Success; **0 proposed / 0 applied** |
| [Pre-activation event runs #130](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42186240868) and [#131](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42186904635) | `disabled` job succeeded, while `synchronize` was skipped; this proves the disabled event path before activation, not disabled schedule or malformed-value pre-token guards |

After activation, the operator visually checked representative Project cards and their expected statuses. The complete snapshot/reconciliation logic rejects duplicate items and requires current open repository content, but a green run alone is not an independent manual inspection of every card.

### Controlled event-driven lifecycle fixture

Isolated [test issue #170](https://github.com/2ton-exe/moris-mix-ai/issues/170) and [test PR #171](https://github.com/2ton-exe/moris-mix-ai/pull/171) were used. The PR contained only a temporary documentation file on `test/170-development-board-lifecycle` and was **closed without merging**. None of that fixture PR's changes reached `main`.


| Lifecycle action | Evidence | Applied Project result |
| --- | --- | --- |
| Create issue | [#136](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42195384559) | Issue #170 added and set `Todo` |
| Open linked draft PR | [#137](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42195577547) | Issue #170 `In Progress`; draft PR #171 added as `In Progress` |
| Mark PR ready | [#138](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42195702904) | PR #171 `In Review` |
| Edit PR #171 | [#139](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42195861424) | Zero-operation reconciliation: 0 proposed / 0 applied |
| Close PR **without merge** | [#140](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42196070305) | Issue #170 restored to `Todo` while remaining **open**; PR Status cleared and card archived |
| Close issue `Not planned` | [#141](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42196223676) | Issue Status cleared and card archived; not `Done` |
| Reopen issue | [#142](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42196374646) | Issue #170 unarchived and restored to `Todo`; this full-board run also added unrelated PR #172 |
| Open PR #172 | [#143](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42196389258) | Zero-operation reconciliation: 0 proposed / 0 applied |
| Explicitly close issue `Completed` | [#148](https://github.com/2ton-exe/moris-mix-ai/actions/runs/42203724235) | Issue #170 set to `Done` (**1 proposed / 1 applied / 0 rejected**) |

These outcomes are supported by successful jobs and acknowledged Project GraphQL mutations. A separate manual Project UI check of final fixture #170 `Done` is still pending in this record. The issue was closed **by a person**, then the synchronizer changed the Project status: the App has repository Issues **read-only** permission and cannot close issues. The fixture did **not** test merging a new PR; merged historical PRs and linked open issues were covered by earlier reconciliation, unit tests, and representative board inspection. A reviewed production-scope/documentation PR can supply a natural future merge-event observation without merging the fixture.

Runs #139 and #143 reconciled unchanged board state after distinct PR events; they do not demonstrate duplicate-event delivery. Live duplicate-event verification remains pending.



### GraphQL workload telemetry (implementation pending hosted verification)

The synchronizer records an aggregate `GraphQL workload` JSON summary at the end
of each authenticated dry-run or reconciliation, including failure paths.
`requests` counts attempted HTTP GraphQL calls; `reads`, `mutations`, and
`attemptedRequestsByCategory` separate the request types and pagination
connection pages. `cumulativeApiMs` sums individual request time, while
`reconciliationMs` measures script reconciliation time, excluding Actions
queue, checkout, and setup overhead. It is not an optimization claim.

The `rateLimit` field contains only the first observed `x-ratelimit-used`
value and the most recent available limit/used/remaining/reset headers.
Missing headers are recorded as null; no extra rate-limit query is issued.
These primary-limit snapshots are **not exact per-query GraphQL point costs**:
concurrent API activity and reset-window changes can affect differences.
The `result` field is `incomplete` when reconciliation fails, even when
some requests or Project mutations succeeded. Telemetry does not record
credentials, request variables, raw GraphQL errors, PR bodies, or API responses.

Before checking the runtime-measurement acceptance item, verify the hosted PR
regression and main-branch run, then capture an authenticated run's summary,
link the Action evidence, assess the measured 30-minute timeout headroom, and
record missing cost precision or scheduled-run limitations explicitly.

### Timing, known limits, and next actions

From the GitHub Actions REST `created_at` and `updated_at` timestamps (run-level elapsed time, including scheduling and setup, **not** a per-API latency metric), #132 took approximately **36 s**, #133 **73 s**, #134 **33 s**, #135 **44 s**, #143 **86 s**, and #148 **37 s**. These runs are observations with different workloads, **not** comparable optimization evidence. Exact GraphQL request counts, remaining rate-limit budget and long-term reliability have **not** been independently measured.

Known nonblocking warning: `actions/checkout@v4` / `actions/setup-node@v4` emitted a Node.js 20 deprecation warning under the runtime; the documented runs succeeded. Do not treat this as a successful compatibility upgrade. The configured synchronization timeout remains 30 minutes, and GitHub schedule executions can be delayed.

Before closing #147: confirm fixture #170's final `Done` status in the Project UI; review the remaining issue acceptance checkboxes against run and board evidence; obtain independent review and main-branch verification for this documentation update; verify the merged-PR/issue-separation behavior through an appropriate **real** PR merge when available; **measure and record GraphQL request counts, rate-limit budget and run duration** for an authenticated reconciliation; and ensure test branch `test/170-development-board-lifecycle` is cleaned up without merging its contents.

---

## Objective and architecture

Normal issue/PR lifecycle events should maintain truthful board state without
manual card movement. `scripts/project-sync.mjs` separates pure relationship
parsing, state calculation and planning from a documented GraphQL adapter and an
orchestrator. `.github/workflows/project-sync.yml` invokes trusted default-branch
code. `scripts/project-sync.test.mjs` uses Node's test runner, synthetic API
responses and in-memory Project state; it needs no App credentials.

Issues track completion of the whole work item. PRs track implementation/review
artifacts. A merged partial PR cannot complete an open issue; no assignee,
branch, comment, or arbitrary number mention implies implementation state.

## Four Status meanings

| Content and observable state | Desired result |
| --- | --- |
| Open issue with recognized OPEN or MERGED implementation PR evidence | In Progress |
| Open issue with no recognized OPEN/MERGED implementation evidence | Todo |
| Issue closed with `COMPLETED` state reason | Done |
| Issue closed with `NOT_PLANNED` state reason | Clear Status, then archive if represented |
| Open draft PR | In Progress |
| Open non-draft PR | In Review |
| Merged PR | Done |
| Closed-unmerged PR | Clear Status, then archive if represented |

A merged partial PR proves implementation has started but does not complete the
issue. After the last implementation PR merges, an open issue stays In Progress
during final verification. Done requires the repository issue itself to be
explicitly closed as completed. The synchronizer never closes repository issues;
issue checklists and comments are intentionally outside its decision logic.
Closed-unmerged PRs do not count as implementation evidence. Draft OPEN PRs do.
Multiple PRs per issue and several issues per PR are supported. Reopened/open
content is unarchived and recalculated from repository evidence, including merged
implementation history, without using Project Status as memory. Unknown closed
issue reasons fail visibly rather than inventing completion.

Archiving preserves history without deleting content. Excluded closed-unmerged
PRs and `NOT_PLANNED` issues have any Project Status cleared before archival;
they are not normalized to Todo, In Progress, In Review, or Done. Already archived
excluded content stays archived, but stale Status values are still cleared.
An archived excluded card whose Status is already unset needs no mutation.
These are locally tested semantics, not hosted runtime verification.
Completed/merged represented history gets Done without
unarchiving intentionally archived terminal history. Missing historical closed
content is not imported. A newly delivered lifecycle event can ensure its own
completed issue/merged PR is represented if absent; scheduled reconciliation
does not bulk-backfill absent historical merged PRs.

## Relationship contract

Use a standalone relationship line, optionally prefixed with a Markdown bullet,
numbered bullet or checkbox. Keywords are case-insensitive and allow a colon:

```text
Part of #123
Part of: #123
Ref #123
Refs: #123
Related to #123
Refs #123, #124 and #125
```

For historical compatibility, the parser also recognizes `Close` / `Closes`,
`Fix` / `Fixes`, and `Resolve` / `Resolves` with the same optional colon and
reference forms. These closing keywords are not recommended for new PRs.

Bare references are recognized only in clearly named `Related Issue` or
`Related GitHub Issue` Markdown sections (plural headings also work). For example:

```markdown
## Related GitHub Issue

- #123
- #124
```

An equal/higher-level following heading ends that section. Same-repository
qualified references (`2ton-exe/moris-mix-ai#123`) and GitHub issue URLs are
accepted in these recognized forms. Cross-repository references and PR URLs
are excluded. References are deduplicated. HTML comments, fenced/indented code
and blockquotes are ignored. Reference lists stop at explanatory prose, so a
later number in testing text is not promoted to a relationship. General prose,
testing/changelog mentions and issue numbers in titles are not parsed.

The adapter paginates GitHub-native `closingIssuesReferences` for every OPEN or
MERGED PR. Both states use supported body relationships and native linked-issue
evidence, so a native-only relationship continues to establish implementation
progress after merge. Native references are accepted only for this repository.
CLOSED-unmerged PR relationships are ignored entirely, including
malformed text; they neither establish progress nor quarantine issues.
GitHub does not expose every informal link through that connection; supported
body syntax remains the compatibility path. A recognized same-repository
reference that cannot resolve to an accessible issue quarantines that PR's
entire relationship evidence. The structured plan/result returns operations and
`rejectedRelationships` diagnostics; logs emit a concise warning with the PR
number and rejected issue reference (or a fixed invalid-number diagnostic),
never the complete PR body or sensitive text. Unrelated repository content
continues reconciling, and the rejected PR's own draft/ready lifecycle remains
independent of its relationships (as does a merged PR's own Done state).

Resolvable open issues referenced by a quarantined PR have uncertain
relationship-derived state. This quarantine applies to participating OPEN and
MERGED PR evidence equally. Without an independent valid OPEN or MERGED PR for
an affected issue, no add/status/archive-state operation is inferred for that
issue; an existing card is preserved. Another OPEN or MERGED PR with complete,
valid relationships can still establish In Progress. Closed issue completion/archive state remains
authoritative. Once the malformed PR relationship is corrected, the next full
reconciliation calculates ordinary issue state again. Correct the reference or
access rather than treating rejected evidence as complete. Missing/malformed
API/native-link evidence, authentication/API errors, invalid Project metadata,
pagination errors, duplicate cards and mutation failures still fail visibly;
they are not converted to relationship warnings. These are locally tested
semantics, not hosted runtime verification.

Explicit body relationships are the most auditable team convention for new PRs.
**Part of #123** contributes to / implements work for an issue; merging does not
close it. **Refs #123** provides a non-closing reference when appropriate.
Repository issues are closed explicitly only after their own completion and
verification criteria are satisfied. A teammate or AI may separately inspect
that evidence and explicitly close the issue; synchronization only observes the
actual repository state. A merge alone never sets an open issue to Done.
The PR template's relationship section is optional; maintenance and
controlled experiments may stand alone. Examples are in comments so an untouched
template does not create a false relationship.

## Events and reconciliation

The exact triggers are:

- `issues`: opened, reopened, closed.
- `pull_request_target`: opened, reopened, ready_for_review, converted_to_draft,
  edited, closed.
- `workflow_dispatch`: explicit `dry-run` (default) or `reconcile`.
- `schedule`: `17 * * * *` (hourly at minute 17 UTC; GitHub may delay schedules).

Every supported event performs full repository reconciliation. This deliberately
avoids a second targeted update path. Editing a body therefore recalculates all
current/prior related issues, even if `changes.body.from` is missing or partial.
Removed links cannot silently leave an issue In Progress. Previous event bodies
are not authoritative; current PR bodies and OPEN/MERGED native closing links are
read from GitHub. Events that race with repository changes are repaired by the next
successful reconciliation.

The adapter first enumerates all organization Projects and all target fields,
validating the organization/type, Project number/title/node ID/open state, one
single-select Status field and exactly the four unique named options. It uses
their discovered IDs, never opaque IDs in runtime configuration. Duplicate
matching titles, missing/ambiguous metadata or unexpected options fail closed.

Repository issues and PRs are fetched across **all states**. This includes all
current open content and permits authoritative resolution of represented closed
history and relationship targets. OPEN and MERGED PRs require native relationship
queries. Project items explicitly request both `ARCHIVED` and `NOT_ARCHIVED`.
All relevant GraphQL connections (Projects, fields, issues, PRs, native links,
Project items, and per-content project memberships) use cursor pagination at up
to 100 records per page. Counts, node identities, next-page cursors and terminal
counts are validated. Null/inaccessible content, missing pages, repeated
cursors/nodes and count changes abort instead of applying a truncated plan.
Snapshot count changes require a later retry.

Before writes, the complete plan detects duplicate Project content and reports
the content ID and conflicting item IDs. It never chooses a card to delete or
archive. Resolve duplicates manually under a separately reviewed policy, then
rerun. Draft Project notes and content belonging to other repositories are not
changed; inaccessible content fails safely.

Open issues/PRs are added only if missing. Correct fields and archive state are
left alone. Each planned write re-reads current project membership, including
archived items, to avoid repeating an add/status/clear-status/archive already
performed. A separate `clear-status` operation uses `clearProjectV2ItemFieldValue`
with the discovered project/item/Status field IDs; it does not unarchive a card
just to clear the field. The pre-write check skips clearing if another writer
already unset the Status. Only `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`,
`clearProjectV2ItemFieldValue`,
`archiveProjectV2Item`, and `unarchiveProjectV2Item` are used for writes.
Mutation payloads must confirm the affected item ID. Duplicate event delivery
and repeated stable reconciliation produce zero extra mutations.

One repository-level concurrency group serializes workflow runs with
`cancel-in-progress: false` and `queue: max`, preserving running synchronization
and retaining pending lifecycle events instead of replacing the single pending
event. [GitHub supports up to 100 pending runs in this mode](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency);
additional runs are canceled when that queue is full. Scheduled reconciliation still repairs drift,
but cannot recreate every missed event-specific historical addition. Queue
configuration is not runtime verification. The API does
not provide a transaction spanning the snapshot and mutations. External edits
or built-in automations can still race; conflict review and subsequent
reconciliation remain necessary. A mutation failure stops the run with failure;
earlier successful writes are preserved and the next run repairs partial work.

## Authentication and activation contract

The following setup contract is retained for **initial installation, key rotation,
and recovery**, not a request to reconfigure the active installation. It was
originally implemented without storing credentials in the branch; credentials
were configured separately after merge. Use a dedicated App installed in
`2ton-exe`, scoped to this repository.

Minimum App permissions:

| Scope | Permission | Level |
| --- | --- | --- |
| Organization | Projects | Read and write |
| Repository | Issues | Read |
| Repository | Pull requests | Read |
| Repository | Metadata | Read |

No Contents write, Actions write, Administration, Deployments, Secrets or
Environments permission is required. The workflow's normal `GITHUB_TOKEN` has
only `contents: read` for trusted checkout. The App token reads metadata and
writes the organization Project; it never mutates repository code.

Expected repository/organization settings (organization settings must be
available to this repository):

- Variable: `PROJECT_AUTOMATION_APP_CLIENT_ID`.
- Secret: `PROJECT_AUTOMATION_APP_PRIVATE_KEY`.
- Activation variable: `PROJECT_AUTOMATION_ENABLED`.

`actions/create-github-app-token@v3` receives client ID/private key and the
installation owner/repository. It requests only Projects write plus Issues,
Pull requests and Metadata read. Dry-run requests Projects **read** instead.
The action masks its output token and revokes it at job completion; the token
is passed only through the synchronization step's environment. Do not echo it,
persist it in Git configuration, upload it in artifacts, or enable debug output
that prints credentials. API error bodies and untrusted PR text are not logged.

Missing/false activation skips automatic work with a clear disabled message.
Actions expression string equality is case-insensitive, so an uppercase value
may enter the workflow job. A case-sensitive Bash validation step therefore
requires activation to be exactly lowercase `true` before minting a write-capable
App token for event-driven runs or manual `reconcile`. Nonexact values fail
before token creation; the guard receives only the activation value, never the
private key. Manual `dry-run` bypasses this activation check and still requests
only Projects read access. The script independently requires exact lowercase
`true` before apply mode can access the API. These guards have local regression
coverage; hosted pre-token behavior is not yet runtime-verified. Dispatch from a
non-default branch is skipped. There is no hidden apply mode; unknown modes fail.

## Trusted-base security boundary

`pull_request_target` is used only to receive lifecycle metadata. Checkout is
explicitly this base repository's default branch with
`persist-credentials: false`. No PR head, merge ref, artifact or cache is checked
out or executed. There is no dependency installation, PR-controlled action, or
PR body/title interpolation into shell commands. Only the trusted default-branch
Node script executes with the App token. PR bodies are untrusted data parsed by
pure functions. Native `fetch` and Node built-ins avoid executing dependencies
from PR contents. Static regression tests check the checkout, action list,
commands, permissions, secret references and activation guard.

## Actions event-policy prerequisite (initial activation)

This repository is public. The synchronizer intentionally uses
`pull_request_target` for trusted-base PR lifecycle metadata, and GitHub's
public-repository default Actions event policy can block that event. Before
setting `PROJECT_AUTOMATION_ENABLED=true`, inspect the applicable repository,
organization, and enterprise Actions policies. If this workflow must continue
using `pull_request_target`, confirm that an applicable event policy explicitly
permits it and record evidence of the live policy check. See GitHub's official
[pull_request_target security guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
and [Actions policy documentation](https://docs.github.com/en/actions/concepts/about-actions-policies).
At implementation time the workflow did not itself configure or prove the live
event policy. The operator later verified the active allowed-event policy before
enabling writes on November 6, as recorded above. Recheck it after policy changes.
This prerequisite is separate from the Project built-in conflict review below.

## Built-in workflow conflict review (initial activation)

The following built-ins were reported enabled in the original baseline:

1. Item closed
2. Pull request merged
3. Auto-close issue
4. Auto-add sub-issues to project
5. Pull request linked to issue
6. Item added to project
7. Auto-add to project

The code does not change these settings. On November 6 the operator confirmed
they were all **Off** before the first write-capable reconciliation. For a new
installation, audit the live settings and perform a reviewed disable or conflict-
resolution step before activation; do not re-enable conflicting writers. In particular, automatic issue closure and generic
closed-item completion conflict with truthful issue/closed-unmerged semantics;
automatic additions/status defaults can race with custom reconciliation. The
custom system is intended to be the authoritative lifecycle synchronizer.
Do not call undocumented/private Project-workflow mutation endpoints.

## Operating commands and troubleshooting

For the **currently active** installation, run Actions → Development Board
synchronization → Run workflow → default branch → `mode: dry-run` to preview
without changing the activation variable. Dry-run discovers metadata and reports
a plan with **zero Project mutations**, using a read-only API adapter and
downscoped Projects-read token; valid App/Project read access is still required.

For a **new installation or recovery after a deliberate pause**, complete App
configuration, conflict review, and dry-run before explicitly approving
`PROJECT_AUTOMATION_ENABLED=true`. With activation enabled, manual
`mode: reconcile` writes to the Project; issue/PR events and hourly reconciliation
can also write. Never disable a working installation solely to re-run initial
setup verification.
Unset activation (or set it to `false`) to disable subsequent automatic runs;
stop an already running job separately if needed. Setting the variable never
rolls back earlier writes.

Plans and the final proposed/applied counts appear in job logs. Plans contain
fixed operation/status names, content IDs and issue/PR numbers, not titles,
bodies or credentials. Validation failures give safe diagnostic messages and
fail the workflow; network failures use a fixed message. No API failure is
converted to a successful no-op.

| Symptom | Check and repair |
| --- | --- |
| Disabled message | Activation absent/nonexact; expected when intentionally disabled (event runs #130/#131 observed this); investigate if unexpected in active mode |
| Credential configuration error | Setting names, org visibility, App installation |
| HTTP/auth/GraphQL failure | Installation, Projects and repository permissions, rate limits, API availability; never print the token |
| Project/field/option identity error | Project 2/title, open state, one Status field and four exact options |
| Unresolvable relationship | Referenced issue exists, is in this repository, and is accessible; correct unsupported links |
| Duplicate content/item IDs | Review duplicates manually; no automatic destructive policy exists |
| Incomplete pagination/count changed | Retry a full reconciliation; investigate concurrent edits/API consistency |
| Partial mutation failure | Inspect safe operation logs, fix permissions/API cause, rerun reconciliation |
| State drifts after a successful run | Built-in or external writers, missing events; recheck conflict plan and schedule |

No automatic API retry hides a failed run. API requests have a 60-second timeout;
the job has a 30-minute bound. Reading all repository history trades additional
API requests for simple, complete evidence. Growth/rate limits may later require
a separately tested incremental strategy. Repository edits during a snapshot
can still create transient inconsistency even without count changes; eventual
reconciliation repairs it. Unsupported relationship formats should be rewritten
using the documented syntax rather than guessed.

A November 2 read-only repository inventory found 67 merged PRs. Including their
native links adds approximately 67 queries per full reconciliation, plus extra
pages for any PR with more than 100 links. This scale does not establish a need
for optimization; complete paginated evidence takes priority over caching,
historical windows, or heuristic filtering. This inventory is not live Project
or App-authenticated runtime verification.

## Local checks

```text
node --test scripts/project-sync.test.mjs
node --test scripts/production-workflow.test.mjs scripts/pr-secretary.test.mjs scripts/runtime-smoke.test.mjs
node --check scripts/project-sync.mjs
node --check scripts/project-sync.test.mjs
git diff --check
git diff --cached --check
```

Tests use the existing frontend ESLint installation's `js-yaml` parser to check
workflow YAML and security structure, consistent with DevOps tests. Install
locked tooling through the normal repository setup if needed. Runtime script
execution itself has no third-party dependencies. Run `actionlint` when available
and report its absence honestly.

Local branch validation on November 2 for preserved native links after merge: 314
project-sync tests passed (the existing 303 retained, with revised native-fetch
expectations and 11 added regressions); classifier
(42), production-workflow (11), PR Secretary (125) and runtime-smoke (35) tests
passed, with no failures or skips. All 13 workflow YAML files parsed; both
project-sync script syntax checks and working/staged whitespace checks passed.
`actionlint` was unavailable. These are local branch results. Hosted PR CI is
tracked separately on the pull request and must be verified against the current
head before merge. These results do not establish GitHub App or live Project
runtime verification.
An earlier separate read-only adapter check through the existing authenticated CLI
retrieved 73 issues (25 open), 74 PRs (3 open), and 98 Project items including
archived items; it proposed zero mutations and made no writes. This used the
existing user's CLI authentication, **not** the future App or Actions workflow,
and proves neither App configuration nor live mutation/lifecycle behavior.


## Activation checkpoint and remaining runtime verification

The 2026-11-06 checkpoint above records completed activation steps and observed
transitions. The synchronizer is active; do not repeat initial setup or disable
activation to complete this checklist. Keep unverified checks open and attach
the remaining evidence before closing #147.

- [x] Configure the dedicated minimum-permission App and repository installation,
  client ID variable and private-key secret (see activation checkpoint).
- [x] Record built-in workflow conflict resolution, linked-PR auto-close disabled,
  and the applicable Actions event policy permitting the required events.
- [x] Run App-authenticated dry-run with zero applied writes (#132), enable
  activation, and observe successful write reconciliation (#133).
- [x] Observe new issue Todo, linked draft PR and issue In Progress, and ready PR
  In Review (#136–#138).
- [x] Observe completed issue Done (#148), not-planned issue archive (#141),
  closed-unmerged PR archive (#140), and reopened issue unarchive/Todo (#142).
- [x] Observe repeated steady-state reconciliation with zero additional mutations
  (#134, #135, #139, #143); duplicate-event delivery remains unverified.
- [ ] Confirm explicit activation approval and review of dry-run metadata,
  relationships and plans; execution success alone does not record those reviews.
- [ ] Confirm merged default-branch implementation and code-owner approval;
  obtain independent review and main-branch verification of this documentation.
- [x] Verify disabled event-triggered path: runs #130/#131 completed the `disabled`
  job and skipped `synchronize` before activation.
- [ ] Document or execute a safe controlled verification of the disabled scheduled
  path and hosted malformed-value pre-token guards, without unnecessarily
  interrupting the active board; record any justified deferral.
- [ ] Inspect fixture #170's final Done status independently in the Project UI.
- [ ] Verify converted-draft PR In Progress and reopened PR unarchive/recalculation.
- [ ] Edit/remove relationships with and without prior-body evidence; verify prior
  issues return to Todo only without other valid OPEN/MERGED evidence; multiple
  links/PRs remain correct and unrelated mentions do nothing.
- [ ] Observe appropriate real partial/final implementation PR merges and verify PR Done while
  the open issue remains In Progress until explicitly closed completed. The
  closed-unmerged fixture does not verify this transition.
- [ ] Verify duplicate-event delivery causes zero additional mutations/cards and
  independently inspect item uniqueness; zero-operation runs alone do not prove it.
- [ ] Exercise >100-item pagination, scheduled drift repair, API/permission failure
  visibility and safe recovery with no credentials in logs.
- [ ] Measure and document authenticated GraphQL request counts, pagination
  workload, available rate-limit budget and run duration for an ordinary full
  reconciliation; assess headroom against the 30-minute job timeout.
- [ ] Review remaining #147 acceptance checkboxes against run and board evidence;
  record remaining transitions, failures and limitations before issue closure.
- [ ] Ensure test branch `test/170-development-board-lifecycle` is cleaned up
  without merging its contents. Preserve completed issues as historical evidence.


Reference API contracts: [Project GraphQL types and mutations](https://docs.github.com/en/graphql/reference/projects),
[Issues GraphQL types](https://docs.github.com/en/graphql/reference/issues),
and [create-github-app-token inputs](https://github.com/actions/create-github-app-token/blob/v3/action.yml).
