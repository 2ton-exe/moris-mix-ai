# Scrapbook asset audit

This inventory records the New Recipe refactor baseline at `3667485`. It covers the writing folio, Pantry, AI Chef review, journal cards and reading pages, the shared desk and auth scene, and Mori's companion. Source paths in the tables are relative to `frontend/`. Proposed filenames are relative to `src/assets/stickers/` unless a different path is given.

The inventory searched tracked SVG and raster assets, JSX drawing markup, CSS image URLs and pseudo-elements, programmatic SVG shapes, canvas calls, and ingredient-icon consumers. The before-and-after review should use the same viewport and seeded data for New Recipe, Pantry, AI Chef review, and a journal card without a photo.

## Recipe Review and shared illustrations

The Review drawings already share an SVG wrapper. The path geometry, viewBox, fill, stroke, and line caps can be serialized as-is. Placement and decorative treatments belong to the consumer or the shared sticker component.

| Asset | Current source | Rendering | Reusable? | Similar artwork | Proposed ID | Destination | Ingredient candidate? | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cooking pot | `src/journal/ReviewSticker.tsx` · `pot` | JSX SVG | Shared review component | Journal pot sketch | `cooking-pot` | `cooking-pot.svg` | No | Extract geometry and register. |
| Open recipe book | `src/journal/ReviewSticker.tsx` · `book` | JSX SVG | Shared review component | None | `recipe-book` | `recipe-book.svg` | No | Extract geometry and register. |
| Clipboard | `src/journal/ReviewSticker.tsx` · `clipboard` | JSX SVG | Shared review component | Repeated in review header and notes using the same geometry | `clipboard` | `clipboard.svg` | No | Extract geometry and register. |
| Chat bubble | `src/journal/ReviewSticker.tsx` · `chat` | JSX SVG | Shared review component | Mori chat and navigation use separate functional iconography | `chat-bubble` | `chat-bubble.svg` | No | Extract geometry and register. |
| Flavor flask | `src/journal/ReviewSticker.tsx` · `flask` | JSX SVG | Shared review component | None | `flask` | `flask.svg` | No | Extract geometry and register. |
| Tomato | `src/journal/ReviewSticker.tsx` · `tomato` | JSX SVG | Shared review component | Twemoji tomato | `tomato` | `tomato.svg` | Yes | Extract geometry and register. |
| Rice bowl | `src/journal/ReviewSticker.tsx` · `rice` | JSX SVG | Shared review component | Twemoji rice, journal serving-bowl sketch | `rice-bowl` | `rice-bowl.svg` | Yes | Extract geometry and register. |
| Garlic bulb | `src/journal/ReviewSticker.tsx` · `garlic` | JSX SVG | Shared review component | Twemoji garlic | `garlic` | `garlic.svg` | Yes | Extract geometry and register. |
| Shell egg | `src/journal/ReviewSticker.tsx` · `egg` | JSX SVG | Shared review component | Twemoji shell egg, journal fried-egg sketch | `egg` | `egg.svg` | Yes | Extract geometry and register. |
| Pork cut | `src/journal/ReviewSticker.tsx` · `pork` | JSX SVG | Shared review component | Twemoji meat emoji also represents beef and sausage | `pork` | `pork.svg` | Yes, exact pork | Extract geometry and register. |
| Strawberry | `src/journal/ReviewSticker.tsx` · `strawberry` | JSX SVG | Shared review component | Twemoji strawberry | `strawberry` | `strawberry.svg` | Yes | Extract geometry and register. |
| Salt shaker | `src/journal/ReviewSticker.tsx` · `salt` | JSX SVG | Shared review component | Twemoji shaker also represents spice | `salt` | `salt.svg` | Yes, salt aliases only | Extract geometry and register. |
| Lemon | `src/journal/ReviewSticker.tsx` · `lemon` | JSX SVG | Shared review component | Twemoji lemon | `lemon` | `lemon.svg` | Yes | Extract geometry and register. |
| Chocolate bar | `src/journal/ReviewSticker.tsx` · `chocolate` | JSX SVG | Shared review component | Twemoji chocolate | `chocolate` | `chocolate.svg` | Yes, whole chocolate | Extract geometry and register. |
| Mushroom | `src/journal/ReviewSticker.tsx` · `mushroom` | JSX SVG | Shared review component | Twemoji mushroom | `mushroom` | `mushroom.svg` | Yes | Extract geometry and register. |
| Chili pepper | `src/journal/ReviewSticker.tsx` · `chili` | JSX SVG | Shared review component | Twemoji chili pepper | `chili` | `chili.svg` | Yes, whole peppers | Extract geometry and register. |
| Sparkle | `src/journal/ReviewSticker.tsx` · `sparkle` | JSX SVG | Shared review component | Lucide action icon and journal typographic sparkle | `sparkle` | `sparkle.svg` | No | Extract geometry and register. |

