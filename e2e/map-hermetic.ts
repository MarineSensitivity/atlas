// Hermetic fixtures for the map (atlas-map). Not a `*.spec.ts`, so Playwright never runs it as a
// test on its own — same convention as e2e/hermetic.ts.
//
// Everything the map fetches is routed: the zones PMTiles archive (a REAL 7 KB archive built with
// tippecanoe, served with working HTTP range support, because that is how the `pmtiles://` protocol
// reads it), the CARTO basemap tiles and the titiler score tiles. No spec here ever touches the
// live network.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/** the committed archive. Rebuild with:
 *   tippecanoe -o zones.pmtiles -l programarea -Z0 -z6 --no-tile-compression --force zones.geojson
 * from `e2e/fixtures/map/` (source: zones.geojson, 4 Program-Area rectangles in US waters). */
export const ZONES_PMTILES_PATH = fileURLToPath(
  new URL("./fixtures/map/zones.pmtiles", import.meta.url),
);

/** the URL the fixture boot.json advertises for the zones archive. */
export const ZONES_PMTILES_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/zones/programarea_2026-01/zones.pmtiles";

/** a fixture COG; only its URL matters, since the tiles are routed. */
export const SCORE_COG_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/fixture.tif";

/** `{ver}/app/boot.json`, trimmed to what the map module reads (atlas-1's contract). */
export const BOOT_FIXTURE = {
  schema: 1,
  ver: "v7",
  grid_id: "usa05",
  grid: {
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 74.75,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
  study_areas: [
    { key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 },
    { key: "GA", label: "Gulf of America", lon: -89.089, lat: 26.251, zoom: 3.74 },
  ],
  units: [
    {
      zone_set_key: "programarea_2026-01",
      fld: "programarea_key",
      label: "Program areas",
      pmtiles: ZONES_PMTILES_URL,
      source_layer: "programarea",
    },
  ],
  zones: {
    programarea: [
      { key: "GAA", name: "Gulf of America", label_pt: [-90, 27] },
      { key: "MDA", name: "Mid Atlantic", label_pt: [-72, 38] },
      { key: "CGA", name: "Cook Inlet", label_pt: [-155, 57] },
      { key: "CAA", name: "Central California", label_pt: [-125, 38] },
    ],
  },
};

// --- a solid PNG, so a painted pixel has an EXACT expected colour -------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** a solid opaque PNG, one colour, a full 256 px tile. Every pixel of a routed tile is exactly this
 * colour — which is what lets a `readPixels` probe assert a VALUE rather than "not the background".
 * Full-size, not 1×1: MapLibre uploads the decoded image as the tile texture and a 1×1 tile paints
 * nothing usable (measured, atlas-map). */
export function solidPng(r: number, g: number, b: number, size = 256, a = 255): Buffer {
  const channels = a === 255 ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 3 ? 2 : 6; // colour type: truecolour [+ alpha]
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * channels)]); // filter 0 + pixels
  for (let x = 0; x < size; x++) {
    row[1 + x * channels] = r;
    row[2 + x * channels] = g;
    row[3 + x * channels] = b;
    if (channels === 4) row[4 + x * channels] = a;
  }
  const idat = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** the basemap's fixture colour (both themes route to it: the spec asserts the SOURCE changed, and
 * separately that the background token changed). */
export const BASEMAP_RGB: [number, number, number] = [0, 102, 153];
/** the score raster's fixture colour — distinct from the basemap's, so a probe can tell them apart. */
export const RASTER_RGB: [number, number, number] = [255, 127, 42];

/**
 * Serve the PMTiles archive with real HTTP range support: the `pmtiles://` protocol reads the
 * header, then the directory, then each tile with a `Range` header, and a handler that ignored it
 * would hand back the whole file for every read and decode garbage.
 */
export async function routeZonesPmtiles(page: Page, url = ZONES_PMTILES_URL) {
  const file = readFileSync(ZONES_PMTILES_PATH);
  await page.route(url, (route) => {
    const range = route.request().headers()["range"];
    const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (!m) {
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "accept-ranges": "bytes", "access-control-allow-origin": "*" },
        body: file,
      });
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : file.length - 1;
    const slice = file.subarray(start, end + 1);
    return route.fulfill({
      status: 206,
      contentType: "application/octet-stream",
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${file.length}`,
        "access-control-allow-origin": "*",
      },
      body: slice,
    });
  });
}

/** CARTO basemap tiles (both `dark_all` and `light_all`) → one solid PNG. */
export async function routeBasemapTiles(page: Page) {
  const png = solidPng(...BASEMAP_RGB);
  await page.route("https://basemaps.cartocdn.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
}

/** every titiler `/cog/tiles` request → one solid PNG of a different colour. */
export async function routeTitilerTiles(page: Page) {
  const png = solidPng(...RASTER_RGB);
  await page.route("https://titiler-v8.marinesensitivity.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
}

/** the glyph endpoint a label layer would fetch — routed so a symbol layer cannot reach the live
 * network either. A 200 with an EMPTY body, not a 404: the live CARTO endpoint answers 200 for
 * `layers/basemap.ts`'s `LABEL_FONT` (verified with `curl -sI` on the exact requested URL), and a
 * 404 in the fixture makes Chromium log a console "error" (its own resource-load reporting, not
 * MapLibre's) the moment any spec's boot fixture gives a zone `label_pt` — which every fixture
 * here now does (atlas-4's zones carry labels by default). A zero-byte body is still a VALID
 * (empty) glyph protobuf, so MapLibre reads it as "no glyphs in this range", never an error. */
export async function routeGlyphs(page: Page) {
  await page.route("https://tiles.basemaps.cartocdn.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/x-protobuf", body: "" }),
  );
}

/** the first-paint contract (plan D3 Tier 0): the map must paint with ZERO WASM bytes. Aborting
 * every `.wasm` makes that structural rather than aspirational. */
export async function blockWasm(page: Page) {
  await page.route("**/*.wasm", (route) => route.abort());
}
