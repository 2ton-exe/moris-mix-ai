# MORI'S MIX visual assets

The two JPEGs in `textures/` are unchanged copies of the user-supplied Figma Make
reference at `../figma-make-reference/src/assets/textures/` (relative to the repo).

| Asset | SHA-256 |
| --- | --- |
| desk-oak.jpg | `18b73f606801c773de5064d870e99f2403aecac1231f8c44cae89e18381310cc` |
| leather-relief.jpg | `f15a92d9681d6b8c429f8b14e653aa4917e646c98e588e98d9fcf13601abf9e4` |

The reference requested fonts from Google Fonts. Normal variable Latin faces
were downloaded on October 31, 2026 and are served locally with `font-display:
swap`; other scripts and italic styles fall back to the documented font stacks.
The original SIL Open Font License texts are in `frontend/public/font-licenses/`
and are copied into production output by Vite.

- [Figtree font](https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4S9DQ.woff2), [license source](https://github.com/google/fonts/blob/main/ofl/figtree/OFL.txt)
- [Fraunces font](https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeA.woff2), [license source](https://github.com/google/fonts/blob/main/ofl/fraunces/OFL.txt)
- [Caveat font](https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYY.woff2), [license source](https://github.com/google/fonts/blob/main/ofl/caveat/OFL.txt)

Mori's vector art remains React SVG in `src/journal/Mori.tsx`. Procedural grain,
mottle, specks, fibers, and endpaper textures are in `src/journal/textures.css`.
No preview PNG is used as an application asset.

## Mori’s directional atlas

The official 200 × 240 SVG includes front-facing idle, expressions, and an
open and closed page-grab mitt. The local keyframe reference board shows
front-facing blink, ear, tail, wave, hop, stir, sleep, and sweat poses. The
asymmetric tail and apron details require separately drawn left and right views.

The `mori/` directory contains an idle and six walking frames in each of the
eight directions. The south idle uses the official front pose directly. The
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
