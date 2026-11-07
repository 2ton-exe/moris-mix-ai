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