| Asset | Current source | Rendering | Reusable? | Similar artwork | Proposed ID | Destination | Ingredient candidate? | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mixing bowl with whisk | `src/assets/stickers/mixing-bowl.svg`, consumed by `ChefProgress.tsx` | SVG file | Yes, direct import | Journal serving bowl and Review rice bowl depict different subjects | `mixing-bowl` | `mixing-bowl.svg` | No | Register the existing artwork. |
| Vegetable basket | `src/assets/stickers/ingredient-basket.svg`, consumed by `ChefProgress.tsx` and `ChefRecipeReviewPage.tsx` | SVG file | Yes, direct import | Same file on Pantry and Review | `ingredient-basket` | `ingredient-basket.svg` | No | Register and share with New Recipe. |
| Scrapbook hearts | `src/assets/stickers/scrapbook-hearts.svg`, consumed by `ChefProgress.tsx` | SVG file | Yes, direct import | None | `scrapbook-hearts` | `scrapbook-hearts.svg` | No | Register the existing artwork. |
| Pantry bottle | `src/assets/stickers/pantry-bottle.svg`, consumed by `PantryCards.tsx` | SVG file | Yes, direct import | Olive oil otherwise uses the Twemoji olive | `pantry-bottle` | `pantry-bottle.svg` | Yes, existing vinegar and olive oil matches | Register and preserve the explicit Pantry matches. |
| Peppercorns | `src/assets/stickers/peppercorns.svg`, consumed by `PantryCards.tsx` | SVG file | Yes, direct import | Twemoji spice uses a shaker | `peppercorns` | `peppercorns.svg` | Yes, existing pepper and peppercorn matches | Register and preserve the explicit Pantry matches. |
| Brushstroke | `src/assets/stickers/review-brush.svg`, consumed by `chefReview.css` | SVG CSS mask | Yes | Review heading and cooking section share one silhouette | Shared CSS mask | `review-brush.svg` | No | Reuse the mask for New Recipe paper accents. |
| Scalloped gingham border | `src/assets/stickers/review-paper-edges.svg`, consumed by `chefReview.css` | SVG page background | Yes, within a paper surface | Gingham tape uses CSS at a different scale | Shared CSS surface | `review-paper-edges.svg` | No | Reuse where the same page trim is needed. |

## Journal, desk, and character artwork

