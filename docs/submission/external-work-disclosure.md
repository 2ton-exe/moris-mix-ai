# External-work and asset disclosure

Compiled **27 November 2026, Asia/Manila**, from main
`7e5260be9c92d0dc07a94ae06447020655b1381b` and this PR's replacement patch.
Original event dates below are separate from compilation. This inventory records
inspected evidence, not a complete certification of anybody's assistant use or
originality. Contributor confirmations remain pending until an attributable reply
or original record supports them. See [outstanding confirmations](outstanding-confirmations.md).

**Verified** means the inspected source supports the stated fact. **Partial**
means it supports only part. **Awaiting confirmation** identifies an exact
contributor question. **Missing original record** means no original was located;
it does not establish that the material was copied without permission.

## Coverage and source access

The seven local 25 November audit attachments were used as historical leads:
`SUBMISSION_GAPS.md`, `REQUIREMENTS_TRACEABILITY.md`, `AUDIT_REPORT.md`,
`EVIDENCE_MATRIX.md`, `RELEASE_SNAPSHOT.md`, `PR_RELEASE_READINESS.md`, and
`Moris_Mix_Final_Technical_Documentation.md`. Their asset summary is incomplete for
the current tree: the five kitchen WebPs and vendored Twemoji also need entries.
The audit files are untracked local attachments, not public repository originals.
This document supplies a readable, limited summary instead of linking to private
file paths or claiming panel access to those attachments.

