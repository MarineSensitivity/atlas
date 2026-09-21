// atlas-0 S4 spike harness entry. Deliberately does NOT statically import shpjs, @tmcw/togeojson,
// flatgeobuf or either duckdb-wasm build: each is its own dynamic import so (1) each becomes its
// own chunk, which is what the bytes-added-per-parser-when-lazy-loaded measurement reads out of
// `vite build`'s manifest, and (2) this mirrors the root app's real rule that these same
// libraries must be lazy (root CLAUDE.md, `scripts/size-budget.mjs`).
//
// Exposes `window.__spike4` for Playwright to call directly — there is no UI here, this harness
// exists purely to be driven from e2e specs.

async function parseShp(zipUrl: string) {
  const { parseShp: fn } = await import("./parse-shp");
  return fn(zipUrl);
}

async function parseKml(kmlUrl: string) {
  const { parseKml: fn } = await import("./parse-kml");
  return fn(kmlUrl);
}

async function parseFgb(fgbUrl: string) {
  const { parseFgb: fn } = await import("./parse-fgb");
  return fn(fgbUrl);
}

async function parseWkt(wktUrl: string) {
  const { parseWkt: fn } = await import("./parse-wkt");
  return fn(wktUrl);
}

async function testGpkg(version: "1.32.0" | "next", gpkgUrl: string, customExtensionRepository?: string) {
  const mod = version === "1.32.0" ? await import("./duckdb-1-32-0") : await import("./duckdb-next");
  return mod.testGpkg(gpkgUrl, customExtensionRepository);
}

declare global {
  interface Window {
    __spike4: {
      parseShp: typeof parseShp;
      parseKml: typeof parseKml;
      parseFgb: typeof parseFgb;
      parseWkt: typeof parseWkt;
      testGpkg: typeof testGpkg;
    };
  }
}

window.__spike4 = { parseShp, parseKml, parseFgb, parseWkt, testGpkg };

const readyEl = document.getElementById("ready");
if (readyEl) readyEl.textContent = "ready";
