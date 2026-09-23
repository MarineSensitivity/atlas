# The report data model (`src/lib/report/`)

atlas-7 step 1. One pure function, `buildReport()`, from `(release, places)` to a plain
`ReportModel` whose every number equals what R produces for the same places. Steps 2-3 (the
document, the print stylesheet, the HTML/ZIP/DOCX exporters) render _this object_ and derive nothing
of their own.

## The contract

```ts
buildReport({ ver, boot, places, tables, now, appSha, ... }) -> ReportModel
```

- **Pure and synchronous.** It fetches nothing and queries nothing. The caller runs the queries and
  hands back their results on each `ReportPlaceInput`.
- **Every result is nullable.** `scores: null` and `species: null` mean "still running", and the
  model answers with the sections that _can_ be built. That is what makes step 2's progressive
  rendering a rendering concern rather than a second model.
- **No second copy of anything.** The flowers go through the scores lens's own
  `dedupeFlowerComponents()` + `computeFlowerGeometrySafe()`; the categories through
  `lib/ui/categories.ts`; the permalink and the in-app links through `lib/state/codec.ts#formatSel`;
  the component labels through `lens/scores/flower.ts#componentLabel`; the dataset citations through
  the one `lib/release/cite.ts` path. The `sql/*.sql` twins are not read here at all - the caller
  ran them.

### Inputs

