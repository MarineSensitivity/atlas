import { test, expect, type Page, type Response } from "@playwright/test";

// atlas-0 S3 fix round 1 (task 2): CLAUDE.md/plan says DuckDB-WASM is self-hosted (GitHub Pages
// cannot proxy a remote origin). But `read_parquet()` -- and any other extension -- triggers an
// autoload fetch from extensions.duckdb.org, NOT self-hosted, for both the stable pin and `next`.
// This spec: (1) discovers exactly which URLs/bytes/ms that costs, for both duckdb versions and
// for `json`/`spatial` too; (2) checks whether it's cached across a reload; (3) the gate --
// pointing DuckDB at a same-origin mirror via `SET custom_extension_repository` must make
// `read_parquet()` succeed even with `**/extensions.duckdb.org/**` network-blocked, and the
// seeded fault -- the identical blocked-network scenario WITHOUT the custom repository set --
// must fail (Review checklist: "a check that cannot fail is not a check").
//
// URL shape (confirmed by setting `custom_extension_repository` to a bogus local path and reading
// the resulting 404's URL): `{repository}/{duckdb_engine_version}/{platform}/{name}.duckdb_extension.wasm`.
// `duckdb_engine_version` is the underlying DuckDB C++ engine baked into a given npm release, not
// the npm package version -- 1.32.0 bundles v1.4.3, `next` (1.33.1-dev64.0) bundles v1.5.5.
// `platform` is whichever bundle `selectBundle()` picks; headless Chromium picked `wasm_eh` for
// both. `scripts/fetch_extensions.sh` mirrors the `parquet` extension for both engine versions
// into `tiles/ext/{engine_version}/wasm_eh/parquet.duckdb_extension.wasm` (gitignored), served at
// `/ext/{engine_version}/wasm_eh/...` by vite's `publicDir`.

interface NetEntry {
  url: string;
  status: number;
  bytes: number;
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
  return { flush: () => Promise.all(pending).then(() => undefined), entries };
}

for (const version of ["stable", "next"] as const) {
  test(`discover: read_parquet extension autoload URLs -- ${version}`, async ({ page }) => {
    const net = trackNetwork(page);
    await page.goto("/ext.html");
    await page.waitForFunction(() => "__ext" in window);
    const result = await page.evaluate((v) => window.__ext.probeReadParquet(v), version);
    await net.flush();
    const duckdbOrg = net.entries.filter((e) => e.url.includes("duckdb.org"));
    console.log(`[S3][ext][${version}][read_parquet] ok=${result.ok} ms=${result.ms.toFixed(1)} rows=${result.rows} error=${result.error ?? ""}`);
    for (const e of duckdbOrg) console.log(`[S3][ext][${version}][read_parquet][url] ${e.url} status=${e.status} bytes=${e.bytes}`);
  });

  for (const ext of ["json", "spatial"]) {
    test(`discover: LOAD ${ext} autoload URLs -- ${version}`, async ({ page }) => {
      const net = trackNetwork(page);
      await page.goto("/ext.html");
      await page.waitForFunction(() => "__ext" in window);
      const result = await page.evaluate(([v, e]) => window.__ext.probeLoadExtension(v as "stable" | "next", e), [version, ext] as const);
      await net.flush();
      const duckdbOrg = net.entries.filter((e) => e.url.includes("duckdb.org"));
      console.log(`[S3][ext][${version}][LOAD ${ext}] ok=${result.ok} ms=${result.ms.toFixed(1)} error=${result.error ?? ""}`);
      for (const e of duckdbOrg) console.log(`[S3][ext][${version}][LOAD ${ext}][url] ${e.url} status=${e.status} bytes=${e.bytes}`);
    });
  }

  test(`cached across a page reload? read_parquet extension -- ${version}`, async ({ page }) => {
    const net = trackNetwork(page);
    await page.goto("/ext.html");
    await page.waitForFunction(() => "__ext" in window);
    const first = await page.evaluate((v) => window.__ext.probeReadParquet(v), version);
    await net.flush();
    const firstExt = net.entries.filter((e) => e.url.includes("duckdb.org"));

    await page.reload();
    await page.waitForFunction(() => "__ext" in window);
    const markBeforeSecond = net.entries.length;
    const second = await page.evaluate((v) => window.__ext.probeReadParquet(v), version);
    await net.flush();
    const secondExt = net.entries.slice(markBeforeSecond).filter((e) => e.url.includes("duckdb.org"));

    console.log(
      `[S3][ext][${version}][cache] first: ok=${first.ok} ms=${first.ms.toFixed(1)} requests=${firstExt.length} bytes=${firstExt.reduce((s, e) => s + e.bytes, 0)} | ` +
        `after reload: ok=${second.ok} ms=${second.ms.toFixed(1)} requests=${secondExt.length} bytes=${secondExt.reduce((s, e) => s + e.bytes, 0)}`,
    );
  });

  // gate: with extensions.duckdb.org network-blocked, read_parquet must succeed when DuckDB is
  // pointed at a same-origin extension mirror. `SPIKE3_EXT_FAULT=1` seeds the fault this gate must
  // catch -- the identical blocked-network scenario WITHOUT the custom repository set, which must
  // FAIL (same env-var-toggle pattern as e2e/s3.spec.ts's SPIKE3_FAULT_OFFSET; the default suite
  // run stays green, the fault is a separate documented invocation -- Review checklist: "a check
  // that cannot fail is not a check").
  const EXT_FAULT = process.env.SPIKE3_EXT_FAULT === "1";
  test(`gate: read_parquet over a same-origin custom_extension_repository with extensions.duckdb.org BLOCKED -- ${version}${EXT_FAULT ? " [SEEDED FAULT: no custom repository]" : ""}`, async ({ page }) => {
    await page.route("**/extensions.duckdb.org/**", (route) => route.abort());
    await page.goto("/ext.html");
    await page.waitForFunction(() => "__ext" in window);
    const repo = EXT_FAULT ? undefined : "http://localhost:4313/ext";
    const result = await page.evaluate(([v, r]) => window.__ext.probeReadParquet(v, r), [version, repo] as const);
    console.log(`[S3][ext][gate][${version}] fault=${EXT_FAULT} ok=${result.ok} ms=${result.ms.toFixed(1)} rows=${result.rows} error=${result.error ?? ""}`);
    expect(result.ok).toBe(true);
  });
}
