# Sprint 1 Log — Foundation / Walking Skeleton

- **Sprint:** Week 1 / Sprint 1
- **Calendar dates:** To be confirmed
- **Log snapshot:** 2026-10-16
- **Product Owner:** [@myntchoc](https://github.com/myntchoc)
- **Project board:** [Project Board](https://github.com/2ton-exe/moris-mix-ai/projects)
- **Backlog:** [Sprint 1 issues](https://github.com/2ton-exe/moris-mix-ai/issues?q=is%3Aissue+label%3A%22Sprint+1%22)

> This is the execution log for Sprint 1. The [architecture ADR](../architecture/sprint-1-adr.md) records the target decisions; the [pipeline metrics log](../devops/pipeline-metrics.md) records CI and deployment measurements.

## Sprint goal

Establish the agreed course-compliant architecture and deploy the first working vertical slice: React frontend → Supabase Edge Function REST API → PostgreSQL, supported by version-controlled migrations, CI/CD, secure environment configuration, and verified backend-only Gemini connectivity. The initial integration uses a read-only demonstration endpoint with non-sensitive sample recipe data. Authenticated recipe CRUD is Sprint 2 work.

## Team roster

| README member | Project role | Sprint plan label |
|---|---|---|
| [@KleinRheePagulongSioson](https://github.com/KleinRheePagulongSioson) | AI Engineer | Sioson |
| [@adnro2](https://github.com/adnro2) | Frontend Engineer | Ong |
| [@DanielRamos1186](https://github.com/DanielRamos1186) | Backend Engineer | Ramos |
| [@myntchoc](https://github.com/myntchoc) | Full-Stack | Belen |
| [@DaeSaster](https://github.com/DaeSaster) | DevOps Engineer | Haresco |

The plan-label matches above are inferred from the matching workstream and README role. Confirm them with the team if the labels refer to different members.

## Consultation demo acceptance

- The React application loads from the production Cloudflare URL.
- The frontend calls `GET /functions/v1/demo-recipe`; the Edge Function returns approved sample data read from PostgreSQL.
- Database migrations and the shared API contract are committed.
- The Sprint 1 board and backlog show assigned issues; pull requests receive teammate review and CI checks.
- Merging a reviewed change to `main` triggers the production deployment.
- One backend-only Gemini connectivity test succeeds and its result is recorded.
- No real credentials or secrets are committed.

## Planned commitments and status

Target days were blank in the supplied plan, so they remain unassigned here. Status notes below describe repository evidence at this log snapshot; update them from the board and team reports during stand-ups.

| Task | Priority | Primary owner | Collaborator / reviewer | Depends on | Status / evidence at log start |
|---|---:|---|---|---|---|
| DEVOPS-00 — organization, repository transfer, access, and `main` | P0 | @DaeSaster (Haresco) | @myntchoc (Belen) | Existing repository | Confirm completion with the team; not evidenced by repository files. |
| BE-01 — Sprint 1 architecture ADR | P0 | @DanielRamos1186 (Ramos) | @myntchoc (Belen) | Approved standards | Done; ADR merged in [PR #7](https://github.com/2ton-exe/moris-mix-ai/pull/7). |
| DOC-01 — README, safe templates, backlog, board, and sprint log | P0 | @myntchoc (Belen) | @DaeSaster (Haresco) | Repository access | In progress; README and setup changes are in [PR #28](https://github.com/2ton-exe/moris-mix-ai/pull/28), which is open at this snapshot. This file supplies the log; add the confirmed board URL and verify backlog assignments. |
| FS-01 — demo API contract and fixture | P0 | @myntchoc (Belen) | @DanielRamos1186 (Ramos), @adnro2 (Ong) | BE-01; demo purpose | No API contract or fixture is present in the checked repository snapshot. |
| FE-01 — React/Vite/TypeScript shell | P0 | @adnro2 (Ong) | @myntchoc (Belen) | Folder and package standards | No `frontend/` project is present in the checked snapshot. |
| BE-02 — migrations, recipe/lineage schema, RLS, and demo seed | P0 | @DanielRamos1186 (Ramos) | @myntchoc (Belen) | BE-01 schema decisions | No migration or seed files are present in the checked snapshot. |
| BE-03 — read-only demo-recipe Edge Function | P0 | @DanielRamos1186 (Ramos) | @myntchoc (Belen) | FS-01; BE-02 | No `demo-recipe` function is present in the checked snapshot. |
| FE-02 — API client and walking-skeleton screen | P0 | @adnro2 (Ong) | @myntchoc (Belen) | FS-01; BE-03 | Waiting on the frontend and deployed demo endpoint. |
| AI-01 — AIProvider and controlled Gemini test | P0 | @KleinRheePagulongSioson (Sioson) | @DanielRamos1186 (Ramos) | Gemini key; Supabase access | AI adapter and connectivity-test source are present; live result/evidence is not recorded here. |
| DEVOPS-01 — PR CI and required review/checks | P0 | @DaeSaster (Haresco) | @myntchoc (Belen) | Repository; FE-01 scripts | CI and branch-protection evidence are documented; frontend checks remain unverified while the frontend is absent. See [pipeline metrics](../devops/pipeline-metrics.md). |
| DEVOPS-02 — Workers hosting and production deployment | P0 | @DaeSaster (Haresco) | @DanielRamos1186 (Ramos), @adnro2 (Ong) | Frontend build; backend deployment inputs | Wrangler and deployment workflow files are present; a live frontend-to-API production integration is not yet verified in the metrics log. |
| QA-01 — live UI/API/database and Gemini smoke test | P0 | @myntchoc (Belen) | @adnro2 (Ong), @DanielRamos1186 (Ramos), @KleinRheePagulongSioson (Sioson) | FE-02; BE-03; DEVOPS-02; AI-01 | Pending the integrated demo and recorded evidence. |
| DEVOPS-03 — pipeline documentation and baseline | P0 | @DaeSaster (Haresco) | @myntchoc (Belen) | CI/deployment runs | In progress; bootstrap CI measurements are in [pipeline metrics](../devops/pipeline-metrics.md); production deployment and recovery measurements remain pending there. |
| DOC-02 — setup, seed, API notes, and troubleshooting | P1 | @myntchoc (Belen) | @DanielRamos1186 (Ramos), @DaeSaster (Haresco) | Working demo; finalized environment | Planned after the runnable demo, as stated in the task dependency. |

## Implementation dependencies

BE-01 and the approved Sprint 1 standards guide parallel work. FS-01 lets FE-02 start against a fixture while backend work proceeds. BE-03 depends on the schema and seed from BE-02. Before Sprint 1 closes, the deployed frontend must retrieve real PostgreSQL data through the Edge Function; browser code must not query application tables directly.

**Sprint 2 boundary:** authenticated recipe CRUD and reusable JWT authorization middleware.

## Stand-up log

Add one dated entry per stand-up. Record facts, blockers, decisions, and links; do not record secrets.

### YYYY-MM-DD

- Completed:
- Planned next:
- Blockers / decisions:
- Related issues, PRs, or evidence:

## Sprint review and carryover

Complete at the end of the sprint.

- Sprint goal met? What evidence supports the result?
- Completed commitments:
- Incomplete work and reason:
- Carryover to Sprint 2 or later:
- Retrospective actions:
- Incidents, optimizations, and rollback notes:
