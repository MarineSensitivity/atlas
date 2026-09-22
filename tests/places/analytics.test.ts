import { describe, expect, it } from "vitest";
import {
  noopTrack,
  placeDrawParams,
  placeShareParams,
  placeUploadParams,
} from "../../src/places/analytics";

describe("Deliverable 7: counts and buckets only, never a name or a vertex", () => {
  it("placeDrawParams buckets the vertex count and the area, never the exact numbers", () => {
    const p = placeDrawParams(123, 4567);
    expect(p).toEqual({ n_vertices: "100", area_bucket: "1k-10k" });
    expect(JSON.stringify(p)).not.toMatch(/123|4567/);
  });

  it("placeDrawParams handles zero/negative gracefully", () => {
    expect(placeDrawParams(0, 0)).toEqual({ n_vertices: "0", area_bucket: "0" });
  });

  it("placeUploadParams carries format/outcome plainly but buckets bytes and feature count", () => {
    const p = placeUploadParams({ format: "geojson", bytes: 234_000, nFeatures: 3, outcome: "ok" });
    expect(p.format).toBe("geojson");
    expect(p.outcome).toBe("ok");
    expect(p.bytes_bucket).toBe("100000");
    expect(p.n_features).toBe("1");
  });

  it("placeShareParams carries only a length bucket, never the link or the hash", () => {
    const p = placeShareParams(9345);
    expect(p).toEqual({ length_bucket: "1000" });
    expect(JSON.stringify(p)).not.toMatch(/9345/);
  });

  it("noopTrack does nothing and never throws", () => {
    expect(() => noopTrack("place_draw", { anything: 1 })).not.toThrow();
  });
});
