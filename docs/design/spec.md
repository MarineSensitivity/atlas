# Atlas design system (atlas-3, step 1)

The MMA visual language applied to a full-screen map app. Sources: `MarineSensitivity.github.io/branding/MMA Branding Guide 2026.pdf`
(July 2026, read 2026-09-20), plan decisions **D10** (brand: seal and agency name approved, spelled
"Minerals") and **D13** (size budget), `atlas-3 design system + shell (MMA brand).md`, and the two
parity inventories under `atlas-refs/` for the content the mockups show.

Everything here is enforced by something: `src/lib/brand/tokens.css` holds the values,
`scripts/contrast.mjs` holds the contrast contract, `scripts/check-hex-literals.mjs` holds "tokens
only", and `tests/{contrast,brand-tokens}.test.ts` hold the seeded faults that prove each gate can
still fail.

**Mockups:** `docs/design/mockups/{scores-desktop,species-desktop,phone-sheet-half}.html`, both themes,
screenshots in `docs/design/mockups/screenshots/` (`node scripts/mockup-shots.mjs` regenerates them;
`node scripts/axe-mockups.mjs` re-runs axe over all six).

---

## 1. Principles

1. **The map is the page.** Everything else floats over it: glass cards, a hexagonal tool rail, no
   fixed sidebar, no tab strip stealing height.
2. **Brand colors are chrome; data colors are data.** Gold / Steel / Navy / Crimson never encode a
   value. Score ramps and the eight category hues are a separate, CVD-safe system.
3. **Component CSS reads custom properties only.** No component may contain a color literal — that
   is what makes two themes, a contrast gate and a future brand revision one-file changes.
4. **Every rule has a gate, and every gate has a seeded fault.** A check that cannot fail is not a
   check (the repo rule from atlas-0).

## 2. Palette

| name        | hex       | role in the app                                                                                                                                                                                 |
| ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gold        | `#E8C24A` | the accent that carries an **active** state on dark surfaces; focus ring on dark; the PREVIEW chip; motif tint on `navy`. **Never text or a thin stroke on a light surface** (1.71:1 on white). |
| Steel Blue  | `#173D6D` | the accent on light surfaces; focus ring on `paper`; motif tint on `paper`; `--text-accent` on `paper` (10.91:1).                                                                               |
| Navy Blue   | `#001A57` | body text on `paper`; the glyph on a Gold fill (9.53:1).                                                                                                                                        |
| Crimson Red | `#6E110F` | destructive / error text on `paper` (12.0:1). On `navy` it is too dark, so the dark theme uses a light tint (`--text-danger`).                                                                  |

The palette reaches the screen only through the theme tokens below; `--mma-*` is exempted from the
contrast pairs precisely because nothing may use it directly.

## 3. Themes

Two themes, both first-class: **`navy`** (dark; `#0B1635` surfaces, white text, Gold accent,
dark-matter basemap) and **`paper`** (light; white surfaces, Navy text, Steel accent, positron
basemap). Default follows `prefers-color-scheme`, **falling back to `navy`** (what both Shiny apps
ship today). An inline pre-paint script in `index.html` sets `data-theme` before first paint, so
there is no flash and `tokens.css` needs no duplicated `@media` block. The mockups carry the same
script (`?theme=navy|paper` wins), which is also how the screenshots are taken.

