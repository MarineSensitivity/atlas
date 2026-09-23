# Accessibility conformance note — Section 508 / WCAG 2.1 Level AA

**Product:** MarineSensitivity Atlas (`atlas`) — `index.html` (map app), `report.html` (print-first
report), `gallery.html` (internal component gallery).
**Version:** 0.10.15 (on 0.10.16) · **Date of this evaluation:** 2026-09-23 · **Evaluator:** atlas-8 step 3.
**Standard:** WCAG 2.1 Level A and AA, as incorporated by Section 508 (36 CFR 1194, Appendix A,
E205.4 / 508 Chapter 5 & 6).

**Conformance claim: _partially supports_.** Fourteen defects are open, six of them serious; they
are listed, reproduced and costed in [`docs/accessibility-fixes.md`](./accessibility-fixes.md) and
are not repeated here. This note is written to one rule, from the phase's own review checklist:

> **The 508 note claims nothing the matrix does not test.**

So every "Supports" row below names the **file and test title** that proves it. A criterion with no
automated or scripted coverage is marked **Not yet verified** and says so plainly — it is not
claimed. "Not yet verified" means exactly that: not tested, not "probably fine".

---

## 1. Test evidence

| What                                   | Where                                            | Result (2026-09-23, local; chromium 141 / webkit 26 / firefox 144 as bundled by Playwright 1.63)                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **axe-core, zero serious/critical**    | `e2e/matrix.a11y.spec.ts`                        | **179 audits, 179 passed.** 174 of them are every state × every viewport `scripts/verify.mjs` itself enumerates (58 named view states × {desktop 1280×800, phone 390×844, phoneNarrow 320×800}), plus 2 gallery states, 2 `report.html` access states and the auto-opened D15 denial dialog. Rule set `wcag2a, wcag2aa, wcag21a, wcag21aa`. Chromium. Wall clock 3.0 min.              |
| **Scripted keyboard walk, no pointer** | `e2e/keyboard-walk.spec.ts`                      | chromium **10 passed / 5 `fixme`**, webkit **9 / 6**, firefox **9 / 6**. Every `fixme` is a numbered finding in the fix list; nothing is skipped for convenience.                                                                                                                                                                                                                      |
| **Shell axe + layout + keyboard**      | `e2e/shell.a11y.spec.ts`                         | 2 themes × 2 widths axe with the pinned `incomplete` triage; `assertLayout()` at 3 viewports × 2 themes; roving tabindex, Esc/focus-return, one-live-region, `'/'`-shortcut removal.                                                                                                                                                                                                   |
| **Component-level a11y**               | `e2e/gallery.spec.ts`                            | ~45 tests, including the 13 defects found by the atlas-3 manual walk: unique id-references, hoverable/Esc-dismissible tooltips, forced-colors state, named Flower petals and Treemap cells, grid row counts, Sheet Esc focus, 320 px reflow, Toast pause-on-focus, one live region, the Legend ramp's text equivalent, the WCAG text-spacing stylesheet, 44 px coarse-pointer targets. |
| **Contrast ratios**                    | `scripts/contrast.mjs`, `tests/contrast.test.ts` | 70 token pairs resolved in both themes; text ≥ 4.5:1, non-text ≥ 3:1.                                                                                                                                                                                                                                                                                                                  |
| **Keyboard-only place creation**       | `e2e/places.spec.ts`                             | "keyboard-only: Enter coordinates creates a place, rename, then remove — drawing is never the only way", plus axe with the coordinate dialog open.                                                                                                                                                                                                                                     |
| **Report structure + exports**         | `e2e/report.spec.ts`                             | axe; "headings are hierarchical (one h1, every section a h2)"; the four export paths.                                                                                                                                                                                                                                                                                                  |
| **State matrix layout**                | `scripts/verify.mjs`                             | `assertLayout()` (no horizontal overflow on `<html>`, every `[data-control]` on screen) at 174 runs × 3 engines.                                                                                                                                                                                                                                                                       |

Reproduce:

```sh
npx playwright test --project=chromium e2e/matrix.a11y.spec.ts     # 179 axe audits
npx playwright test e2e/keyboard-walk.spec.ts                       # the walk, 3 engines
npx playwright test --config=playwright.gallery.config.ts           # component gallery
node scripts/contrast.mjs                                           # token contrast
node scripts/verify.mjs                                             # the state matrix
npm run test:faults                                                 # every gate's seeded fault
```

