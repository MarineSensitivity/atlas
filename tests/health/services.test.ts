// V3 (P round, 2026-09-24): the two ServiceDef factories — mostly a "does this build the right
// URL/host label" check, since registry.test.ts already covers bannerMessage's copy in depth.
import { describe, expect, it } from "vitest";
import { dataServiceDef, tilerServiceDef } from "../../src/lib/health/services";

describe("tilerServiceDef", () => {
  it("probes /healthz on the given host, and strips the scheme for hostLabel", () => {
    const def = tilerServiceDef("https://titiler-v8.marinesensitivity.org");
    expect(def.url).toBe("https://titiler-v8.marinesensitivity.org/healthz");
    expect(def.hostLabel).toBe("titiler-v8.marinesensitivity.org");
    expect(def.id).toBe("tiler");
  });

  it("defaults to the real production titiler-v8 host when no host is given", () => {
    const def = tilerServiceDef();
    expect(def.url).toBe("https://titiler-v8.marinesensitivity.org/healthz");
  });
});

describe("dataServiceDef", () => {
  it("probes the release's own app/boot.json, under the public bucket base", () => {
    const def = dataServiceDef("v9");
    expect(def.url).toBe(
      "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/app/boot.json",
    );
    expect(def.hostLabel).toBe("s3.us-east-1.amazonaws.com");
    expect(def.id).toBe("data");
  });

  it("the URL always names the SAME ver it was asked about, never a stale one", () => {
    expect(dataServiceDef("v7").url).toContain("/v7/app/boot.json");
    expect(dataServiceDef("v9").url).toContain("/v9/app/boot.json");
  });
});
