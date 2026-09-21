import { test, expect, type Page, type Response } from "@playwright/test";
import { CASES, type CaseName } from "../src/cases";

// atlas-0 S3 spike: candidate (a) DuckDB-WASM-over-tiled-cell_metric vs candidate (b) geotiff
// windowed COG reads. Raw measurements only -- see spikes/3/RESULTS.md for the numbers this spec
// prints; no verdict is drawn here (plan S3 paragraph: "Verdict feeds atlas-1", not this spec).
//
// Every case gets a FRESH BrowserContext (empty HTTP cache) so "bytes/requests/ms" reflects a cold
// first visit. Requests are categorised by URL shape, not by "before/after init resolved" timing
// -- a timing split raced against duckdb-wasm's OWN lazy fetches (its parquet extension loads from
// extensions.duckdb.org on the first `read_parquet` call, i.e. inside the timed query, not inside
// `initA()`) and against geotiff's lazily-imported compression codec chunks, so a phase flag
// mislabels exactly the costs this spec exists to separate. Categories:
//   runtime_js   -- our own bundle + duckdb-wasm's self-hosted worker/wasm (one-time, same-origin)
//   duckdb_ext   -- duckdb-wasm's remote parquet extension (one-time per session, NOT self-hosted)
//   tile_data    -- candidate (a)'s tile parquet fetches (same-origin /app/cell/tile=...)
//   cog_data     -- candidate (b)'s COG range reads (s3.us-east-1.amazonaws.com)
//   other        -- anything else (should be empty; surfaced instead of silently dropped)

interface NetEntry {
  url: string;
  status: number;
  bytes: number;
}

type Category = "runtime_js" | "duckdb_ext" | "tile_data" | "cog_data" | "other";

function categorize(url: string): Category {
  if (url.includes("extensions.duckdb.org")) return "duckdb_ext";
  if (url.includes("/app/cell/tile=")) return "tile_data";
  if (url.includes("s3.us-east-1.amazonaws.com")) return "cog_data";
  if (/\.(js|wasm|html|css)(\?|$)/.test(url) || url.includes("/src/")) return "runtime_js";
  return "other";
}

function trackNetwork(page: Page) {
  const entries: NetEntry[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (resp: Response) => {
    const p = resp
      .body()
      .then((b) => b.length)
      .catch(() => 0)
      .then((bytes) => {
        entries.push({ url: resp.url(), status: resp.status(), bytes });
      });
    pending.push(p);
  });
  return {
    // must be awaited before reading `entries` -- response bodies resolve asynchronously and a
    // request started right before the timed call returns can otherwise be dropped mid-read.
    flush: () => Promise.all(pending).then(() => undefined),
    entries,
  };
}

function byCategory(entries: NetEntry[]): Record<Category, { requests: number; bytes: number }> {
  const out: Record<Category, { requests: number; bytes: number }> = {
    runtime_js: { requests: 0, bytes: 0 },
    duckdb_ext: { requests: 0, bytes: 0 },
    tile_data: { requests: 0, bytes: 0 },
    cog_data: { requests: 0, bytes: 0 },
    other: { requests: 0, bytes: 0 },
  };
  for (const e of entries) {
    const c = categorize(e.url);
    out[c].requests += 1;
    out[c].bytes += e.bytes;
  }
  return out;
}

async function ready(page: Page) {
  await page.waitForFunction(() => "__spike3" in window);
}

const CASE_NAMES: CaseName[] = ["click", "poly2", "polypra"];
const FAULT_OFFSET = Number(process.env.SPIKE3_FAULT_OFFSET ?? 0);

test.describe("candidate (a): DuckDB-WASM over tiled cell_metric", () => {
  for (const caseName of CASE_NAMES) {
    test(`bytes/requests/ms -- ${caseName} (${CASES[caseName].label})`, async ({ page }) => {
      const net = trackNetwork(page);
      await page.goto("/index.html");
      await ready(page);
      await page.evaluate(() => window.__spike3.initA());
      const result = await page.evaluate((c) => window.__spike3.runA(c), caseName);
      await net.flush();

      expect(result.rowCount).toBeGreaterThan(0);

      const cat = byCategory(net.entries);
      console.log(
        `[S3][a][${caseName}] ms=${result.ms.toFixed(1)} rows=${result.rowCount} ` +
          `tilesNeeded=${JSON.stringify(result.tiles)} tilesFetched=${JSON.stringify(result.fetchedTiles)} ` +
          `runtime_js={req:${cat.runtime_js.requests},bytes:${cat.runtime_js.bytes}} ` +
          `duckdb_ext={req:${cat.duckdb_ext.requests},bytes:${cat.duckdb_ext.bytes}} ` +
          `tile_data={req:${cat.tile_data.requests},bytes:${cat.tile_data.bytes}} ` +
          `other={req:${cat.other.requests},bytes:${cat.other.bytes}}`,
      );
    });
  }
});

test.describe("candidate (b): geotiff windowed reads over published score COGs", () => {
  for (const caseName of CASE_NAMES) {
    test(`bytes/requests/ms -- ${caseName} (${CASES[caseName].label})`, async ({ page }) => {
      const net = trackNetwork(page);
      await page.goto("/index.html");
      await ready(page);
      await page.evaluate(() => window.__spike3.initB());
      const result = await page.evaluate((c) => window.__spike3.runB(c), caseName);
      await net.flush();

      expect(result.metricCount).toBe(8);

      const cat = byCategory(net.entries);
      console.log(
        `[S3][b][${caseName}] ms=${result.ms.toFixed(1)} metrics=${result.metricCount} pixels=${result.pixelCount} ` +
          `runtime_js={req:${cat.runtime_js.requests},bytes:${cat.runtime_js.bytes}} ` +
          `cog_data={req:${cat.cog_data.requests},bytes:${cat.cog_data.bytes}} ` +
          `other={req:${cat.other.requests},bytes:${cat.other.bytes}}`,
      );
    });
  }
});

test.describe("(a) vs (b) agreement", () => {
  for (const caseName of CASE_NAMES) {
    const faultNote = FAULT_OFFSET ? ` [SEEDED FAULT: candidate (b) row offset=${FAULT_OFFSET}]` : "";
    test(`(a) doubles and (b) float32 agree at the probe cells -- ${caseName}${faultNote}`, async ({ page }) => {
      await page.goto("/index.html");
      await ready(page);
      await page.evaluate(() => window.__spike3.initA());
      const result = await page.evaluate(
        ([c, offsetB]) => window.__spike3.compare(c, 0, offsetB),
        [caseName, FAULT_OFFSET] as [CaseName, number],
      );

      console.log(
        `[S3][compare][${caseName}] n=${result.stats.n} maxAbsDelta=${result.stats.maxAbsDelta} ` +
          `p99AbsDelta=${result.stats.p99AbsDelta} p50AbsDelta=${result.stats.p50AbsDelta} ` +
          `meanAbsDelta=${result.stats.meanAbsDelta} maxAt=${JSON.stringify(result.stats.maxAt)}`,
      );

      expect(result.stats.n).toBeGreaterThan(0);
      // float32 precision at these magnitudes (values 0-100, float32 has ~7 significant digits)
      // is ~1e-5; 1e-3 leaves margin. A real 1-cell misalignment (SPIKE3_FAULT_OFFSET=1) makes
      // maxAbsDelta jump to the scale of the underlying values themselves (up to ~100) -- proof
      // this assertion can see a misalignment (Review checklist: "a check that cannot fail is not
      // a check").
      expect(result.stats.maxAbsDelta).toBeLessThan(1e-3);
    });
  }
});