| Asset | Current source | Rendering | Reusable? | Similar artwork | Proposed ID | Destination | Ingredient candidate? | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Green pencil | `src/journal/DeskStationery.tsx` | JSX polygons, rectangles, and text | Shared desk scene | None | `desk-pencil` | `desk-pencil.svg` if extracted | No | Retain the existing desk appearance. Extract only if a separate placement needs it, preserving wordmark typography. |
| Brass paperclip pair | `src/journal/DeskStationery.tsx` | JSX repeats one clip at two offsets and rotations | Shared desk scene | Sheet paperclip uses different geometry | `desk-paperclip` | `desk-paperclip.svg` if extracted | No | Preserve the desk arrangement. Reuse one path if the piece is extracted. |
| Sheet paperclip | `src/journal/Scrapbook.tsx` · `PaperClip` | JSX SVG | Shared by auth and recipe reading | Desk clips use a different finish and silhouette | `sheet-paperclip` | `sheet-paperclip.svg` if extracted | No | Retain the existing reusable component and clip placement. |
| Sage tape roll | `src/journal/DeskStationery.tsx` | SVG circles and procedural dots | Shared desk scene | Applied dotted tape is a CSS strip | `tape-roll` | `tape-roll.svg` if extracted | No | Retain the existing desk treatment. The flat tape strip can be reused independently. |
| Herb sprig | `src/journal/DeskStationery.tsx` | SVG stem and procedural leaf pairs | Shared desk scene | Endpaper has a stylized sprig tile and Twemoji has an herb | `herb-sprig` | `herb-sprig.svg` | No | Extract the original path and procedural ellipses for the desk and New Recipe margin. |
| Cup ring stain | `src/journal/DeskStationery.tsx` | JSX SVG strokes and CSS opacity | Shared desk scene | None | `desk-ring-stain` | `desk-ring-stain.svg` if extracted | No | Retain as an atmospheric desk layer. |
| Torn tape strips | `src/journal/Scrapbook.tsx` · `Tape`; `src/journal/foundation.css` · `.mm-tape` | CSS polygon, grain, gradients, and dots | Yes, masking, sage dotted, mustard striped, burgundy grid, cream striped | Journal discovery has a flat CSS tape pseudo-element | `Tape` | Existing component and CSS | No | Reuse the sage variant on New Recipe. The component supports texture, color tokens, and responsive sizing. |
| Journal discovery tape | `src/journal/recipe-journal.css` · `.discovery-controls::before` | CSS pseudo-element | Journal-specific placement | Shared `Tape` uses a different cut and pattern | — | Existing CSS | No | Retain the discovery placement. Use shared `Tape` for new placements. |
| Stamps, labels, paper cards | `src/journal/Scrapbook.tsx`, `src/journal/foundation.css` | HTML and CSS | Yes | Used on auth, dashboard, reading, and public pages | Existing components | Existing components and CSS | No | Retain as shared paper primitives. |
| Endpaper whisk, spoon, sprig, fork, and dots | `src/journal/textures.css` · `--mm-tex-endpaper` | SVG data URI tile | Yes, journal boards and Pantry | Mixing bowl includes a colored whisk at a different scale | `endpaper` | Existing CSS texture token | No | Retain the tile as one surface image. |
| Grain, mottle, specks, fibers | `src/journal/textures.css` | SVG filter tiles in data URIs | Yes, material tokens | Shared across parchment and cover treatments | Existing CSS texture tokens | Existing CSS texture tokens | No | Retain continuous materials as CSS backgrounds. |
| Brass ring halves, ring plate, book layers, tabs, and page-turn shade | `src/journal/JournalShell.tsx`, `src/journal/journal-shell.css`, `src/journal/page-turn.css` | CSS gradients, shapes, shadows, and pseudo-elements | Shared structural chrome | Outer book rings align with animated leaves | — | Existing shell and CSS | No | Retain physical geometry and animation contracts. |
| Oak desk and leather cover | `src/assets/journal/textures/` | JPEG backgrounds | Yes, shared material surfaces | None | — | Existing JPEGs | No | Retain the sourced raster materials. |
| Mori character and expressions | `src/journal/Mori.tsx` | Articulated JSX SVG and CSS animation | Yes, auth, companion, and journal | Same character in directional atlas | `Mori` | Existing component | No | Preserve pose, grip, mood, and animation hooks. |
| Mori seal | `src/journal/Mori.tsx` · `MoriEmblem` | JSX SVG with caller color | Yes, brand mark and bookplates | Same character as the companion | `MoriEmblem` | Existing component | No | Retain the live color and sizing API. |
| Mori directional atlas | `src/assets/journal/mori/{E,N,NE,NW,S,SE,SW,W}/`; `strides.json` | 62 SVG pose files and stride/contact data | Yes, character choreography | Original front-facing art supplies the south pose | Existing directional names | Existing atlas files | No | Retain all pose files and their anchor geometry. |
| Functional icons and typographic accents | `lucide-react` imports throughout `src/`; `src/journal/recipe-journal.css` | Library SVG and CSS glyphs | Yes, by provider | Sparkles have separate decorative artwork | Existing icon exports | Existing provider or CSS | No | Retain navigation, button, and list affordances. |
| User recipe photos and loading placeholder | `src/recipes/RecipeScrapArtwork.tsx`, `src/recipes/imageApi.ts` | Image, canvas resize, empty SVG skeleton | Existing photo pipeline | Fallback sketches appear only when a photo is unavailable | — | Existing photo pipeline | No | Preserve photo precedence and loading geometry. Page-turn canvas copying in `JournalPageTurn.tsx` snapshots rendered content and adds no illustration. |

