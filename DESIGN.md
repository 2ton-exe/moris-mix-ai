---
name: "Mori’s Mix"
description: "A warm, handmade recipe ledger for home cooks."
colors:
  burgundy-leather: "#622031"
  burgundy-deep: "#4c1825"
  garden-sage: "#596a4b"
  garden-sage-light: "#e1e7d8"
  garden-sage-deep: "#283024"
  antique-brass: "#b28a3d"
  mustard-gold: "#bf8826"
  warm-parchment: "#f8f1e1"
  fresh-paper: "#fffcf3"
  paper-control: "#fdf8ec"
  espresso-ink: "#2b211b"
  soft-ink: "#5b4a3d"
  kraft-paper: "#dac093"
  brick-error: "#9a3324"
  lilac-paper: "#e6dff0"
typography:
  display:
    fontFamily: "'Fraunces', ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: "clamp(30px, 4.4vw, 49px)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Fraunces', ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: "clamp(26px, 2.2vw, 32px)"
    fontWeight: 600
    lineHeight: 1.1
  title:
    fontFamily: "'Fraunces', ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  chat:
    fontFamily: "'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.12em"
  button:
    fontFamily: "'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "0.01em"
  handwritten:
    fontFamily: "'Caveat', 'Segoe Print', 'Bradley Hand', cursive"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  paper: "3px"
  control: "8px"
  card: "12px"
  field: "9px"
  button: "10px"
  bookmark: "12px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
  space-8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.burgundy-leather}"
    textColor: "#fff6ea"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 1.15em"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper-control}"
    textColor: "{colors.espresso-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 1.15em"
    height: "44px"
  card-paper:
    backgroundColor: "{colors.warm-parchment}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.paper}"
    padding: "{spacing.space-6}"
  card-feature:
    backgroundColor: "#fdfaf3"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.card}"
    padding: "clamp(16px, 2.5vw, 24px)"
  input-framed:
    backgroundColor: "rgba(255, 253, 247, 0.94)"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
    height: "46px"
  recipe-field-ruled:
    backgroundColor: "transparent"
    textColor: "{colors.espresso-ink}"
    typography: "{typography.body}"
    rounded: "0"
    padding: "7px 3px"
    height: "44px"
  chat-message-mori:
    backgroundColor: "#fffdf7"
    textColor: "{colors.espresso-ink}"
    typography: "{typography.chat}"
    rounded: "12px 12px 12px 4px"
    padding: "8px 10px"
  chat-message-user:
    backgroundColor: "{colors.garden-sage-light}"
    textColor: "{colors.espresso-ink}"
    typography: "{typography.chat}"
    rounded: "12px 12px 4px 12px"
    padding: "8px 10px"
  recipe-preview:
    backgroundColor: "{colors.fresh-paper}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.paper}"
    padding: "clamp(15px, 2.5vw, 22px)"
  nav-bookmark:
    backgroundColor: "{colors.garden-sage-light}"
    textColor: "{colors.garden-sage-deep}"
    typography: "{typography.button}"
    rounded: "0 12px 12px 0"
    padding: "0 8px 0 30px"
    height: "46px"
  tag-sage:
    backgroundColor: "{colors.garden-sage-light}"
    textColor: "#364030"
    typography: "{typography.label}"
    rounded: "{rounded.paper}"
    padding: "4px 8px"
  stamp-burgundy:
    backgroundColor: "transparent"
    textColor: "{colors.burgundy-leather}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
---

# Design System: Mori’s Mix

## Overview

**Creative North Star: “The Handmade Recipe Ledger”**

Mori's Mix should feel like a well-used recipe book kept open on an oak kitchen table: personal, warm, tactile, and quietly playful. Parchment pages, a burgundy leather cover, paper tabs, brass details, and Mori's rat-chef identity make the journal recognizable without turning cooking tasks into decoration.

Materials do much of the storytelling; restraint protects the work. Oak and leather anchor the screen, paper carries reading and writing, and small stamps or handwritten notes add personality. Buttons and bookmarks can feel physical, while recipe text and fields stay calm and legible. Mori's companion repeats paper and sage in compact chat bubbles. AI-created recipes remain visibly reviewable as drafts, with saving presented as a separate, explicit action.

**Key Characteristics:**

- Oak, leather, parchment, and kraft-paper surfaces with restrained grain.
- Fraunces headings paired with Figtree interface text and occasional Caveat notes.
- Burgundy for primary actions, sage for support, brass for hardware, and lilac for active AI Chef progress.
- Soft paper lift, a deeper desk shadow, pressed button edges, physical bookmark tabs, and Mori's paper-and-sage chat bubbles.

## Colors

The palette stays close to the materials of a home recipe ledger: deep burgundy, garden greens, worn gold, warm paper, and espresso ink. A small lilac paper accent marks the active step in the AI Chef journey.

