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

| component                   | idle                                                                           | hover                     | active / selected                                                                                                                    | focus                                                                                       | disabled                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hex rail button** (44 px) | `--fill-control` face, `--border-control` edge, `--text-primary` glyph         | face lightens one step    | `--fill-accent` face, `--text-on-accent` glyph, `aria-pressed="true"`                                                                | 2 px `--focus-ring`, offset 2 (the outline is on the button box, never on the clipped face) | `--icon-muted` glyph, `aria-disabled`, no fill change alone                                                                                |
| **Segmented (lens)**        | `--text-secondary` label                                                       | label to `--text-primary` | `--fill-accent` + bold label + `aria-pressed`                                                                                        | same ring                                                                                   | —                                                                                                                                          |
| **Chip / version chip**     | `--fill-control` + border                                                      | border brightens          | `.chip--accent` = accent fill                                                                                                        | same ring                                                                                   | —                                                                                                                                          |
| **Layer pill**              | border + `--text-primary`                                                      | —                         | accent fill + bold                                                                                                                   | same ring                                                                                   | dashed border, strike-through, `aria-disabled="true"`, tooltip says _why_ ("… feeds the merged model, but v7 publishes no surface for it") |
| **Panel**                   | glass, 1 px `--border-control`, `--elev-3`; header carries the hexagon texture | —                         | collapses to a labelled pill on the nearest edge; geometry remembered per viewport in `localStorage` (chrome only, never view state) | ring on the header controls                                                                 | —                                                                                                                                          |
| **Bottom sheet**            | peek / **half** / full detents, wave top edge, grab handle                     | —                         | detent dots show which                                                                                                               | the scroll region is itself focusable                                                       | —                                                                                                                                          |
| **Button**                  | `--fill-control`                                                               | —                         | `.btn--primary` = accent fill, bold                                                                                                  | ring                                                                                        | —                                                                                                                                          |
| **Accordion**               | `aria-expanded="false"`, chevron                                               | —                         | `aria-expanded="true"`, chevron rotates                                                                                              | ring                                                                                        | —                                                                                                                                          |

The rail carries **no words**; the tooltip does (shown in the desktop Scores mockup). Every state
that means something is also in the accessibility tree (`aria-pressed`, `aria-expanded`,
`aria-disabled`) — never color alone.

## 6. Motifs: the 10 % rule

The guide makes the hexagon pattern and the wave **secondary** elements at **10 % opacity** (pp. 9-10).
In this app they are CSS masks over a token tint, so they can never carry a literal color:

- `src/lib/brand/motifs/hex.svg` — tileable pointy-top honeycomb, one `currentColor`. Used as panel-header
  texture, empty states, the loading honeycomb, the report cover band; and as _shape_ for the rail
  buttons and category swatches.
- `src/lib/brand/motifs/wave.svg` — tileable edge, one `currentColor`. Used for the top bar's lower edge,
  the sheet's upper edge, modal dividers, report header and footer.
- `--motif-hex-opacity` and `--motif-wave-opacity` are **0.10 and capped**: `tests/brand-tokens.test.ts`
  fails if either is raised, and the same test proves it by raising one.
- A motif never sits behind a block of body text longer than a line.
- **Deviation to confirm:** the guide gives the hexagon "Steel Blue or Gold" and the wave "Steel and
  Navy". Steel at 10 % over a navy surface is invisible, so the dark theme takes the Gold option for
  both motifs and the light theme takes Steel.

## 7. The contrast contract

`node scripts/contrast.mjs` reads the `@contrast` block **inside `tokens.css`** — the pairs live next
to the tokens they constrain — resolves every token in both themes and fails if:

- a **text** pair is under **4.5:1**, or a **non-text** pair (borders, focus rings, icons, category
  swatches, accent fills) is under **3:1**;
- a paired token does not resolve to an **opaque** color (glass is measured through its
  `--surface-panel-basis`, the worst case of that glass over the map — never guessed at);
- **any color token is unclassified**: every color must appear as a pair subject, as a surface, or in
  the exemption list with a reason. A new token cannot skip the gate.

66 pairs pass today. Exemptions and why: raw `--mma-*` palette (never used directly); `--fill-control`
and `--fill-track` (adjacent fills of controls whose boundary, `--border-control`, is paired);
`--divider` (decorative rule inside one surface); `--motif-color` (≤ 10 % texture); `--scrim` and
`--shadow-color`; and `--ramp-score-*` (a continuous ramp cannot meet 3:1 stop-to-stop, so it is
labelled with tick values and mirrored by a table).

**Data color.** Eight CVD-safe category hues (Okabe-Ito), one table shared by the flower, the treemap,
table chips, the legend and the report — including `primary producer` / `primprod`, which fall
outside `hue_pal()(8)` today and render grey. **The hue is the identity; the lightness follows the
theme**, because no single lightness clears 3:1 against both `#303E55` and white. Score ramps stay
Spectral, matching the published COGs' `spectral_r`; `--ramp-score-0…4` are the legend's stops and
atlas-2's `ramps.ts` remains the source of truth.

## 8. The seal (D10) and the agency string

