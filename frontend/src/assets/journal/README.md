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

N, NE, E, SE, S, SW, W, and NW still need approved idle artwork and 4–8 walking
frames each. The controller already calculates all eight directions. Until
those frames are available, the desktop turn uses the official front-facing
SVG, so its travel can still look like sliding. The turn uses the existing
articulated mitt. An authored side-facing reach, grip, and release would
improve the pose once approved art is available.

To add artwork, keep each transparent frame on the shared 200 × 240 canvas and
record its planted foot `{ x, y }` in source-art units. The official SVG rests
at `(100, 230.6)`. Import the files as asset URLs in
`src/journal/moriSpriteAtlas.ts` and add the matching compass key to the atlas
passed to `createMoriSpriteLookup`. Supply an `idle` frame, an ordered `walk`
array, and a positive `stride` for distance covered per cycle in source-art
units. Sample all frames at their foot anchors before shipping a direction.
