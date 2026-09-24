// D8 (Opus 5.5 eyes-on, 2026-09-24): the species camera's LAST resort — stock titiler's own
// `/cog/bounds`, asked only once camera.ts's bundle-only chain has already fallen to the study
// area for want of any published bbox. Same shape as tests/raster/point.test.ts's own coverage of
// point.ts's `/cog/point`.
import { describe, expect, it } from "vitest";
import { createTitilerBoundsSource, titilerBoundsUrl } from "../../src/lib/raster/bounds";
import { DEFAULT_TITILER_CONFIG, DEFAULT_TITILER_HOST } from "../../src/lib/raster/tiles";

const COG_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/ffe72edb91a4f7ae.tif";

describe("titilerBoundsUrl", () => {
  it("builds {host}/cog/bounds?url=<enc>", () => {
    const url = titilerBoundsUrl(DEFAULT_TITILER_CONFIG, COG_URL);
    expect(url).toBe(`${DEFAULT_TITILER_HOST}/cog/bounds?url=${encodeURIComponent(COG_URL)}`);
  });
});

describe("createTitilerBoundsSource", () => {
  it("resolves the COG's own [xmin,ymin,xmax,ymax] — no network call, fetchJson injected", async () => {
    const requested: string[] = [];
    const source = createTitilerBoundsSource(async (url) => {
      requested.push(url);
      return { bounds: [-170.5, 51.2, -64.8, 71.4] };
    });
    await expect(source.cogBounds(COG_URL)).resolves.toEqual([-170.5, 51.2, -64.8, 71.4]);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/cog/bounds?url=");
  });

  it("resolves null when the fetch throws (network down) — never a throw", async () => {
    const source = createTitilerBoundsSource(async () => {
      throw new Error("network down");
    });
    await expect(source.cogBounds(COG_URL)).resolves.toBeNull();
  });

  it("resolves null when the response has no usable bounds array", async () => {
    const source = createTitilerBoundsSource(async () => ({}));
    await expect(source.cogBounds(COG_URL)).resolves.toBeNull();
  });

  it("resolves null for a malformed (wrong length, non-numeric) bounds array", async () => {
    const short = createTitilerBoundsSource(async () => ({ bounds: [1, 2, 3] }));
    await expect(short.cogBounds(COG_URL)).resolves.toBeNull();
    const nonNumeric = createTitilerBoundsSource(async () => ({ bounds: [1, 2, 3, "x"] }));
    await expect(nonNumeric.cogBounds(COG_URL)).resolves.toBeNull();
    const nonFinite = createTitilerBoundsSource(async () => ({ bounds: [1, 2, 3, Infinity] }));
    await expect(nonFinite.cogBounds(COG_URL)).resolves.toBeNull();
  });
});
