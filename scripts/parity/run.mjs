#!/usr/bin/env node
// scripts/parity/run.mjs -- the atlas-2 parity gate.
//
// Runs the REAL `sql/*.sql` twins, through the REAL `src/lib/analysis/queries.ts` orchestration,
// against a release's published objects, and diffs the answers against what msens produced in
// `tests/fixtures/parity/{ver}/*.json` (written by `scripts/parity/fixtures.R`).
//
// It executes the SAME FILES the browser runs -- nothing here re-types a query -- so a change to a
// twin is either reproduced by R or it is a red gate. The only thing that differs from the browser
// is the plumbing under `exec()`: here it is the DuckDB CLI over local/HTTP Parquet, there it is
// DuckDB-WASM over `fetch`ed and registered buffers. `tests/fixtures/parity-e2e/` closes that gap by
// running one of each query through the real WASM engine with `extensions.duckdb.org` blocked.
//
// Usage:
//   node scripts/parity/run.mjs [v9 v7] [--base <dir-or-url>] [--sql-dir <dir>] [--verbose]
//
// `--base` is the release ROOT that holds `{ver}/app/`, `{ver}/serve/` and `{ver}/tables/` -- a
// local mirror by default (see `scripts/parity/mirror.mjs`), the bucket after the push:
//   node scripts/parity/run.mjs v9 --base https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/
// `--sql-dir` points the harness at a COPY of `sql/` -- how every seeded fault in this repo's
// review is demonstrated without touching the committed twins.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureMirror } from "./mirror.mjs";
// side effect only, and it MUST come before the app's TypeScript is imported (see the file's own
// header): a resolve hook that lets Node read this repo's bundler-style extensionless imports
import "./ts-resolve.mjs";

// dynamic, so the hook above is registered first -- static imports hoist above every statement
const { batchTiles, placeCells, tilesForCells } = await import("../../src/lib/analysis/place.ts");
const {
  cellComponents,
  componentMetricKeys,
  composition,
  createPlaceCells,
  createStudyAreaCells,
  meanScore,
  scoresForCells,
  speciesForCells,
  speciesForZone,
  cellModelKeySql,
} = await import("../../src/lib/analysis/queries.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATE_NAMES = [
  "cell_components",
  "cell_model_key",
  "cell_model_seq",
  "cells_in_study_area",
  "composition",
  "scores_for_cells",
  "species_for_cells",
  "species_for_zone",
  "species_shares",
];

// the gate: max|delta| on every quantity the plan names, on v7 AND v9
const TOL = 1e-9;
const TRACING_TOL = 0.5;

// ---- argv --------------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { vers: [], base: null, sqlDir: path.join(ROOT, "sql"), verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--sql-dir") out.sqlDir = path.resolve(argv[++i]);
    else if (a === "--verbose") out.verbose = true;
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else out.vers.push(a);
  }
  if (!out.vers.length) out.vers = ["v9", "v7"];
  return out;
}

// ---- the DuckDB CLI as a SqlRunner --------------------------------------------------------------

class DuckdbCli {
  constructor(dbPath, opts = {}) {
    this.dbPath = dbPath;
    this.verbose = opts.verbose === true;
    this.httpfs = opts.httpfs === true;
    if (this.httpfs) this.#raw("INSTALL httpfs; LOAD httpfs;");
  }

