import { describe, expect, it } from "vitest";
import {
  buildPageLocation,
  buildPagePath,
  type LocationLike,
} from "../../src/lib/analytics/pageLocation";
import { QUERY_KEYS } from "../../src/lib/state/types";

describe("buildPageLocation / buildPagePath — never the hash, never an unlisted query key", () => {
  it("rebuilds origin + path + allow-listed query, dropping nothing that is allowed", () => {
    const loc: LocationLike = {
      origin: "https://marinesensitivity.org",
      pathname: "/atlas/",
      search: "?ver=v9&lens=species&sp=ms_merge%7CWORMS%3A137209",
    };
    expect(buildPageLocation(loc)).toBe(
      "https://marinesensitivity.org/atlas/?ver=v9&lens=species&sp=ms_merge%7CWORMS%3A137209",
    );
  });

  it("buildPagePath omits the origin (matches ms_log_header()'s page column)", () => {
    const loc: LocationLike = { origin: "https://x.test", pathname: "/atlas/", search: "?ver=v9" };
    expect(buildPagePath(loc)).toBe("/atlas/?ver=v9");
  });

  it("produces no trailing '?' when nothing survives the allow-list", () => {
    const loc: LocationLike = { origin: "https://x.test", pathname: "/atlas/", search: "" };
    expect(buildPageLocation(loc)).toBe("https://x.test/atlas/");
  });

  // seeded fault: a query key outside the allow-list passed through.
  it("seeded fault: drops a query key that is not in the allow-list", () => {
    const loc: LocationLike = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: "?ver=v9&secret_token=abc123&lens=scores",
    };
    const out = buildPageLocation(loc);
    expect(out).not.toContain("secret_token");
    expect(out).not.toContain("abc123");
    expect(out).toBe("https://x.test/atlas/?ver=v9&lens=scores");
  });

  it("respects a caller-supplied allow-list narrower than QUERY_KEYS", () => {
    const loc: LocationLike = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: "?ver=v9&lens=scores",
    };
    expect(buildPageLocation(loc, ["ver"])).toBe("https://x.test/atlas/?ver=v9");
  });

  it("the default allow-list is exactly state/types.ts's QUERY_KEYS (single source of truth)", () => {
    const search = QUERY_KEYS.map((k) => `${k}=x`).join("&");
    const loc: LocationLike = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: `?${search}`,
    };
    const out = buildPageLocation(loc);
    for (const key of QUERY_KEYS) expect(out).toContain(`${key}=x`);
  });

  // seeded fault: the hash included in page_location. LocationLike has no `hash` field, so this
  // proves the guarantee holds even when handed an object that DOES carry one (as window.location
  // would) — buildPageLocation must never read it.
  it("seeded fault: never includes the hash, even when the input object also carries one", () => {
    const locWithHash: LocationLike & { hash: string } = {
      origin: "https://x.test",
      pathname: "/atlas/",
      search: "?ver=v9",
      hash: "#pl=z.pa.1,2,3~t=Sensitive%20Report%20Title",
    };
    const out = buildPageLocation(locWithHash);
    expect(out).not.toContain("#");
    expect(out).not.toContain("pl=z.pa");
    expect(out).not.toContain("Sensitive");
    expect(out).toBe("https://x.test/atlas/?ver=v9");
  });

  it("hash-only keys (pl, t) are never in the query allow-list to begin with", () => {
    const keys: readonly string[] = QUERY_KEYS;
    expect(keys.includes("pl")).toBe(false);
    expect(keys.includes("t")).toBe(false);
  });
});