**Every gate here ships with a seeded fault** (`CLAUDE.md`: "a check that cannot fail is not a
check"). The two for this phase are `tests/faults/hexbutton-unnamed.patch` (the tool rail's
`HexButton` loses its `aria-label` — the axe sweep goes red) and
`tests/faults/modal-focus-restore.patch` (a modal opened by setting the `open` attribute instead of
`showModal()`, so closing it restores focus to nothing — the keyboard walk goes red). Both are
applied to a throwaway `git worktree` by `npm run test:faults` and must turn their gate red.

---

## 2. Criteria

Status values: **Supports** (a named test proves it) · **Partially supports** (proven for most of
the product, with a named open defect) · **Does not support** · **Not yet verified** (no test) ·
**N/A** (no content of that kind).

### Level A

| SC                              | Status                | How met — and the test that proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1.1 Non-text Content          | Partially supports    | Icon-only controls carry `aria-label` (`HexButton.svelte`; seeded fault `hexbutton-unnamed.patch` proves the gate). Colour ramps carry a text equivalent naming the quantity and both endpoints with units — `gallery.spec.ts` "the Legend ramp has a text equivalent stating both endpoints with units", ticks `aria-hidden`. Flower petals and Treemap cells each keep `role="img"` + a computed name — `gallery.spec.ts` "Flower petals and Treemap cells keep their own accessible name". Brand marks are `alt=""`. **Open:** the map does not point at its text equivalent — fix list #9.                                                                                                                                    |
| 1.2.x Time-based Media          | N/A                   | The product contains no audio, video or prerecorded media.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1.3.1 Info and Relationships    | Partially supports    | Tables are real `<table>` with `<th scope="col">` and an `aria-label` — verified in the accessibility tree for the zones table (`table "Zones ranked by Overall score"`, five `columnheader`s, a named checkbox per row) and asserted by `keyboard-walk.spec.ts` "the score a screen reader reads from that row IS the release's published number". The grid's row counts include both header rows — `gallery.spec.ts` "aria-rowcount is data rows PLUS the two header rows". Landmarks: one `banner`, one `main`, one `navigation "Tools"`, one `region` per panel, one per About card. **Open:** a nested duplicate-named region (#10) and a legend in no landmark (#11).                                                       |
| 1.3.2 Meaningful Sequence       | Not yet verified      | DOM order is the visual order in every panel read during the walk, and `shell.a11y.spec.ts` "Tab reaches every current tab stop on the page, in DOM order" pins that Tab order never revisits a middle stop out of turn — but no test asserts reading order independently of tab order.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1.3.3 Sensory Characteristics   | Not yet verified      | No instruction observed during the walk relies on shape, position or sound alone; not asserted by any test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2.1.1 Keyboard                  | Partially supports    | The whole primary task chain is proven pointer-free on three engines by `keyboard-walk.spec.ts`: select a Program Area from the zones table, read its score, create a place by coordinates, open the report, trigger an export. `places.spec.ts` proves create/rename/remove keyboard-only. **Open:** the species picker's listbox has no keyboard model of its own (#8). **Exception:** the map canvas — see §3.                                                                                                                                                                                                                                                                                                                 |
| 2.1.2 No Keyboard Trap          | Partially supports    | Modals are native `<dialog>` + `showModal()`, so Esc always closes; `gallery.spec.ts` "a modal traps focus and returns it to the opener on close". Nothing in the walk ever became unescapable. **Open:** the inverse defect — Tab _escapes_ an open dialog when its last control is disabled (#2).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.1.4 Character Key Shortcuts   | Supports              | There are none: the one single-character shortcut (`/` focusing search) was removed, and `shell.a11y.spec.ts` "'/' does not move focus, from a topbar control or from a rail tool" keeps it removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.2.1 Timing Adjustable         | Supports              | The only timed UI is the Toast auto-dismiss, which pauses while focused — `gallery.spec.ts` "focusing its Dismiss button keeps a toast alive past its 5s timeout".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.2.2 Pause, Stop, Hide         | Not yet verified      | No auto-updating or moving content was observed; map camera motion is user-initiated. Not asserted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.3.1 Three Flashes             | N/A                   | No flashing content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.4.1 Bypass Blocks             | Partially supports    | Two skip links, in DOM/visual/tab order, to the tool rail and the details panel (`index.html:345-346`). Proven to land on the rail on chromium and webkit by `keyboard-walk.spec.ts` "'Skip to the tools' lands the caret on the tool rail". **Does not support on Firefox** — fix list #6.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2.4.2 Page Titled               | Supports              | Exactly one writer for `document.title` (`Shell.svelte`), pinned by the source scan `tests/shell/documentTitle.test.ts`; the report's own `<h1>` is asserted by `report.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2.4.3 Focus Order               | Partially supports    | Tab order follows DOM order — `shell.a11y.spec.ts` "Tab reaches every current tab stop on the page, in DOM order". Focus return after a modal closes and after a panel collapse/expand — `keyboard-walk.spec.ts` "the release dialog returns focus to the version chip that opened it" and "closing the coordinate dialog with its Close button returns focus to the opener"; `shell.a11y.spec.ts` "Esc collapses the panel and moves focus to its pill; expanding returns focus to control 1"; `gallery.spec.ts` "Sheet's Esc moves focus to its own collapse control, never `<body>`". **Open, and the largest cluster:** #1 (Esc in a panel-hosted modal), #2 (Tab leaves the dialog), #5 (webkit drops focus on a tool swap). |
| 2.4.4 Link Purpose (In Context) | Not yet verified      | Link text was read in the tree dump and is self-describing (the permalink renders its own URL; the WoRMS link renders the taxon id in context). Not asserted by a test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.5.1 Pointer Gestures          | Supports              | Nothing requires a multipoint or path-based gesture: the sheet's drag handle is a `separator` with keyboard-operable detent buttons beside it, and drawing always has "Enter coordinates" as its equivalent — `places.spec.ts` "drawing is never the only way".                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.5.2 Pointer Cancellation      | Not yet verified      | Controls act on `click`, not `pointerdown`, throughout `src/` — but no test asserts it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.5.3 Label in Name             | Not yet verified      | Spot-checked in the tree dump (visible "Add place" / accessible "Add place"; visible "Report on selected (1)" / accessible the same). Not asserted by a test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2.5.4 Motion Actuation          | N/A                   | No motion-actuated feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3.1.1 Language of Page          | Not yet verified      | `<html lang>` is not asserted by any test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3.2.1 On Focus                  | Supports (by removal) | No control changes context on focus; the one that did (`/` stealing focus) is gone and gated — `shell.a11y.spec.ts`, as 2.1.4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3.2.2 On Input                  | Not yet verified      | Changing a `<select>` re-renders the map but does not move focus or open a window; not asserted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3.3.1 Error Identification      | Partially supports    | Upload and coordinate refusals render verbatim in a `role="alert"` (`CoordinateDialog.svelte:60`, `UploadPanel.svelte:179`) with what/why/fix; the copy itself is gated per-rule by `tests/geo/upload/messages.test.ts`. **Open:** a bundle-load failure reports nothing at all (#14).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3.3.2 Labels or Instructions    | Partially supports    | Every form control read in the tree dump has a programmatic label (`combobox "Study area"`, `switch "Sphere (globe projection)"`, `searchbox "Search species"`, `textbox "Rename place"`, `checkbox "Select Gulf of America for report"`); the keyboard walk asserts an accessible name on **every** stop it visits, on three engines. **Open:** one known exception, the panel body (#7), tracked in the walk's own `KNOWN_UNNAMED_STOPS` list.                                                                                                                                                                                                                                                                                  |
| 4.1.1 Parsing                   | N/A                   | Obsolete; removed from WCAG 2.1 by erratum.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4.1.2 Name, Role, Value         | Partially supports    | Every `aria-describedby`/`aria-labelledby`/`aria-controls` target resolves to a unique node — `gallery.spec.ts` "no aria-describedby/aria-labelledby/aria-controls target is missing, duplicated, or shared". Toggle state is exposed (`aria-pressed` on the lens switch and rail; `aria-expanded` on disclosures; `aria-sort` on sortable headers — `gallery.spec.ts` "a header click sets aria-sort, and it toggles asc → desc → none"). `aria-disabled` without `disabled` keeps the inactive Flower tool reachable — `shell.a11y.spec.ts`. **Open:** #7 (nameless panel body), #8 (no combobox), #13 (half a tab widget).                                                                                                     |

### Level AA

| SC                                              | Status                    | How met — and the test that proves it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.2.4 / 1.2.5 (captions, audio description)     | N/A                       | No time-based media.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.3.4 Orientation                               | Not yet verified          | No orientation lock is applied; the matrix covers portrait phone (390×844) and landscape desktop, but no test asserts the absence of a lock.                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.3.5 Identify Input Purpose                    | N/A                       | The product collects no personal information; no input has a WCAG autocomplete purpose.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.4.1 Use of Color                              | Supports                  | Colour is never the only signal for state: forced-colors mode keeps idle/pressed/inactive distinguishable — `gallery.spec.ts` "HexButton: idle, pressed and inactive faces are visually distinct system colors"; the panel/sheet size controls' painted state matches the actual detent, not a static attribute — `shell.a11y.spec.ts` "panel/sheet size controls: visual state matches the actual detent"; the continuous ramp is labelled with tick **values** — `Legend.svelte`, gated by `tests/raster/ramps.test.ts`'s `legendTicks`. |
| 1.4.2 Audio Control                             | N/A                       | No audio.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1.4.3 Contrast (Minimum)                        | Supports                  | 70 token pairs, both themes, text ≥ 4.5:1 — `scripts/contrast.mjs` + `tests/contrast.test.ts` (seeded fault: "gold on paper is a FAIL"). Hex literals outside `tokens.css` are banned by `scripts/check-hex-literals.mjs`, so no component can introduce an ungated colour. axe's own `color-contrast` reports `incomplete` (not a violation) on glass-over-canvas surfaces it cannot sample; that is pinned by node count and reason in `e2e/hermetic.ts`'s `assertColorContrastIncompletePinned`, not blanket-exempted.                  |
| 1.4.4 Resize Text                               | Supports                  | No content is lost under the WCAG text-spacing stylesheet — `gallery.spec.ts` "no cell content is lost under the WCAG text-spacing stylesheet".                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.4.5 Images of Text                            | Supports                  | There are none: all text is live text; the only images are the brand mark, the optional agency seal, and the report's map capture (which has a `figcaption` summary).                                                                                                                                                                                                                                                                                                                                                                      |
| 1.4.10 Reflow                                   | Supports                  | No horizontal overflow and every `[data-control]` fully on screen at **320×800** — `assertLayout()` in `scripts/verify.mjs`, run for all 58 states (`scripts/verify.mjs`) and for both themes (`shell.a11y.spec.ts` "layout: no horizontal overflow, every control on screen"); plus `gallery.spec.ts` "About and Panel each fit within a 320px viewport" and "the Categories demo table no longer overflows the PAGE at 320 CSS px". 320 CSS px is 1280 px at 400 % zoom.                                                                 |
| 1.4.11 Non-text Contrast                        | Supports                  | Non-text pairs ≥ 3:1 in both themes — `scripts/contrast.mjs`; forced-colors mode does not erase control state — `gallery.spec.ts` "forced-colors mode does not erase state" (HexButton faces, and the Legend ramp is not blanked by `forced-color-adjust`).                                                                                                                                                                                                                                                                                |
| 1.4.12 Text Spacing                             | Supports                  | Same gate as 1.4.4 — `gallery.spec.ts` "fix round 1, item 12 (SC 1.4.4/1.4.12)".                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1.4.13 Content on Hover or Focus                | Supports                  | Tooltips are hoverable and Esc-dismissible without moving focus — `gallery.spec.ts` "the pointer can move onto the tooltip itself without it disappearing" and "Esc hides the tooltip without moving focus off the button".                                                                                                                                                                                                                                                                                                                |
| 2.4.5 Multiple Ways                             | Supports                  | Two ways to every view: the URL is the view (every piece of state is a shareable link, `tests/state/*`), and the in-app navigation (rail tools, lens switch, release picker) reaches the same states. `report.html` additionally renders its own permalink — `report.spec.ts` "the permalink round-trips ver and pl".                                                                                                                                                                                                                      |
| 2.4.6 Headings and Labels                       | Partially supports        | One `h1` per page; `report.spec.ts` "headings are hierarchical (one h1, every section a h2)". Panel titles are `h2` named by the open tool; panel content headings are `h3`. **Open:** the floating legend's orphan `h2` breaks the outline (#11) and duplicates the panel's own title (#10).                                                                                                                                                                                                                                              |
| 2.4.7 Focus Visible                             | Partially supports        | A 2 px `--focus-ring` outline on `:focus-visible` throughout, and the roving-tabindex "active" cell is deliberately a _different_, weaker indicator so the two are not confused — `gallery.spec.ts` "the active-but-unfocused cell uses a lighter, dashed indicator, not the strong focus ring". **Does not support** for one control: the file-upload input (#3).                                                                                                                                                                         |
| 2.5.8 Target Size (Minimum) — WCAG 2.2          | Supports (exceeds AA 2.1) | Every control reaches 44 CSS px under a coarse pointer — `gallery.spec.ts` "every control reaches 44 CSS px on a coarse (touch) pointer" and "DataTable's filter INPUT itself reaches 44 CSS px tall on a coarse pointer". Listed for completeness; not required at WCAG 2.1 AA.                                                                                                                                                                                                                                                           |
| 3.1.2 Language of Parts                         | N/A                       | Single-language content. Scientific names are rendered in `<em>`, not tagged with a language.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3.2.3 Consistent Navigation                     | Supports                  | The tool rail is the same five controls, in the same order, on every viewport and in both lenses — `tests/shell/tools.test.ts` (source-of-truth order) and `shell.a11y.spec.ts` (roving tabindex order, live).                                                                                                                                                                                                                                                                                                                             |
| 3.2.4 Consistent Identification                 | Not yet verified          | The same icon+label pair is used for a given action throughout (`icon-map.json` is generated and gated by `tests/icon-paths.test.ts`), but no test asserts consistency of _identification_ across pages.                                                                                                                                                                                                                                                                                                                                   |
| 3.3.3 Error Suggestion                          | Supports                  | Every upload/coordinate refusal must name the number or format that decided it and a concrete remedy — `tests/geo/upload/messages.test.ts`'s per-rule `NUMBER_DECIDED` and fix-token tables, with a `mysteryRule` seeded fault that passes the old generic checks and fails the new ones.                                                                                                                                                                                                                                                  |
| 3.3.4 Error Prevention (Legal, Financial, Data) | N/A                       | No legal, financial or data-modifying transaction. Everything is read-only over published data; a place is removable and the URL is reversible.                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.1.3 Status Messages                           | Partially supports        | `index.html` has **exactly one** polite live region, before and after a full interaction walk — `shell.a11y.spec.ts` "exactly one live region exists, before and after a full interaction walk" and `gallery.spec.ts`'s two equivalents; every component routes through the shared `announce()` rather than rendering its own. **Does not support on `report.html`:** its progress line is `role="status" aria-live="off"` (#4). **Open:** the map-click popup is never announced (#12).                                                   |

---

## 3. Known exceptions

### 3.1 The map canvas — its equivalent is the zones table

The map is a WebGL canvas inside `<div id="map" role="img" aria-label="Map of U.S. marine areas">`.
It is **not keyboard-operable and not exposed as interactive content**, and this is deliberate, not
an oversight to be fixed: a choropleth of hundreds of polygons and a 0.05° raster of millions of
cells has no meaningful linear traversal.

The equivalent is the **zones table** (`src/lens/scores/ZonesTable.svelte`), reached by the Table
rail tool → Zones. It is the same ranking, by the same layer the choropleth is painting, from the
same numbers: values come from `boot.zones[unit][*].metrics` **verbatim**, never recomputed
(`src/lens/scores/zonesTable.ts`). Clicking a zone name in the table sets exactly the selection
clicking its polygon would (`sel=zone:<unit>:<key>`). This equivalence is not a claim — it is
tested end to end, by keyboard only, on three engines:

- `e2e/keyboard-walk.spec.ts` → "rail → Table → Zones → the zone's own button, by keyboard only"
  (the selection lands in the URL as `sel=zone:programarea:GAA`);
- `e2e/keyboard-walk.spec.ts` → "the score a screen reader reads from that row IS the release's
  published number" (rank, zone name and the ranked layer's value are asserted against the
  release's own published metric, not against a second hand-typed literal).

**What is still missing:** nothing in the map's own semantics tells a screen-reader user that this
equivalent exists or where it is — fix list #9. Until that lands, the exception is real but
undiscoverable, and this note says so rather than claiming otherwise.

Two further consequences, disclosed rather than hidden:

- **The map-click popup** (cell id · lon, lat · layer value) is only reachable by clicking the map,
  and is not announced — fix list #12. Zone-level values are all in the zones table; **cell-level**
  values are not, and today there is no keyboard path to them at all.
- **Drawing a place** on the map is pointer-only, but it is never the only way: "Enter coordinates"
  accepts a bounding box, a coordinate list or pasted WKT/GeoJSON, and is proven keyboard-only by
  `e2e/places.spec.ts` and by step 2 of the walk.

### 3.2 `gallery.html`

An internal component gallery, not part of the public product. It is audited anyway (2 states in
the axe sweep, ~45 tests in `e2e/gallery.spec.ts`) because it is where the components are proven,
but it is not offered to users and is not part of this conformance claim.

### 3.3 Printed / exported output

`report.html`'s Print and "Download HTML" outputs are static documents; "Data package (ZIP)" is
CSV. The **Word document** export (`docx`) is not evaluated here — no test inspects the produced
`.docx` for tagged structure, alt text or reading order. **Not yet verified.**

### 3.4 Engine coverage

Every claim above was measured on Playwright's bundled chromium, webkit and firefox. **Real Safari

- VoiceOver and real NVDA have not been run** — see §4.

---

## 4. Manual walk notes — what a screen-reader user hears, per region

This section is the "manual keyboard and screen-reader walk" the phase asks for, with one honest
limitation stated up front: **no screen reader was actually driven.** VoiceOver and NVDA cannot be
automated from this harness. What was done instead is a read of the **real computed accessibility
tree** — Playwright's own accname/role implementation via `ariaSnapshot()`, which is what a screen
reader consumes — for every region of the shell (both lenses, desktop and phone), the report and
the gallery, plus the scripted keyboard walk above on three engines. Where the text below says "a
screen-reader user hears X", it means "the accessibility tree exposes X"; it does not mean a
VoiceOver or NVDA session was observed. Running both by hand remains open (§5).

### Top bar (`banner`)

> banner → heading level 1 "Marine Sensitivity Atlas" → button "v7 Change release version" →
> group "Lens" → button "Scores, pressed" → button "Species" → search box "Search species and
> places" → button "Share" → button "Report" → button "Help, guided tour and About" → button
> "Switch to the navy theme".

Good: the `h1` is the product name and there is exactly one. The version chip reads its value
_and_ its action ("v7 Change release version") and advertises `aria-haspopup="dialog"` only because
it really opens one — `shell.a11y.spec.ts` pins that pairing after a round where it advertised a
dialog it did not have. The lens switch is a named group of two toggle buttons, so the current lens
is announced as "pressed" rather than implied by colour. **The theme toggle names the destination,
not the state** ("Switch to the navy theme"), which is the right choice for a button.

Wrong: nothing in this region.

### Map (`img "Map of U.S. marine areas"`)

> img "Map of U.S. marine areas" → region "Map" (MapLibre's own canvas).

A screen-reader user hears that there is a map and learns nothing else — no data, no summary, no
pointer to where the numbers live. See §3.1 and fix list #9. The nested `region "Map"` is
MapLibre's own label on its canvas, exposed inside a `role="img"` subtree that should be pruned;
harmless but untidy.

### Tool rail (`navigation "Tools"` → `toolbar "Tools"`)

> navigation "Tools" → toolbar "Tools" → button "Layers, pressed" → "Places" → "Flower plot" →
> "Table" → "Report".

Correct roving-tabindex toolbar: one Tab stop, Arrow keys within, wrapping at both ends
(`shell.a11y.spec.ts`). In the Species lens the Flower tool is `aria-disabled="true"` but still
focusable and still announces its reason through the shared live region when activated
("Flower plot — Scores only") rather than being silently removed. Each button's tooltip is its
`aria-describedby` target, per instance, so two buttons with the same label never share one.

Wrong: on WebKit the caret is dropped to `<body>` about 100 ms after a tool is actually switched —
fix list #5. A VoiceOver user would land back at the top of the document after every tool change.

### Details panel (`region "<tool name>"`)

> region "Layers" → heading level 2 "Layers" → group "Panel size" → button "Collapse to a pill,
> expanded" / "Half height, pressed" / "Full height" → **(a nameless group)** → text "Study area",
> combo box "Study area" → text "Spatial units", combo box "Spatial units" → … → switch "Sphere
> (globe projection)" → region "Layers on the map" → heading level 3 "Layers" → list → list item
> "Raster cell values".

Good: one region per panel, named by its own `h2`; the three size controls are a named group and
the collapse control is a pure disclosure (`aria-expanded`, never a static `aria-pressed` —
`gallery.spec.ts` pins that). Every `<select>` has a programmatic label. The projection control is
a real `switch`.

Wrong, and audible: **the "nameless group" above is the panel's own scrollable body** — a
`tabindex="0"` tab stop with no role and no name (fix list #7). VoiceOver announces a blank group.
The phone `Sheet` gets this right (`region "Layers details"`), so the two sizes of the same panel
behave differently. And **"Layers on the map" is a second region nested inside "Layers"**, with an
`h3` that repeats the panel's own `h2` (fix list #10) — landmark navigation offers two near-identical
entries.

### Floating legend

> heading level 2 "Overall score" → img "Overall score, score ramp from 0 to 100 score" → (ticks,
> `aria-hidden`).

Good: the ramp is the one thing on the page that colour alone cannot convey, and it carries a real
text equivalent naming the quantity and both endpoints **with units** — gated by `gallery.spec.ts`.
The tick labels are `aria-hidden` so the ramp is not read twice.

Wrong: the legend sits in no landmark at all (a bare `<div>` under `<main>`), so landmark
navigation never offers it, and its `h2` lands after the panel's `h3` — the outline reads
h1 → h2 → h3 → h2 → h2 (fix list #11). Below 900 px the floating legend is `display: none`
entirely, so phone users get no legend text equivalent at all — a documented trade-off in
`ScoresLegend.svelte`/`SpeciesLegend.svelte`, but it is a gap.

### Zones table — the map's declared equivalent

> table "Zones ranked by Overall score" → row "Select Rank Zone Overall score …" with five column
> headers → row "Select Gulf of America for report, 1, Gulf of America, 73.4, 51.2" → check box
> "Select Gulf of America for report" → cell "1" → button "Gulf of America" → cell "73.4".

This is the strongest region in the product. The table announces what it is ranked by; each row
announces rank, zone and every component score; the per-row checkbox is named with the zone it
selects (not a bare "Select"); the zone name is a button that changes the map selection. A
screen-reader user can do the entire scores task here without the map.

Wrong: nothing structural. The "Report on selected (N)" button's name carries the count, but the
count changing is not announced — a user has to re-focus the button to hear it. Minor; not filed.

### Species picker

> search box "Search species" … (focus) … check box "Only species in US waters, checked" → list box
> "Species results" → option "bird: Aechmophorus clarkii (Clark's Grebe)" → …

Good: each option's name includes its category prefix, so "turtle: Dermochelys coriacea
(Leatherback Turtle)" is self-describing out of context, and the selected option carries
`aria-selected`.

Wrong, and this is the worst region: the input is **not a combobox**. Nothing announces that a list
opened, how many results there are, or that the results changed as you type; Arrow Down does
nothing; Esc does nothing; the only route into the results is Tab. A screen-reader user types and
hears silence (fix list #8).

### Live region

> status (polite, empty until something is announced).

`index.html` has exactly one, and a full interaction walk does not produce a second — gated by
`shell.a11y.spec.ts` and `gallery.spec.ts`. Every component calls the shared `announce()`. This is
the one SC 4.1.3 mechanism in the product and it is sound.

### `report.html`

> main → status (polite, empty) → **paragraph "Done — 2 places." (`aria-live="off"`)** → heading
> level 1 "BOEM Marine Sensitivity Report" → "v9 · prerelease · restricted" → link (the permalink)
> → paragraph "PREVIEW — not for citation or distribution" → region "Introduction" (h2) → region
> "Parameters ▸" (h2) → region "Map" (h2) → heading "Mean score" + img "Mean score, score ramp from
> 38 to 40 score" → region "Plot of Scores" (h2) → tab list "Places" → tab "Gulf of America" / tab
> "Alaska" → group "Composite mean 40" / "Composite mean 38" → region "Table of Scores" (h2) →
> region "Summary of Species" (h2) → heading level 3 per place → region "Sources and Method" (h2) →
> region "Provenance ▸" (h2) → heading level 3 "Reproduce in R".

Good: a clean landmark-per-section outline with one `h1` and an `h2` per section (gated by
`report.spec.ts`), a real permalink, the preview banner as text (not colour alone), the ramp's text
equivalent again, and each flower SVG exposed as a named `group` ("Composite mean 40") rather than
an opaque image. The export bar is four plainly-named buttons — Print, Download HTML, Data package
(ZIP), Word document — all keyboard-operable (proven: the walk triggers "Download HTML" with Enter,
on three engines).

Wrong: **the progress line is silenced** (`aria-live="off"` overriding `role="status"`), so the one
message that says the multi-second build is running and then finished reaches nobody (fix list #4).
And the "Plot of Scores" tabs are half a tab widget — the role promises Arrow keys and a linked
panel, and delivers neither (fix list #13).

### Phone (390×844) — the `Sheet`

> region "Layers" → separator "Drag to resize the sheet" → heading level 2 "Layers" → group "Sheet
> size" → button "Collapse to a peek, expanded" / "Half height, pressed" / "Full height" → region
> "Layers details" → …

The sheet's drag handle is a named `separator` with real keyboard-operable detent buttons beside
it, so the drag gesture is never the only way (SC 2.5.1). Its body **is** named
(`region "Layers details"`) — which is exactly what the desktop panel is missing. Esc collapses to
peek and moves focus to the collapse control, never `<body>` (`gallery.spec.ts`).

### What a screen-reader user cannot do at all today

1. Learn that the zones table is the map's equivalent, from the map (#9).
2. Read a **cell**-level value (only the map-click popup shows it, and it is never announced) (#12).
3. Search for a species with any expectation of feedback (#8).
4. Know that `report.html` is building, or that it finished (#4).

---

## 5. Not yet verified — stated plainly

These are **not** claims of conformance. They are gaps in the evidence.

1. **No real screen reader has been run.** VoiceOver (macOS/iOS) and NVDA (Windows) notes in §4 are
   derived from the computed accessibility tree, not from a session with either product. Announcement
   _order_, verbosity, and the behaviour of VoiceOver's own rotor/quick-nav over this page are
   unverified. This is the largest single gap in this note.
2. **Criteria with no test at all:** 1.3.2 Meaningful Sequence, 1.3.3 Sensory Characteristics,
   1.3.4 Orientation, 2.2.2 Pause/Stop/Hide, 2.4.4 Link Purpose, 2.5.2 Pointer Cancellation,
   2.5.3 Label in Name, 3.1.1 Language of Page, 3.2.2 On Input, 3.2.4 Consistent Identification.
3. **The `.docx` export** is not evaluated for tagged structure, alt text or reading order (§3.3).
4. **Zoom to 400 % in a real browser** is inferred from the 320 CSS px reflow gate, not measured as
   a zoom.
5. **Windows High Contrast** is tested through Playwright's `forcedColors: "active"` emulation, not
   on real Windows.
6. **The gallery's own axe `incomplete` triage** and the shell's are pinned by node count and
   reason rather than resolved; the underlying contrast is gated independently by
   `scripts/contrast.mjs`, but axe itself cannot see through a WebGL canvas and that is recorded,
   not fixed.
7. **The phone floating legend** is `display: none` below 900 px, so the ramp's text equivalent is
   absent there; no test asserts an alternative exists.

## 6. Open defects

All fourteen are in [`docs/accessibility-fixes.md`](./accessibility-fixes.md), each with its SC,
file:line, what a user experiences, the fix, a severity, and — for seven of them — a failing test
already committed in `e2e/keyboard-walk.spec.ts`. This note will be revised, and the conformance
claim re-stated, after that round and its re-audit.