| token                   | navy      | paper     | notes                                                                                                                |
| ----------------------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `--surface-map`         | `#0B1635` | `#EAEEF3` | basemap average; the page background                                                                                 |
| `--surface-panel`       | `#142446` | `#FFFFFF` | the glass card's own color, mixed at `--glass-opacity` (88 %)                                                        |
| `--surface-panel-basis` | `#303E55` | `#E6F1F7` | **the worst-case opaque composite of that glass over the map** — what the contrast checker measures against (see §7) |
| `--surface-raised`      | `#1C2F57` | `#FFFFFF` | modal, popover, tooltip: opaque, never glass                                                                         |
| `--surface-sunken`      | `#0A1533` | `#F2F5F9` | inputs, table stripes                                                                                                |
| `--text-primary`        | `#FFFFFF` | Navy      | 16.3:1 / 16.3:1 on panel                                                                                             |
| `--text-secondary`      | `#C7D2E8` | `#3D4C74` | ≥ 7:1 everywhere it is used                                                                                          |
| `--text-accent`         | Gold      | Steel     | the one place the two themes disagree on which brand color is legible                                                |
| `--text-link`           | `#9CC8F2` | `#15467F` | links are underlined as well as colored                                                                              |
| `--text-danger`         | `#FF9C94` | Crimson   |                                                                                                                      |
| `--fill-accent`         | Gold      | Steel     | active hex button, selected place outline, primary button                                                            |
| `--text-on-accent`      | Navy      | `#FFFFFF` |                                                                                                                      |
| `--border-control`      | `#8494BD` | `#5D6D92` | every control's boundary; ≥ 3:1 on every surface it touches                                                          |
| `--focus-ring`          | Gold      | Steel     | 2 px, `outline-offset: 2px`                                                                                          |
| `--icon-muted`          | `#AAB8D8` | `#56658A` |                                                                                                                      |
| `--icon-inactive`       | `#98A3BD` | `#6B7793` | an inactive control's glyph; >= 3:1 on the control's own face (see section 5)                                        |
| `--surface-seal-plate`  | `#FFFFFF` | `#FFFFFF` | the plain plate the seal sits on, white in BOTH themes (see section 9)                                               |
| `--motif-color`         | Gold      | Steel     | see §6                                                                                                               |

## 4. Type, spacing, elevation, motion

**Faces.** Display `"Century Gothic", CenturyGothic, "TeX Gyre Adventor", "URW Gothic", Jost, sans-serif`;
body `Calibri, Carlito, "Segoe UI", system-ui, sans-serif`. Century Gothic and Calibri are licensed —
`local()` first, **never redistributed**. The self-hosted open fallbacks (TeX Gyre Adventor, or Jost
if the GUST renaming clause bites; Carlito for body) are metric-compatible, so a swap does not shift
layout. Tables use `font-variant-numeric: tabular-nums`.

**Scale** (`--text-*`): 12 legend / meta · 13 dense table, chips · 14 body · 16 panel body and phone
body · 20 panel title · 28 modal, report title and the flower's centre number. Line height 1.2 for
display, 1.5 for body; display tracking `0.01em`.

**Spacing** (`--space-1…6`): 4 · 8 · 12 · 16 · 24 · 32. Sizes: top bar 48, rail 56, minimum target
44, panel 380, sheet peek 96, sheet half `46svh`, **seal minimum 72** (§5).

**Radius**: card 12, control 8, pill 999; hexagons are a `clip-path` polygon, not a radius.

**Elevation**: `--elev-1` resting chrome (top bar), `--elev-2` floating (rail, legend, layer bar),
`--elev-3` overlay (panel, sheet, modal). The shadow color is a token, never literal black — a black
shadow on a white page is a dark theme's habit.

**Motion**: 150 ms for control states, 200 ms for panels and the sheet, `--ease-out`. Both collapse
to `0ms` under `prefers-reduced-motion` in `tokens.css`, so nothing has to remember to opt out. The
loader is seven hexagons pulsing in sequence; under reduced motion it is a static honeycomb with the
status text.

## 5. Components and their states

Everything below is a requirement for the component build, not a suggestion;
`tests/mockup-shell.test.ts` asserts the ones a mockup can prove.

### 5.1 The tool rail is FIVE controls, the same five, in the same order, on every viewport

`Layers · Places · Flower · Table · Report` (Ben, 2026-09-21). Desktop: a floating honeycomb column
on the left. Phone: the identical five as a bottom bar. 44 px targets everywhere, no words on the
control itself (the tooltip carries them), roving `tabindex` inside the group.