The journal's title-selected placeholder sketches use an established monochrome ink style. They represent prepared dishes and use recipe titles as input. Keep `sketchFor` and the shared `Sketch` vector component. It takes the caller’s ink color through `currentColor` and preserves the journal’s monochrome treatment.

| Asset | Current source | Rendering | Reusable? | Similar artwork | Proposed ID | Destination | Ingredient candidate? | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Serving bowl | `src/recipes/RecipeSketch.tsx` · `bowl` | JSX SVG | Shared journal uses `Sketch` | Rice bowl and mixing bowl | `recipe-sketch-bowl` | `recipe-sketch-bowl.svg` if extracted | No | Reuse the original dish sketch. |
| Frying pan | `src/recipes/RecipeSketch.tsx` · `pan` | JSX SVG | Shared journal uses `Sketch` | None | `recipe-sketch-pan` | `recipe-sketch-pan.svg` if extracted | No | Reuse the original dish sketch. |
| Cake slice | `src/recipes/RecipeSketch.tsx` · `cake` | JSX SVG | Shared journal uses `Sketch` | None | `recipe-sketch-cake` | `recipe-sketch-cake.svg` if extracted | No | Reuse the original dish sketch. |
| Bread loaf | `src/recipes/RecipeSketch.tsx` · `bread` | JSX SVG | Shared journal uses `Sketch` | Twemoji bread | `recipe-sketch-bread` | `recipe-sketch-bread.svg` if extracted | No | Reuse the original dish sketch. |
| Bowl of noodles | `src/recipes/RecipeSketch.tsx` · `noodles` | JSX SVG | Shared journal uses `Sketch` | Twemoji pasta | `recipe-sketch-noodles` | `recipe-sketch-noodles.svg` if extracted | No | Reuse the original dish sketch. |
| Lidded pot | `src/recipes/RecipeSketch.tsx` · `pot` | JSX SVG | Shared journal uses `Sketch` | Recipe Review color pot | `recipe-sketch-pot` | `recipe-sketch-pot.svg` if extracted | No | Reuse the original dish sketch. |
| Fried egg | `src/recipes/RecipeSketch.tsx` · `egg` | JSX SVG | Shared journal uses `Sketch` | Recipe Review whole shell egg | `recipe-sketch-egg` | `recipe-sketch-egg.svg` if extracted | No | Reuse the original dish sketch. |
| Steaming mug | `src/recipes/RecipeSketch.tsx` · `cup` | JSX SVG | Shared journal uses `Sketch` | None | `recipe-sketch-cup` | `recipe-sketch-cup.svg` if extracted | No | Reuse the original dish sketch. |

## Ingredient artwork and fallback

[`ingredientEmojiFor`](../../frontend/src/recipe-form/ingredientEmoji.ts) trims the input, lowercases it with the English locale, collapses whitespace, and matches an exact phrase or alias. It returns a Unicode emoji. Unknown names return the plate emoji. [`IngredientEmoji`](../../frontend/src/recipe-form/IngredientEmojiView.tsx) turns the emoji into a local Twemoji SVG filename and displays a decorative image beside the ingredient name. The existing assets and license are in [`public/twemoji`](../../frontend/public/twemoji/ATTRIBUTION.md). The browser can cache the files as ordinary static images. There is no runtime artwork service or resolver cache.