  // stderr is CAPTURED, not inherited: `queries.ts`'s `dropBoth()` deliberately attempts a drop
  // that may fail, and an inherited stderr would print a "Catalog Error" for each one in the
  // middle of a gate's output. `spawnSync`, not `execFileSync`, precisely so the captured stderr
  // can be INSPECTED afterwards -- the CLI does not always exit non-zero on a statement error.
  #raw(sql) {
    const r = spawnSync("duckdb", [this.dbPath, "-json"], {
      input: sql,
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    if (r.error) throw r.error;
    this.stderr = r.stderr ?? "";
    if (r.status !== 0) {
      const err = new Error(`duckdb exited ${r.status}`);
      err.stderr = this.stderr;
      throw err;
    }
    return r.stdout ?? "";
  }

  lastStderr() {
    return this.stderr ?? "";
  }

  // one statement per invocation: `-json` then prints exactly one array, which needs no framing
  async exec(sql) {
    const text = sql.trim().replace(/;\s*$/, "");
    if (this.verbose) console.error(`  sql> ${text.slice(0, 140).replace(/\s+/g, " ")}`);
    let out;
    try {
      out = this.#raw(`${text};`);
    } catch (err) {
      const stderr = err.stderr ? String(err.stderr) : String(err);
      throw new Error(`duckdb failed:\n${stderr}\n--- sql ---\n${text.slice(0, 2000)}`, {
        cause: err,
      });
    }
    // The CLI does not always exit non-zero on a statement error (a failed DROP does not), so a
    // captured stderr must be inspected as well -- otherwise a statement could fail and the gate
    // would read its empty output as "no rows" and pass.
    const stderr = this.lastStderr();
    if (/^[A-Za-z ]*Error:/m.test(stderr))
      throw new Error(`duckdb failed:\n${stderr}\n--- sql ---\n${text.slice(0, 2000)}`);
    const trimmed = out.trim();
    if (!trimmed) return [];
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`duckdb returned non-JSON:\n${trimmed.slice(0, 500)}`);
    }
  }
}

// ---- the release's objects, as views --------------------------------------------------------

/** a FROM source for one published path under `{base}{ver}/` -- a local file or an https URL. */
function sourceOf(base, ver, rel) {
  const p = /^https?:/.test(base)
    ? new URL(`${ver}/${rel}`, base.endsWith("/") ? base : `${base}/`).href
    : path.join(base, ver, rel);
  return `read_parquet('${p.replace(/'/g, "''")}')`;
}

/** `{ver}/app/boot.json` -- the release's own description of itself (grid, id_field, layers). */
async function readBoot(base, ver) {
  if (/^https?:/.test(base)) {
    const url = new URL(`${ver}/app/boot.json`, base.endsWith("/") ? base : `${base}/`).href;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`boot.json ${resp.status} at ${url}`);
    return resp.json();
  }
  return JSON.parse(fs.readFileSync(path.join(base, ver, "app/boot.json"), "utf8"));
}

function view(db, name, sources) {
  return db.exec(
    `CREATE OR REPLACE VIEW "${name}" AS ${sources.map((s) => `SELECT * FROM ${s}`).join(" UNION ALL BY NAME ")};`,
  );
}

async function mountRelease(db, base, ver, boot) {
  await view(db, "taxon", [sourceOf(base, ver, "app/taxon.parquet")]);
  await view(db, "zone_taxon", [sourceOf(base, ver, "app/zone_taxon.parquet")]);
  await view(db, "taxonomy", [sourceOf(base, ver, "app/taxonomy.parquet")]);
  if (boot.id_field === "mdl_key")
    await view(db, "model", [sourceOf(base, ver, "tables/model.parquet")]);
}

const cellTiles = (db, base, ver, tiles) =>
  view(
    db,
    "cell",
    tiles.map((t) => sourceOf(base, ver, `app/cell/tile=${t}/data_0.parquet`)),
  );

/** one batch of cell_model tiles, plus the `cell_model_key` twin `boot.id_field` selects. */
async function cellModelTiles(db, base, ver, boot, templates, tiles) {
  await view(
    db,
    "cell_model",
    tiles.map((t) => sourceOf(base, ver, `serve/cell_model/tile=${t}/data_0.parquet`)),
  );
  // created AFTER `cell_model` exists: DuckDB binds a view body at CREATE time, so the generation
  // branch cannot be mounted up front (`src/lib/analysis/sources.ts` does the same, in the same order)
  await db.exec(
    `CREATE OR REPLACE VIEW cell_model_key AS ${cellModelKeySql(templates, boot.id_field).replace(/;\s*$/, "").trimEnd()};`,
  );
}

// ---- diffing -------------------------------------------------------------------------------------

