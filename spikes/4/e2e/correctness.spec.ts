// atlas-0 S4 spike — correctness of each parser against the ground truth in
// fixtures/fixtures_manifest.json (computed once, independently, by fixtures/generate_fixtures.R
// via GDAL/PROJ). Measurement-only: no verdict, just pass/fail per (fixture, parser) cell.
//
// Seeded-fault gate: set SPIKE4_MANIFEST=fixtures_manifest.faulty.json to run these exact same
// assertions against a manifest with a deliberately wrong gulf_rectangle vertex_count/bbox and a
// utm_zone "ground truth" left in raw UTM metres (i.e. simulating a reader that ignored the
// .prj). That run MUST fail — see RESULTS.md for the captured red output — which is the committed
// proof that this spec can actually fail (a check that cannot fail is not a check).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestFile = process.env.SPIKE4_MANIFEST ?? "fixtures_manifest.json";
const manifest = JSON.parse(readFileSync(path.join(here, "..", "fixtures", manifestFile), "utf8"));

// metres tolerance expressed as degrees at ~39N (UTM zone 10N test latitude); 1 degree of
// latitude ~= 111,320 m there, longitude a bit less (* cos(lat)) — using the larger (latitude)
// conversion for both axes keeps the tolerance conservative (tighter than reality on the lon axis).
const METRES_PER_DEG = 111_320;

function expectBboxClose(actual: number[], expected: number[], tolDeg: number, label: string) {
  for (let i = 0; i < 4; i++) {
    const d = Math.abs(actual[i] - expected[i]);
    expect(d, `${label} bbox[${i}] off by ${d} (tol ${tolDeg})`).toBeLessThan(tolDeg);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__spike4 !== undefined);
});

// --- gulf_rectangle: plain WGS84 rectangle, the "everything should just work" control -------
for (const [label, fmt, url] of [
  ["shpjs", "parseShp", "/gulf_rectangle.zip"],
  ["togeojson", "parseKml", "/gulf_rectangle.kml"],
  ["flatgeobuf", "parseFgb", "/gulf_rectangle.fgb"],
  ["wkt (hand-rolled)", "parseWkt", "/gulf_rectangle.wkt"],
] as const) {
  test(`gulf_rectangle via ${label}`, async ({ page }) => {
    const r = await page.evaluate(([fn, u]) => (window as any).__spike4[fn](u), [fmt, url] as const);
    const m = manifest.gulf_rectangle;
    console.log(`gulf_rectangle/${label}:`, JSON.stringify(r));
    expect(r.vertexCount, `${label} vertexCount`).toBe(m.vertex_count);
    expectBboxClose(r.bbox, m.bbox, 1e-6, `gulf_rectangle/${label}`);
  });
}

// --- aleutian_dateline: crosses the antimeridian with wrapped coords (178 -> -177). Every
// parser here is expected to pass raw coordinates through with NO antimeridian correction, so a
// naive bbox over them reproduces the same ~355-degree-wide "wrong" bbox our own ground truth
// naive calculator gets — that reproduction (not a "true" ~5-degree bbox) is what PASSES here.
for (const [label, fmt, url] of [
  ["shpjs", "parseShp", "/aleutian_dateline.zip"],
  ["togeojson", "parseKml", "/aleutian_dateline.kml"],
  ["flatgeobuf", "parseFgb", "/aleutian_dateline.fgb"],
  ["wkt (hand-rolled)", "parseWkt", "/aleutian_dateline.wkt"],
] as const) {
  test(`aleutian_dateline via ${label} (180-degree crossing)`, async ({ page }) => {
    const r = await page.evaluate(([fn, u]) => (window as any).__spike4[fn](u), [fmt, url] as const);
    const m = manifest.aleutian_dateline;
    console.log(`aleutian_dateline/${label}:`, JSON.stringify(r));
    expect(r.vertexCount, `${label} vertexCount`).toBe(m.vertex_count);
    expectBboxClose(r.bbox, m.naive_bbox_raw_coords, 1e-6, `aleutian_dateline/${label}`);
    const naiveWidth = r.bbox[2] - r.bbox[0];
    console.log(`  naive bbox width from ${label}: ${naiveWidth} deg (true width is ${m.true_bbox_width_deg} deg)`);
  });
}

// --- multipolygon: two disjoint parts, one Feature -------------------------------------------
for (const [label, fmt, url] of [
  ["shpjs", "parseShp", "/multipolygon.zip"],
  ["togeojson", "parseKml", "/multipolygon.kml"],
  ["flatgeobuf", "parseFgb", "/multipolygon.fgb"],
  ["wkt (hand-rolled)", "parseWkt", "/multipolygon.wkt"],
] as const) {
  test(`multipolygon via ${label}`, async ({ page }) => {
    const r = await page.evaluate(([fn, u]) => (window as any).__spike4[fn](u), [fmt, url] as const);
    const m = manifest.multipolygon;
    console.log(`multipolygon/${label}:`, JSON.stringify(r));
    expect(r.vertexCount, `${label} vertexCount`).toBe(m.vertex_count);
    expectBboxClose(r.bbox, m.bbox, 1e-6, `multipolygon/${label}`);
  });
}