D10 (2026-09-20) approves the seal and the agency name, spelled **"Marine Minerals Administration"**
(the seal's spelling) everywhere. The guide's rules still bind:

- **Never in the top bar.** 28 px would break the 0.75 in minimum (p. 4). The top bar uses the
  project's own MST mark (`src/lib/brand/vendor/mst-mark*.svg`, vendored from `server/branding/`).
- The seal appears in **exactly two places**: the About modal and the report header.
- **≥ 72 CSS px** (`--size-seal-min`), with clear space equal to the platform's height on all sides,
  unmodified — no stretch, shadow, gradient, greyscale, crop, crowding or down-res.
- Loaded **lazily** from `MMA logo.svg` (897 KB with embedded rasters): never copied into the app's
  critical path, never a build asset of `index.html`.
- **Flags.** `VITE_AGENCY` mirrors `server/branding/make_branding.py`'s `AGENCY`
  (`MMA` | `BOEM` | `""`) and `VITE_SEAL` (`1` | `0`) gates the seal. **Defaults after D10:
  `VITE_AGENCY=MMA`, `VITE_SEAL=1`.** `VITE_AGENCY=""` implies `VITE_SEAL=0` — a seal without the
  agency line is not a lockup the guide recognizes.
- `branding/offshore_hub.png` is **not used and not linked anywhere** (D10: internal only).

## 9. Phone (< 900 px)

One `matchMedia("(max-width: 899px)")` switch, no separate route or bundle:

- the title collapses to the mark (the accessible name stays in an `h1`);
- the rail becomes a **bottom bar of five hexagons**, still 44 px, still labelled by `aria-label`;
- panels become **one bottom sheet** with peek / half / full detents, a wave top edge, a grab handle
  and velocity-aware snapping; the detent is shown by dots, not by color alone;
- the sheet's scroll region is focusable (a scrollable region with no focusable child must still be
  reachable by keyboard — axe `scrollable-region-focusable`, caught and fixed in this step);
- the flower shrinks to 150 px and the component list stays a list, not a second chart.

## 10. Accessibility contract (re-checked in atlas-8)

Keyboard reaches and operates everything (roving `tabindex` in the rail, focus trap and return in
modals, `Esc` closes the top layer); visible focus everywhere (2 px `--focus-ring`, offset 2);
`aria-expanded`/`aria-controls` on every disclosure; one polite live region announces async results
("Species table loaded, 1,234 rows"); every chart has a table equivalent and a text summary (the
flower's `aria-label` carries the mean and points at the component table); the zone table is the
non-visual equivalent of the map; **no information by color alone** (the low-coverage turtle
component carries a labelled chip, not a pale petal); 200 % zoom reflows without horizontal scroll;
targets ≥ 44 px on touch (`@media (pointer: coarse)` raises the 40 px desktop chrome buttons);
`lang`, a skip link, and a page title that tracks the view.

**Measured now:** axe (WCAG 2.0/2.1 A + AA) over the three mockups in both themes —
**0 critical, 0 serious, 0 moderate, 0 minor**.

## 11. What the size budget leaves for fonts and CSS (D13)

The static critical path is **350 KB gzip** and runtime workers get **150 KB gzip** separately
(`scripts/size-budget.mjs`; D13's working rule until Ben answers). Spike S2 measured maplibre-gl 6.10

- pmtiles + CSS at **288,149 B gzip**, so **≈ 70,251 B (68.6 KiB)** is left for _everything else on
  the static path_: the Svelte runtime, the shell, all component CSS and any font in that path.

Working allocation for atlas-3:

| item                             | budget (gzip)                 | note                                                                                                                                        |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Svelte 5 runtime + shell + state | ~38 KB                        | atlas-2/3 own this                                                                                                                          |
| `tokens.css` + component CSS     | **≤ 10 KB**                   | tokens.css is ~2 KB gzip today; the whole design system's CSS must stay inside 10                                                           |
| display face, 2 weights, subset  | **≤ 20 KB**                   | TeX Gyre Adventor / Jost, Latin-basic subset, WOFF2, `font-display: swap`                                                                   |
| body face                        | **0 KB in the critical path** | `local()` Calibri, then `system-ui`; Carlito is fetched **after** first paint, and being metric-compatible it swaps without shifting layout |

Note what the checker does and does not see: it counts the entry's JS and CSS from the Vite manifest,
so a **font binary is not in that number** — but a font referenced by critical CSS still downloads
before first text paint. That is why the table budgets fonts explicitly instead of leaning on the
gate. The mockups, their screenshots and this document live under `docs/` and are not part of any
build entry, so they cost the budget nothing (`npm run size-budget` confirms it after this change).

## 12. Gates in this step

| gate                  | command                               | seeded fault                                                                       |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| contrast, both themes | `node scripts/contrast.mjs`           | assign Gold to `--text-accent` on `paper` → 1.71:1, red (`tests/contrast.test.ts`) |
| tokens-only color     | `node scripts/check-hex-literals.mjs` | plant a literal in mockup CSS → red (`tests/brand-tokens.test.ts`)                 |
| motif ≤ 10 %          | `npm test`                            | raise `--motif-hex-opacity` to 0.18 → red                                          |
| accessibility         | `node scripts/axe-mockups.mjs`        | a scrollable sheet with no keyboard access → serious (found and fixed here)        |
| screenshots           | `node scripts/mockup-shots.mjs`       | — (regenerates the six committed PNGs)                                             |

## 13. Open for the owner at this checkpoint

1. **Gold on light.** Gold cannot carry an active state on a white panel (1.71:1 against white, and
   the fill-to-fill difference is under 3:1), so `paper`'s active fill is **Steel** with white
   glyphs — the guide's own "reversed white on Steel Blue" lockup — and Gold stays a dark-surface
   accent. Confirm, or accept a Gold fill that is always wrapped in a Steel boundary.
2. **Motif tint on dark** — Gold rather than Steel (§6), because Steel at 10 % over navy is invisible.
3. **Per-theme category hues** — the eight CVD-safe hues keep their hue but change lightness between
   themes so each clears 3:1 (§7). The alternative is one fixed set that fails the gate on one theme.
