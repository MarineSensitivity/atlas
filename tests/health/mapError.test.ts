// V3 (P round, 2026-09-24): classifyMapTileError's line between a legitimate "no data here" gap
// (403/404 — the same convention analysis/sources.ts's isMissingTileStatus already uses for the
// DuckDB-parquet tiles) and a REAL failure (5xx, no status at all = a network error/abort). Also
// covers the attribution rule: only a URL under the given tilerHost is ever classified at all.
import { describe, expect, it } from "vitest";
import { classifyMapTileError } from "../../src/lib/health/mapError";

const TILER = "https://titiler-v8.marinesensitivity.org";
const opts = { tilerHost: TILER };

describe("classifyMapTileError: 403/404 under the tiler host — empty, never a failure", () => {
  it("403 (an AJAXError-shaped object) is 'empty'", () => {
    const err = { status: 403, url: `${TILER}/cog/tiles/WebMercatorQuad/5/3/3.png` };
    expect(classifyMapTileError(err, opts)).toEqual({ kind: "empty", url: err.url, status: 403 });
  });

  it("404 is 'empty'", () => {
    const err = { status: 404, url: `${TILER}/cog/tiles/WebMercatorQuad/5/3/3.png` };
    expect(classifyMapTileError(err, opts).kind).toBe("empty");
  });
});

describe("classifyMapTileError: everything else under the tiler host is a real failure", () => {
  it("500 is 'failure', attributed to the tiler service, reason 'HTTP 500'", () => {
    const err = { status: 500, url: `${TILER}/cog/tiles/WebMercatorQuad/5/3/3.png` };
    expect(classifyMapTileError(err, opts)).toEqual({
      kind: "failure",
      service: "tiler",
      url: err.url,
      status: 500,
      reason: "HTTP 500",
    });
  });

  it("503 is 'failure' (the exact status Ben's outage would have produced downstream of the LB)", () => {
    const err = { status: 503, url: `${TILER}/cog/tiles/WebMercatorQuad/5/3/3.png` };
    expect(classifyMapTileError(err, opts).kind).toBe("failure");
  });

  it("no status at all (a network error / CORS block / abort — AJAXError never even formed) is 'failure', reason 'network error'", () => {
    const err = { url: `${TILER}/cog/tiles/WebMercatorQuad/5/3/3.png` };
    expect(classifyMapTileError(err, opts)).toEqual({
      kind: "failure",
      service: "tiler",
      url: err.url,
      reason: "network error",
    });
  });

  it("a bare Error with no .url at all (some browsers report exactly this for an aborted request) is ignored, not misattributed", () => {
    expect(classifyMapTileError(new Error("Failed to fetch"), opts).kind).toBe("ignored");
  });
});

describe("classifyMapTileError: attribution — a failure NOT under the tiler host is never misattributed", () => {
  it("a basemap tile 500 is ignored, not counted against the tiler service", () => {
    const err = { status: 500, url: "https://tiles.basemaps.cartocdn.com/vectortiles/foo.mvt" };
    expect(classifyMapTileError(err, opts)).toEqual({ kind: "ignored" });
  });

  it("a zones PMTiles range-read failure is ignored", () => {
    const err = {
      status: 500,
      url: "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/zones/x.pmtiles",
    };
    expect(classifyMapTileError(err, opts).kind).toBe("ignored");
  });
});
