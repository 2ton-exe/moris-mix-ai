# Development Board lifecycle synchronization

Tracking issue: [#147](https://github.com/2ton-exe/moris-mix-ai/issues/147).
Target: organization `2ton-exe`, Project **2**, **2ton.exe - Development Board**,
repository `2ton-exe/moris-mix-ai`.

## Delivery and evidence boundary

This implementation ships **disabled by default**. Configuration is NOT runtime
proof. Local deterministic tests do not prove installation permissions, Actions
delivery, built-in workflow compatibility, or live mutation behavior. Do not
close #147 or describe this automation as operational until controlled post-merge
runtime evidence has been recorded. This workflow is not a required merge check.

The November 1 preflight observed remote main
`bd192be90428da62d00d2d1cae6f22c529c8740e`, #147 OPEN / Todo, and 98 current
Project items. These observations are historical, not runtime configuration.
CODEOWNERS covered `.github/workflows/**`; `Protect main` required code-owner
review. The implementation does not change either policy, existing modular
validation, Hosted RLS, deployments, or #124 path-selection behavior.

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

The adapter also paginates GitHub-native `closingIssuesReferences` for every
current open PR. Native references are accepted only for this repository.
MERGED PRs use supported explicit body relationships already fetched in the
repository snapshot. Their native closing relationships are not queried: body
evidence satisfies implementation tracking without extra per-PR historical
queries. CLOSED-unmerged PR relationships are ignored entirely, including
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
are not authoritative; current PR bodies and open PR native closing links are
read from GitHub. Events that race with repository changes are repaired by the next
successful reconciliation.

The adapter first enumerates all organization Projects and all target fields,
validating the organization/type, Project number/title/node ID/open state, one
single-select Status field and exactly the four unique named options. It uses
their discovered IDs, never opaque IDs in runtime configuration. Duplicate
matching titles, missing/ambiguous metadata or unexpected options fail closed.

Repository issues and PRs are fetched across **all states**. This includes all
current open content and permits authoritative resolution of represented closed
history and relationship targets. Only open PRs require native relationship
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

Do not configure credentials as part of implementing this branch. After merge,
use a dedicated App installed in `2ton-exe`, scoped to this repository.

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

## Actions event-policy check before activation

This repository is public. The synchronizer intentionally uses
`pull_request_target` for trusted-base PR lifecycle metadata, and GitHub's
public-repository default Actions event policy can block that event. Before
setting `PROJECT_AUTOMATION_ENABLED=true`, inspect the applicable repository,
organization, and enterprise Actions policies. If this workflow must continue
using `pull_request_target`, confirm that an applicable event policy explicitly
permits it and record evidence of the live policy check. See GitHub's official
[pull_request_target security guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
and [Actions policy documentation](https://docs.github.com/en/actions/concepts/about-actions-policies).
This change does not inspect, configure, or claim that the live event policy is
already permitted. This prerequisite is separate from the Project built-in
workflow conflict review below; both checks are required before activation.

## Built-in workflow conflict review before activation

The following built-ins were reported enabled in the agreed baseline:

1. Item closed
2. Pull request merged
3. Auto-close issue
4. Auto-add sub-issues to project
5. Pull request linked to issue
6. Item added to project
7. Auto-add to project

This branch does not change them. Before setting the activation variable, audit
their live behavior in the Project UI and perform a one-time reviewed disable
or conflict-resolution step. In particular, automatic issue closure and generic
closed-item completion conflict with truthful issue/closed-unmerged semantics;
automatic additions/status defaults can race with custom reconciliation. The
custom system is intended to be the authoritative lifecycle synchronizer.
Do not call undocumented/private Project-workflow mutation endpoints.

## Operating commands and troubleshooting

After merge and App configuration, with activation still disabled, use Actions
→ Development Board synchronization → Run workflow → default branch →
`mode: dry-run`. This discovers live metadata, calculates and reports proposed
operations, and performs **zero Project mutations**. Dry-run is protected both
by a read-only API adapter and a downscoped Projects-read token. It still needs
valid metadata/Project read access; it cannot preview without credentials.

Only after configuration, conflict review and explicit approval, set activation
to exactly `true`. Use the same dispatch form with `mode: reconcile` to apply.
Hourly reconciliation then uses the same implementation as lifecycle events.
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
| Disabled message | Activation absent/nonexact; this is expected before approval |
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

Local branch validation on November 2 for preserved issue progress: 303
project-sync tests passed (the existing 291 retained, with revised merged-evidence
expectations and 12 added regressions); classifier
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

## Post-merge configuration and runtime verification still required

- [ ] Review merged default-branch implementation and code-owner approval.
- [ ] Create/configure the minimum-permission App and installation separately.
- [ ] Configure the client ID variable and private-key secret without disclosure.
- [ ] Keep activation disabled; verify disabled event/scheduled paths visibly skip.
- [ ] Audit all seven built-ins live; resolve conflicts through reviewed UI changes.
- [ ] Run App-authenticated dry-run, review metadata/relationships/plans and confirm zero writes.
- [ ] Explicitly approve enabling `PROJECT_AUTOMATION_ENABLED=true`.
- [ ] Use controlled fixtures to verify new issue Todo; draft PR In Progress;
  issue In Progress; ready PR In Review; converted draft In Progress.
- [ ] Edit/remove relationships with and without prior-body evidence; verify prior
  issues return to Todo only without other valid OPEN/MERGED evidence; multiple
  links/PRs remain correct and unrelated mentions do nothing.
- [ ] Merge partial/final implementation PRs and verify PR Done while the open
  issue remains In Progress through verification until explicitly closed completed.
- [ ] Complete an issue and verify Done; close not-planned and verify archive.
- [ ] Close an unmerged PR and verify archive, never a new Done transition.
- [ ] Reopen issue/PR fixtures and verify unarchive plus recalculated status.
- [ ] Repeat reconcile and duplicate events; confirm zero additional mutations/cards.
- [ ] Exercise >100-item pagination, scheduled drift repair, API/permission failure
  visibility and safe recovery with no credentials in logs.
- [ ] Record run URLs, observed transitions, counts, failures and limitations on #147
  before claiming acceptance. Preserve completed issues as historical evidence.

Reference API contracts: [Project GraphQL types and mutations](https://docs.github.com/en/graphql/reference/projects),
[Issues GraphQL types](https://docs.github.com/en/graphql/reference/issues),
and [create-github-app-token inputs](https://github.com/actions/create-github-app-token/blob/v3/action.yml).
