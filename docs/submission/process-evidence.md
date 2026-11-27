# Four-sprint process evidence

**Reconstructed and reconciled on 27 November 2026 (Asia/Manila).** The original reconstruction used [`7e5260b`](https://github.com/2ton-exe/moris-mix-ai/commit/7e5260be9c92d0dc07a94ae06447020655b1381b) and the seven **25 November historical audits**. Later facts are labeled below. This document preserves event dates and distinguishes original plans, repository execution records and later recollection. [Current product evidence](README.md), [captured board](board-evidence.md), [source register](compilation-record.md) and [one manual-input register](outstanding-confirmations.md) supply the related evidence.

**Current documentation owner: myntchoc**, full-stack engineer, for all non-DevOps creation, updates, technical verification, synthesis and final document approval. Historical authors, reviewers, assignees and planned POs remain credited below. DevOps supplies operational facts; no routine document approval or teammate request is assigned to component owners.

## Evidence rules and source coverage

| Label | Meaning |
|---|---|
| Verified | Inspected evidence supports the stated scope and revision. A source test establishes coverage; its execution establishes only the recorded run. |
| Partial | Evidence supports part of a claim; the unproved part is named. |
| Failed behavior | An executed journey failed at the described stage; it differs from missing proof. |
| Missing original | No contemporaneous supporting record was located. This does not establish that an event never occurred. |
| Present-day declaration / recollection | An attributable statement recorded now, with its author's knowledge and uncertainty; never backdated to the event. |
| Awaiting factual input | An irreducible fact in the single input register. Current technical/document approval can be supplied by myntchoc; it cannot create historical instructor approval or another person's unknown tool history. |

A merged PR establishes integration, not deployment, attendance, actual PO duty, instructor acceptance or an effort percentage. The course's Definition of Done separately includes review, passing pipeline, deployment and a deployed check. Original UTC GitHub event dates are retained where marked; all new reconciliation dates use Asia/Manila.

**Authorities read:** myntchoc designates supplied `endterm_format.md` authoritative for the final document; the previously read `documentformat.md` and `documentstructure.md` remain supporting inputs (the latter matches the supplied template). The original Endterm instructions local Markdown copy was located and read, including §§2–4, 6 and 9. It requires four sprint plans, standups, retrospectives and consultations. Its sprint milestone ordering is guidance, and scope changes require a recorded reason and telling the instructor at consultation; it does not impose universal additional component-owner signatures.

**Planning originals located:** `AI Dev Proj.docx` (four-week plan), earlier `AI DevProj.md` pitch, alternate DOCX plan, Week 2 updated plan and accelerated `AI DevProj (4).docx`. The [native four-week plan](https://docs.google.com/document/d/1OQSBhwqsT_keB60Nwf1i72dcbl4vWlC0NqhwtU4dydc/edit) and [Week 2 plan](https://docs.google.com/document/d/15cRKRjJlh70rl_rPmQNZA3FChAoK8GTAj8Ma5QIyzCg/edit) were also located; Drive marks both unshared. The [native pitch-like main document](https://docs.google.com/document/d/18-wOuyPL-UoxIft8P4XOxOuRmE7F6mCuNZ6YVK8FlEA/edit?tab=t.udxcsz99nkxh) proposes automatic save, OpenAI and a different stack. Its spec tab calls the design approved for implementation but identifies no instructor or attributable approval event. **Yuan/myntchoc directly confirms instructor approval of the Moris Mix pitch in the clarification received 27 November 2026 PHT.** Associate that declaration with the located `AI DevProj.md` pitch (hash below) and native **AI DevProj main docu**, retaining their separate identities. The exact approved revision, original approval message/event date and later scope-notification records remain unestablished; basic pitch approval is no longer an unanswered question. Drive marks that document shared, which does not prove panel access.

The separate accelerated timeline explicitly labels its dates/assignments proposed targets subject to review. The local knowledge-base source list, roadmap, ownership guide and sprint-log template are secondary compilations, not meeting originals. Historical capture inspected the roster, Sprint 1 log, ADRs, foundation record, QA, AI evaluation, metrics and board automation; it covered 97 issues and 195 PRs. Representative reviews below were individually read; every historical comment/review was not audited. No team-channel, LMS or calendar original established meeting attendance. No consultation minutes, instructor response, pitch approval signature or submission receipt was located.

## Sprint assignment and observed outcomes

**Clarification received 27 November 2026 PHT:** Yuan/myntchoc directs use of the existing issue sprint labels for assignment. A read-only GitHub issue refresh on **27 November 23:27 PHT** supports the mapping below. Original plans remain historical intentions; thematic summaries or late merge dates do not override issue labels. The [board](board-evidence.md) preserves all original captured rows and PR relationships, with a current-label supplement.

| Existing issue labels | Current labeled work and outcome boundary |
|---|---|
| Sprint 1 | 15 issues, all closed. #4→#7 architecture, #5→#27 schema and #18→#35 QA have recorded implementation/review outcomes. #18 closed 28 October, after its 17 October partial QA report; closure does not erase unchecked acceptance. |
| Sprint 2 | 22 issues, all closed. #48→#72 CRUD and #58→#79 integration have merged outcomes. #59 retained Sprint 2 and closed 14 November; that later closure does not establish a Sprint 3 reassignment or a calendar boundary. |
| Sprint 3 | 34 issues, all closed. #90/#91→#118/#127 extraction, #94/#96→#123/#129 Chef, #104→#188/#190 image lifecycle, #117 rehearsal and #110→#135 evaluation remain assigned here even when integration occurred in November. Optional #108 closure does not prove its unchecked deletion criteria. |
| Sprint 4 | 9 issues: #155, #159, #163, #164, #165, #180, #276, #280, #299. #163, #165 and #299 are open; six are closed, with state/reason and criteria distinguished in the preserved board. #276/#280 were not planned, not completed acceptance. DevOps outcomes remain separately evidenced. |

**Cross-label history:** #51 bears Sprint 2 and Sprint 3. Its event history records Sprint 2 added **19 October 07:33:24 UTC**, closure **28 October 10:42:28 UTC**, and Sprint 3 added **28 October 15:41:30 UTC**, after closure. Retain both labels, but do not call this unfinished carryover. Histories for #18, #59 and #108 were also checked for closure/label dates. Labels establish selected/mapped work now; exact historical planning selection time, sprint calendars and actual carryover remain unspecified unless supported by a contemporaneous record. A PR merge establishes implementation integration, not all Definition-of-Done criteria.

## Sprint 1 — foundation and walking skeleton

**Original plan:** DEVOPS-00–04, BE-01–03, DOC-01–02, FS-01, FE-01–02, AI-01 and QA-01; read-only demo first, private CRUD in Sprint 2. Planned PO **Yuan Paulo Sebastian M. Belen / myntchoc**, explicitly assigned in the [Sprint 1 log](../sprints/sprint-1.md). Calendar boundaries remain unconfirmed; the log snapshot is 16 October and QA is 17 October. This establishes assignment, not consultation representation.

| Dated original | Evidence and what it establishes | Exact remaining gap |
|---|---|---|
| Architecture review/merge, 15–16 Oct UTC | [Issue #4](https://github.com/2ton-exe/moris-mix-ai/issues/4), [#7](https://github.com/2ton-exe/moris-mix-ai/pull/7): Ramos authored; Belen approved; [ADR](../architecture/sprint-1-adr.md) still labels draft status | Engineering review is verified; pitch approval is directly confirmed by Yuan/myntchoc, while exact approved revision and later instructor notification remain unestablished |
| Schema → contract → API → screen, 16–17 Oct UTC | [#27](https://github.com/2ton-exe/moris-mix-ai/pull/27), [#30](https://github.com/2ton-exe/moris-mix-ai/pull/30), [#33](https://github.com/2ton-exe/moris-mix-ai/pull/33), [#34](https://github.com/2ton-exe/moris-mix-ai/pull/34); [original commitments](../sprints/sprint-1.md#planned-commitments-and-status) | Integrated chain; all individual reviews were not re-audited |
| QA-01, 17 Oct PHT | [Original operator record](../sprints/sprint-1.md#qa-01-smoke-test-record-2026-10-17), [#18](https://github.com/2ton-exe/moris-mix-ai/issues/18), [#35](https://github.com/2ton-exe/moris-mix-ai/pull/35): UI→API→PostgreSQL worked; model listing worked; generation returned 403; linked Projects view had no board | Historical partial acceptance. #18's 28 Oct closure does not clear its unchecked generation/board criteria |
| CI/release, 16 Oct UTC | [Run 38928750840](https://github.com/2ton-exe/moris-mix-ai/actions/runs/38928750840) succeeded at `8f8e0d8456acf3589184c082bfc9f94375c23e67`; [Sprint 1 CI record](../sprints/sprint-1.md#ci-and-reviewed-pr-evidence) records Frontend/Deploy success | Historical execution, not a new production check or proof of a consultation demo |
| Process originals | [Standup](../sprints/sprint-1.md#stand-up-log) and [review/carryover](../sprints/sprint-1.md#sprint-review-and-carryover) contain templates | Actual dates/backlog carryover, standups, retro/action, attendance and consultation originals remain missing; see recollection below |

## Sprint 2 — authentication and core recipe CRUD

**Original plan:** BE-04–09, FE-03–07, FS-02–03, AI-02–03 and DEVOPS-05–09. Planned PO **Daniel C. Ramos / DanielRamos1186**. The four-week and Week 2 plans establish intended work/owners, not actual selection or calendar. Representative integration spans 19–30 October UTC; actual PO duty remains unproved.

| Dated original | Evidence and what it establishes | Exact remaining gap |
|---|---|---|
| Auth/integration, 19 Oct UTC | [#45](https://github.com/2ton-exe/moris-mix-ai/pull/45), [#63](https://github.com/2ton-exe/moris-mix-ai/pull/63), [#65](https://github.com/2ton-exe/moris-mix-ai/pull/65), [#66](https://github.com/2ton-exe/moris-mix-ai/pull/66): frontend auth, journal, session client and shared backend auth merged | Integration metadata is not a production demo |
| CRUD, 22–24 Oct UTC | [#71](https://github.com/2ton-exe/moris-mix-ai/pull/71), [#72](https://github.com/2ton-exe/moris-mix-ai/pull/72), [#48](https://github.com/2ton-exe/moris-mix-ai/issues/48), [API](../api/recipes.md); #72 review excluded production migration/deploy changes from app scope | Historical source/review; current production acceptance is separately reconciled in the evidence table |
| Integrated test, 25 Oct UTC | [#58](https://github.com/2ton-exe/moris-mix-ai/issues/58), [#79](https://github.com/2ton-exe/moris-mix-ai/pull/79), [run 40203995986](https://github.com/2ton-exe/moris-mix-ai/actions/runs/40203995986) at PR head `958425b…`; [journey](../../frontend/e2e/authenticated-crud.spec.ts). Ramos approved after runner/cleanup/ownership feedback; PR records local 2/2 journeys | Execution predates merge; not a consultation or fresh hosted/production check |
| Delivery/CI, 23–30 Oct UTC | [#74](https://github.com/2ton-exe/moris-mix-ai/pull/74), [#81](https://github.com/2ton-exe/moris-mix-ai/pull/81), [#82](https://github.com/2ton-exe/moris-mix-ai/pull/82), [#88](https://github.com/2ton-exe/moris-mix-ai/pull/88), [#125](https://github.com/2ton-exe/moris-mix-ai/pull/125), [#126](https://github.com/2ton-exe/moris-mix-ai/pull/126); [metrics](../devops/pipeline-metrics.md) | Integrated automation and scoped measurements, not proof of a delivered consultation report |
| Process originals | No contemporaneous Sprint 2 log or meeting originals in inspected sprint paths/plans/discussions | Issue labels and outcomes establish the mapped work; exact calendar/carryover decisions, PO duty, standups, retro/action and consultation originals remain unlocated |

## Sprint 3 — AI extraction, Chef and lineage

**Original plan:** AI-04–09, BE-10–12, FE-08–11, FS-04, QA-02, AI deployment and CI. Planned PO **Klein Rhee P. Sioson / KleinRheePagulongSioson**. Accelerated plan targets 28 Oct–3 Nov, 31 Oct features, 2 Nov freeze and 3 Nov presentation; these are proposed dates. Authored AI PRs support technical attribution, not actual PO duty or a presentation event.

| Dated original | Evidence and what it establishes | Exact remaining gap |
|---|---|---|
| Extraction, 29–30 Oct UTC | [#118](https://github.com/2ton-exe/moris-mix-ai/pull/118), [#127](https://github.com/2ton-exe/moris-mix-ai/pull/127), [#90](https://github.com/2ton-exe/moris-mix-ai/issues/90), [#91](https://github.com/2ton-exe/moris-mix-ai/issues/91): adapter/prompt and authenticated unsaved-preview endpoint; explicit save remains separate | Engineering integration/review, not live generation proof |
| Chef/lineage/quotas, 30 Oct–1 Nov UTC | [#123](https://github.com/2ton-exe/moris-mix-ai/pull/123), [#129](https://github.com/2ton-exe/moris-mix-ai/pull/129), [#131](https://github.com/2ton-exe/moris-mix-ai/pull/131), [#136](https://github.com/2ton-exe/moris-mix-ai/pull/136); #129 human review names missing AI deployment and follow-up #130 | Integration and a reviewed subset; deployment needed separate evidence |
| Evaluation, 31 Oct UTC | [#134](https://github.com/2ton-exe/moris-mix-ai/pull/134), [#135](https://github.com/2ton-exe/moris-mix-ai/pull/135), [run 41201872271](https://github.com/2ton-exe/moris-mix-ai/actions/runs/41201872271) at PR head `c9ef7bd…`, not merge SHA; [report](../ai-evaluation-report.md) | 30 deterministic fixtures are not live model trials; later report edits retain their own dates |
| Later live evidence, 14–15 Nov | [3/3 extraction spot check](../ai-evaluation-report.md#dedicated-gemini-project-re-verification-2026-11-14) at `b297977`; [production previews](../ai-evaluation-report.md#production-enablement-verification-2026-11-15) for extraction and Chef | Historical samples with no implied save, current availability, general accuracy or Sprint 3 consultation |
| Images/readiness, 7–17 Nov | [#160](https://github.com/2ton-exe/moris-mix-ai/pull/160), [#188](https://github.com/2ton-exe/moris-mix-ai/pull/188), [#194](https://github.com/2ton-exe/moris-mix-ai/pull/194), [#225](https://github.com/2ton-exe/moris-mix-ai/pull/225), [#232](https://github.com/2ton-exe/moris-mix-ai/pull/232); [transport trail](#scope-decision-trail) | Source/readiness, deployed app lifecycle and physical object cleanup are separate. PA-20261127 updates are in the current evidence table |
| QA rehearsal, 15 Nov | [QA-05 original](../qa/qa-05-presentation-rehearsal.md), [#117](https://github.com/2ton-exe/moris-mix-ai/issues/117): synthetic mocked-provider local 7/7 journeys and 1/1 headed fallback | Human presenter rehearsal/live Gemini remain unchecked; not a consultation or continuous deploy recording |
| Process originals | Plans and issue activity exist; actual meeting originals not located | Actual calendar/PO/backlog, standups, retro/action, consultation/demo originals and scope-notification trail missing; see recollection below |

## Sprint 4 — images, hardening and release evidence

**Original plan:** BE-13–16, FE-12–14, FS-05, QA-03–05, DOC-03–04, backup/security/metrics/rollback. Planned PO **Joseph Andrew Y. Ong / adnro2**; actual duty and calendar unconfirmed. Accelerated hardening targets 1–2 Nov. Later records extend through November; the frozen 7–17 Nov UTC metrics cohort does not establish sprint boundaries. The original plan is not the assignment authority: image/quality issues carry Sprint 3 labels and their evidence is listed there. Later unlabeled follow-ups below are explicitly not assigned to Sprint 4.

| Dated original | Evidence and what it establishes | Exact remaining gap |
|---|---|---|
| Security/metrics, 20–25 Nov | [Metrics](../devops/pipeline-metrics.md), [#164](https://github.com/2ton-exe/moris-mix-ai/issues/164), [#268](https://github.com/2ton-exe/moris-mix-ai/pull/268), [#289](https://github.com/2ton-exe/moris-mix-ai/pull/289), [security](../devops/security-checks.md) | Existing measurements/merges; operational verification belongs to the DevOps dependency |
| Recovery tooling, 24–25 Nov UTC | [#285](https://github.com/2ton-exe/moris-mix-ai/pull/285), [#288](https://github.com/2ton-exe/moris-mix-ai/pull/288), [#159](https://github.com/2ton-exe/moris-mix-ai/issues/159); #288 merged 25 Nov 17:25:04 UTC after approval | Supersedes the 25 Nov audit's pending #288 state; tooling merge does not prove a successful full restore |
| Unlabeled later desktop follow-up, 27 Nov PHT (not a Sprint 4 assignment) | [#282](https://github.com/2ton-exe/moris-mix-ai/pull/282) merged at [7918d99](https://github.com/2ton-exe/moris-mix-ai/commit/7918d99c7370103dd30334ef720334b2ed3aacb0), **15:47:17 PHT**; ancestor of inspected current main [`d329285`](https://github.com/2ton-exe/moris-mix-ai/commit/d329285ce0be5e955ee6ac76751cf97f6e58f799) | No pending-#282 blocker. PA-20261127's Chef/revision failures remain separately recorded; local checks cannot relabel that acceptance |
| Deferred/recovery capture | [#154](https://github.com/2ton-exe/moris-mix-ai/pull/154), [#274](https://github.com/2ton-exe/moris-mix-ai/pull/274) were closed-unmerged; [#165](https://github.com/2ton-exe/moris-mix-ai/issues/165) retained unchecked rollback/redeploy/verification criteria | Historical capture only; no reopening, merge, tag, deployment or operational acceptance is performed here |
| Process originals | No actual Sprint 4 standups or retro/action originals located. myntchoc reports no Week 4 consultation | Preserve the missing consultation, rather than inventing a completed event; presenter materials and actual planning records remain needed |

## Review and merge register

These original teammate review submissions and PR metadata were inspected for the reconstruction. **Dates are UTC**. Branch→PR links and engineering approvals do not establish planning dates, consultation attendance or instructor approval; other board rows do not inherit them.

| PR / linked work | Author and branch | Inspected approval | Merge event |
|---|---|---|---|
| [#7](https://github.com/2ton-exe/moris-mix-ai/pull/7), Refs #4 | @DanielRamos1186; `feature/be-01-architecture-adr` | @myntchoc, 15 Oct 16:51:37; [original review](https://github.com/2ton-exe/moris-mix-ai/pull/7#pullrequestreview-5536810361) | 16 Oct 13:10:19 |
| [#35](https://github.com/2ton-exe/moris-mix-ai/pull/35), QA-01 / #18 | @myntchoc; `docs/18-sprint-1-qa-evidence` | @DanielRamos1186, 17 Oct 15:29:34; PR Reviews | 17 Oct 15:30:32 |
| [#72](https://github.com/2ton-exe/moris-mix-ai/pull/72), BE-06 / #48 | @DanielRamos1186; `BE-06-recipe-crud` | @myntchoc, 24 Oct 06:29:22; PR Reviews | 24 Oct 06:38:59 |
| [#79](https://github.com/2ton-exe/moris-mix-ai/pull/79), FS-03 / #58 | @myntchoc; `codex/fs-03-authenticated-crud-e2e` | @DanielRamos1186, 25 Oct 14:36:36; [original review](https://github.com/2ton-exe/moris-mix-ai/pull/79#pullrequestreview-5643691620) | 25 Oct 14:51:53 |
| [#127](https://github.com/2ton-exe/moris-mix-ai/pull/127), Closes #91 | @KleinRheePagulongSioson; `feat/91-extract-recipe` | @DanielRamos1186, 30 Oct 05:37:24; PR Reviews | 30 Oct 06:00:20 |
| [#129](https://github.com/2ton-exe/moris-mix-ai/pull/129), Closes #96 | @KleinRheePagulongSioson; `feat/96-chef-generation` | @DanielRamos1186, 30 Oct 12:33:33; [original review](https://github.com/2ton-exe/moris-mix-ai/pull/129#pullrequestreview-5712289767) | 30 Oct 12:46:56 |
| [#135](https://github.com/2ton-exe/moris-mix-ai/pull/135), Closes #110 | @KleinRheePagulongSioson; `feat/110-ai-failure-tests-eval-report` | @DanielRamos1186, 31 Oct 12:59:26; PR Reviews | 31 Oct 13:43:54 |
| [#232](https://github.com/2ton-exe/moris-mix-ai/pull/232), image readiness | @myntchoc; `fix/integrated-recipe-image-readiness` | @DaeSaster, 17 Nov 12:45:10; PR Reviews (rechecked origin-gate repair) | 17 Nov 14:31:21 |
| [#268](https://github.com/2ton-exe/moris-mix-ai/pull/268), security controls | @DaeSaster; `ci/163-final-security-controls` | @adnro2, 21 Nov 16:16:48; @myntchoc, 16:31:21; PR Reviews | 21 Nov 16:35:34 |
| [#289](https://github.com/2ton-exe/moris-mix-ai/pull/289), dependency remediation | @DaeSaster; `fix/163-minimatch-advisory` | @myntchoc, 25 Nov 01:29:24; PR Reviews | 25 Nov 01:50:43 |
| [#288](https://github.com/2ton-exe/moris-mix-ai/pull/288), recovery tooling | @DaeSaster; `codex/276-stageb-execution-ready` | @myntchoc, 25 Nov 16:33:52; [original review](https://github.com/2ton-exe/moris-mix-ai/pull/288#pullrequestreview-6061249016), after earlier changes requests | 25 Nov 17:25:04 |

## Consultation evidence and historical gaps

The following is **myntchoc's supplied recollection, recorded 27 November 2026 PHT**, from `reconciliation-of-facts.md`. In the clarification received **27 November 2026 PHT**, Yuan/myntchoc confirms that the team retained and applied this feedback. That is an attributable declaration of adoption, not invented contemporaneous minutes. It supplies remembered feedback, not contemporaneous minutes or a new instructor attestation. The event dates, attendance, speaker, deployed demo and board walkthrough remain unverified. Original notes/feedback may replace uncertainty if later supplied.

| Week | Attributable present-day recollection | Evidence boundary / useful technical trail |
|---|---|---|
| 1 | Feedback concerned CodeRabbit and diversifying frontend/backend services to reduce correlated outage risk | Application confirmed by Yuan/myntchoc. [Review workflow](../devops/pr-secretary.md), CodeRabbit PR review records, and Workers/Supabase/Gemini service boundaries are technical counterparts; no exact consultation date or causal sequence inferred |
| 2 | Feedback advised against Antigravity for agentic use | Team application confirmed by Yuan/myntchoc; [declared Codex/OpenCode workflow](external-work-disclosure.md) provides the recorded alternative. Individual tool-use history and the date of any switch remain unspecified |
| 3 | Feedback asked what differentiates the app from an AI wrapper | [Structured output/processing](../ai-architecture.md) and versioned evaluations describe the implementation response; Yuan/myntchoc confirms application of the feedback; exact causal timing is not independently established |
| 4 | “we werent able to have a consultation for week 4” | Reported not held; do not substitute QA playback or a future meeting for the missing consultation |

For **each sprint**, original standup posts, actual retrospective notes and one resulting action/follow-through remain unlocated. Issue sprint mapping is now settled by labels, with linked implementation and state outcomes above. Exact calendars, historical planning/carryover decisions and actual PO representation remain narrower factual gaps. myntchoc may supply retained originals or a dated first-hand recollection, including “unknown/no original retained”; neither commits nor current document approval can create historical attendance or instructor decisions. The [input register](outstanding-confirmations.md) consolidates those questions once.

## Scope-decision trail

| Original scope → recorded decision | Attribution, rationale and implementation evidence | Current decision / historical gap |
|---|---|---|
| Earlier pitch Express/Prisma/OpenAI/automatic save; later browser-direct CRUD guardrail → Edge REST and explicit preview/save | Four-week plan records the conflict with Endterm §3.3; [#4](https://github.com/2ton-exe/moris-mix-ai/issues/4), Ramos-authored/Belen-approved [#7](https://github.com/2ton-exe/moris-mix-ai/pull/7), [#120](https://github.com/2ton-exe/moris-mix-ai/pull/120) and [ADR](../architecture/sprint-1-adr.md); [#72](https://github.com/2ton-exe/moris-mix-ai/pull/72), [#127](https://github.com/2ton-exe/moris-mix-ai/pull/127), [#129](https://github.com/2ton-exe/moris-mix-ai/pull/129) integrate it | Engineering adoption verified; approved-pitch version and any historical consultation notification remain unlocated. myntchoc owns the current technical/document decision |
| Authorized browser-direct R2 PUT in [#51](https://github.com/2ton-exe/moris-mix-ai/issues/51)/[#85](https://github.com/2ton-exe/moris-mix-ai/pull/85) → bounded Edge ingress | [#190](https://github.com/2ton-exe/moris-mix-ai/pull/190), carried in [#188](https://github.com/2ton-exe/moris-mix-ai/pull/188); Ramos's [8 Nov 11:45 UTC approval](https://github.com/2ton-exe/moris-mix-ai/issues/104#issuecomment-6721071406) and [15:02 UTC frontend-approval relay](https://github.com/2ton-exe/moris-mix-ai/issues/106#issuecomment-6723073867). Actual-byte bounds and replay protection explain the change | Retain the relay as Ramos's report, not an Ong-authored original. [13 Nov private-read acceptance](https://github.com/2ton-exe/moris-mix-ai/issues/106#issuecomment-6846170189) by Belen is a different contract; no new signature is required for this document |
| Historical proxy → ten-minute signed direct-R2 PUT, 15 Nov | [R2 ADR](../adr/0001-direct-r2-recipe-image-uploads.md), [#225](https://github.com/2ton-exe/moris-mix-ai/pull/225), [#232](https://github.com/2ton-exe/moris-mix-ai/pull/232): backend owns authorization, headers, object verification and attach. ADR reports owner acceptance without owner-specific URLs | Preserve that historical provenance limit. Proxy approval cannot become direct-transport approval. Current acceptance/documentation belongs to myntchoc; deployment/physical cleanup are separately evidenced, not inferred |
| One-photo quality/release plan → journal and companion evolution | [Foundation](../frontend/journal-foundation.md), [#152](https://github.com/2ton-exe/moris-mix-ai/pull/152), [#235](https://github.com/2ton-exe/moris-mix-ai/pull/235), merged [#282](https://github.com/2ton-exe/moris-mix-ai/pull/282). Foundation “approved origin/main” denotes an engineering baseline | Record scope/reason and any retained instructor notification. No additional instructor approval requirement is invented from the old audits; closed #274 remains outside scope |
| Capacity-gated export/deletion [#108](https://github.com/2ton-exe/moris-mix-ai/issues/108) | Closed/completed 16 Nov with unchecked deletion criteria; [#192](https://github.com/2ton-exe/moris-mix-ai/pull/192) is export implementation; no issue comments returned at historical capture | Optional scope remains incomplete, not a new mandatory task. myntchoc can record the present disposition without inventing an old waiver; no implementation is added |
| Accelerated 28 Oct–3 Nov proposal → later delivery records | Local accelerated plan targets 2 Nov freeze and 3 Nov presentation; subsequent source/report dates extend beyond it | Actual dates, whether that presentation occurred and any recorded replanning remain questions. Chronology proves neither attendance nor instructor approval |

## Requirement mapping

| Original criterion | Available evidence | Residual evidence gap |
|---|---|---|
| Endterm §2 roles, PO duty and teammate review | Roster, planned rotation and original review register | Actual PO duty/any role-change notification; no effort or attendance inference |
| Endterm §4 plans, branches, reviewed PRs and Definition of Done | Four planned sections, chronology, captured board and separately scoped deployment/QA records | Issue-label mapping established; actual calendars and historical commitment/carryover records remain limited; merge alone is insufficient deployed acceptance |
| Endterm §§4/6 standups, retros/actions and consultations | Original templates, technical evidence and dated myntchoc recollection above | Standup/retro originals for four sprints; consultation 1–3 event details; Week 4 reported not held |
| Endterm §3.3 and §9 scope changes | REST/AI boundary and scope/rationale trail | Pitch approval directly confirmed by Yuan/myntchoc; exact approved revision/original message and later scope-notification record remain unlocated; no vector-search requirement added |
| Endterm §9 and template §§7/10 process evidence | This pack, board, metrics, reviews, QA and current evidence table | Original board history, presentation media and uninterrupted deploy recording remain separate gaps |
| Template §8 contribution/external work | Roster/PR identities and [disclosure](external-work-disclosure.md) | Exact personal facts/sources and permissions where unresolved; current documentation owner is myntchoc |

## Local primary-copy identifiers

These hashes identify inspected planning/course copies; they establish file identity, not instructor approval or panel access. Additional supplied records and tool disclosure are in the [compilation register](compilation-record.md).

| Inspected filename | SHA-256 |
|---|---|
| `Endterm Final Project Instructions Artificial Intelligence Sem1 AY 2026-27 BSCS 4B.md` | `69627c1ea18a8806e69f40c0b0ae40316786fc1f5a39ef75a6e28278c247c5c5` |
| `CSP221A_Final_Technical_Documentation_Template.docx.md` | `0ccd5f3c6501513b214234ad3a447b0ad12674ffb1d628398fd795713b87098a` |
| `AI Dev Proj.docx` (four-week plan) | `3954a5185b2e0dbebafc7af20281c8adc8a7106724aaad841202f27309b4a9c8` |
| `AI DevProj.md` (earlier pitch text; differs from same-stem DOCX) | `7979f0ff9059fa1e3c50817f561df769fadf9ce3aee5d7d9176307807e58fb7a` |
| `AI DevProj.docx` (alternate four-week plan) | `65fa566264704f09cdfb6e86f2119a2ae5307f12ac61135a8046593e4f6712f7` |
| `AI DevProj - Week 2 Updated.docx` | `1ec2162816e32c9675f41b2231dba0bc4c5dd512f31881418ea7b4cbdfd118d9` |
| `AI DevProj (4).docx` (accelerated plan) | `89eda289289d2a3094bd2da141387b82cdaa07c6083c56de5047b67c5c6adf05` |

## Source index

[Original Sprint 1 log](../sprints/sprint-1.md), [roster/workflow](../../README.md), [board reconstruction](board-evidence.md), [architecture ADR](../architecture/sprint-1-adr.md), [R2 ADR](../adr/0001-direct-r2-recipe-image-uploads.md), [metrics](../devops/pipeline-metrics.md), [optimization](../devops/optimization-log.md), [incidents](../devops/incident-log.md), [board automation](../devops/project-board-automation.md), [AI evaluation](../ai-evaluation-report.md) and [QA rehearsal](../qa/qa-05-presentation-rehearsal.md) retain their original dated scope. Local originals are not published wholesale; identified private native plans need panel-authorized access or redacted equivalents. The current evidence table supersedes stale release conclusions without altering the dated originals.
