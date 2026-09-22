// tests/geo/upload/support.ts — the two grids, the fixture reader, and the XML parser the unit
// tests inject. Shared so every upload spec asserts against the SAME grid literals the coverage
// tests use (tests/geo/coverage.test.ts), not a second copy that could drift.
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { gridFromBoot, type GridSpec } from "../../../src/lib/grid/grid";
import type { XmlParse } from "../../../src/lib/geo/upload/parsers/xml";

const dir = new URL("../../fixtures/upload/", import.meta.url);

export const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(name, dir)));

export const textBytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** node has no DOMParser, so KML/GPX get one injected (see parsers/xml.ts for why that seam). */
export const xmlParse: XmlParse = (text) =>
  new DOMParser().parseFromString(text, "text/xml") as unknown as Document;

/** v8+ : 7200 x 3600 from -180, closes in longitude. */
export const global05: GridSpec = gridFromBoot({
  grid_id: "global05",
  grid: { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, lon360: false },
});

/** v1-v7 : 3103 x 2006 from 141.10 E on a 0-360 frame. */
export const usa05: GridSpec = gridFromBoot({
  grid_id: "usa05",
  grid: { nc: 3103, nr: 2006, xmin: 141.1, ymax: 82.6, resx: 0.05, resy: 0.05, lon360: true },
});

export const GRIDS: [string, GridSpec][] = [
  ["global05", global05],
  ["usa05", usa05],
];

export interface FixtureTruth {
  vertex_count: number;
  bbox?: number[];
  true_bbox_width_deg?: number;
  naive_bbox_width_deg?: number;
  wgs84_ground_truth_ring?: number[][];
  wgs84_ground_truth_bbox?: number[];
}

/** the R-computed ground truth that travelled with the fixtures (generate_fixtures.R). */
export const manifest: Record<string, FixtureTruth> = JSON.parse(
  readFileSync(new URL("fixtures_manifest.json", dir), "utf8"),
);
