// atlas-0 S4 spike, part (b) — does duckdb-wasm's `spatial` extension load, and does `ST_Read`
// on a registered .gpkg return the right feature count / bbox / vertex count, on BOTH
// @duckdb/duckdb-wasm 1.32.0 and the current `next` dist-tag, for each of the five fixtures?
//
// Fix round 1: the earlier version of this spec asserted structure only ("did the harness return
// something well-formed") because `instantiate()` hung on every cell. Root cause fixed in
// src/duckdb-gpkg-test.ts (a plain `new Worker(url)`, not duckdb-wasm's `createWorker()` helper —
// see that file's header comment). Every cell now asserts the REAL outcome against
// fixtures_manifest.json ground truth, same as e2e/correctness.spec.ts. Every stage inside
// runGpkgTest already carries its own hard timeout (src/duckdb-gpkg-test.ts's `withTimeout`);
// this spec's own (Playwright) per-test timeout (playwright.config.ts) is the second, outer hard
// timeout — either one turns a hang into a recorded, exact-stage failure, never a stall.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, "..", "fixtures", "fixtures_manifest.json"), "utf8"));

const FIXTURES = ["gulf_rectangle", "aleutian_dateline", "multipolygon", "utm_zone", "coastline_40k"] as const;
const VERSIONS = ["1.32.0", "next"] as const;

// which manifest field is the expected bbox for ST_Read's raw (never-reprojected — see
// correctness.spec.ts's utm_zone/flatgeobuf case for the same point) output, per fixture.
function expectedBboxFor(fixture: string): number[] {
  const m = manifest[fixture];
  if (fixture === "aleutian_dateline") return m.naive_bbox_raw_coords;
  if (fixture === "utm_zone") return m.bbox_utm_metres;
  return m.bbox;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__spike4 !== undefined);
});

for (const version of VERSIONS) {
  for (const fixture of FIXTURES) {
    test(`duckdb-wasm ${version}: spatial + ST_Read(${fixture}.gpkg)`, async ({ page }) => {
      let totalNetworkBytes = 0;
      const perUrl: Record<string, number> = {};
      page.on("response", async (resp) => {
        try {
          const buf = await resp.body();
          perUrl[resp.url()] = buf.length;
          totalNetworkBytes += buf.length;
        } catch {
          // opaque/aborted responses (e.g. a worker's own nested fetches) — not fatal to the measurement
        }
      });

      const r = await page.evaluate(
        ([v, url]) => (window as any).__spike4.testGpkg(v, url),
        [version, `/${fixture}.gpkg`] as const,
      );

      console.log(`duckdb ${version} / ${fixture}.gpkg: totalNetworkBytes=${totalNetworkBytes}`, JSON.stringify(r));
      console.log(`  per-url bytes:`, JSON.stringify(perUrl));
      if (r.workerErrors.length) console.log(`  worker errors:`, JSON.stringify(r.workerErrors));

      // hard requirement (fix round 1): the extension must actually load and ST_Read must return
      // the real feature count/bbox/vertex count — no more "structure only" pass.
      expect(r.errorText, `${version}/${fixture} errorText`).toBeNull();
      expect(r.spatialInstallLoadOk, `${version}/${fixture} spatialInstallLoadOk`).toBe(true);
      expect(r.rowCount, `${version}/${fixture} ST_Read row count`).toBe(1);

      const m = manifest[fixture];
      expect(r.vertexCount, `${version}/${fixture} ST_Read vertex count`).toBe(m.vertex_count);
      const expectedBbox = expectedBboxFor(fixture);
      for (let i = 0; i < 4; i++) {
        expect(
          Math.abs(r.bbox[i] - expectedBbox[i]),
          `${version}/${fixture} bbox[${i}] got ${r.bbox[i]} expected ${expectedBbox[i]}`,
        ).toBeLessThan(1e-6);
      }
    });
  }
}
