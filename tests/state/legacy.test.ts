import { describe, expect, it } from "vitest";
import { NO_ALIAS_LOOKUP, rewriteLegacyParams, type AliasLookup } from "../../src/lib/state/legacy";

describe("rewriteLegacyParams: mdl_key / mdl_seq -> sp (+ in via the alias lookup)", () => {
  it("mdl_key becomes sp, and mdl_key/mdl_seq are both removed", () => {
    const params = new URLSearchParams("mdl_key=abc123");
    rewriteLegacyParams(params);
    expect(params.get("sp")).toBe("abc123");
    expect(params.has("mdl_key")).toBe(false);
    expect(params.has("mdl_seq")).toBe(false);
  });

  it("mdl_seq becomes sp when there is no mdl_key", () => {
    const params = new URLSearchParams("mdl_seq=54238");
    rewriteLegacyParams(params);
    expect(params.get("sp")).toBe("54238");
  });

  it("mdl_key is preferred over mdl_seq when both are present (the stable public id)", () => {
    const params = new URLSearchParams("mdl_key=abc123&mdl_seq=999");
    rewriteLegacyParams(params);
    expect(params.get("sp")).toBe("abc123");
  });

  it("never clobbers an already-modern sp value", () => {
    const params = new URLSearchParams("mdl_key=abc123&sp=already-modern");
    rewriteLegacyParams(params);
    expect(params.get("sp")).toBe("already-modern");
  });

  it("with NO_ALIAS_LOOKUP, no `in` is resolved", () => {
    const params = new URLSearchParams("mdl_key=abc123");
    rewriteLegacyParams(params, NO_ALIAS_LOOKUP);
    expect(params.has("in")).toBe(false);
  });

  it("an injected alias lookup can resolve `in` from the raw key", () => {
    const alias: AliasLookup = {
      resolveInput: (rawKey) => (rawKey === "abc123" ? { in: "raw_ds_9" } : null),
    };
    const params = new URLSearchParams("mdl_key=abc123");
    rewriteLegacyParams(params, alias);
    expect(params.get("in")).toBe("raw_ds_9");
  });

  it("never clobbers an already-present `in`, even when the alias resolves one", () => {
    const alias: AliasLookup = { resolveInput: () => ({ in: "resolved" }) };
    const params = new URLSearchParams("mdl_key=abc123&in=explicit");
    rewriteLegacyParams(params, alias);
    expect(params.get("in")).toBe("explicit");
  });

  it("no mdl_key/mdl_seq at all: sp is left untouched", () => {
    const params = new URLSearchParams("sp=modern");
    rewriteLegacyParams(params);
    expect(params.get("sp")).toBe("modern");
  });
});

describe("rewriteLegacyParams: splash=false -> tour=off", () => {
  it("rewrites splash=false to tour=off and removes splash", () => {
    const params = new URLSearchParams("splash=false");
    rewriteLegacyParams(params);
    expect(params.get("tour")).toBe("off");
    expect(params.has("splash")).toBe(false);
  });

  it("never clobbers an already-present tour value", () => {
    const params = new URLSearchParams("splash=false&tour=on");
    rewriteLegacyParams(params);
    expect(params.get("tour")).toBe("on");
  });

  it("any other splash= value is dropped (not a recognized legacy token)", () => {
    const params = new URLSearchParams("splash=true");
    rewriteLegacyParams(params);
    expect(params.has("splash")).toBe(false);
    expect(params.has("tour")).toBe(false);
  });
});

describe("rewriteLegacyParams: er_clr is kept as-is (the debug overlay)", () => {
  it("is neither deleted nor renamed", () => {
    const params = new URLSearchParams("er_clr=1");
    rewriteLegacyParams(params);
    expect(params.get("er_clr")).toBe("1");
  });

  it("does not trigger the mdl_key/mdl_seq sp rewrite", () => {
    const params = new URLSearchParams("er_clr=1");
    rewriteLegacyParams(params);
    expect(params.has("sp")).toBe(false);
  });
});
