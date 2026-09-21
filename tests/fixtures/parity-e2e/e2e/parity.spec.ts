// One of each SQL twin, through the REAL DuckDB-WASM engine, with extensions.duckdb.org BLOCKED.
//
// `scripts/parity/run.mjs` already diffs every twin against msens under the DuckDB CLI. What it
// cannot prove is that the SAME files answer the SAME numbers inside the browser -- a different
// DuckDB build, reading `registerFileBuffer`d buffers rather than local paths, through a worker,
// with the parquet extension loaded from the same-origin mirror. That is this spec, and it asserts
// against the very same `tests/fixtures/parity/{ver}/*.json` R wrote.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { RunResult } from "../main";

const TOL = 1e-9;
const VER = "v9";
const DATA_BASE = "http://127.0.0.1:4441/";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../parity/${VER}/${name}.json`, import.meta.url), "utf8"));
const place = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../places/${name}.json`, import.meta.url), "utf8"));

/** max|delta| of `field` between two row sets matched on `key`, and the key it happened on. */
function worst(
  got: Record<string, unknown>[],
  want: Record<string, unknown>[],
  key: string,
  field: string,
): { value: number; where: string } {
  const by = new Map(got.map((r) => [String(r[key]), r]));
  let value = 0;
  let where = "";
  for (const w of want) {
    const g = by.get(String(w[key]));
    expect(g, `row ${key}=${w[key]} missing from the browser result`).toBeDefined();
    const d = Math.abs(Number(g![field]) - Number(w[field]));
    if (d > value) {
      value = d;
      where = String(w[key]);
    }
  }
  return { value, where };
}

test("every SQL twin answers msens's numbers inside DuckDB-WASM, CDN blocked", async ({ page }) => {
  // the seeded-fault control for this very gate lives in tests/fixtures/engine-e2e/e2e/
  // extension-unset.spec.ts: with the mirror unset AND this route blocked, the engine fails. Here
  // the mirror IS set, so blocking the CDN must change nothing at all.
  let cdnHits = 0;
  await page.route("**/extensions.duckdb.org/**", (r) => {
    cdnHits += 1;
    return r.abort();
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__parityTest?.run === "function");

  const zoneFx = fixture("species_zone")[0];
  const cellFx = fixture("species_cell")[0];
  const scoresFx = fixture("scores").find(
    (s: { fixture: string }) => s.fixture === "gulf_rectangle",
  );
  const compsFx = fixture("cell_components").find(
    (c: { cell_id: number }) => c.cell_id === cellFx.cell_id,
  );
  const compositionFx = fixture("composition");

  const res: RunResult = await page.evaluate((args) => window.__parityTest.run(args), {
    base: DATA_BASE,
    ver: VER,
    zone: { fld: zoneFx.zone_fld, value: zoneFx.zone_value },
    cellId: cellFx.cell_id,
    place: { geometry: place("gulf_rectangle").geometry },
  });

  expect(res.error ?? "").toBe("");
  expect(res.ok).toBe(true);
  expect(res.idField, "v9 is the mdl_id -> model branch").toBe("mdl_key");

  // --- species_for_zone.sql + species_shares.sql
  expect(res.speciesZone).toHaveLength(zoneFx.n);
  for (const f of ["area_km2", "avg_suit", "pct_cat"]) {
    const w = worst(res.speciesZone as never, zoneFx.rows, "mdl_key", f);
    console.log(`  species_zone ${f}: max|delta| ${w.value.toExponential(3)} (${w.where})`);
    expect(w.value).toBeLessThan(TOL);
  }

  // --- composition.sql (the treemap's taxonomy join, over that same selection)
  expect(res.composition).toHaveLength(compositionFx.n);
  {
    const w = worst(res.composition as never, compositionFx.rows, "mdl_key", "suit_er_area");
    console.log(`  composition suit_er_area: max|delta| ${w.value.toExponential(3)} (${w.where})`);
    expect(w.value).toBeLessThan(TOL);
    const by = new Map(
      (res.composition as Record<string, unknown>[]).map((r) => [String(r.mdl_key), r]),
    );
    for (const row of compositionFx.rows.slice(0, 50))
      for (const rank of ["kingdom", "phylum", "class"])
        expect(String(by.get(String(row.mdl_key))![rank])).toBe(String(row[rank]));
  }

  // --- scores_for_cells.sql (the blend, over the study-area-clipped cell set)
  expect(res.nCells).toBe(scoresFx.n_cells);
  expect(res.nCellsStudyArea).toBe(scoresFx.n_cells_sa);
  expect(res.scores).toHaveLength(scoresFx.n);
  for (const f of ["score", "coverage", "mean_where_present"]) {
    const w = worst(res.scores as never, scoresFx.rows, "metric_key", f);
    console.log(`  scores ${f}: max|delta| ${w.value.toExponential(3)} (${w.where})`);
    expect(w.value).toBeLessThan(TOL);
  }
  expect(Math.abs((res.composite ?? NaN) - scoresFx.composite)).toBeLessThan(TOL);

  // --- cell_components.sql (one clicked cell; its value IS its single-cell blended score)
  {
    const got = (res.cellComponents as Record<string, unknown>[])
      .filter((r) => r.val !== null)
      .map((r) => ({ metric_key: r.metric_key, score: r.val }));
    expect(got).toHaveLength(compsFx.n);
    const w = worst(got as never, compsFx.rows, "metric_key", "score");
    console.log(`  cell_components: max|delta| ${w.value.toExponential(3)} (${w.where})`);
    expect(w.value).toBeLessThan(TOL);
  }

  // --- species_for_cells.sql, through the batched, bounded-memory path
  expect(res.nCellModelBatches).toBeGreaterThanOrEqual(1);
  expect(res.speciesCell).toHaveLength(cellFx.n);
  for (const f of ["area_km2", "avg_suit", "pct_cat"]) {
    const w = worst(res.speciesCell as never, cellFx.rows, "mdl_key", f);
    console.log(`  species_cell ${f}: max|delta| ${w.value.toExponential(3)} (${w.where})`);
    expect(w.value).toBeLessThan(TOL);
  }

  expect(errors, "no console error or page error").toEqual([]);
  console.log(`  extensions.duckdb.org requests blocked: ${cdnHits} (the mirror served instead)`);
});
