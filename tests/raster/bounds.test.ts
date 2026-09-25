// D8 (Opus 5.5 eyes-on, 2026-09-24; orchestrator round 2, real-v7-build eyes-on): the species
// camera's LAST resort — stock titiler's own `/cog/info` (NOT `/cog/bounds`, which 404s live on
// titiler-v8 — bounds.ts's own header has the verification), asked only once camera.ts's
// bundle-only chain has already fallen to the study area for want of any published bbox. Same
// shape as tests/raster/point.test.ts's own coverage of point.ts's `/cog/point`.
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_LONS,
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

  // R3-rr fix 1, round 2: PROBES EVERY candidate now (never stops at the first hit) -- a single,
  // isolated hit still needs distinguishing from several widely-spread ones, which is only
  // possible by checking them all. This test renamed from "stops at the FIRST candidate..." to
  // match; the SINGLE-hit narrowed-window outcome (the walrus shape) is unchanged.
  it("with exactly ONE candidate holding data, frames a modest window around it (the walrus shape) -- every candidate is still probed", async () => {
    const probed: number[] = [];
    const bbox = await narrowLongitude(
      async (url) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(url);
        if (m) probed.push(Number(m[1]));
        // the third candidate (-150) is the ONLY hit in this fixture.
        return { values: [probed.at(-1) === -150 ? 42 : null] };
      },
      config,
      COG_URL,
      [-180, 53, 180, 74],
    );
    // every candidate probed, not just up to the hit -- a later, more-spread-out hit could still
    // change the outcome, so stopping early is no longer correct.
    expect(probed).toHaveLength(CANDIDATE_LONS.length);
    expect(bbox).toEqual([-150 - 20, 53, -150 + 20, 74]);
  });

  // R3-rr fix 1, round 2 (Opus 5.5 eyes-on review round 3, second pass, 2026-09-25): the real,
  // live leatherback (mdl_seq 54241) probed 2026-09-25 -- data at -165 (Aleutians), -66 (Atlantic/
  // Caribbean), -157 (Hawaii), and 145 (Guam/CNMI). A single 40-deg window around whichever hits
  // first (the OLD behaviour) would keep the bbox's full original 78-deg latitude range too,
  // producing a tall, near-useless sliver with no "Zoom to" toggle (span 40 < WIDE_RANGE_SPAN_DEG)
  // -- the exact live bug. Handing the RAW bbox back instead lets the caller's own wide-range
  // narrowing (camera.ts) apply.
  // R3-rr fix 1, round 3 (real-build eyes-on, 2026-09-25): live-verified that fitting the RAW
  // -180..180 box for "Whole range" lands on lng=0 (Africa) — the opposite side of the world from
  // any of the actual data. Hands back the confirmed-data ARC instead (hitLonArc), never the raw
  // degenerate box.
  it("BUG: with MULTIPLE widely-spread hits (the real leatherback shape), hands back the confirmed-data ARC, not the raw degenerate bbox", async () => {
    const HIT_LONS = new Set([-165, -66, -157, 145]);
    const bbox = await narrowLongitude(
      async (url) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(url);
        const lon = m ? Number(m[1]) : NaN;
        return { values: [HIT_LONS.has(lon) ? 100 : null] };
      },
      config,
      COG_URL,
      [-180, -17.700000000000017, 180, 60.44999999999999],
    );
    // the smallest arc containing all four hits: cut at the widest gap (between -66 and 145, 211
    // deg) -- runs 145 -> 195 (=-165+360) -> 203 (=-157+360) -> 294 (=-66+360), span 149 deg. Never
    // padded (padding past 180 deg would trip camera.ts#minimalFrame's own re-derivation into the
    // WRONG, empty side) and never the raw box's own latitude-unbounded globe span.
    expect(bbox).toEqual([145, -17.700000000000017, 294, 60.44999999999999]);
  });

  it("two hits close together (through the dateline) still count as ONE region, not wide -- narrows to a window spanning both", async () => {
    // 145 and -165 are only 50 deg apart via the Pacific (180-145=35, 180-165=15) -- well under
    // MULTI_REGION_SPREAD_DEG (60) -- a real shape (a Guam/CNMI-to-Aleutians coastal species).
    const HIT_LONS = new Set([145, -165]);
    const bbox = await narrowLongitude(
      async (url) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(url);
        const lon = m ? Number(m[1]) : NaN;
        return { values: [HIT_LONS.has(lon) ? 50 : null] };
      },
      config,
      COG_URL,
      [-180, 10, 180, 30],
    );
    // the arc spanning BOTH hits (145 -> 195, i.e. -165+360), padded on each side -- not just a
    // window around whichever hit happened to be probed first.
    expect(bbox).toEqual([145 - 20, 10, 195 + 20, 30]);
  });

  it("probes at the bbox's own latitude MIDPOINT, via the SAME /cog/point titilerPointUrl this app already sanctions for species values (plan D4)", async () => {
    let firstProbedUrl: string | null = null;
    await narrowLongitude(
      async (url) => {
        if (url.includes("/cog/point/") && firstProbedUrl === null) firstProbedUrl = url;
        return { values: [null] }; // no hits -- keeps this test's ONLY concern the probe URL shape
      },
      config,
      COG_URL,
      [-180, 40, 180, 60], // midpoint lat 50
    );
    expect(firstProbedUrl).toBe(titilerPointUrl(config, -177, 50, COG_URL));
  });
});
