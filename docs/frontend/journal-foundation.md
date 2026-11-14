# UI-01 Phase A: MORI'S MIX journal foundation

Implemented on `feat/UI-01-journal-redesign`, directly from approved
`origin/main` commit `46809319eb23394a45d6f1ea79f8ee41f541011b`.
No merge, cherry-pick, commit, push, or pull request was performed.

## Reference recovery

Before branch creation, `git status --short` and `git status --porcelain -uall`
identified seven untracked root paths: `REFERENCE_README.md`, `index.html`,
`public/`, `reference-screenshots/`, `src/`, `tsconfig.json`, and `vite.config.ts`.
Every file under those paths was enumerated, including hidden files; there were
no tracked files or filesystem links under them. All 60 files had identical
SHA-256 hashes to their counterparts in `../figma-make-reference`.

Only those seven paths were moved to a newly created sibling directory,
`../figma-make-root-recovery`, preserving their structure and contents. No
destination was overwritten. The separate `../figma-make-reference` copy remains
intact. The tracked root package files were left alone.

Git reported a clean working tree before switching branches. FE-05 remained at
`9da59c2cc43d11d1b01b6b6814d58570b9185027`; the other worktrees were untouched.

## Inspected reference source

Source: [Figma Make prototype](https://www.figma.com/make/p2oIcNIvnbLu8exQJ6P9hP/Design-Pan%E2%80%99s-Scraps-Journal).
Implementation uses the verified local snapshot, not the prototype runtime.

| Reference files | Inspected for |
| --- | --- |
| `REFERENCE_README.md` | Provenance, missing Make configuration, mock-service exclusions |
| `src/index.css`, `src/styles/tokens.css`, `src/styles/base.css` | Fonts, palette, paper textures, base behavior |
| `src/styles/paper.css`, `src/styles/decor.css` | Paper surfaces, ruled cards, tape, stamps |
| `src/styles/desk.css`, `src/styles/book.css` | Oak and leather surface layering |
| `src/styles/motion.css`, `src/styles/mori.css` | Character motion and reduced-motion behavior |
| `src/ui/kit.tsx`, `src/ui/Mori.tsx` | Scrapbook primitives, SVG character and emblem |
| `src/journal/book.tsx`, `src/mori/MoriScene.tsx`, `src/features/dev.tsx` | Composition and dependencies to keep outside Phase A |
| `src/assets/textures/*.jpg`, initial/closed-cover reference PNGs | Actual materials and visual comparison |

The screenshot set includes an initial blank desk and closed-cover views. It
does not establish complete authenticated-screen fidelity.

## Implementation and file inventory

Paths below are relative to `frontend/`, except this handoff document.

| Files | Purpose |
| --- | --- |
| `src/journal/tokens.css` | Reference palette, typography stacks, shadows and easing under `--mm-*`; spacing, size and radius tokens |
| `src/journal/textures.css` | Source procedural SVG paper textures |
| `src/journal/fonts.css` | Local variable Figtree, Fraunces and Caveat faces |
| `src/journal/foundation.css` | Opt-in `mm-*` surfaces, paper cards, tape, buttons, labels, stamps and brand styles |
| `src/journal/Scrapbook.tsx` | `PaperCard`, `JournalSurface`, `Tape`, `PaperClip`, `ScrapbookButton`, `ScrapLabel`, `Stamp` |
| `src/journal/Mori.tsx`, `src/journal/mori-motion.css` | Original character geometry and emblem; opt-in, scoped animation with system reduced-motion support |
| `src/journal/BrandMark.tsx` | Reusable MORI'S MIX name and Mori emblem |
| `src/assets/journal/textures/{desk-oak,leather-relief}.jpg` | Two unchanged source JPEGs |
| `src/assets/journal/fonts/{figtree,fraunces,caveat}-latin.woff2` | Three self-hosted normal variable Latin font files |
| `src/assets/journal/README.md`, `public/font-licenses/*-OFL.txt` | Asset provenance, hashes and distributed font licenses |
| `journal-foundation.html`, `src/journal/foundation-preview.{tsx,css}` | Development component gallery with all visual variants |
| `src/main.tsx` | Load the foundation stylesheet alongside existing CSS |
| `src/pages/JournalPage.tsx`, `src/recipe-form/RecipeEditorFrame.tsx` | Replace the existing brand text/decoration with `BrandMark` only |
| `index.html` | Official title, description and burgundy browser theme color |
| `README.md` | Link to this handoff and preview instructions |

The application's body typography and layouts retain their existing styles.
Foundation typography applies to the new components. No Tailwind or new package
dependency was added. No prototype auth, data, API, AI, router, providers or
snapshot/page-turn runtime was imported. Existing route declarations, session
handling, HTTP clients, TanStack Query, discovery, forms and tests are unchanged.

## Preview and reuse

From `frontend/`, run `pnpm dev`, then open `/journal-foundation.html` on the
printed local URL. The gallery is a separate development HTML entry with no
router or application providers. It is excluded from production build inputs;
it is not a new application route.

Import components directly from `src/journal/Scrapbook` and `src/journal/Mori`.
The application's entry already imports `foundation.css`. `PaperCard` and
`JournalSurface` use native div props; buttons retain native props, refs, disabled
behavior and explicit submit support (default type is `button`). `ScrapLabel`
is a span, not a replacement for a form label. Tape and clips are decorative and
ignore pointer events. Mori is decorative unless a `label` is supplied. Set
`animated` explicitly to enable character motion.

## Validation on October 31, 2026

| Check | Approved-base baseline | Phase A |
| --- | --- | --- |
| `pnpm lint` | Pass | Pass, no new warnings |
| `pnpm type-check` | Pass | Pass |
| `pnpm test` | 367 pass, 1 fail on standalone rerun | 367 pass, same 1 fail |
| `pnpm build` | Pass; bundle-size warning | Pass; same warning |

The reproducible pre-existing test failure is
`src/auth/AuthFlow.test.tsx:167`, "restores a valid session on a fresh mount and
allows protected access": expected two `getSession` calls, received four. During
the first baseline run alongside other checks, a deletion test also timed out
waiting for a recipe heading. It passed in the standalone baseline rerun and
after Phase A. These tests and the authentication implementation were not edited.

Additional browser verification using installed Playwright and Chrome:

- Gallery at 1280, 375 and 320px: no horizontal overflow; both JPEGs decode;
  all fonts load locally; original SVG proportions render correctly; buttons
  support clicks, keyboard activation and disabled state; reduced motion stops
  Mori's animation; no external requests, missing resources or page errors.
- Production preview: all five generated font/image URLs return nonempty HTTP
  200 responses; the gallery HTML and gallery text are excluded from the build.
- Existing `node e2e/recipe-discovery.browser.mjs`: passed at 1280, 375 and 320px,
  including search/sort controls, cursor pagination by keyboard, failed-page
  retry, end state and logout. This uses the existing isolated browser harness.
- Diff and asset-path review: no business-logic changes or broken asset URLs;
  texture copies match source hashes. Only intended Phase A files are dirty.

No live Supabase E2E environment was invoked. The test failure and existing
large JavaScript chunk warning remain separate follow-up work. The prototype's
missing `.figma/make/site.json` is irrelevant to these plain-CSS visual modules.

## Recommended Phase B

1. Wrap the existing authenticated `JournalPage` header and `Outlet` in a
   responsive desk/journal composition using these surfaces. Keep the existing
   route tree, auth gates, account controls and Query provider boundaries.
2. Add journal navigation as links to the existing recipes and create routes,
   with current-route indication and visible keyboard focus. Use a two-page
   composition on desktop and a flowing single column on narrow screens.
3. Preserve normal document scrolling, loading/error/empty states and logout.
   Confirm layout, focus order, zoom and reduced motion before adding animation.
4. Keep recipe-card/dashboard, authentication-screen and editor redesigns as
   separate increments. Introduce cover/page transitions only after the shell
   works with real route navigation and existing unsaved-change protection.

Phase A stops here; no complete shell or AI features have been implemented.