class Report {
  constructor() {
    this.max = new Map();
    this.failures = [];
    this.lines = [];
  }
  delta(quantity, value, where) {
    const prev = this.max.get(quantity);
    if (!prev || value > prev.value) this.max.set(quantity, { value, where });
  }
  fail(msg) {
    this.failures.push(msg);
  }
  check(cond, msg) {
    if (!cond) this.fail(msg);
    return cond;
  }
  line(s) {
    this.lines.push(s);
  }
}

const num = (v) => (v === null || v === undefined ? NaN : Number(v));

/** row-for-row diff of two tables keyed by `key`, over `quantities`. */
function diffRows(rep, label, key, quantities, got, want) {
  if (
    !rep.check(got.length === want.length, `${label}: row count ${got.length} != R ${want.length}`)
  )
    return;
  const byKey = new Map(got.map((r) => [String(r[key]), r]));
  for (const w of want) {
    const g = byKey.get(String(w[key]));
    if (!rep.check(g !== undefined, `${label}: R row ${key}=${w[key]} missing from the SQL result`))
      continue;
    for (const q of quantities) {
      const a = num(g[q]);
      const b = num(w[q]);
      if (Number.isNaN(a) && Number.isNaN(b)) continue;
      const d = Math.abs(a - b);
      rep.delta(q, d, `${label} ${key}=${w[key]}`);
      if (!(d < TOL))
        rep.fail(`${label}: ${q} ${key}=${w[key]} delta ${d.toExponential(3)} >= ${TOL}`);
    }
  }
}

// ---- one version ---------------------------------------------------------------------------------