| control    | opens                                                                                                                                                          | icon                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Layers** | the LAYERS panel: score layer (or species surface), palette, zone outlines, bathymetry, OBIS occurrences, other related layers. It is **not** the flower plot. | `mdiLayers`               |
| **Places** | select · draw · upload                                                                                                                                         | `mdiMapMarker`            |
| **Flower** | the flower plot of component scores for the current place                                                                                                      | **bespoke `flower`** (§6) |
| **Table**  | the data table (species or zones, per lens)                                                                                                                    | `mdiTable`                |
| **Report** | the report builder                                                                                                                                             | `mdiFileDocumentOutline`  |

Two controls that used to be in the rail are **gone**:

- **Help** lives in the **top bar only** ("redundant in desktop with its upper right"). The top-bar
  Help button opens help, the guided tour and **About**.
- The **species/fish** button is gone: the **lens switch** (`Scores | Species`) and the **search**
  field are how a species is chosen, and the species card is what the Species lens' panel shows. In
  the Scores lens a species is reached from the species table's row link, which switches the lens.

### 5.2 An inactive control fades in place; it is never removed

The Flower has no meaning in the Species lens. It **stays in its third position** and becomes
visibly inactive (removal is "jerky" — Ben, 2026-09-21):

- the glyph transitions to `--icon-inactive` over `--motif`-free `var(--motion-panel)` (200 ms,
  `--ease-out`); under `prefers-reduced-motion` the token is `0ms`, so it simply is grey;
- `aria-disabled="true"` — **not** the `disabled` attribute, so it stays focusable and can explain
  itself; no `tabindex="-1"`;
- its tooltip and accessible description say why: **"Flower plot — Scores only"**;
- activation is a no-op that re-announces the tooltip text in the live region;
- `--icon-inactive` is ≥ 3:1 against both `--fill-control` and `--surface-panel-basis` (gated), so an
  inactive control is still identifiable — "greyed out" never means "invisible".

### 5.3 Panel header controls: collapse · half · full, upper right

Every floating panel **and** the phone sheet carries the same three-button group in its upper right,
in this order, `role="group"` with `aria-label="Panel size"` (sheet: `"Sheet size"`):

| order | action                                        | desktop icon            | phone icon             | aria                                                                                                            |
| ----- | --------------------------------------------- | ----------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1     | **Collapse** to a labelled pill (sheet: peek) | `mdiChevronDoubleRight` | `mdiChevronDoubleDown` | `aria-expanded` + `aria-controls="<panel-body id>"`; `aria-label="Collapse to a pill"` / `"Collapse to a peek"` |
| 2     | **Half**                                      | `mdiDockRight`          | `mdiDockBottom`        | `aria-pressed`; `aria-label="Half height"`                                                                      |
| 3     | **Full**                                      | `mdiArrowExpand`        | `mdiArrowExpand`       | `aria-pressed`; `aria-label="Full height"`                                                                      |

- **Exactly one** of Half / Full is `aria-pressed="true"` at a time; the collapse button is a
  disclosure, not a detent, so it carries `aria-expanded`/`aria-controls` instead.
- **Size**: 32 × 32 on a fine pointer, **44 × 44 under `@media (pointer: coarse)`** (so every phone
  target meets the contract). Spacing `--space-1`; the header reserves 116 px of right padding so a
  long title never runs under the group.
- **Keyboard**: each button is a real `<button>` in the tab order, `Enter`/`Space` activates. `Esc`
  inside a panel collapses it (the same as pressing control 1). The group is not a roving-tabindex
  toolbar — three targets do not justify it, and Tab must reach each one.
- **Focus on collapse**: focus moves to the pill the panel collapsed into (which carries the panel's
  label and `aria-expanded="false"` + `aria-controls`), so focus is never left on a removed node.
- **Focus on restore**: expanding from the pill returns focus to control 1 of the restored header —
  the element the user would have been on had the panel never collapsed.
- Collapsing and restoring are chrome, not view state: remembered per viewport size in
  `localStorage`, never in the URL.

### 5.4 Everything else