### Primary

- **Burgundy Leather** (#622031): Brand marks and the primary action; use the deeper #4c1825 for the cover and strong burgundy edges.

### Secondary

- **Garden Sage** (#596a4b): Supporting actions, selected supportive states, and restrained botanical details. Its lighter paper tone is #e1e7d8.

### Tertiary

- **Antique Brass** (#b28a3d): Clips, small highlights, and hardware details. Mustard gold (#bf8826) marks a tab or secondary emphasis when it needs more color. Lilac Paper (#e6dff0) is reserved for active AI Chef progress.

### Neutral

- **Warm Parchment** (#f8f1e1): Main paper surface; fresh paper (#fffcf3) and paper controls (#fdf8ec) provide lighter writing and control surfaces.
- **Espresso Ink** (#2b211b): Primary text. Soft ink (#5b4a3d) supports secondary copy; kraft paper (#dac093) adds a warmer page variation.
- **Brick Error** (#9a3324): Error and destructive-action states; keep it semantically clear and separate from brand burgundy.

### Named Rules

**The Ledger Mark Rule.** Burgundy identifies the brand and primary actions; Garden Sage carries supporting actions and states; Antique Brass stays on hardware and small editorial accents; Lilac Paper marks AI Chef progress; Warm Parchment and Espresso Ink do most of the reading.

## Typography

- **Display Font:** Fraunces (with ui-serif, Georgia, Cambria, and serif fallbacks)
- **Body Font:** Figtree (with ui-sans-serif and system sans-serif fallbacks)
- **Label/Mono Font:** Figtree for labels; ui-monospace for compact search and data-like values
- **Handwriting Accent:** Caveat (with system handwriting fallbacks)

**Character:** Fraunces gives recipe titles a literary, printed quality. Figtree keeps controls and instructions direct; Caveat is a brief handwritten accent, not a second body voice.

### Hierarchy

- **Display** (600, clamp(30px, 4.4vw, 49px), 1.06): Recipe and page titles that lead a reading surface.
- **Headline** (600, clamp(26px, 2.2vw, 32px), 1.1): Section and editor headings.
- **Title** (600, 21px, 1.2): Card and content-section titles.
- **Body** (400, 16px, 1.6–1.7): Recipe content, instructions, and supporting copy. Keep paragraphs comfortably readable and let the paper column set the measure.
- **Label** (700, 11–12px, 0.07–0.12em tracking, often uppercase): Form labels, stamps, and compact metadata.
- **Handwritten note** (600, 24px, 1.3): Short annotations and characterful empty-state copy only.
- **Chat** (400, 13px, 1.4): Compact, readable copy inside Mori Companion messages.

### Named Rules

**The Two-Hand Rule.** Use Fraunces and Figtree for nearly all product text. Save Caveat for a short note or flourish where handwriting adds meaning.

## Layout

The journal is the spatial model: a two-page spread at wide desktop sizes, with a single-page reading flow when the viewport is narrower than about 1100px or shorter than about 640px. The spread scales from page height and available width rather than forcing a fixed desktop canvas; its page width-to-height ratio is 0.74. As the book switches to the single-page layout, bookmark tabs move to a horizontal row above it. Below roughly 600px, multi-column recipe and detail content collapses into a single column.

Use the existing 4, 8, 12, 16, 24, and 32px spacing rhythm. Keep content flexible with min-width: 0, let long recipe names wrap, and preserve normal reading and document scrolling on short screens. The book can occupy a generous central area; toolbars and supporting text can use wider measures around it.

## Elevation & Depth

Depth comes from layered materials and soft ambient shadows. Paper cards use a small lift, the book sits more deeply on the desk, and interactive controls use a restrained edge that makes a press feel physical. Reserve the strongest shadow for the book and large stage; ordinary reading cards should remain close to the page.

### Shadow Vocabulary

- **Paper**: 0 1px 1px rgb(54 36 20 / 0.14), 0 3px 8px -2px rgb(54 36 20 / 0.2) for notes and cards.
- **Lifted paper**: 0 2px 4px rgb(40 24 12 / 0.18), 0 14px 28px -8px rgb(40 24 12 / 0.42) for an active or raised card.
- **Desk**: 0 2px 3px rgb(30 18 8 / 0.28), 0 18px 40px -10px rgb(30 18 8 / 0.5) for a large surface on the oak background.
- **Pressed action**: a colored 2px edge plus a compact 5px shadow for primary actions; remove the lift as the button is pressed.

**The Page-Layer Rule.** Give paper a soft ambient lift, reserve the deepest shadow for the journal on the desk, and use pressed edges for actions that should feel tactile.

## Shapes

Paper stays nearly square at 3px. Controls soften to 8px, with framed auth and discovery fields at 9px and standard buttons at 10px; small and large buttons use 8px and 12px. Larger feature cards use a 12px radius. Bookmark ends use a 12px outer corner. Rounded pills are reserved for compact page-turn or icon controls, not the general page shape.

Use thin, warm paper borders, lined writing surfaces, clipped or torn tape edges, and restrained slight rotations on physical details. Keep decorative tape and clips outside the reading and interaction area.

## Components

### Buttons

Buttons are the ledger's tactile actions; primary and secondary actions have different weight by role.

- **Shape:** Standard 10px radius, 44px minimum height, Figtree 650 at 15px.
- **Primary:** Burgundy Leather with warm light text; a colored lower edge and close shadow make the press legible.
- **Secondary:** Paper surface with an inset outline and shallow shadow.
- **Hover / Focus:** Shift the surface color on hover; show a 3px visible focus outline with 4px offset. Pressed buttons move down 2px and lose their raised shadow. Disabled controls lower opacity and remove the lift.
- **Quiet actions:** Ghost, page-turn, and icon buttons stay flat so they do not compete with save or create actions.

### Chips

Labels are small paper-backed tags for category and status information.

- **Style:** 12px Figtree, compact padding, a fine current-color border, and square paper corners. Sage, mustard, and burgundy variants use pale fills with dark readable text.
- **Stamp:** A signature stamp uses a double outline, uppercase tracking, and a slight -3deg rotation. It is decorative metadata, not a control.

### Cards / Containers

Paper cards sit on the page rather than floating above it; larger feature sheets use softer corners.

- **Corner Style:** 3px for paper cards; 12px for larger feature sheets and journey panels.
- **Background:** Parchment, fresh paper, kraft, or ruled paper according to content.
- **Shadow Strategy:** Use the Paper shadow at rest; the Lifted paper shadow only for an active or hovered card.
- **Border:** A thin warm-paper stroke.
- **Internal Padding:** 24px by default for paper cards; feature sheets use a responsive 15–24px inset.

### Inputs / Fields

Reading and writing fields use different treatments by role.

- **Framed fields:** Auth and discovery inputs use a warm off-white fill, 1.5px warm stroke, 9px corners, and a subtle inset shadow. Focus changes the border to Burgundy Leather and adds a warm gold halo.
- **Recipe writing fields:** Inputs sit directly on the page with a ruled underline; note areas use horizontal notebook lines. The AI note composer uses a lightly framed, ruled textarea with 8px corners. Keep controls at least 44px high.
- **Error / Disabled:** Errors use the brick family and an explicit message; disabled fields remain recognizable and lower in contrast without losing their labels.

### Navigation

Bookmark links behave like physical page tabs.

- **Style:** Sage, mustard, and cream tabs with Figtree labels, a small edge shadow, and a modest horizontal offset at rest.
- **Active:** The current page settles flush with the book and gains a stronger tab shadow; expose the state through aria-current as well.
- **Responsive:** Tabs sit vertically along the book at wide sizes and form a compact horizontal row on smaller screens. Keep their keyboard focus outline visible.

### Signature Details

Mori, paper clips, masking tape, and rotated stamps carry the journal's personality.

- Preserve Mori's existing rat-chef artwork and proportions.
- Tape, clips, and stains are decoration only; keep them out of hit areas and give decorative elements no pointer interaction.
- Use Caveat for short notes, not for labels, instructions, or recipe text.

### Mori Companion

The floating rat-chef companion uses the same paper-and-sage language in a compact chat panel.

- **Mori messages:** Warm paper bubbles align left with one softly pinched lower corner; the cook's sage messages align right and mirror that corner.
- **Recipe previews:** Keep a generated recipe condensed inside Mori's response, with a distinct review action. A preview remains an editable draft until the cook confirms saving.
- **Composer:** Use a paper textarea with ruled lines, 8px corners, vertical resize, and a 48px minimum height; keep send and shortcut controls at least 44px tall.

## Do's and Don'ts

### Do:

- Do keep reading and writing surfaces warm and quiet: parchment backgrounds, Espresso Ink body text, and unobtrusive grain.
- Do use Fraunces for editorial hierarchy, Figtree for functional copy, and Caveat only for short handwritten notes.
- Do make primary actions burgundy and give controls a visible keyboard focus treatment.
- Do let secondary controls and status accents take their own color role: Garden Sage for support, Antique Brass for hardware and small marks.
- Do make AI drafts read as editable previews, and show the explicit save action as a separate confirmation step.

### Don't:

- Don't use Caveat for instructions, form labels, or long passages.
- Don't put tape, paper clips, or stamps over a control or its text; they are decorative.
- Don't let grain, stains, or shadow compete with recipe text; keep body content on high-contrast paper.
- Don't present a generated recipe draft with the same saved state as an account-owned recipe before the cook confirms it.