// --- utm_zone: the reprojection case ------------------------------------------------------------
test("utm_zone via shpjs (zip): reads the .prj and reprojects to WGS84", async ({ page }) => {
  const r = await page.evaluate((u) => (window as any).__spike4.parseShp(u), "/utm_zone.zip");
  const m = manifest.utm_zone;
  console.log("utm_zone/shpjs:", JSON.stringify(r));
  expect(r.vertexCount, "shpjs vertexCount").toBe(m.vertex_count);
  // reprojection error in metres: max corner delta, both axes, converted at ~111,320 m/deg.
  const dxDeg = Math.max(Math.abs(r.bbox[0] - m.wgs84_ground_truth_bbox[0]), Math.abs(r.bbox[2] - m.wgs84_ground_truth_bbox[2]));
  const dyDeg = Math.max(Math.abs(r.bbox[1] - m.wgs84_ground_truth_bbox[1]), Math.abs(r.bbox[3] - m.wgs84_ground_truth_bbox[3]));
  const errMetres = Math.max(dxDeg, dyDeg) * METRES_PER_DEG;
  console.log(`utm_zone/shpjs reprojection error: ${errMetres.toFixed(6)} m`);
  // gate: this is the check that "must FAIL if the .prj is ignored (coordinates left in metres)"
  // — see RESULTS.md for the seeded-fault run (SPIKE4_MANIFEST=fixtures_manifest.faulty.json)
  // where wgs84_ground_truth_bbox is deliberately left as raw UTM metres and this assertion goes
  // from ~0 m to a many-million-metre failure.
  expect(errMetres, "utm_zone/shpjs reprojection error (m)").toBeLessThan(10);
});

test("utm_zone via flatgeobuf (fgb): does NOT reproject (raw UTM metres preserved)", async ({ page }) => {
  const r = await page.evaluate((u) => (window as any).__spike4.parseFgb(u), "/utm_zone.fgb");
  const m = manifest.utm_zone;
  console.log("utm_zone/flatgeobuf:", JSON.stringify(r));
  expect(r.vertexCount, "flatgeobuf vertexCount").toBe(m.vertex_count);
  // flatgeobuf's JS reader hands back whatever coordinates were encoded, verbatim — expect the
  // RAW UTM metre bbox here, not the WGS84 one, and record whether the header still carries a CRS.
  expectBboxClose(r.bbox, m.bbox_utm_metres, 1e-6, "utm_zone/flatgeobuf");
  console.log("utm_zone/flatgeobuf header.crs:", JSON.stringify(r.headerCrs));
});

test("utm_zone via wkt (hand-rolled): no CRS in plain WKT, numbers pass through as-is", async ({ page }) => {
  const r = await page.evaluate((u) => (window as any).__spike4.parseWkt(u), "/utm_zone.wkt");
  const m = manifest.utm_zone;
  console.log("utm_zone/wkt:", JSON.stringify(r));
  expect(r.vertexCount, "wkt vertexCount").toBe(m.vertex_count);
  // the paste-WKT parser has no idea these are metres, not degrees — it should reproduce the raw
  // UTM numbers unchanged. This documents the gap, it is not asking the parser to reproject.
  expectBboxClose(r.bbox, m.bbox_utm_metres, 1e-6, "utm_zone/wkt");
});

// --- coastline_40k: vertex count + parse time, no ring (LineString) ---------------------------
for (const [label, fmt, url] of [
  ["shpjs", "parseShp", "/coastline_40k.zip"],
  ["togeojson", "parseKml", "/coastline_40k.kml"],
  ["flatgeobuf", "parseFgb", "/coastline_40k.fgb"],
  ["wkt (hand-rolled)", "parseWkt", "/coastline_40k.wkt"],
] as const) {
  test(`coastline_40k via ${label} (40k vertices, parse time)`, async ({ page }) => {
    const r = await page.evaluate(([fn, u]) => (window as any).__spike4[fn](u), [fmt, url] as const);
    const m = manifest.coastline_40k;
    console.log(`coastline_40k/${label}: vertexCount=${r.vertexCount} parseMs=${r.parseMs.toFixed(2)} bytesFetched=${r.bytesFetched}`);
    expect(r.vertexCount, `${label} vertexCount`).toBe(m.vertex_count);
    expectBboxClose(r.bbox, m.bbox, 1e-6, `coastline_40k/${label}`);
  });
}