| component               | idle                                                                           | hover                     | active / selected                                                     | focus                                                                                       | disabled / inactive                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hex rail button**     | `--fill-control` face, `--border-control` edge, `--text-primary` glyph         | face lightens one step    | `--fill-accent` face, `--text-on-accent` glyph, `aria-pressed="true"` | 2 px `--focus-ring`, offset 2 (the outline is on the button box, never on the clipped face) | `--icon-inactive` glyph + `aria-disabled` + a tooltip that says why (§5.2)                                                                 |
| **Segmented (lens)**    | `--text-secondary` label                                                       | label to `--text-primary` | `--fill-accent` + bold label + `aria-pressed`                         | same ring                                                                                   | —                                                                                                                                          |
| **Chip / version chip** | `--fill-control` + border                                                      | border brightens          | `.chip--accent` = accent fill                                         | same ring                                                                                   | —                                                                                                                                          |
| **Layer pill**          | border + `--text-primary`                                                      | —                         | accent fill + bold                                                    | same ring                                                                                   | dashed border, strike-through, `aria-disabled="true"`, tooltip says _why_ ("… feeds the merged model, but v7 publishes no surface for it") |
| **Panel**               | glass, 1 px `--border-control`, `--elev-3`; header carries the hexagon texture | —                         | detents per §5.3                                                      | ring on the header controls                                                                 | —                                                                                                                                          |
| **Bottom sheet**        | peek / **half** / full, wave top edge, grab handle                             | —                         | the pressed header control shows which detent                         | the scroll region is itself focusable                                                       | —                                                                                                                                          |
| **Button**              | `--fill-control`                                                               | —                         | `.btn--primary` = accent fill, bold                                   | ring                                                                                        | —                                                                                                                                          |
| **Accordion**           | `aria-expanded="false"`, chevron                                               | —                         | `aria-expanded="true"`, chevron rotates                               | ring                                                                                        | —                                                                                                                                          |

Every state that means something is also in the accessibility tree (`aria-pressed`,
`aria-expanded`, `aria-disabled`) — never color alone.

### 5.5 Content rule: the protection chips

