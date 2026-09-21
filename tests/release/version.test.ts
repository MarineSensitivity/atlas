import { describe, expect, it } from "vitest";
import {
  VERSION_RE,
  resolveVersion,
  versionFromPath,
  versionFromQuery,
} from "../../src/lib/release/version";

describe("VERSION_RE", () => {
  it("matches exactly ^v[0-9]+[a-z]?$, the same shape as msens::atlas_resolve_ver()", () => {
    for (const ok of ["v1", "v8", "v10", "v4b"]) expect(VERSION_RE.test(ok)).toBe(true);
    for (const bad of ["", "v", "8", "V8", "v8b2", "v8-a", "latest", "../etc", "v8; DROP"]) {
      expect(VERSION_RE.test(bad)).toBe(false);
    }
  });
});

describe("versionFromPath", () => {
  it("reads the leading /v9/ segment (the preview host's shape)", () => {
    expect(versionFromPath("/v9/atlas/")).toBe("v9");
    expect(versionFromPath("/v4b/atlas/index.html")).toBe("v4b");
  });

  it("is null with no version segment, even if a later segment looks like one", () => {
    expect(versionFromPath("/atlas/")).toBeNull();
    expect(versionFromPath("/atlas/v9/")).toBeNull();
  });
});

describe("versionFromQuery", () => {
  it("reads a well-formed ?ver=", () => {
    expect(versionFromQuery("?ver=v7")).toBe("v7");
  });

  it("a malformed ver falls through (returns null) instead of being surfaced", () => {
    expect(versionFromQuery("?ver=../etc")).toBeNull();
    expect(versionFromQuery("?ver=v8;%20DROP")).toBeNull();
    expect(versionFromQuery("")).toBeNull();
  });
});

describe("resolveVersion", () => {
  const fetchLatest = async () => "v7";

  it("path beats query beats latest.txt", async () => {
    expect(await resolveVersion({ pathname: "/v9/atlas/", search: "?ver=v3" }, fetchLatest)).toBe(
      "v9",
    );
    expect(await resolveVersion({ pathname: "/atlas/", search: "?ver=v3" }, fetchLatest)).toBe(
      "v3",
    );
    expect(await resolveVersion({ pathname: "/atlas/", search: "" }, fetchLatest)).toBe("v7");
  });

  it("a malformed ver falls through to latest.txt rather than erroring", async () => {
    expect(await resolveVersion({ pathname: "/atlas/", search: "?ver=../etc" }, fetchLatest)).toBe(
      "v7",
    );
  });

  it("resolves to null (never a throw) when latest.txt is unreachable and nothing else names a version", async () => {
    const fail = async () => {
      throw new Error("network error");
    };
    expect(await resolveVersion({ pathname: "/atlas/", search: "" }, fail)).toBeNull();
  });

  it("treats a malformed latest.txt body as unresolved rather than propagating garbage", async () => {
    const garbage = async () => "not-a-version";
    expect(await resolveVersion({ pathname: "/atlas/", search: "" }, garbage)).toBeNull();
  });
});
