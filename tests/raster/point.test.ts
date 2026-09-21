import { describe, expect, it } from "vitest";
import {
  assertSpeciesValueRequest,
  createTitilerValueSource,
  titilerPointUrl,
  type ValueRequest,
} from "../../src/lib/raster/point";
import { DEFAULT_TITILER_CONFIG, DEFAULT_TITILER_HOST } from "../../src/lib/raster/tiles";

const COG_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/global05/x.tif";

describe("assertSpeciesValueRequest (runtime guard: /cog/point serves species values ONLY)", () => {
  it("passes silently for domain: 'species'", () => {
    expect(() => assertSpeciesValueRequest({ domain: "species" })).not.toThrow();
  });

  // seeded fault: a scores value requested through /cog/point. Scores values must come from
  // Parquet (engine/ + sql/), never a raster pixel (plan D4) — a request built from untyped data
  // (bypassing the ValueRequest["domain"] type) must still be rejected at runtime.
  it("seeded fault: throws for domain: 'scores' even though the type only admits 'species'", () => {
    const untyped = { domain: "scores" } as unknown as { domain: string };
    expect(() => assertSpeciesValueRequest(untyped)).toThrow(/species values/i);
  });

  it("throws for any other unexpected domain string", () => {
    expect(() => assertSpeciesValueRequest({ domain: "zones" })).toThrow();
  });
});

describe("titilerPointUrl", () => {
  it("builds {host}/cog/point/{lon},{lat}?url=<enc>", () => {
    const url = titilerPointUrl(DEFAULT_TITILER_CONFIG, -122.5, 37.8, COG_URL);
    expect(url).toBe(
      `${DEFAULT_TITILER_HOST}/cog/point/-122.5,37.8?url=${encodeURIComponent(COG_URL)}`,
    );
  });
});

describe("createTitilerValueSource", () => {
  it("resolves the first value from {values:[...]} — no network call, fetchJson injected", async () => {
    const requested: string[] = [];
    const source = createTitilerValueSource(async (url) => {
      requested.push(url);
      return { values: [42.5, 99] };
    });
    const req: ValueRequest = { domain: "species", lon: 1, lat: 2, cogUrl: COG_URL };
    await expect(source.pointValue(req)).resolves.toBe(42.5);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/cog/point/1,2?url=");
  });

  it("resolves null when the fetch throws (matches cog_point_value()'s NA-on-failure contract)", async () => {
    const source = createTitilerValueSource(async () => {
      throw new Error("network down");
    });
    const req: ValueRequest = { domain: "species", lon: 1, lat: 2, cogUrl: COG_URL };
    await expect(source.pointValue(req)).resolves.toBeNull();
  });

  it("resolves null when the response has no usable values array", async () => {
    const source = createTitilerValueSource(async () => ({}));
    const req: ValueRequest = { domain: "species", lon: 1, lat: 2, cogUrl: COG_URL };
    await expect(source.pointValue(req)).resolves.toBeNull();
  });

  it("rejects a scores-domain request before ever calling fetchJson (seeded fault)", async () => {
    let called = false;
    const source = createTitilerValueSource(async () => {
      called = true;
      return { values: [1] };
    });
    const badReq = { domain: "scores", lon: 1, lat: 2, cogUrl: COG_URL } as unknown as ValueRequest;
    await expect(source.pointValue(badReq)).rejects.toThrow(/species values/i);
    expect(called).toBe(false);
  });
});