The species card shows **one chip per statute, always both**, so absence is never ambiguous
(Ben, 2026-09-21: "Showing 'MMPA' does not make sense for a Leatherback Turtle card, unless it says
'not applicable' like the MBTA"):

- **MMPA** applies to **marine mammals** (`sp_cat == "mammal"`): the chip reads `MMPA · floor 20`.
- **MBTA** applies to **birds** (`sp_cat == "bird"`): the chip reads `MBTA · floor 10`.
- For any other category — the Leatherback Turtle included — the chip reads **`· not applicable`**.
- The floors are the extinction-risk floors `msens::compute_er_score()` applies (MMPA 20, MBTA 10);
  a chip never invents a floor for a taxon its statute does not cover.

## 6. Icons: the exact map the components are built from

One canonical name → path map (`src/lib/ui/icon-paths.ts`), rendered by a single `<Icon>` component
as `<svg viewBox="0 0 24 24"><path d={ICON[name]} fill="currentColor"/></svg>`. Two rules the Step 2
generator must follow:

1. **Import `@mdi/js` by export name; never transcribe path data by hand.** A first attempt typed 16
   "MDI" paths from memory and 0 of 16 matched. The generator imports the named export and fails
   loudly if `@mdi/js` has no such export, so a wrong name is a build error, not a wrong picture.
2. **Bespoke glyphs live in `src/lib/brand/glyphs/*.svg`** and are read from those files, not retyped.

| app name       | source                   | used by                                          |
| -------------- | ------------------------ | ------------------------------------------------ |
| `layers`       | `mdiLayers`              | rail 1                                           |
| `places`       | `mdiMapMarker`           | rail 2                                           |
| `flower`       | **bespoke `flower.svg`** | rail 3, the flower panel's header, the report    |
| `table`        | `mdiTable`               | rail 4, "Open table"                             |
| `report`       | `mdiFileDocumentOutline` | rail 5, top bar Report, "Add to report"          |
| `help`         | `mdiHelpCircleOutline`   | top bar Help / tour / About                      |
| `search`       | `mdiMagnify`             | top bar search                                   |
| `share`        | `mdiShareVariant`        | top bar Share                                    |
| `theme`        | `mdiThemeLightDark`      | top bar theme toggle                             |
| `version`      | `mdiChevronDown`         | the `v7 ▾` chip, every `<select>`-like control   |
| `chevronDown`  | `mdiChevronDown`         | accordion closed                                 |
| `chevronUp`    | `mdiChevronUp`           | accordion open                                   |
| `collapseSide` | `mdiChevronDoubleRight`  | panel header control 1 (desktop)                 |
| `collapseDown` | `mdiChevronDoubleDown`   | sheet header control 1 (phone)                   |
| `dockRight`    | `mdiDockRight`           | panel dock control (desktop, sheet "half")       |
| `dockBottom`   | `mdiDockBottom`          | panel dock control (desktop, sheet "half")       |
| `dockLeft`     | `mdiDockLeft`            | panel dock control (desktop, R1)                 |
| `expand`       | `mdiArrowExpand`         | header control 3 ("full"), sheet "full"          |
| `collapseAll`  | `mdiArrowCollapse`       | "full" toggled back, panel restore from a pill   |
| `close`        | `mdiClose`               | modal close, chip dismiss                        |
| `info`         | `mdiInformationOutline`  | the `ⓘ` popover trigger, the About popover       |
| `maximize`     | `mdiFullscreen`          | panel header control (R1, maximize to stage)     |
| `restore`      | `mdiFullscreenExit`      | panel header control (R1, restore from maximize) |
| `more`         | `mdiDotsHorizontal`      | phone top-bar overflow (⋯) menu (R2)             |
| `feedback`     | `mdiMessageAlertOutline` | top bar "Feedback" (R2)                          |
| `copy`         | `mdiContentCopy`         | copy the scientific / common name                |
| `check`        | `mdiCheck`               | merged-model pill, selected row                  |
| `alert`        | `mdiAlertCircleOutline`  | a denied release, a failed upload                |
| `download`     | `mdiDownload`            | CSV export, report download                      |
| `upload`       | `mdiUpload`              | Places → upload                                  |
| `draw`         | `mdiVectorPolygon`       | Places → draw                                    |
| `filter`       | `mdiFilterVariant`       | table column filter                              |
| `sortAsc`      | `mdiArrowUp`             | table sort ascending                             |
| `sortDesc`     | `mdiArrowDown`           | table sort descending                            |
| `preview`      | `mdiEye`                 | the PREVIEW chip on the preview host             |

### The bespoke `flower` glyph

A circle with eight radiating petals of clearly different lengths — the centre is the composite mean
and each petal is one component score, which is exactly what the flower plot draws (Ben, 2026-09-21:
"a simplified icon with a circle and radiating petals of different lengths"). It is **not**
`mdiFlower` (a decorative flower) and it is not the Layers icon. 24 × 24, one `currentColor` path,
legible at 20 px inside a 44 px hexagon button. `src/lib/brand/glyphs/flower.svg` is the source;
`tests/glyphs.test.ts` proves this quoted copy is byte-identical to it, that it parses as path data,
and that the mockups' sprites carry the same string.

<!-- glyph:flower -->

```
M8.9 12a3.1 3.1 0 1 0 6.2 0 3.1 3.1 0 1 0-6.2 0ZM11.37 9.48Q9.41 6.19 12 1.4Q14.59 6.19 12.63 9.48ZM13.34 9.77Q13.29 8.64 16.24 7.76Q15.36 10.71 14.23 10.66ZM14.52 11.37Q16.93 9.8 21 12Q16.93 14.2 14.52 12.63ZM14.23 13.34Q15.92 13.51 16.95 16.95Q13.51 15.92 13.34 14.23ZM12.63 14.52Q14.39 17.37 12 21.8Q9.61 17.37 11.37 14.52ZM10.66 14.23Q10.84 15.02 8.18 15.82Q8.98 13.16 9.77 13.34ZM9.48 12.63Q7.51 14 3.8 12Q7.51 10 9.48 11.37ZM9.77 10.66Q8.3 10.58 7.33 7.33Q10.58 8.3 10.66 9.77Z
```

## 7. Motifs: the 10 % rule

The guide makes the hexagon pattern and the wave **secondary** elements at **10 % opacity** (pp. 9-10).
In this app they are CSS masks over a token tint, so they can never carry a literal color:

- `src/lib/brand/motifs/hex.svg` — tileable pointy-top honeycomb, one `currentColor`. Panel-header
  texture, empty states, the loading honeycomb, the report cover band; and as _shape_ for the rail
  buttons and category swatches.
- `src/lib/brand/motifs/wave.svg` — tileable edge, one `currentColor`. The top bar's lower edge, the
  sheet's upper edge, modal dividers, report header and footer.
- `--motif-hex-opacity` and `--motif-wave-opacity` are **0.10 and capped**: `tests/brand-tokens.test.ts`
  fails if either is raised, and proves it by raising one.
- A motif never sits behind a block of body text longer than a line.
- The dark theme tints both motifs **Gold** and the light theme **Steel** (the guide allows either for
  the hexagon; Steel at 10 % over navy is invisible). Reviewed 2026-09-21, no objection.

## 8. The contrast contract

`node scripts/contrast.mjs` reads the `@contrast` block **inside `tokens.css`** — the pairs live next
to the tokens they constrain — resolves every token in both themes and fails if:

- a **text** pair is under **4.5:1**, or a **non-text** pair (borders, focus rings, icons, category
  swatches, accent fills, **an inactive control's glyph**) is under **3:1**;
- a paired token does not resolve to an **opaque** color (glass is measured through its
  `--surface-panel-basis`, the worst case of that glass over the map — never guessed at);
- **any color token is unclassified**: every color must appear as a pair subject, as a surface, or in
  the exemption list with a reason. A new token cannot skip the gate.

70 pairs pass today. Exemptions and why: raw `--mma-*` palette (never used directly); `--fill-control`
and `--fill-track` (adjacent fills of controls whose boundary, `--border-control`, is paired);
`--divider` (decorative rule inside one surface); `--motif-color` (≤ 10 % texture);
`--surface-seal-plate` (carries the seal, never text); `--scrim` and `--shadow-color`; and
`--ramp-score-*` (a continuous ramp cannot meet 3:1 stop-to-stop, so it is labelled with tick values
and mirrored by a table).

**Data color.** Eight CVD-safe category hues (Okabe-Ito), one table shared by the flower, the treemap,
table chips, the legend and the report — including `primary producer` / `primprod`, which fall
outside `hue_pal()(8)` today and render grey. **The hue is the identity; the lightness follows the
theme**, because no single lightness clears 3:1 against both `#303E55` and white (reviewed
2026-09-21, no objection). Score ramps stay Spectral, matching the published COGs' `spectral_r`;
`--ramp-score-0…4` are the legend's stops and atlas-2's `ramps.ts` remains the source of truth.

## 9. The seal (D10), where it appears, and the agency string

D10 (2026-09-20) approves the seal and the agency name, spelled **"Marine Minerals Administration"**
(the seal's spelling) everywhere. Ben, 2026-09-21: "Would be good to have the seal somewhere… just go
for it." The guide's rules still bind, so the seal appears in exactly **three** places:

| surface                                 | why it is legitimate                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **About** (top bar Help → About)        | a document-like surface with room for the full lockup and the agency line                                                       |
| **Report header**                       | the printed artifact; the seal at the top of page 1, clear space intact                                                         |
| **The on-map About / attribution card** | the one on-map placement: an **opaque** card (never glass), so the seal sits on a plain background as the guide requires (p. 3) |

The attribution card is anchored at the bottom of the map, **collapsed to its header by default**
(`ⓘ About this release`, `aria-expanded="false"`); expanding it reveals the seal, the agency line and
the release/basemap attribution. The desktop Scores mockup shows it **expanded**, which is how the
seal treatment is reviewed. No other on-map placement is allowed: a glass panel is not a plain
background, and the 48 px top bar cannot hold a 72 px seal.

Rules, everywhere it appears:

- **Never in the top bar** — 28 px would break the 0.75 in minimum (p. 4). The top bar uses the
  project's own MST mark (`src/lib/brand/vendor/mst-mark*.svg`, vendored from `server/branding/`).
- **≥ 72 CSS px** (`--size-seal-min`), with **clear space** of a quarter of its height (the platform's
  height, p. 4) on all four sides, on a plain `--surface-seal-plate` (white in both themes).
- **Unmodified**: no stretch, skew, shadow, gradient, greyscale, crop, crowding or down-res, and the
  aspect ratio is fixed by giving the `<img>` both `width` and `height`.
- **Lazy**: `loading="lazy"`, from the app's own asset URL; the 897 KB `MMA logo.svg` is never copied
  into this repo, never bundled and never in the critical path. The mockups borrow the read-only
  source through one review-server alias (`scripts/mockup-serve.mjs`), which ships nothing.
- **Flags**: `VITE_AGENCY` mirrors `server/branding/make_branding.py`'s `AGENCY` (`MMA` | `BOEM` | `""`)
  and `VITE_SEAL` (`1` | `0`) gates the seal. **Defaults after D10: `VITE_AGENCY=MMA`, `VITE_SEAL=1`.**
  `VITE_AGENCY=""` implies `VITE_SEAL=0` — a seal without the agency line is not a lockup the guide
  recognizes. With `VITE_SEAL=0` the About card keeps its text and simply has no seal.
- `branding/offshore_hub.png` is **not used and not linked anywhere** (D10: internal only).

## 10. Phone (< 900 px)

One `matchMedia("(max-width: 899px)")` switch, no separate route or bundle:

- the title collapses to the mark (the accessible name stays in an `h1`);
- the rail becomes a **bottom bar of the same five hexagons in the same order** (§5.1), still 44 px,
  still labelled by `aria-label`;
- panels become **one bottom sheet** with peek / half / full, a wave top edge and a grab handle, and
  the **same three header controls** as a desktop panel (§5.3), at 44 px;
- the sheet's scroll region is focusable (a scrollable region with no focusable child must still be
  reachable by keyboard — axe `scrollable-region-focusable`, caught and fixed in this step);
- the flower shrinks to 150 px and the component list stays a list, not a second chart.

## 11. Accessibility contract (re-checked in atlas-8)

Keyboard reaches and operates everything (roving `tabindex` in the rail, Tab through the three panel
header controls, focus trap and return in modals, `Esc` closes the top layer — inside a panel `Esc`
collapses it and moves focus to its pill); visible focus everywhere (2 px `--focus-ring`, offset 2);
`aria-expanded`/`aria-controls` on every disclosure, including each panel's collapse control and the
pill it collapses into; one polite live region announces async results ("Species table loaded, 1,234
rows") and an inactive control's reason when it is activated; every chart has a table equivalent and
a text summary (the flower's `aria-label` carries the mean and points at the component table); the
zone table is the non-visual equivalent of the map; **no information by color alone** (an inactive
control also carries `aria-disabled` and a tooltip; the low-coverage turtle component carries a
labelled chip, not a pale petal); 200 % zoom reflows without horizontal scroll; targets ≥ 44 px on
touch (`@media (pointer: coarse)` raises the 32-40 px desktop chrome buttons); `lang`, a skip link,
and a page title that tracks the view.

**Measured now:** axe (WCAG 2.0/2.1 A + AA) over the three mockups in both themes —
**0 critical, 0 serious, 0 moderate, 0 minor**.

## 12. What the size budget leaves for fonts and CSS (D13)

**Relaxed 2026-09-21** (owner: "we don't need to be so tight on the 350 KB budget"): the static
critical path is **450 KB gzip** and runtime workers get **150 KB gzip** separately
(`scripts/size-budget.mjs`), 600 KB combined. The original 350 KB cap (atlas-0 Deliverable 4) is
what the rest of this section's arithmetic was written against; it turned out too tight once
atlas-3 step 3 actually wired the shell and measured it for real (below), so D13 is no longer "a
working rule until Ben answers" — it is answered, at 450 KB.

Spike S2 measured maplibre-gl 6.10 + pmtiles + CSS at **288,149 B gzip** on its own. atlas-3 step 3's
shell (index.html's real entry, `npm run build` + `node scripts/size-budget.mjs`) measures:

| item (as actually built, atlas-3 step 3)                           | measured (gzip)              |
| ------------------------------------------------------------------ | ---------------------------- |
| Svelte 5 runtime + Shell.svelte + shell.css + component CSS        | ~29.8 KB (JS + CSS combined) |
| self-hosted brand fonts, both faces, both weights (Jost + Carlito) | ~78.5 KB                     |
| **shell total**                                                    | **~108.3 KB**                |

288 (maplibre) + 108 (shell) ≈ 396 KB, which left under 54 KB of the OLD 350 KB cap for atlas-4/5's
own lens code — tight enough that the owner relaxed the cap rather than the shell shrinking further.
At 450 KB, atlas-4/5 has **≈ 50 KB** of headroom for lens code before hitting the new cap (assuming
maplibre-gl's measured footprint doesn't grow). The self-hosted fonts stay wired exactly as this
step measured them (`local()` first, both Jost weights and both Carlito weights preloaded — see
index.html's own comment on why Carlito needed preloading too, not just the display face); the
budget question this raised is answered by the relax above, not by a font change.

Note what the checker does and does not see: it counts the entry's JS and CSS from the Vite manifest
(including every font file the manifest's `assets` list associates with the entry, via any
`@font-face src: url(...)` reachable from the entry's CSS, REGARDLESS of whether `local()` would
actually resolve first at runtime on a machine that has the licensed face installed) — so this is a
conservative, worst-case count, not "bytes guaranteed to cross the wire on every visit." The mockups,
their screenshots, the glyph SVGs and this document live under `docs/` and `src/lib/brand/`, are not
imported by any build entry, and cost the budget nothing (`npm run size-budget` confirms it).

## 13. Gates in this step

| gate                  | command                                   | seeded fault                                                                                |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| contrast, both themes | `node scripts/contrast.mjs`               | assign Gold to `--text-accent` on `paper` → 1.49:1 / 1.71:1, red (`tests/contrast.test.ts`) |
| tokens-only color     | `node scripts/check-hex-literals.mjs`     | plant a literal in mockup CSS → red (`tests/brand-tokens.test.ts`)                          |
| motif ≤ 10 %          | `npm test`                                | raise `--motif-hex-opacity` above 0.10 → red                                                |
| the bespoke glyph     | `npm test` (`tests/glyphs.test.ts`)       | a `d` that is not path data, or a spec copy that drifts from the SVG → red                  |
| the shell's shape     | `npm test` (`tests/mockup-shell.test.ts`) | a sixth rail button, a missing panel-size control, `MMPA · floor` on a turtle → red         |
| accessibility         | `node scripts/axe-mockups.mjs`            | a scrollable sheet with no keyboard access → serious (found and fixed here)                 |
| screenshots           | `node scripts/mockup-shots.mjs`           | — (regenerates the six committed PNGs)                                                      |

## 14. Decisions, after Ben's review of 2026-09-21

Settled — the component build takes these as given:

1. **Steel, not Gold, is the active fill on `paper`** ("Steel feel is fine for paper theme").
2. Motif tint Gold on dark / Steel on light (§7) — no objection.
3. Category hues keep their hue and change lightness per theme (§8) — no objection.
4. The rail is five controls on every viewport; Help is top-bar only; there is no fish/species rail
   button (§5.1).
5. The Flower control fades in place in the Species lens rather than being removed (§5.2).
6. Panels and the sheet carry collapse · half · full in the upper right (§5.3).
7. The flower plot has its own bespoke glyph; Layers opens the layers control (§6).
8. Protection chips always show both statutes, "not applicable" where one does not apply (§5.5).
9. The seal appears in About, the report header and the collapsible on-map About card (§9).
10. D13 itself, relaxed 2026-09-21: the static critical path is **450 KB gzip** (was 350), runtime
    workers stay at 150 KB gzip — see §12 for the measured arithmetic that motivated the relax.

Still open, and not blocking:

- Whether the on-map About card should default to **expanded** on a wide desktop (it defaults to
  collapsed here, so the map keeps the space).
