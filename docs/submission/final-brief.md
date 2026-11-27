# Mori’s Mix Final Technical Documentation

**PROVISIONAL · FOR MYNTCHOC’S REVIEW**

**CSP221A · BSCS 4B · 2ton.exe · Reconciled 27 November 2026 PHT**

**Klein Rhee P. Sioson** – AI Engineer; **Joseph Andrew Y. Ong** – Frontend Engineer; **Daniel C. Ramos** – Backend Engineer; **Yuan Paulo Sebastian M. Belen** – Full-Stack Engineer; **Diofel Gwen F. Haresco** – DevOps Engineer.

**Release:** designation pending DevOps. **PA:** `5cad4b8`/`05c9b32`; **local:** `d329285`, repair `40b5e10` (#308); **docs:** #293. [Repository](https://github.com/2ton-exe/moris-mix-ai) · [Production](https://moris-mix-ai.diofelgwenharesco.workers.dev) · [Revision identities and current evidence](README.md).

### 1 Product status & architecture

Mori’s Mix helps home cooks keep private recipes and turn notes or pantry ingredients into editable drafts. PA-20261127 passed session-reused access, CRUD, extraction/edit/save/reopen, deployment persistence and app image handling. Chef failed before inspiration selection/save; note-driven revision was rejected. Both end-to-end journeys remain unaccepted. [Acceptance report](assets/PA-20261127.md).

Workers serves React → Supabase Edge Functions verify identity → PostgreSQL/Gemini → backend validation → editable UI. Edge owns application data/AI; browser exceptions are Supabase Auth and backend-authorized signed R2 image bytes. Automatic saving became explicit preview/save. Retrieval uses ingredient overlap, without embeddings/vectors. Approved-pitch identity remains open. [Architecture diagram](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/architecture/sprint-1-adr.md#architecture) · [Scope trail](process-evidence.md#scope-decision-trail).

### 2 Technology & dependency disclosure

| Area | Technology and responsibility |
|---|---|
| Frontend / UX | TypeScript 5.7.3, React 19.3.0, Router 7.18.4, Query 5.104.4, Vite 6.4.5, Lucide 1.64.0, CSS/SVG; Workers static hosting. [Manifest/lock](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/frontend/pnpm-lock.yaml). |
| Backend / API | TypeScript, Supabase Edge/Deno 2.9.7 in CI, Zod 4.6.6, Supabase JS 2.39.8/PostgREST; SQL/RPCs, no ORM. [Deno lock](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/deno.lock). |
| Database / auth | Supabase PostgreSQL/Auth, frontend client 2.118.0; PostgreSQL 16 in DB checks, hosted version unmeasured; private photos in R2. [Schema](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/database.md). |
| AI / data | Gemini, code default `gemini-3.5-flash-lite`, SDK 0.21.0; JSON/ingredient retrieval and synthetic fixtures. Live override unverified. [AI design](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/ai-architecture.md). |
| DevOps / quality | GitHub Actions, Node 24/pnpm 10, Supabase CLI 2.122.0, Wrangler 4.168.0, ESLint 9.39.5, Vitest 4.1.12, Playwright 1.64.1. Actions/provider logs; separate analytics unestablished. [Pipeline](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/devops/PIPELINE.md). |
| External / cost | Codex/OpenCode, CodeRabbit trial, Codex review, Figma, Impeccable, Ponytail/RTK disclosed. Historical reports: Gemini Free 15 RPM/500 RPD (20 Nov), Supabase Free. Current costs/limits await DevOps. [Tools, assets and notices](external-work-disclosure.md). |

### 3 Data model, API & user workflow

`recipes.user_id` references Auth users; `recipe_lineage` references parent/child recipes. Migrations enforce unique pairs, no self-links, ownership and cascading lineage removal. Internal quota/image queues stay backend-owned; physical image cleanup is asynchronous. [Schema/migrations](https://github.com/2ton-exe/moris-mix-ai/tree/d329285ce0be5e955ee6ac76751cf97f6e58f799/supabase/migrations).

Authenticated POST/GET/PATCH/DELETE `/recipes` and `/recipes/:id` implement CRUD/search; POST `/recipes/:id/lineage` checks signed parent authorization. PATCH checks edit versions; JSON/field limits and safe errors protect requests. PA saved/reopened/edited/deleted a synthetic recipe; another witness survived redeployment. [API](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/api/README.md) · [PA evidence](assets/PA-20261127.md).

---

## Implementation & Verification

### 4 AI feature: design, output processing & evidence

Quick AI Entry extracts ingredients and ordered steps from notes. Chef ranks owned recipes by normalized ingredient overlap, rating and recency, then supplies bounded context with pantry/preferences. Prompts are extraction 1.1.0, Chef 1.2.0 and revision 1.0.0. Gemini JSON is parsed, normalized, schema-checked and checked for substitution/parent membership; note revisions also require one verifiable amount change. The UI receives an editable preview. Explicit recipe save and lineage save are separate operations with recovery for partial success. [AI contract](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/api/ai-integration.md).

Code defaults include 20 logical operations/account/UTC day and bounded burst controls; optional shared provider ceilings count attempts separately. Each provider attempt has a 30-second timeout and at most one bounded retry. Invalid output returns a typed error; failure retains input for retry/manual entry and writes no recipe/lineage. Operational settings, provider eligibility and food safety are not established by these guards. [Provider/quota source](https://github.com/2ton-exe/moris-mix-ai/tree/d329285ce0be5e955ee6ac76751cf97f6e58f799/supabase/functions/_shared/ai).

Four deterministic test blocks cover 30 synthetic fixture cases: 14 extraction, 8 Chef, 8 faults. The historical 14 Nov extraction spot check was 3/3 at `b297977`. PA-20261127 separately observed three app submissions, with unknown provider-attempt count. None is a model-accuracy or human-scoring study. [Evaluation](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/ai-evaluation-report.md).

### 5 Security, data protection & reliability

Verified JWTs, owner-scoped queries/RLS and backend-only quota/image operations restrict access. Images require ownership/type/size checks and signed byte URLs. Environment/provider stores inject secrets. Notes/selected recipe context enter Gemini; drafts use session storage, saved recipes PostgreSQL. Safe messages/request IDs support retry. R2-02: two objects present, queue zero attempts. Secret-history coverage, live provider eligibility/data use and cleanup remain DevOps dependencies. [Environment example](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/.env.example) · [Image contract](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/api/recipe-images.md).

### 6 Testing: report actual counts and results

| Scope | Result and limits |
|---|---|
| Focused local source, 27 Nov | At `d329285`: 447 Edge/API passed, 0 failed, 5 environment-dependent cases ignored; frontend invocations passed 489 and 66 distinct focused cases. Eight revision diagnostic tests passed separately; no full-suite sum claimed. [Exact commands/runs](compilation-record.md#verification-record). |
| Local persistence / browser | Disposable PostgreSQL 16: 13 migration scenarios and 137 RLS assertions passed. Chef happy path passed at two desktop sizes; lineage failure/reload/retry passed. Synthetic transport is separate from real SQL checks and establishes no hosted-DB acceptance. [Run record](compilation-record.md#verification-record). |
| Production acceptance | PA-20261127: AUTH-01, CRUD-01, DUR-01, AI-EX-01 and app-level R2-01 passed; Chef and revision end-to-end failed; R2-02 partial. Tests belong to `5cad4b8`/`05c9b32`, not later main. [Report](assets/PA-20261127.md). |
| Repair / proof limits | Unmerged [#308](https://github.com/2ton-exe/moris-mix-ai/pull/308), `40b5e10`: 63 generation and 53 RecipePages tests pass; revision save/reopen passes at two desktop sizes. Wider frontend attempt: one timeout. PA failures remain unaccepted; exact-target semantics limited. [Repair runs](compilation-record.md#repair-follow-up-verification). |

### 7 Engineering process & CI/CD

Issues/branches/reviewed PRs feed three core validation jobs. Eligible non-draft PRs can deploy staging; main runs gated deployment/smoke, separate browsers and migration controls. Keep #293 draft: marking ready can deploy its asset scope. Four sprint sections/78 board rows preserve attribution; standups/retros remain incomplete. Dated recollections cover weeks 1–3; no week-4 consultation reported. [Process](process-evidence.md) · [Workflows](https://github.com/2ton-exe/moris-mix-ai/tree/d329285ce0be5e955ee6ac76751cf97f6e58f799/.github/workflows).

Matched docs-only workflows: 91 s (1 run) → 37 s (3 runs). Frozen 7–17 Nov UTC cohort: 196/231 PR, 42/51 main-push successes. No overall speedup inferred. Release tag/SHA, current restore/rollback proof and uninterrupted deployment recording await the DevOps packet. [Metrics](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/devops/pipeline-metrics.md) · [Runbook](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/devops/deployment-runbook.md).

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

myntchoc supplied the grouped development-tool and Figma/Codex asset declaration. This reconciliation also uses Codex and delegated assessment, checked against source, deterministic tests and rendered pages; final human approval is pending. Runtime Gemini is separate. Fonts retain OFL, Twemoji CC BY 4.0 and Lucide/Feather ISC/MIT notices. A01’s procedural JPEG replacements exist in #293’s tree/build and are not claimed deployed. A05–A08 source/tool provenance is documented; permission for retained adapted material is not yet established. Attribution and document approval do not supply third-party permission. [Disclosure and exact inventory](external-work-disclosure.md).

### 9 Current limitations and final status

**Provisional.** #282 is merged; its old pending-PR blocker is removed. The supplied acceptance establishes live CRUD, persistence, extraction and app image handling at its stated revisions. It does not accept Chef lineage/reopen or note-driven linked-copy behavior in production. R2 physical deletion remains partial. Local checks neither overwrite these results nor certify a later production head.

The consolidated register separates behavior failures, missing originals, missing media, factual declarations and access gaps. Original Endterm instructions and pitch/plan copies were found; instructor-approved pitch identity, original standups/retros and some consultation details remain unestablished. Missing PA screenshots, panel permissions, final release designation, required DevOps proof and final PDF/Google Doc submission remain open. [Questions and DevOps dependencies](outstanding-confirmations.md).

Next: review the updated brief and close the named evidence/access gaps; local repairs are verified separately in #308. Optional export/account deletion, #274 and vector search are outside this work; they are not added as new submission gates. No new approval, production test, deployment or 100% readiness is claimed. [Current decisions](README.md#current-evidence).

### 10 Reviewer evidence index

| Area | Reviewer links |
|---|---|
| Product and source | [Production](https://moris-mix-ai.diofelgwenharesco.workers.dev), [repository](https://github.com/2ton-exe/moris-mix-ai), [separate revision identities](README.md#revision-identities). Final release designation pending DevOps. |
| Technical references | [Architecture diagram](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/architecture/sprint-1-adr.md#architecture), [schema](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/database.md), [API](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/api/README.md). |
| AI and testing | [Evaluation](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/ai-evaluation-report.md), [exact local runs](compilation-record.md#verification-record), [production acceptance](assets/PA-20261127.md). |
| Delivery and process | [Pipeline](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/devops/PIPELINE.md), [metrics](https://github.com/2ton-exe/moris-mix-ai/blob/d329285ce0be5e955ee6ac76751cf97f6e58f799/docs/devops/pipeline-metrics.md), [four sprints](process-evidence.md), [captured board](board-evidence.md). |
| Submission and media | [Existing FINAL DOCUMENT destination](https://docs.google.com/document/d/1USkQIcd6oCz7vO2sAsE2ssJcLbs-OOlsEqgfmDamqcI/edit?tab=t.0); current review copy is local. Continuous deployment recording and panel-view access remain unverified. |