async function runVersion(ver, opts, templates) {
  const rep = new Report();
  const fixDir = path.join(ROOT, "tests/fixtures/parity", ver);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(fixDir, f), "utf8"));
  const base = opts.base;
  const boot = await readBoot(base, ver);
  const grid = {
    gridId: boot.grid.grid_id,
    nc: boot.grid.nc,
    nr: boot.grid.nr,
    xmin: boot.grid.xmin,
    ymax: boot.grid.ymax,
    resx: boot.grid.resx,
    resy: boot.grid.resy,
    lon360: boot.grid.lon360 === true,
    tileSize: boot.grid.tile.size,
  };
  const metricKeys = componentMetricKeys(boot);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `parity-${ver}-`));
  const db = new DuckdbCli(path.join(tmp, "parity.duckdb"), {
    verbose: opts.verbose,
    httpfs: /^https?:/.test(base),
  });
  await mountRelease(db, base, ver, boot);

  // --- species for 3 zones
  for (const z of read("species_zone.json")) {
    const got = await speciesForZone(db, templates, {
      zoneFld: z.zone_fld,
      zoneValue: z.zone_value,
    });
    diffRows(
      rep,
      `species_zone ${z.zone_fld}=${z.zone_value}`,
      "mdl_key",
      ["area_km2", "avg_suit", "pct_cat"],
      got,
      z.rows,
    );
    rep.line(`  species_for_zone ${z.zone_fld}=${z.zone_value}: ${got.length} rows (R ${z.n})`);

    // --- composition rides on the same selection (the treemap describes what the table shows)
    const cmp = read("composition.json");
    if (cmp.zone_fld === z.zone_fld && cmp.zone_value === z.zone_value) {
      const rows = await composition(db, templates);
      diffRows(rep, "composition", "mdl_key", ["suit_er_area"], rows, cmp.rows);
      const byKey = new Map(rows.map((r) => [String(r.mdl_key), r]));
      for (const w of cmp.rows) {
        const g = byKey.get(String(w.mdl_key));
        if (!g) continue;
        for (const rank of ["kingdom", "phylum", "class"])
          rep.check(
            String(g[rank]) === String(w[rank]),
            `composition: ${rank} for ${w.mdl_key} is "${g[rank]}", R says "${w[rank]}"`,
          );
      }
      rep.line(`  composition ${cmp.zone_fld}=${cmp.zone_value}: ${rows.length} rows (R ${cmp.n})`);
    }
  }

  // --- species for 5 single cells, and the same cells as the click popup
  const comps = read("cell_components.json");
  for (const c of read("species_cell.json")) {
    const tile = tilesForCells([{ cell_id: c.cell_id, pct: 100 }], grid);
    await cellTiles(db, base, ver, tile);
    await createPlaceCells(db, [{ cell_id: c.cell_id, pct: 100 }]);
    const nSa = await createStudyAreaCells(db, templates);
    const got = await speciesForCells(db, templates, {
      batches: batchTiles(tile),
      mount: (tiles) => cellModelTiles(db, base, ver, boot, templates, tiles),
    });
    diffRows(
      rep,
      `species_cell ${c.cell_id}`,
      "mdl_key",
      ["area_km2", "avg_suit", "pct_cat"],
      got,
      c.rows,
    );
    rep.line(
      `  species_for_cells cell ${c.cell_id}: ${got.length} rows (R ${c.n}), ${nSa} cell(s) in study area`,
    );

    const want = comps.find((x) => x.cell_id === c.cell_id);
    if (want) {
      const rows = await cellComponents(db, templates, { cellId: c.cell_id, metricKeys });
      // a single cell's component VALUE is its blended score (pct 100): the degeneration asserted
      const got2 = rows
        .filter((r) => r.val !== null)
        .map((r) => ({ metric_key: r.metric_key, score: r.val }));
      diffRows(rep, `cell_components ${c.cell_id}`, "metric_key", ["score"], got2, want.rows);
    }
  }

  // --- scores for the 3 polygon fixtures
  for (const s of read("scores.json")) {
    const fx = JSON.parse(
      fs.readFileSync(path.join(ROOT, "tests/fixtures/places", `${s.fixture}.json`), "utf8"),
    );
    const cells = placeCells(fx.unwrapped ?? fx.geometry, grid);
    rep.check(
      cells.length === s.n_cells,
      `scores ${s.fixture}: coverage gave ${cells.length} cells, R gave ${s.n_cells}`,
    );
    await cellTiles(db, base, ver, tilesForCells(cells, grid));
    await createPlaceCells(db, cells);
    const nSa = await createStudyAreaCells(db, templates);
    rep.check(
      nSa === s.n_cells_sa,
      `scores ${s.fixture}: study-area clip kept ${nSa} cells, R kept ${s.n_cells_sa}`,
    );
    const got = await scoresForCells(db, templates, { metricKeys });
    diffRows(
      rep,
      `scores ${s.fixture}`,
      "metric_key",
      ["score", "coverage", "mean_where_present"],
      got,
      s.rows,
    );
    const composite = meanScore(got);
    if (Number.isFinite(s.composite)) {
      const d = Math.abs(composite - s.composite);
      rep.delta("composite", d, `scores ${s.fixture}`);
      rep.check(d < TOL, `scores ${s.fixture}: composite delta ${d.toExponential(3)} >= ${TOL}`);
    }
    rep.line(
      `  scores_for_cells ${s.fixture}: ${cells.length} cells -> ${nSa} in study area, ` +
        `${got.length} components, composite ${composite.toFixed(6)} (R ${Number(s.composite).toFixed(6)})`,
    );
  }

  // --- the Program-Area tracing gate
  const tr = read("tracing.json");
  {
    // POSITIVE: the traced GAA outline reproduces its published composite within 0.5, but ONLY on
    // the release whose Program-Area vintage matches the fixture (v9: 14,238 cells; v7 published
    // 14,256 from its own outline, so the traced case is recorded and not asserted there).
    const fx = JSON.parse(
      fs.readFileSync(path.join(ROOT, "tests/fixtures/places/programarea_gaa.json"), "utf8"),
    );
    const cells = placeCells(fx.geometry, grid);
    await cellTiles(db, base, ver, tilesForCells(cells, grid));
    await createPlaceCells(db, cells);
    await createStudyAreaCells(db, templates);
    const got = await scoresForCells(db, templates, { metricKeys });
    const pub = new Map(tr.gaa.published.map((p) => [p.metric_key, Number(p.score)]));
    let worst = 0;
    let worstKey = "";
    for (const r of got) {
      const p = pub.get(r.metric_key);
      if (p === undefined) continue;
      const d = Math.abs(Number(r.score) - p);
      if (d > worst) {
        worst = d;
        worstKey = r.metric_key;
      }
    }
    rep.delta("GAA vs published", worst, worstKey);
    rep.line(
      `  tracing GAA: ${cells.length} cells, max|delta| vs published ${worst.toFixed(4)} (${worstKey})` +
        (tr.gaa.assert ? "" : "  [recorded, not asserted: the outline is v9's vintage]"),
    );
    if (tr.gaa.assert)
      rep.check(
        worst < TRACING_TOL,
        `tracing GAA: max|delta| ${worst.toFixed(4)} >= ${TRACING_TOL} on ${worstKey}`,
      );
  }
  {
    // THE RED SIDE: GEO. `mean_where_present` IS the old, unblended formula (calc.R:328), so the
    // same result row carries both. The blend must be close; the old formula must be far. If a
    // twin ever silently loses the blend, `score` becomes `mean_where_present` and BOTH assertions
    // below fail at once.
    const cells = tr.geo.cell_id.map((id, i) => ({ cell_id: id, pct: tr.geo.pct_covered[i] }));
    await cellTiles(db, base, ver, tilesForCells(cells, grid));
    await createPlaceCells(db, cells);
    await createStudyAreaCells(db, templates);
    const got = await scoresForCells(db, templates, { metricKeys });
    diffRows(
      rep,
      "tracing GEO",
      "metric_key",
      ["score", "coverage", "mean_where_present"],
      got,
      tr.geo.rows,
    );
    const pub = new Map(tr.geo.published.map((p) => [p.metric_key, Number(p.score)]));
    let blendWorst = 0;
    let oldWorst = 0;
    let oldKey = "";
    for (const r of got) {
      const p = pub.get(r.metric_key);
      if (p === undefined) continue;
      blendWorst = Math.max(blendWorst, Math.abs(Number(r.score) - p));
      const d = Math.abs(Number(r.mean_where_present) - p);
      if (d > oldWorst) {
        oldWorst = d;
        oldKey = r.metric_key;
      }
    }
    const margin = Number(tr.geo.old_formula_max_abs_delta);
    rep.line(
      `  tracing GEO: ${cells.length} cells, blended max|delta| ${blendWorst.toFixed(4)}, ` +
        `OLD formula ${oldWorst.toFixed(4)} on ${oldKey} (R measured ${margin.toFixed(4)})`,
    );
    rep.check(
      blendWorst < TRACING_TOL,
      `tracing GEO: the BLENDED score misses the published zone_metric by ${blendWorst.toFixed(4)} >= ${TRACING_TOL}`,
    );
    rep.check(
      oldWorst >= margin - TOL,
      `tracing GEO: the OLD formula only misses by ${oldWorst.toFixed(4)}, R measured ${margin.toFixed(4)} ` +
        `-- the blend has been lost from sql/scores_for_cells.sql`,
    );
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  return rep;
}

// ---- main ----------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const templates = Object.fromEntries(
    TEMPLATE_NAMES.map((n) => [n, fs.readFileSync(path.join(opts.sqlDir, `${n}.sql`), "utf8")]),
  );
  if (!opts.base) opts.base = ensureMirror(opts.vers);
  console.log(`parity: base=${opts.base}  sql=${path.relative(ROOT, opts.sqlDir) || "sql"}`);

  let bad = 0;
  for (const ver of opts.vers) {
    console.log(`\n== ${ver}`);
    const rep = await runVersion(ver, opts, templates);
    for (const l of rep.lines) console.log(l);
    console.log("  max|delta| per quantity:");
    for (const [q, { value, where }] of [...rep.max].sort())
      console.log(`    ${q.padEnd(20)} ${value.toExponential(3).padStart(11)}   ${where}`);
    if (rep.failures.length) {
      bad = 1;
      console.log(`  FAIL (${rep.failures.length}):`);
      for (const f of rep.failures.slice(0, 20)) console.log(`    - ${f}`);
      if (rep.failures.length > 20) console.log(`    ... and ${rep.failures.length - 20} more`);
    } else {
      console.log(`  PASS  (max|delta| < ${TOL} on every quantity)`);
    }
  }
  process.exit(bad);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
