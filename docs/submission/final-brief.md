# Mori’s Mix Final Technical Documentation

**REVIEWABLE SUBMISSION · SPECIFIC EVIDENCE GAPS REMAIN**

**CSP221A · BSCS 4B · 2ton.exe · Reconciled 27 November 2026 PHT**

**Klein Rhee P. Sioson** – AI Engineer; **Joseph Andrew Y. Ong** – Frontend Engineer; **Daniel C. Ramos** – Backend Engineer; **Yuan Paulo Sebastian M. Belen** – Full-Stack Engineer; **Diofel Gwen F. Haresco** – DevOps Engineer.

**Release:** [v1.0.0/changelog](https://github.com/2ton-exe/moris-mix-ai/releases/tag/v1.0.0), `c49a840`. **PA:** `5cad4b8`/`05c9b32`; **local repair:** `40b5e10`; **docs:** draft #293. [Repository](https://github.com/2ton-exe/moris-mix-ai) · [Production](https://moris-mix-ai.diofelgwenharesco.workers.dev) · [Deployment](https://github.com/2ton-exe/moris-mix-ai/actions/runs/46024556206).

### 1 Product status & architecture

Mori’s Mix helps home cooks keep private recipes and turn notes or pantry ingredients into editable drafts. PA-20261127 passed session-reused access, CRUD, extraction/edit/save/reopen, deployment persistence and app image handling. Chef failed before inspiration selection/save; note-driven revision was rejected. Both end-to-end journeys remain unaccepted. [Acceptance report](assets/PA-20261127.md).

Workers serves React → Supabase Edge Functions verify identity → PostgreSQL/Gemini → backend validation → editable UI. Edge owns application data/AI; browser exceptions are Supabase Auth and backend-authorized signed R2 image bytes. Automatic saving became explicit preview/save. Retrieval uses ingredient overlap, without embeddings/vectors. Yuan confirms instructor pitch approval; exact approved revision remains unknown. [Architecture diagram](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/architecture/sprint-1-adr.md#architecture) · [Scope trail](process-evidence.md#scope-decision-trail).

### 2 Technology & dependency disclosure

| Area | Technology and responsibility |
|---|---|
| Frontend / UX | TypeScript 5.7.3, React 19.3.0, Router 7.18.4, Query 5.104.4, Vite 6.4.5, Lucide 1.64.0, CSS/SVG; Workers static hosting. [Manifest/lock](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/frontend/pnpm-lock.yaml). |
| Backend / API | TypeScript, Supabase Edge/Deno 2.9.7 in CI, Zod 4.6.6, Supabase JS 2.39.8/PostgREST; SQL/RPCs, no ORM. [Deno lock](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/deno.lock). |
| Database / auth | Supabase PostgreSQL/Auth, frontend client 2.118.0; PostgreSQL 16 in DB checks, hosted version unmeasured; private photos in R2. [Schema](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/database.md). |
| AI / data | Gemini, code default `gemini-3.5-flash-lite`, SDK 0.21.0; JSON/ingredient retrieval and synthetic fixtures. Live override unverified. [AI design](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/ai-architecture.md). |
| DevOps / quality | GitHub Actions, Node 24/pnpm 10, Supabase CLI 2.122.0, Wrangler 4.168.0, ESLint 9.39.5, Vitest 4.1.12, Playwright 1.64.1. Actions/provider logs; separate analytics unestablished. [Pipeline](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/devops/PIPELINE.md). |
| External / cost | Codex/OpenCode, CodeRabbit trial, Codex review, Figma, Impeccable, Ponytail/RTK disclosed. 27 Nov Gemini audit: Free/no billing, 15 RPM/250,000 input TPM/500 RPD. Supabase historically Free; current other charges/spend limits unverified. [Tools, assets and notices](external-work-disclosure.md). |

### 3 Data model, API & user workflow

`recipes.user_id` references Auth users; `recipe_lineage` references parent/child recipes. Migrations enforce unique pairs, no self-links, ownership and cascading lineage removal. Internal quota/image queues stay backend-owned; physical image cleanup is asynchronous. [Schema/migrations](https://github.com/2ton-exe/moris-mix-ai/tree/c49a8406a535d9b3475634f4f3c6ff998223e246/supabase/migrations).

Authenticated POST/GET/PATCH/DELETE `/recipes` and `/recipes/:id` implement CRUD/search; POST `/recipes/:id/lineage` checks signed parent authorization. PATCH checks edit versions; JSON/field limits and safe errors protect requests. PA saved/reopened/edited/deleted a synthetic recipe; another witness survived redeployment. [Both DUR figures](assets/PA-20261127.md#evidence-index-and-gap-updates) are supplied. [API](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/api/README.md) · [PA evidence](assets/PA-20261127.md).

---

## Implementation & Verification

### 4 AI feature: design, output processing & evidence

Quick AI Entry extracts ingredients and ordered steps from notes. Chef ranks owned recipes by normalized ingredient overlap, rating and recency, then supplies bounded context with pantry/preferences. Prompts are extraction 1.1.0, Chef 1.2.0 and revision 1.0.0. Gemini JSON is parsed, normalized, schema-checked and checked for substitution/parent membership; note revisions also require one verifiable amount change. The UI receives an editable preview. Explicit recipe save and lineage save are separate operations with recovery for partial success. [AI contract](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/api/ai-integration.md).

Code defaults include 20 logical operations/account/UTC day and bounded burst controls; optional shared provider ceilings count attempts separately. Each provider attempt has a 30-second timeout and at most one bounded retry. Invalid output returns a typed error; failure retains input for retry/manual entry and writes no recipe/lineage. Operational settings, provider eligibility and food safety are not established by these guards. [Provider/quota source](https://github.com/2ton-exe/moris-mix-ai/tree/c49a8406a535d9b3475634f4f3c6ff998223e246/supabase/functions/_shared/ai).

Four deterministic test blocks cover 30 synthetic fixture cases: 14 extraction, 8 Chef, 8 faults. The historical 14 Nov extraction spot check was 3/3 at `b297977`. PA-20261127 separately observed three app submissions, with unknown provider-attempt count. None is a model-accuracy or human-scoring study. [Evaluation](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/ai-evaluation-report.md).

### 5 Security, data protection & reliability

Verified JWTs, owner-scoped queries/RLS and backend-only quota/image operations restrict access. Images require ownership/type/size checks and signed byte URLs. Environment/provider stores inject secrets. Notes/selected recipe context enter Gemini; drafts use session storage, saved recipes PostgreSQL. Safe messages/request IDs support retry. PA R2-02 checkpoint: two objects present, queue zero attempts. Secret-history coverage, live provider eligibility/data use and cleanup remain DevOps dependencies. [Environment example](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/.env.example) · [Image contract](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/api/recipe-images.md).

### 6 Testing: report actual counts and results

| Scope | Result and limits |
|---|---|
| Release CI, 27 Nov | At `c49a840`: 1,015 frontend tests/64 files passed; 557 deterministic Edge/API passed, 0 failed, 6 ignored; separate non-production hosted RLS: 204 passed, 0 failed. Nine browser shards and production route/runtime smoke passed. [Exact run](https://github.com/2ton-exe/moris-mix-ai/actions/runs/46024556206). |
| Local persistence / browser | At `d329285`, disposable PostgreSQL 16: 13 migration scenarios and 137 RLS assertions passed. At repair `40b5e10`: 63 generation/53 RecipePages tests and 9 browser journeys/10 executions passed; broader frontend attempt had one timeout, isolated rerun passed. Counts overlap. [Runs](compilation-record.md#repair-follow-up-verification). |
| Production acceptance | PA-20261127: AUTH-01, CRUD-01, DUR-01, AI-EX-01 and app-level R2-01 passed; Chef/revision end-to-end failed; R2-02 partial. Tests belong to `5cad4b8`/`05c9b32`, not v1.0.0. [Report](assets/PA-20261127.md). |
| Repair / proof limits | [#308](https://github.com/2ton-exe/moris-mix-ai/pull/308) merged as `66ccff1`, deployed and included in v1.0.0. Targeted production Chef/revision acceptance remains unverified; local checks are not a production retest. Exact-note-target semantics remain limited. [DevOps packet](assets/devops-handoff-20261127.md). |

### 7 Engineering process & CI/CD

Protected main requires one approval, Code Owners, resolved threads and three core checks. Eligible PRs deploy staging; main validates, deploys and smokes. Keep #293 draft: its asset scope can trigger staging. Sprint labels map work; Yuan confirms feedback applied in weeks 1–3, no week-4 consultation. Standup/retro originals remain incomplete. [Process](process-evidence.md) · [Pipeline/diagram](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/devops/PIPELINE.md#pipeline-diagram).

Docs-only PR wall clock: 91 s (1 run) → 37 s (3 runs). Frozen 7–17 Nov UTC: 196/231 PR and 42/51 main-push successes. Reviewed revert-to-smoke recovery: 7m 11s; synthetic restore proof exists, production-archive recovery unverified. Continuous recording has no verified playback URL. [Metrics](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/devops/pipeline-metrics.md) · [Recovery](https://github.com/2ton-exe/moris-mix-ai/issues/165).

---

## Ownership, Limitations & Evidence

### 8 Contribution and external-work disclosure

| Member and declared role | Representative contribution, preserving historical attribution |
|---|---|
| Klein Rhee P. Sioson · AI Engineer | Extraction, Chef orchestration and offline evaluation. [#127](https://github.com/2ton-exe/moris-mix-ai/pull/127), [#129](https://github.com/2ton-exe/moris-mix-ai/pull/129), [#135](https://github.com/2ton-exe/moris-mix-ai/pull/135). |
| Joseph Andrew Y. Ong · Frontend Engineer | Journal, extraction review and accessibility. [#152](https://github.com/2ton-exe/moris-mix-ai/pull/152), [#173](https://github.com/2ton-exe/moris-mix-ai/pull/173), [#212](https://github.com/2ton-exe/moris-mix-ai/pull/212). |
| Daniel C. Ramos · Backend Engineer | CRUD, owned-recipe retrieval and image lifecycle. [#72](https://github.com/2ton-exe/moris-mix-ai/pull/72), [#123](https://github.com/2ton-exe/moris-mix-ai/pull/123), [#188](https://github.com/2ton-exe/moris-mix-ai/pull/188). |
| Yuan Paulo Sebastian M. Belen · Full-Stack Engineer | Image integration, Mori, browser sharding, merged desktop/revision work; current non-DevOps documentation, verification, synthesis and final approval. [#232](https://github.com/2ton-exe/moris-mix-ai/pull/232), [#249](https://github.com/2ton-exe/moris-mix-ai/pull/249), [#282](https://github.com/2ton-exe/moris-mix-ai/pull/282), [#293](https://github.com/2ton-exe/moris-mix-ai/pull/293). |
| Diofel Gwen F. Haresco · DevOps Engineer | Pipeline, delivery/security and backup/restore operations. [#268](https://github.com/2ton-exe/moris-mix-ai/pull/268), [#285](https://github.com/2ton-exe/moris-mix-ai/pull/285), [#289](https://github.com/2ton-exe/moris-mix-ai/pull/289). |

myntchoc supplied the grouped development-tool and Figma/Codex asset declaration. Codex and delegated assessment supported synthesis with source/tests/render checks; Yuan approved reviewed revision `3677bce` and clarifications on 27 Nov; later synthesis preserves those facts. Runtime Gemini is separate. Fonts retain OFL, Twemoji CC BY 4.0 and Lucide/Feather ISC/MIT notices. A01’s procedural JPEG replacements exist in #293’s tree/build and are not claimed deployed. A05–A08 source/tool provenance is documented; permission for retained adapted material is not yet established. Attribution and document approval do not supply third-party permission. [Disclosure and exact inventory](external-work-disclosure.md).

### 9 Current limitations and final status

**Reviewable submission with gaps.** Release v1.0.0 is tagged/deployed; #282 and #308 are merged. Historical PA passes remain valid at their revisions, while Chef/revision production acceptance remains unverified after repair. R2 physical deletion remains partial. Document approval does not establish later product acceptance or overall readiness.

Both named PA screenshots are supplied. Yuan confirms pitch approval, applied consultation feedback and shared workflow/asset origins. Narrow gaps remain: exact approved pitch revision, standup/retro originals, specific asset permissions, current function provenance/provider policy, later object disposition and panel-playable recording. [D1–D5 and gaps](outstanding-confirmations.md) · [DevOps evidence](assets/devops-handoff-20261127.md).

Next: obtain the missing operational/media/access evidence and only separately authorized release-specific acceptance. Preserve synthetic-restore and production-archive limits. Optional export/deletion, #274 and vector search remain outside scope. No 100% submission readiness claimed. [Evidence map](README.md#current-evidence).

### 10 Reviewer evidence index

| Area | Reviewer links |
|---|---|
| Product and source | [Production](https://moris-mix-ai.diofelgwenharesco.workers.dev), [repository](https://github.com/2ton-exe/moris-mix-ai), [separate revision identities](README.md#revision-identities). [v1.0.0/changelog](https://github.com/2ton-exe/moris-mix-ai/releases/tag/v1.0.0). |
| Technical references | [Architecture diagram](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/architecture/sprint-1-adr.md#architecture), [schema](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/database.md), [API](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/api/README.md). |
| AI and testing | [Evaluation](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/ai-evaluation-report.md), [exact local runs](compilation-record.md#verification-record), [production acceptance](assets/PA-20261127.md). |
| Delivery and process | [Pipeline](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/devops/PIPELINE.md), [metrics](https://github.com/2ton-exe/moris-mix-ai/blob/c49a8406a535d9b3475634f4f3c6ff998223e246/docs/devops/pipeline-metrics.md), [four sprints](process-evidence.md), [captured board](board-evidence.md). |
| Submission and media | [Existing FINAL DOCUMENT destination](https://docs.google.com/document/d/1USkQIcd6oCz7vO2sAsE2ssJcLbs-OOlsEqgfmDamqcI/edit?tab=t.0); PDF/DOCX are linked in the [submission index](README.md). Continuous recording playback and panel access remain unverified. |
