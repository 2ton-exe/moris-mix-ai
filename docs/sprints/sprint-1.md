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

Target days were blank in the supplied plan, so they remain unassigned here. Status notes below reflect repository and CI evidence at this update; confirm board-only progress with the team during stand-ups.

| Task | Priority | Primary owner | Collaborator / reviewer | Depends on | Status / evidence at log start |
|---|---:|---|---|---|---|
| DEVOPS-00 — organization, repository transfer, access, and `main` | P0 | @DaeSaster (Haresco) | @myntchoc (Belen) | Existing repository | Confirm completion with the team; not evidenced by repository files. |
| BE-01 — Sprint 1 architecture ADR | P0 | @DanielRamos1186 (Ramos) | @myntchoc (Belen) | Approved standards | Done; ADR merged in [PR #7](https://github.com/2ton-exe/moris-mix-ai/pull/7). |
| DOC-01 — README, safe templates, backlog, board, and sprint log | P0 | @myntchoc (Belen) | @DaeSaster (Haresco) | Repository access | In progress; README and setup changes are in [PR #28](https://github.com/2ton-exe/moris-mix-ai/pull/28), which is open at this snapshot. This file supplies the log; add the confirmed board URL and verify backlog assignments. |
| FS-01 — demo API contract and fixture | P0 | @myntchoc (Belen) | @DanielRamos1186 (Ramos), @adnro2 (Ong) | BE-01; demo purpose | No API contract or fixture is present in the checked repository snapshot. |
| FE-01 — React/Vite/TypeScript shell | P0 | @adnro2 (Ong) | @myntchoc (Belen) | Folder and package standards | Scaffold is present on `main` with `/` and `/about` routes; [CI run #36](https://github.com/2ton-exe/moris-mix-ai/actions/runs/38912161040) passed frozen install, lint, and production build. Confirm the board reflects any remaining acceptance work. |
| BE-02 — migrations, recipe/lineage schema, RLS, and demo seed | P0 | @DanielRamos1186 (Ramos) | @myntchoc (Belen) | BE-01 schema decisions | No migration or seed files are present in the checked snapshot. |
| BE-03 — read-only demo-recipe Edge Function | P0 | @DanielRamos1186 (Ramos) | @myntchoc (Belen) | FS-01; BE-02 | No `demo-recipe` function is present in the checked snapshot. |
| FE-02 — API client and walking-skeleton screen | P0 | @adnro2 (Ong) | @myntchoc (Belen) | FS-01; BE-03 | The current app entry point still shows starter content; live demo-recipe display, loading/error states, and endpoint connection remain to be verified after FS-01 and BE-03. |
| AI-01 — AIProvider and controlled Gemini test | P0 | @KleinRheePagulongSioson (Sioson) | @DanielRamos1186 (Ramos) | Gemini key; Supabase access | AI adapter and connectivity-test source are present; live result/evidence is not recorded here. |
| DEVOPS-01 — PR CI and required review/checks | P0 | @DaeSaster (Haresco) | @myntchoc (Belen) | Repository; FE-01 scripts | [CI run #36](https://github.com/2ton-exe/moris-mix-ai/actions/runs/38912161040) passed frontend install, lint, and build. Prior branch-protection evidence is recorded in [pipeline metrics](../devops/pipeline-metrics.md); confirm current settings in GitHub. |
| DEVOPS-02 — Workers hosting and production deployment | P0 | @DaeSaster (Haresco) | @DanielRamos1186 (Ramos), @adnro2 (Ong) | Frontend build; backend deployment inputs | Wrangler and deployment workflow files are present; a live frontend-to-API production integration is not yet verified in the metrics log. |
| QA-01 — live UI/API/database and Gemini smoke test | P0 | @myntchoc (Belen) | @adnro2 (Ong), @DanielRamos1186 (Ramos), @KleinRheePagulongSioson (Sioson) | FE-02; BE-03; DEVOPS-02; AI-01 | Pending at log start; production UI/API/PostgreSQL path passed 2026-10-17, while Gemini generation was denied (HTTP 403). See the dated record below. |
| DEVOPS-03 — pipeline documentation and baseline | P0 | @DaeSaster (Haresco) | @myntchoc (Belen) | CI/deployment runs | In progress; bootstrap CI measurements are in [pipeline metrics](../devops/pipeline-metrics.md); production deployment and recovery measurements remain pending there. |
| DOC-02 — setup, seed, API notes, and troubleshooting | P1 | @myntchoc (Belen) | @DanielRamos1186 (Ramos), @DaeSaster (Haresco) | Working demo; finalized environment | Planned after the runnable demo, as stated in the task dependency. |

## QA-01 smoke-test record 2026-10-17

**Checked:** 2026-10-17 (Asia/Manila)

### Production UI, API, and database

- Opened the [production frontend](https://moris-mix-ai.diofelgwenharesco.workers.dev). It rendered “Demonstration recipe” and “Classic Tomato Scraps Pasta”. The browser loaded data from the Supabase Edge Function.
- A direct `GET https://gtbwblxskctpsqhbpebg.supabase.co/functions/v1/demo-recipe` returned `200 OK` with `Content-Type: application/json` and `Cache-Control: public, max-age=60, s-maxage=300`.
- The Edge Function's database query filters `recipes` by the approved demo ID, owner ID, and `is_public = true`. The successful response confirms the production query can read the expected row and the runtime schema/seed state required by `20261017000001_add_is_public_to_recipes.sql` is present. The connected Supabase account does not have access to this project, so its migration-history ledger could not be read independently.

Sample response:

```json
{
  "recipe": {
    "id": "11111111-1111-1111-1111-111111111111",
    "title": "Classic Tomato Scraps Pasta",
    "ingredients": [
      { "name": "spaghetti", "quantity": 200, "unit": "g", "inferred": false },
      { "name": "tomato paste", "quantity": 2, "unit": "tbsp", "inferred": false },
      { "name": "garlic", "quantity": 2, "unit": "cloves", "inferred": false },
      { "name": "Fresh basil", "quantity": null, "unit": null, "inferred": false }
    ],
    "instructions": [
      { "step": 1, "text": "Boil pasta in salted water." },
      { "step": 2, "text": "Saute minced garlic and tomato paste." },
      { "step": 3, "text": "Toss pasta with sauce and torn basil." }
    ],
    "flavor_scores": { "sweet": 2, "salty": 3, "sour": 3, "bitter": 1, "umami": 4, "spicy": 0 },
    "star_rating": 4,
    "cooked_at": "2026-10-14"
  }
}
```

### CI and reviewed PR evidence

- [PR #31](https://github.com/2ton-exe/moris-mix-ai/pull/31) was approved by @myntchoc on 2026-10-16 15:59:55 UTC and merged as `8f8e0d8456acf3589184c082bfc9f94375c23e67`.
- [Main CI run #48](https://github.com/2ton-exe/moris-mix-ai/actions/runs/38928750840) completed successfully on that merge. Both `Frontend Checks` and `Deploy to Cloudflare` succeeded.

### Gemini and project board

- The earlier Gemini model-list request returned `200`. The migrated Interactions API smoke test returned `404 NOT_FOUND` for the configured `gemini-3.8-flash-lite` model; retrying with the supported `gemini-3.8-flash` model returned `403 PERMISSION_DENIED` (`Your project has been denied access`). Generation is not verified; no API key was recorded.
- The linked [repository Projects view](https://github.com/2ton-exe/moris-mix-ai/projects) showed no projects (`Open (0)`, `Closed (0)`), so there was no Sprint 1 board state to verify.

**QA-01 status:** Partial. The production browser → Edge Function → PostgreSQL path passed. Gemini generation remains blocked, the production migration ledger could not be inspected, and the linked repository has no project board.

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