| field                                                                    | what                                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ver`                                                                    | the resolved release label                                                                                  |
| `boot`                                                                   | `boot.json`, parsed - the model reads `release`, `grid`, `zones`, `tables`, `datasets`, `built_at`, `msens` |
| `places`                                                                 | one `ReportPlaceInput` per **reported area**, in the URL's order                                            |
| `tables`                                                                 | the `boot.tables` keys this report read, for the provenance digests                                         |
| `now`, `appSha`                                                          | injected, never read from the environment (a model that reads the clock is not testable)                    |
| `title`, `preview`, `status`, `access`, `duckdbWasm`, `permalink`, `sql` | optional; `status`/`access` default to `boot.release.*`                                                     |

A `ReportPlaceInput` carries the `Place` (the `g1` union), its `token`, its display `name`, a custom
place's decoded `geometry`, and the two query results. `expandPlaces(places, boot)` turns the URL's
`Place[]` into those stubs, **splitting a multi-key zone place into one reported area per key** -
one row per area, exactly as the report it replaces had.

### Output

`ReportModel` mirrors the document's own order (atlas-7 sections 0-8):

| field        | section | what it holds                                                                                                                                                               |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `header`     | 0       | title, `ver / status / access` chip, generated stamp, permalink parts, `preview`, the PREVIEW banner + `PREVIEW_` file prefix on a restricted release, the export file stem |
| `intro`      | 1       | the boilerplate rewritten for "computed in your browser from release {ver}", plus relative links                                                                            |
| `parameters` | 2       | per place: name, kind, zone keys **or** vertex count, bbox, area, N cells, D7b's share inside the study area, token                                                         |
| `map`        | 3       | one `{name, score}` per place (`score` = `round(composite, 1)`) and the ramp `domain`                                                                                       |
| `flowers`    | 4       | one `FlowerGeometry` per place, its centre, what the ring could not draw, and two text summaries                                                                            |
| `scores`     | 5       | the `Area / N cells / components / Overall` table, plus the coverage footnotes                                                                                              |
| `species`    | 6       | per place: the `Category x ER category` counts, the top 20, the full list + CSV columns/filename                                                                            |
| `sources`    | 7       | the two paragraphs, the docs link and the dataset citations                                                                                                                 |
| `provenance` | 8       | ver/status/access, every table read with its digest, app SHA, DuckDB-WASM version, timestamp, the SQL that ran, and "Reproduce in R" per place                              |
| `summaries`  | -       | every figure's text equivalent, in document order (the accessibility gate reads this array)                                                                                 |

## The rules worth knowing

**The ramp spans the places in _this_ report.** `range()` over the places' rounded composites,
widened `+/- 0.5` when they are all equal (`report.qmd:159-160`). Without the widening a one-place
report has a zero-width domain and every interpolation against it divides by zero.

**`Overall` is the PLAIN mean of the components present** (`msens::mean_score()`, whose `even`
weights are all 1). A component with no value anywhere in a place has **no row** and is absent from
the mean - never a zero in it.

**Every component below 100 % coverage is footnoted** with its coverage and its mean where present
(D7b). `score = coverage * mean_where_present` is an identity of the blend, so "17.7" on a component
covering 1.4 % of a place means 17.7 blended from a mean of ~1,255 where it exists; printing 17.7
with no footnote implies 17.7 everywhere, which is what the old report did. A `null` coverage
footnotes **nothing**: "we cannot say" is not "it is complete".

**A zone place's coverage is derived, not published.** `boot.zones[...].metrics` carries both the
post-weight value and its `_prepctareaweighting` twin, and `coverage = post / pre`,
`mean_where_present = pre` - an identity of how `zone_metric` was built. That is what lets a zone
place carry the same footnotes a custom place does.

**The flower's centre is the table's `Overall`, not the drawn petals' mean.** On v8/v9
`primary producer` and `primprod` resolve to one category, so the ring draws seven petals for eight
components; both still feed the composite. A document whose flower centre and whose table disagree
by four points is a defect whatever the reason, so `centre = round(Overall)` and the petals' own
mean is reported separately as `centreOfDrawnPetals`, with `droppedLabels` naming what the ring
could not show.

**The model sorts; it does not trust its input's order.** The full species list is re-sorted by
`(sp_cat, sp_scientific)` and the top 20 by `suit_er_area` descending, both in C-locale/binary order
to match `dplyr::arrange()` and DuckDB. The numbers gate shuffles the fixture's rows before calling
`buildReport`, so those two sorts are what it measures.

**Two numbers that look like one.** A **zone** place reports its release's published `zone_metric`;
the **same area traced as a custom place** reports the D7b-clipped blend over its own cells. On v9
GAA that is 40.4484 published vs 40.4982 traced (+0.0498) - inside D7b's own 0.08-point bound, and
recorded in `tests/fixtures/report/v9/report_gaa.json`'s `traced_as_custom_place` block so a reader
can see which kind of place produced which.

## What steps 2-3 render from it

- **Step 2 (the document).** Each section maps to one field above; nothing is recomputed in a
  component. Progressive rendering is "render the fields that are not `null`, re-run `buildReport()`
  when another query lands" - the function is cheap and has no state.
- **Step 3 (print + exporters).** The print stylesheet needs `scores.footnotes` (they must not be
  clipped), `summaries` (the axe gate) and `header.previewBanner` (the diagonal watermark). The HTML
  and ZIP exporters need `species[].full` + `csvColumns` + `csvFilename`, `provenance` (into
  `provenance.json`), `sources.citations` (into `CITATION.md`) and `header.permalink.href` (into the
  `README.md` and the QR). The DOCX exporter (D9) needs the same tables plus `flowers[].geometry`.

## Where the numbers come from

`tests/fixtures/report/README.md` - six committed R fixtures (GAA, a drawn Gulf rectangle, the
Aleutian antimeridian box; v7 and v9), regenerated with `npm run report:fixtures`. Scores match
within `1e-9`; counts and the top-20 order match exactly. Six seeded faults
(`tests/lib/report/faults.ts`) prove each of those assertions can fail.

## Files

| file                           | what                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `src/lib/report/model.ts`      | `buildReport()`, `expandPlaces()`, `zoneComponents()`, `describeFlower()` |
| `src/lib/report/er.ts`         | `erConsolidate()` (ported verbatim) + the counts table                    |
| `src/lib/report/scores.ts`     | `overallScore()`, `scoresTable()` and the D7b footnotes                   |
| `src/lib/report/species.ts`    | the two sorts, the top-20 distinct, the CSV column list                   |
| `src/lib/report/ramp.ts`       | `mapScore()`, `rampDomain()`                                              |
| `src/lib/report/provenance.ts` | `tablesRead()`, `reproduceInR()`, `buildProvenance()`                     |
| `src/lib/report/format.ts`     | every display format, in one place                                        |
| `src/lib/release/cite.ts`      | the one dataset-citation path (NOT under `report/`, so a lens may use it) |