The writing form uses this component in ingredient summaries and the ingredient editor. AI Chef uses it in pantry suggestions, pantry cards, and review. The compact Review includes a separate switch for rice, tomato, garlic, egg, and pork and uses explicit food artwork for its flavor symbols. Pantry cards have anchored name patterns for the bottle and peppercorns. Mori's recipe suggestion chips also use `IngredientEmoji`. At baseline, the journal reading page uses text and a decorative dot for ingredient rows, while journal cards use recipe photos or the title-selected dish sketches above.

| Asset | Current source | Rendering | Reusable? | Similar artwork | Proposed ID | Destination | Ingredient candidate? | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tomato, rice, garlic, egg, lemon, strawberry, mushroom, chili, salt, and chocolate | `public/twemoji/svg/{1f345,1f35a,1f9c4,1f95a,1f34b,1f353,1f344,1f336,1f9c2,1f36b}.svg` | Vendored Twemoji SVG | Yes, classifier returns code points | Corresponding color scrapbook drawings | Existing code points | Existing Twemoji files | Yes | Preserve as fallbacks for phrases without a matching scrapbook drawing. |
| Meat and generic plate | `public/twemoji/svg/{1f969,1f37d}.svg` | Vendored Twemoji SVG | Yes | Review pork resembles the meat symbol | Existing code points | Existing Twemoji files | Meat yes, plate is fallback | Keep other meat categories and unknown ingredients on the existing fallback. |
| Carrot | `public/twemoji/svg/1f955.svg` | Vendored Twemoji SVG | Yes | No standalone first-party carrot was found | Existing code point | Existing Twemoji file | Yes | Reuse the established fallback until a dedicated illustration is needed. |
| Remaining Twemoji set | `public/twemoji/svg/`, with the inventory defined by `emojiByIngredient` | Vendored Twemoji SVG | Yes | Ingredient-specific licensed symbols | Existing code points | Existing Twemoji files | Yes | Retain existing outputs and attribution. |

Artwork can be more specific than emoji. For example, tomato sauce, paste, purée, and crushed tomatoes currently map to the tomato emoji. Garlic powder similarly maps to garlic, and sausage and pork share the meat emoji. Use an exact artwork alias or a sufficiently specific result from the existing classifier before choosing a whole-food sticker. Preserve the existing emoji for all other matches. `Tomatoes` and `cherry tomatoes` can use the tomato illustration. `Rice vinegar` must never choose the rice bowl, even if a bottle is available. Keep decorative artwork selection local and independent of recipe data or AI calls.

## Implemented disposition

The [sticker registry](../../frontend/src/journal/scrapbookRegistry.ts) contains the 17 Review drawings, five existing Pantry assets, and the extracted desk sprig. The [sticker component](../../frontend/src/journal/ScrapbookSticker.tsx) provides plain and die-cut treatments. The warm paper brush and gingham trim remain reusable CSS backgrounds sourced from their original SVGs. The existing `Tape` component still owns dotted sage tape. The desk’s other stationery drawings stay in its shared scene, where their coordinates, theme tokens, and arrangement define the illustration.

The centralized ingredient presentation uses local SVGs in Pantry, the recipe editors, AI Chef review, and desktop journal reading. Form, Pantry, and reading labels still expose the ingredient name as text. Carrot and the remaining unmapped ingredients retain their vendored Twemoji artwork.

## Visual comparison

Both captures use the same seeded draft and a 1366 × 768 viewport. The updated ingredient editor leaves room for its Done button above the save footer.

| Before | After |
| --- | --- |
| [Original New Recipe and ingredient editor](images/new-recipe-before.webp) | [Scrapbook spread with rating stars and ingredient editor](images/new-recipe-after.webp) |