Inspected sources include the tracked asset tree; all `frontend/public` files;
inline journal/Scrapbook/Mori/recipe artwork; CSS image references; manifests and
lockfiles; the font licenses; generated-documentation markers; PRs
[#152](https://github.com/2ton-exe/moris-mix-ai/pull/152),
[#160](https://github.com/2ton-exe/moris-mix-ai/pull/160), and
[#266](https://github.com/2ton-exe/moris-mix-ai/pull/266); and the local
`Downloads/moris-background` source bundle. Local-only sources are summarized
below with hashes. A public source link is not evidence that a panel member can
access an associated private attachment or Figma workspace.

The [asset register](asset-register.tsv) lists **every physical application
image/font file** under `frontend/src/assets/` and `frontend/public/twemoji/svg/`
with a SHA-256 and an inventory group below. Inline SVG/CSS artwork is separately
listed in A06–A08. This excludes user-supplied runtime photos and ignored build,
browser-output and test-result directories. Package dependencies are recorded
separately from copied source; there is no claim of a full transitive license
audit, or that absence of a credit proves original team authorship.

## Assistant, generated-work, copied-work and fixture inventory

| ID / item | Purpose and extent; paths | Inspected evidence / original source | Team changes and review evidence | Status / confirmation owner |
| --- | --- | --- | --- | --- |
| W01 · OpenAI Codex, this submission PR | Agent-assisted research, disclosure prose, source reconciliation, procedural texture generator and local verification in `docs/submission/` and the two JPEG replacements | Originating user request and this PR's source/diff are direct records of this use | Compiled evidence, retained explicit gaps, inspected local render and build; contributor/instructor acceptance is separate and pending | **Verified** use in this PR; myntchoc to review the final draft. This does not establish past tool use by any other member. |
| W02 · CodeRabbit review and PR summaries | Automated review suggestions and release-note text in PRs; retained generated passages in `docs/api/recipe-images.md` | `coderabbit-ai-generated:v1` markers around cleanup/reconciliation prose; introduced with [#160](https://github.com/2ton-exe/moris-mix-ai/pull/160), merged 7 Nov 2026 UTC; [#152](https://github.com/2ton-exe/moris-mix-ai/pull/152) records eight verified findings, corrections and tests | Existing PR narrative describes validation; generated markers identify two incorporated documentation passages, not authorship of all surrounding code | **Verified** automated review and marked docs; **Awaiting confirmation** DanielRamos1186 on which suggested code/docs were incorporated and how modified/reviewed. CodeRabbit is not evidence of instructor acceptance. |
| W03 · Figma Make reference / adapted presentation | Journal foundation CSS, Scrapbook components, auth composition, Mori geometry, textures and typography; see `frontend/src/journal/` and [foundation handoff](../frontend/journal-foundation.md) | [Original prototype](https://www.figma.com/make/p2oIcNIvnbLu8exQJ6P9hP/Design-Pan%E2%80%99s-Scraps-Journal); handoff enumerates reference files and distinguishes borrowed visuals from excluded prototype services | [#152](https://github.com/2ton-exe/moris-mix-ai/pull/152), merged 13 Nov UTC, integrates/adapts presentation to existing product APIs and records corrections and browser checks | **Verified** source adaptation described by committed handoffs; **Missing original record** of reference author's permission/tool-output provenance. Prototype could not be read through the web tool on 27 Nov; named sibling snapshot is absent. adnro2 / reference supplier to identify author, copied/generated extent and permission. |
| W04 · Figma Code Layer material-realism bundle | Kitchen background code plus five generated WebPs; `frontend/src/journal/KitchenBackground.{tsx,css}` and A05 | Local `moris-background/README.md` explicitly identifies the Material realism pass, mount/adapt instructions and `scripts/kitchen-textures.js`; all five raster bytes match the source bundle | Import paths, host scene and CSS adapted in commit `b3ec2c95f32f9cac87d9deb21a861e2810b1eeaf` (21 Nov PHT), included in [#266](https://github.com/2ton-exe/moris-mix-ai/pull/266), merged 22 Nov UTC | **Verified** bundle identity and procedural method; **Awaiting confirmation** myntchoc / source supplier on original author, assistant/tool and permission for source/output. No human/tool authorship is inferred from a Git author. |
| W05 · Other assistants, borrowed snippets and templates | All five contributors' implementation, tests, documentation and workflows | No attributable complete per-person disclosure located in the inspected committed records; source markers and Git history cannot prove completeness | No percentage or claim of exclusive human authorship inferred; package imports do not establish copied snippets | **Awaiting confirmation** each contributor; individualized unsent drafts in [confirmations](outstanding-confirmations.md). Include tool/model if known, paths/PRs, incorporated outputs, source and review method; explicitly say if none. |
| W06 · AI evaluation examples | Synthetic notes, recipes, candidate IDs and simulated provider outputs in `supabase/functions/_shared/ai/eval_dataset.ts` | File header explicitly declares invented fixtures without real user data; [evaluation report](../ai-evaluation-report.md) describes the versioned fixture suite | Source version `2.1.1`; prompt versions tracked separately. This is test/example data, not a borrowed corpus or claim about real cooks | **Verified** source declaration; **Awaiting confirmation** KleinRheePagulongSioson on assistants/external examples used to author fixtures/prompts. |
| W07 · Demo/browser/signing examples | `fixtures/{demo-recipe,ai-extracted-recipe}.json`, `supabase/seed.sql`, `frontend/e2e/`, `supabase/functions/tests/r2_signing_test.ts` | Demo fixture/seed contain fixed example recipe and local demo identity; [QA-04](../qa/qa-04-cross-browser-mobile-bug-bash.md) explicitly records synthetic accounts/intercepted image bytes; [image API verification](../api/recipe-images.md) records independent synthetic signing vectors | Used for deterministic local/test scenarios. No production records, real user photos or provider output were collected for this PR | **Verified** these scoped test declarations; **Partial** originality/provenance of all recipe wording. DanielRamos1186 / KleinRheePagulongSioson / myntchoc to name any external examples and tool involvement. |

The five-member roster and handles are supported by [README](../../README.md).
The inventory does not treat commit count, co-author markers, or a PR author as
proof of individual effort, attendance or sole authorship.

## Asset and permission inventory

| ID / assets and affected paths | Origin / purpose / modification | Permission evidence and required attribution | Existing or updated attribution | Status / exact remaining question and owner |
| --- | --- | --- | --- | --- |
| A01 · Two replacement JPEGs, `frontend/src/assets/journal/textures/{desk-oak,leather-relief}.jpg` | Newly authored procedural oak grain and grayscale leather relief; same dimensions and CSS paths as prior materials | [Generator](assets/generate-textures.py) reads no source images/network; original output prepared for this repository with Codex, provided under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/); no third-party raster attribution required | [Asset README](../../frontend/src/assets/journal/README.md) records date, method, license, dimensions and hashes | **Verified** original procedural replacement in this PR; no remaining permission dependency on the two old reference rasters for current output. Historical permission question remains A02. |
| A02 · Prior copies at the same two JPEG paths; no longer current bytes | User-supplied Figma Make snapshot, copied unchanged per historical asset README / [foundation handoff](../frontend/journal-foundation.md) | Original source creator, host URL and redistribution grant not located. A Figma reference credit is not permission. No conclusion of unlawful use follows from the missing record | Historical old hashes preserved below; current credits now identify replacement | **Missing original record** for previous distribution; adnro2 / reference supplier to provide original texture listing/license or written creator permission. Old versions remain in Git history; no history rewrite is proposed. |
| A03 · Figtree, Fraunces, Caveat; `frontend/src/assets/journal/fonts/*-latin.woff2` | Self-hosted normal variable Latin fonts; documented download 31 Oct 2026; no modifications found by byte comparison | All three bytes match the precise gstatic URLs in [asset README](../../frontend/src/assets/journal/README.md) as checked 27 Nov. [Figtree OFL](https://github.com/google/fonts/blob/main/ofl/figtree/OFL.txt), [Fraunces OFL](https://github.com/google/fonts/blob/main/ofl/fraunces/OFL.txt), [Caveat OFL](https://github.com/google/fonts/blob/main/ofl/caveat/OFL.txt); SIL OFL 1.1 permits redistribution subject to retaining copyright/license, no standalone font sale, and applicable naming/license conditions | Full per-font copyright and OFL texts already in `frontend/public/font-licenses/`, copied into build | **Verified** source-byte identity and retained permission notices for the three unmodified fonts. No claim about other variants/scripts. |
| A04 · 54 Twemoji ingredient/fallback SVGs; `frontend/public/twemoji/svg/` | [Twemoji v17.0.3](https://github.com/jdecked/twemoji/tree/v17.0.3/assets/svg), by Twitter, Inc. and contributors; locally served, all 54 byte-match upstream tag on 27 Nov; no modifications | [Upstream graphics license](https://github.com/jdecked/twemoji/blob/v17.0.3/LICENSE-GRAPHICS) is CC BY 4.0; retain creator/source/license/warranty notices and indicate modifications. JavaScript's MIT license is separate; no Twemoji JS is used here | Updated [attribution](../../frontend/public/twemoji/ATTRIBUTION.md); added full `frontend/public/twemoji/LICENSE-GRAPHICS`, publicly served in build | **Verified** file identity and artwork permission with retained conditions; complete filename/hash inventory in register. |
| A05 · Kitchen tile and four props; `textures/kitchen-tiles.webp`, `props/{flour,spoon,sprig,whisk}.webp` under journal assets | Local `moris-background` bundle; all five byte-match; 608-line Canvas generator uses seeded noise, paths/gradients and internally created canvases, no raster/network imports | Local README supports procedural generation and adaptation instructions, but is not an identified author's license grant; no author/license file found | Added source and pending-permission note in [asset README](../../frontend/src/assets/journal/README.md); source hash/algorithm summary below | **Partial** provenance, **Awaiting confirmation** myntchoc / source supplier: who wrote/generated the source, with which tool, and what permits repository/application redistribution of source/output? Exact retained assets; not the two audit textures. |
| A06 · Mori / emblem / directional atlas; `frontend/src/journal/Mori.tsx`, `frontend/src/assets/journal/mori/**/*.svg`, `strides.json` | Base front-facing SVG explicitly marked visual-only artwork from verified Figma Make reference; atlas derives front pose and separately drawn directions per asset README | Adaptation and source known; no identifiable reference creator license or attributable team permission located for underlying character geometry | Existing source comment, asset README, [foundation handoff](../frontend/journal-foundation.md); every atlas SVG listed in register | **Partial** source trail, **Awaiting confirmation** adnro2 (reference supplier) and myntchoc (atlas integration): identify underlying character author/tool, source grant and derivative changes. Retained provenance blocker; no identity redesign added. |
| A07 · 25 scrapbook SVGs; `frontend/src/assets/stickers/*.svg` | [#266](https://github.com/2ton-exe/moris-mix-ai/pull/266) describes local original geometry extracted/shared from review illustrations; includes food stickers, bowl/basket, paper edges/brush/hearts | Attributable PR narrative supports local-geometry claim, not a complete original-author/tool declaration or third-party clearance | Historical asset audit recovered at local commit `ee1de12`; intentionally removed before #266 merge (merge message records removal). Current register enumerates every sticker | **Partial** repository origin; **Awaiting confirmation** myntchoc: which SVGs were drawn by team/assistant or adapted, sources/license for any copied geometry, modifications and review. Do not present removed audit as current committed documentation. |
| A08 · Inline SVG sketches, paper/wood/leather CSS layers, clips, endpaper and surface patterns; `frontend/src/recipes/RecipeSketch.tsx`, `frontend/src/journal/{Scrapbook.tsx,textures.css,foundation.css}`, related journal styles | Journal refactor creates/adapts inline decoration; [foundation handoff](../frontend/journal-foundation.md) enumerates reference CSS/SVG material inputs | Procedural CSS does not itself prove its source was team-authored. No additional external image hosts found in those styles; reference-source permission remains W03 | Handoff and source files; this inventory distinguishes inline artwork from vendored files/packages | **Partial** implementation/source map; **Awaiting confirmation** adnro2 / myntchoc on copied versus newly drawn patterns/geometry and source permissions. |
| A09 · Functional UI icons through `lucide-react@1.64.0`; imports throughout `frontend/src/` | Installed dependency from [Lucide](https://github.com/lucide-icons/lucide), not copied project source; SVG output styled by app | Installed package `LICENSE` supplies ISC (Lucide Icons and Contributors) plus MIT for Feather-derived icons (Cole Bemis); preserve both full notices with distribution | Added exact package notice at `frontend/public/asset-licenses/lucide-react-LICENSE.txt`, copied unchanged to build; package version pinned in manifest/lock | **Verified** dependency license/attribution support. No claim the team drew Lucide/Feather geometry. |
| A10 · User recipe photos | Supplied by cooks at runtime through existing private image lifecycle; no shipped user-photo dataset located in the tracked asset tree | Per-photo creator/rights are outside this static repository inventory; no live photo collection or R2 transfer performed | Product/API ownership model in [recipe image contract](../api/recipe-images.md) | **Not applicable** to distributed static asset register; not a claim about any production user's photo permission. |

## Two reference textures: resolved current distribution, historical question retained

| Asset | Prior SHA-256 (historical) | Replacement SHA-256 | Application reference |
| --- | --- | --- | --- |
| `desk-oak.jpg` | `18b73f606801c773de5064d870e99f2403aecac1231f8c44cae89e18381310cc` | `e1d3adef0faeb63616e4f73bc8f9dacbe094ac3bd06798495ffeff935f94a9f9` | `frontend/src/journal/foundation.css`, `.mm-surface--wood` |
| `leather-relief.jpg` | `f15a92d9681d6b8c429f8b14e653aa4917e646c98e588e98d9fcf13601abf9e4` | `5c1ecf073125c34865d9c95c2adfb131553afcd30ae51c21abeb23161528115e` | same CSS, `.mm-surface--leather` |

The historical README only identified a sibling reference directory, not the
photographer/texture provider. That directory is absent from the accessible
workspace and the linked Figma prototype could not be read through the web tool.
No source-specific license/permission record was located. The narrow remedy is
the concrete replacement here, not an assertion that attribution grants rights.
The replacement generator uses independently chosen seeds, noise and formulas;
it never reads the disputed JPEGs. The same JPEG paths and dimensions preserve
all CSS callers, including #282's active layout work, without modifying its
branch or the shared styles. Main now uses kitchen tiles for the application
desk; the oak surface remains referenced by the foundation/gallery styles and
would otherwise still be distributed by the build.

No old raster is retained in the new application tree or copied into these
screenshots. The Git history and already deployed historical versions are not
rewritten or changed by this PR. Historical permission confirmation remains a
separate question for the original supplier.

## Retained kitchen bundle: panel-readable source summary

The inspected local bundle README identifies a **Material realism pass in the
Figma Code Layer** and instructs copying the React/CSS/assets together. Its
`generateKitchenTextures()` function returns five WebP data URLs. The complete
608-line source was inspected: it builds tiled noise and shading per pixel,
constructs a wooden spoon with distance fields, draws whisk wires/handle with
Canvas paths and gradients, draws a rosemary sprig with Bézier leaves, and
creates flour dust/crumbs from seeded noise. Its only `drawImage` operation copies
an internally created canvas to apply blur. It loads no external photograph,
font, image URL or network resource. This establishes a procedural source trail;
it does not identify the original source author or prove who used which assistant.

| Local source record | SHA-256 / identity |
| --- | --- |
| `moris-background/README.md` | `940b445b6e1fe8b535b99226b64af75c23477cc59289dff3a29fea53514d55d2` |
| `moris-background/scripts/kitchen-textures.js` | `8216dc7578cd3b1f6e4a3a76aa93c80d5f03efebe758a64dbc2eaa7b3ff8136b` |
| `textures/kitchen-tiles.webp` (same bytes in local source bundle and repository) | `fdb74f13a30b8466ecf64f0c16d653e297b7da6b6fb9e86670f6806b9f1faf4c` |
| `props/flour.webp` (same bytes in local source bundle and repository) | `09e96f4f355fbb6560c368e3841199e96f6d8d0348b6109652b28b8aa01b7327` |
| `props/spoon.webp` (same bytes in local source bundle and repository) | `2765a82cae9dacf45ac91cf2a5526934222a2dcf9f8ee166789ea4123d60e4d2` |
| `props/sprig.webp` (same bytes in local source bundle and repository) | `eb15f15b0a4c0caf6827c130b5f6aa4460fc74ce8da7cef8deb48d77c10b56f2` |
| `props/whisk.webp` (same bytes in local source bundle and repository) | `511ca8b387243250bec8fc1a479681c2cbd9f14d182cb46499238f0d2a19858c` |

These originals are local and have no verified panel-sharing URL. The summary
above makes the inspected facts readable without presenting the script as
licensed team work. Request the author's attribution/permission and a shareable
source copy; do not add an invented license to the original bundle.

## Dependency and license records

Dependencies remain third-party packages, not original team code or proof of
copied snippets. No packages or versions are changed by this PR. The exact
frontend versions below were checked against installed package metadata and the
existing lockfile; API imports also use a separate older Supabase client.

| Dependency / role | Inspected version and declared license | Source / existing record | Responsibility / limit |
| --- | --- | --- | --- |
| React / React DOM, UI runtime | `19.3.0`, MIT | `frontend/package.json`, `frontend/pnpm-lock.yaml`; installed `react/LICENSE`, `react-dom/LICENSE`; [React](https://github.com/facebook/react) | adnro2 / myntchoc; app composition and styles are local modifications, packages remain dependencies. |
| React Router, routes | `7.18.4`, MIT | same manifest/lock; installed `react-router/LICENSE.md`; [React Router](https://github.com/remix-run/react-router) | adnro2 / myntchoc. |
| TanStack Query, query/cache | `5.104.4`, MIT | same manifest/lock; installed `@tanstack/react-query/LICENSE`; [Query](https://github.com/TanStack/query) | adnro2 / myntchoc. |
| Supabase JS, frontend Auth/client and API backend client | frontend `2.118.0`; backend `2.39.8`, MIT | frontend manifest/lock; `deno.lock`, backend imports; installed package LICENSE files; [Supabase JS](https://github.com/supabase/supabase-js) | DanielRamos1186 / adnro2; don't conflate package permission with production account access or data rights. |
| Zod, boundary schemas | `4.6.6`, MIT | frontend manifest/lock and `deno.lock`; installed `zod/LICENSE`; [Zod](https://github.com/colinhacks/zod) | DanielRamos1186 / KleinRheePagulongSioson. |
| Lucide React, icon package | `1.64.0`, ISC plus Feather-derived MIT notice | frontend manifest/lock and A09's distributed complete license | adnro2 / myntchoc; copied art from package is separately credited from team illustrations. |
| Google Generative AI SDK, server-only provider adapter | `0.21.0`, Apache-2.0 | `deno.lock`; installed `@google/generative-ai/package.json` and `LICENSE`; [SDK](https://github.com/google-gemini/deprecated-generative-ai-js) | KleinRheePagulongSioson; SDK code license does not establish model-output rights or current service terms. No provider calls made. |
| PostgreSQL Node client / dotenv, local scripts | `pg@8.23.1`, MIT; `dotenv@18.0.8`, BSD-2-Clause | root `package.json`, `pnpm-lock.yaml`, `deno.lock`; installed package metadata/license records; [node-postgres](https://github.com/brianc/node-postgres), [dotenv](https://github.com/motdotla/dotenv) | DanielRamos1186 / DaeSaster; root declares ISC for the repository package but this does not override external material licenses. |
| Build/test/development tooling | Vite `6.4.5` MIT, TypeScript `5.7.3` Apache-2.0, Vitest `4.1.12` MIT, Playwright `1.64.1` Apache-2.0, Supabase CLI `2.122.0` MIT | `frontend/package.json`, `frontend/pnpm-lock.yaml`; installed package metadata and license files; workflow pins remain in `.github/workflows/` | DaeSaster / respective implementers. Tools are dependencies, not copied app source. Remaining ESLint/Testing Library/type packages and transitive trees are enumerated by manifests/lockfiles, not individually audited here. |

The lockfiles establish resolved dependency identities and integrity metadata;
they are not a substitute for license texts or a contributor disclosure. Full
font notices, the Twemoji graphics license and Lucide/Feather notices are
available with the served static files. Other installed-package notices remain
in their package distributions and some retained bundle banners. This scoped
pack does not certify all transitive notice obligations for a separately
redistributed software bundle. No new infrastructure or dependency-license
workflow is introduced.

## Local replacement verification

Performed on **27 November 2026 PHT** in the isolated disclosure worktree based on
the baseline revision above, using the existing installed dependency tree and
local Vite. Only texture bytes, disclosure/credits, generator/evidence files and
static license notices change; no CSS, component behavior, API, secrets, staging
flags or deployment workflows change.

| Check | Result and scope |
| --- | --- |
| Generator self-check and repeat run | Python 3 / Pillow 11.3.0; output RGB JPEG dimensions validated, nonconstant pixels asserted; repeat generation produces the listed SHA-256s. No source images or network inputs read by generator. |
| Current source and production-build scan | Both old SHA-256s absent from current tracked physical assets and `frontend/dist/`; build contains exactly the new JPEG bytes. Same filenames remain referenced by `foundation.css`. Historical hash text is intentionally preserved here; Git history is unchanged. |
| Build/typecheck | `tsc -p tsconfig.app.json --noEmit` and `vite build --configLoader runner` passed. Existing Vite chunk-size and third-party PURE-comment advisories remain; the pnpm dependency precheck rejected the temporary shared node_modules symlink but the build script itself completed successfully. No dependency/lockfile change was made. |
| Foundation gallery, desktop 1440 × 960 Chromium | `/journal-foundation.html` shows new oak grain and burgundy leather with readable paper and headings. [Inspected capture](assets/screens/foundation-after.webp). This development gallery exposes the oak surface still referenced in shared CSS. |
| Login screen, desktop 1440 × 960 Chromium | `/login` shows new leather on the closed book, original kitchen scene/props, legible card and unchanged controls. [Inspected capture](assets/screens/login-after.webp). Fonts loaded; resource entries were local only. No sign-in submitted. |
| Licensing distribution | Build contains the three existing font license files, updated Twemoji attribution + full graphics license, and the exact Lucide/Feather package license. |

Playwright CLI was used for the local rendering inspection. One development
foundation-page console error was an unrelated missing `favicon.ico` (404), not a
failed material/font load; the login capture had no reported console error.
No production, live AI, real R2 transfer, staged deployment or database mutation
was used. No blanket product-acceptance claim follows from inspecting these two
screens. Mobile/tablet, full journeys and #282's evolving branch were not tested
for this asset-only change.

## Exact open disclosure facts

- **Each of the five contributors:** tools/assistants used, incorporated outputs
  with paths/PRs, review/modification method, and any unlisted external code,
  templates, examples or artwork. A response may state none for a specific area;
  do not substitute a blanket originality certification.
- **adnro2 / original reference supplier:** identify the Figma Make reference
  author/tool and shareable permission record for retained character/visual
  source; historical author/source/license for both replaced JPEGs.
- **myntchoc / kitchen bundle supplier:** author, assistant and redistribution
  basis for the five exact WebPs and the procedural source; status remains
  pending even though the bundle identity and method are now established.
- **myntchoc / relevant illustration contributor:** author/tool/copied-source
  breakdown for every sticker/atlas group and any inherited sketches or CSS
  patterns; provide original source permission for adapted geometry.
- **DanielRamos1186 / KleinRheePagulongSioson:** incorporated CodeRabbit or other
  assistant outputs and any external recipe/prompt/example sources in their
  respective code, docs and fixture sets.

These are evidence/permission blockers for the named retained groups, not a
request to redesign Mori or reopen product scope. [Ready-to-send drafts and
acceptable evidence](outstanding-confirmations.md) are unsent and unconfirmed.
