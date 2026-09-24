// D8 (Opus 5.5 eyes-on, 2026-09-24; orchestrator round 2, real-v7-build eyes-on): the species
// camera's LAST resort — stock titiler's own `/cog/info` (NOT `/cog/bounds`, which 404s live on
// titiler-v8 — bounds.ts's own header has the verification), asked only once camera.ts's
// bundle-only chain has already fallen to the study area for want of any published bbox. Same
// shape as tests/raster/point.test.ts's own coverage of point.ts's `/cog/point`.
import { describe, expect, it } from "vitest";
import {
  createTitilerBoundsSource,
  narrowLongitude,
  titilerInfoUrl,
} from "../../src/lib/raster/bounds";
import { DEFAULT_TITILER_CONFIG, DEFAULT_TITILER_HOST } from "../../src/lib/raster/tiles";
import { titilerPointUrl } from "../../src/lib/raster/point";

const COG_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/ffe72edb91a4f7ae.tif";

describe("titilerInfoUrl", () => {
  it("builds {host}/cog/info?url=<enc>", () => {
    const url = titilerInfoUrl(DEFAULT_TITILER_CONFIG, COG_URL);
    expect(url).toBe(`${DEFAULT_TITILER_HOST}/cog/info?url=${encodeURIComponent(COG_URL)}`);
  });
});

describe("createTitilerBoundsSource", () => {
  it("resolves the COG's own [xmin,ymin,xmax,ymax] from /cog/info — no network call, fetchJson injected", async () => {
    const requested: string[] = [];
    const source = createTitilerBoundsSource(async (url) => {
      requested.push(url);
      return { bounds: [-170.5, 51.2, -64.8, 71.4] };
    });
    await expect(source.cogBounds(COG_URL)).resolves.toEqual([-170.5, 51.2, -64.8, 71.4]);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/cog/info?url=");
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

  // orchestrator round 2 (real-build eyes-on): the walrus v7 merged COG's own `/cog/info` bounds
  // are a genuinely full 360-degree longitude span ([-180, 53.15, 180, 73.75], verified live) — a
  // degenerate extent `cogBounds` must narrow via `narrowLongitude`, not hand through as-is (that
  // would frame the WHOLE globe's width at a thin Arctic band, the exact real-build defect this
  // round fixes).
  it("narrows a degenerate (whole-globe-width) /cog/info bbox using a point probe, real walrus numbers", async () => {
    const source = createTitilerBoundsSource(async (url) => {
      if (url.includes("/cog/info")) return { bounds: [-180, 53.15, 180, 73.75] };
      // only -170 (the real walrus data's own longitude, measured live) answers with a value —
      // every other CANDIDATE_LONS probe must come first and answer null, exactly like the walrus
      // itself was measured to.
      if (url.includes("/cog/point/-170,")) return { values: [91] };
      return { values: [null] };
    });
    const bbox = await source.cogBounds(COG_URL);
    expect(bbox).not.toBeNull();
    const [xmin, ymin, xmax, ymax] = bbox!;
    expect(xmin).toBeLessThan(-170);
    expect(xmax).toBeGreaterThan(-170);
    expect(ymin).toBe(53.15);
    expect(ymax).toBe(73.75);
    // a MODEST window, not the file's own full width -- this is the whole point of narrowing.
    expect(xmax - xmin).toBeLessThan(100);
  });

  it("a degenerate bbox with NO candidate holding data resolves null (falls back to the study area, same as before this module existed)", async () => {
    const source = createTitilerBoundsSource(async (url) => {
      if (url.includes("/cog/info")) return { bounds: [-180, 0, 180, 10] };
      return { values: [null] }; // every candidate probe answers null
    });
    await expect(source.cogBounds(COG_URL)).resolves.toBeNull();
  });
});

describe("narrowLongitude", () => {
  const config = DEFAULT_TITILER_CONFIG;

  it("passes a non-degenerate bbox through UNCHANGED", async () => {
    const bbox: [number, number, number, number] = [-170, 51, -64, 71];
    const out = await narrowLongitude(async () => ({ values: [1] }), config, COG_URL, bbox);
    expect(out).toEqual(bbox);
  });

  it("stops at the FIRST candidate that holds data — never probes every one", async () => {
    const probed: number[] = [];
    await narrowLongitude(
      async (url) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(url);
        if (m) probed.push(Number(m[1]));
        // the third candidate (-150) is the first hit in this fixture.
        return { values: [probed.at(-1) === -150 ? 42 : null] };
      },
      config,
      COG_URL,
      [-180, 53, 180, 74],
    );
    expect(probed.indexOf(-150)).toBeGreaterThanOrEqual(0);
    // nothing probed AFTER the hit -- confirms the sequential "stop at first" contract.
    const hitIndex = probed.indexOf(-150);
    expect(probed.length).toBe(hitIndex + 1);
  });

  it("probes at the bbox's own latitude MIDPOINT, via the SAME /cog/point titilerPointUrl this app already sanctions for species values (plan D4)", async () => {
    let probedUrl: string | null = null;
    await narrowLongitude(
      async (url) => {
        if (url.includes("/cog/point/")) probedUrl = url;
        return { values: [1] }; // the first candidate hits immediately
      },
      config,
      COG_URL,
      [-180, 40, 180, 60], // midpoint lat 50
    );
    expect(probedUrl).toBe(titilerPointUrl(config, -177, 50, COG_URL));
  });
});
