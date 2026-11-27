# MORI'S MIX visual assets

## Material textures

In PR #293's tree, the two JPEGs in `textures/` were replaced on
**27 November 2026** with original
procedural images prepared with OpenAI Codex for this submission PR. They use
seeded noise and mathematical grain; no source photograph, reference raster, or
network input enters the generator. The PR remains draft/unmerged; these bytes
are established in its tree and local build, not as deployed replacements.
The generator and its outputs are provided
under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/).
Recreate them with `python3 docs/submission/assets/generate-textures.py` from the
repository root (Python 3 and Pillow; compiled using Pillow 11.3.0).

| Asset | Dimensions | Current SHA-256 |
| --- | --- | --- |
| desk-oak.jpg | 2000 × 1474 | `e1d3adef0faeb63616e4f73bc8f9dacbe094ac3bd06798495ffeff935f94a9f9` |
| leather-relief.jpg | 1000 × 825 | `5c1ecf073125c34865d9c95c2adfb131553afcd30ae51c21abeb23161528115e` |

**Historical provenance:** the prior JPEGs were unchanged copies of a user-supplied
Figma Make reference, described in [the foundation handoff](../../../../docs/frontend/journal-foundation.md).
Their original creator and redistribution terms could not be established from
the available record. Attribution alone did not establish permission. That is
an evidence limitation, not a finding that the original assets were unlawful.
The prior bytes remain in Git history; they are absent from the current
application paths and the replacement build. The disclosure records the old
hashes and the remaining question about historical distribution.

`textures/kitchen-tiles.webp` and `props/{flour,spoon,sprig,whisk}.webp` are a
separate, retained set. All five byte-match the local `moris-background` source
bundle inspected on 27 November. Its README describes a Figma Code Layer
"Material realism pass" and its generator draws seeded Canvas shapes and noise.
myntchoc's supplied 27 November declaration identifies Figma Make as the
tool/source context. The bundle still has no identified creator/license grant
establishing source/output redistribution permission. myntchoc owns the current
documentation decision. See [the grouped declaration](../../../../docs/submission/external-work-disclosure.md#one-grouped-declaration-for-a05a08w03)
for scope, source records, permission limits and concrete fallback choices.

## Fonts

The reference requested fonts from Google Fonts. Normal variable Latin faces
were downloaded on October 31, 2026 and are served locally with `font-display:
swap`; other scripts and italic styles fall back to the documented font stacks.
The original SIL Open Font License texts are in `frontend/public/font-licenses/`
and are copied into production output by Vite.

- [Figtree font](https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4S9DQ.woff2), [license source](https://github.com/google/fonts/blob/main/ofl/figtree/OFL.txt)
- [Fraunces font](https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeA.woff2), [license source](https://github.com/google/fonts/blob/main/ofl/fraunces/OFL.txt)
- [Caveat font](https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYY.woff2), [license source](https://github.com/google/fonts/blob/main/ofl/caveat/OFL.txt)

Mori's vector art remains React SVG in `src/journal/Mori.tsx`. myntchoc declares
Figma Make and Codex (`gpt-6.2-sol` turn contexts) for the base/adapted editable art;
the underlying character grant and original-versus-adapted geometry remain
unresolved in the grouped disclosure. Procedural grain,
mottle, specks, fibers, and endpaper textures are in `src/journal/textures.css`.
No preview PNG is used as an application asset.

## Mori’s directional atlas

The reference-derived 200 × 240 SVG includes front-facing idle, expressions, and an
open and closed page-grab mitt. The local keyframe reference board shows
front-facing blink, ear, tail, wave, hop, stir, sleep, and sweat poses. The
asymmetric tail and apron details require separately drawn left and right views.

The `mori/` directory contains an idle and six walking frames in each of the
eight directions. The south idle uses the reference front pose directly. The
east and west directories also contain reach, grip, and release poses. During
desktop turns the scene tracks the moving paper edge with the articulated mitt.
The compact layout uses the original companion illustration.

Keep each frame on the 200 × 240 SVG artboard. The common ground datum is
`(100, 230.6)` and each walking frame’s planted sole sits on that line. Store
its horizontal coordinate and the complete stride length in `mori/strides.json`.
The atlas resolves the numbered `walk-01.svg` to `walk-06.svg` files and
`idle.svg` automatically. The SVG descriptions also record the anchor coordinates.
In page-turn art, preserve the shoulder, wrist, forearm, mitt, and contact
annotations so the scene can position just the gripping arm.

## Third-party icons and complete inventory

The ingredient fallback artwork is credited in
[`public/twemoji/ATTRIBUTION.md`](../../../public/twemoji/ATTRIBUTION.md), alongside
the full graphics license. Functional icons come through the `lucide-react`
package; its complete ISC and Feather-derived MIT notices are distributed at
[`public/asset-licenses/lucide-react-LICENSE.txt`](../../../public/asset-licenses/lucide-react-LICENSE.txt).
The [submission asset register](../../../../docs/submission/asset-register.tsv)
includes each physical application artwork/font file and its disclosure group.
The disclosure records source/tool declarations for Mori, stickers and adapted
CSS/SVG. Permission and borrowed-geometry gaps remain explicit; this README does
not certify that every visual was drawn by the team. Font, Twemoji and
Lucide/Feather notices are unchanged.
