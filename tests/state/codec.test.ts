import { describe, expect, it } from "vitest";
import { formatSel, parseSel, type UrlLike } from "../../src/lib/state/codec";
import { DEFAULT_SEL, defaultLens, defaultOut, type Sel } from "../../src/lib/state/types";
import type { AliasLookup } from "../../src/lib/state/legacy";

const EMPTY: UrlLike = { search: "", hash: "" };

describe("parseSel: the shipped default view is the empty URL", () => {
  it("with no query and no hash, every field equals DEFAULT_SEL", () => {
    expect(parseSel(EMPTY)).toEqual(DEFAULT_SEL);
  });
});

describe("formatSel: emits ONLY non-default fields (the seeded fault: a default value in the URL)", () => {
  it("DEFAULT_SEL formats to an empty search and an empty hash", () => {
    expect(formatSel(DEFAULT_SEL)).toEqual({ search: "", hash: "" });
  });

  it("a single non-default field writes exactly one key", () => {
    expect(formatSel({ ...DEFAULT_SEL, pal: "viridis" }).search).toBe("?pal=viridis");
  });

  it("setting a field back to its default omits it again", () => {
    const sel: Sel = { ...DEFAULT_SEL, pal: "viridis" };
    sel.pal = DEFAULT_SEL.pal;
    expect(formatSel(sel).search).toBe("");
  });
});

describe("lens: default 'scores', or 'species' when sp is present", () => {
  it("parses to 'scores' with no sp", () => {
    expect(parseSel(EMPTY).lens).toBe("scores");
  });

  it("parses to 'species' when sp is present and lens is unset", () => {
    expect(parseSel({ search: "?sp=whale-x", hash: "" }).lens).toBe("species");
  });

  it("an explicit lens overrides the sp-derived default", () => {
    expect(parseSel({ search: "?sp=whale-x&lens=scores", hash: "" }).lens).toBe("scores");
  });

  it("formatSel omits lens when it equals the sp-derived default", () => {
    // out must also be set to ITS (species-lens) default here, or it would be written too —
    // covered on its own in the "out" describe block below.
    expect(
      formatSel({ ...DEFAULT_SEL, sp: "whale-x", lens: "species", out: defaultOut("species") })
        .search,
    ).toBe("?sp=whale-x");
  });

  it("formatSel writes lens when it does NOT equal the sp-derived default", () => {
    const search = formatSel({ ...DEFAULT_SEL, sp: "whale-x", lens: "scores" }).search;
    expect(search).toContain("lens=scores");
  });

  it("an unrecognized lens value falls back to the (contextual) default", () => {
    expect(parseSel({ search: "?lens=bogus", hash: "" }).lens).toBe("scores");
    expect(parseSel({ search: "?sp=x&lens=bogus", hash: "" }).lens).toBe("species");
  });
});

describe("out: default is 'per lens' (defaultOut), pinned so a change is a deliberate diff", () => {
  it("defaultOut('scores') is 'programarea'", () => {
    expect(defaultOut("scores")).toBe("programarea");
  });

  it("defaultOut('species') is 'none'", () => {
    expect(defaultOut("species")).toBe("none");
  });

  it("parses the scores-lens default with no out key", () => {
    expect(parseSel(EMPTY).out).toBe("programarea");
  });

  it("parses the species-lens default with no out key", () => {
    expect(parseSel({ search: "?lens=species", hash: "" }).out).toBe("none");
  });

  it("an explicit out overrides the lens-derived default", () => {
    expect(parseSel({ search: "?out=ecoregion", hash: "" }).out).toBe("ecoregion");
  });

  it("an unrecognized out value falls back to the lens-derived default", () => {
    expect(parseSel({ search: "?out=bogus", hash: "" }).out).toBe("programarea");
  });

  it("formatSel omits out when it equals the lens-derived default", () => {
    expect(formatSel({ ...DEFAULT_SEL, lens: "species", out: "none" }).search).toBe(
      "?lens=species",
    );
  });
});

describe("pal: enum, default spectral_r", () => {
  it("accepts every documented value", () => {
    for (const v of ["spectral_r", "viridis", "cividis", "magma"]) {
      expect(parseSel({ search: `?pal=${v}`, hash: "" }).pal).toBe(v);
    }
  });

  it("an unknown value falls back to spectral_r", () => {
    expect(parseSel({ search: "?pal=rainbow", hash: "" }).pal).toBe("spectral_r");
  });
});

describe("proj / rep / theme / tour: enums with fixed defaults", () => {
  it("proj defaults to globe and clamps garbage", () => {
    expect(parseSel(EMPTY).proj).toBe("globe");
    expect(parseSel({ search: "?proj=flat", hash: "" }).proj).toBe("globe");
    expect(parseSel({ search: "?proj=mercator", hash: "" }).proj).toBe("mercator");
  });

  it("rep defaults to native and clamps garbage", () => {
    expect(parseSel(EMPTY).rep).toBe("native");
    expect(parseSel({ search: "?rep=bogus", hash: "" }).rep).toBe("native");
    expect(parseSel({ search: "?rep=model", hash: "" }).rep).toBe("model");
  });

  it("theme defaults to light and clamps garbage", () => {
    expect(parseSel(EMPTY).theme).toBe("light");
    expect(parseSel({ search: "?theme=blue", hash: "" }).theme).toBe("light");
    expect(parseSel({ search: "?theme=dark", hash: "" }).theme).toBe("dark");
  });

  it("tour defaults to on; only tour=off is ever written or read as off", () => {
    expect(parseSel(EMPTY).tour).toBe("on");
    expect(parseSel({ search: "?tour=off", hash: "" }).tour).toBe("off");
    expect(parseSel({ search: "?tour=bogus", hash: "" }).tour).toBe("on");
    expect(formatSel({ ...DEFAULT_SEL, tour: "on" }).search).toBe("");
    expect(formatSel({ ...DEFAULT_SEL, tour: "off" }).search).toBe("?tour=off");
  });
});

describe("us: default true (US-only); only us=0 turns it off", () => {
  it("defaults to true with no key", () => {
    expect(parseSel(EMPTY).us).toBe(true);
  });

  it("us=0 parses to false", () => {
    expect(parseSel({ search: "?us=0", hash: "" }).us).toBe(false);
  });

  it("any other value (including us=1) falls back to the default true", () => {
    expect(parseSel({ search: "?us=1", hash: "" }).us).toBe(true);
    expect(parseSel({ search: "?us=bogus", hash: "" }).us).toBe(true);
  });

  it("formatSel writes us=0 only when false, and never writes us=1", () => {
    expect(formatSel({ ...DEFAULT_SEL, us: false }).search).toBe("?us=0");
    expect(formatSel({ ...DEFAULT_SEL, us: true }).search).toBe("");
  });
});

describe("obis: default false (off); only obis=1 turns it on", () => {
  it("defaults to false", () => {
    expect(parseSel(EMPTY).obis).toBe(false);
  });

  it("obis=1 parses to true; anything else is false", () => {
    expect(parseSel({ search: "?obis=1", hash: "" }).obis).toBe(true);
    expect(parseSel({ search: "?obis=true", hash: "" }).obis).toBe(false);
  });

  it("formatSel writes obis=1 only when true", () => {
    expect(formatSel({ ...DEFAULT_SEL, obis: true }).search).toBe("?obis=1");
    expect(formatSel({ ...DEFAULT_SEL, obis: false }).search).toBe("");
  });
});

describe("ver / lyr / unit / area / in / sp: free-form strings, structural clamping only", () => {
  it("ver accepts a well-formed version label and rejects garbage", () => {
    expect(parseSel({ search: "?ver=v9", hash: "" }).ver).toBe("v9");
    expect(parseSel({ search: "?ver=latest", hash: "" }).ver).toBeUndefined();
    expect(parseSel({ search: "?ver=../etc", hash: "" }).ver).toBeUndefined();
  });

  it("lyr/unit/area/in/sp round-trip an arbitrary opaque string", () => {
    const sel = parseSel({
      search: "?lyr=extrisk_bird&unit=ecoregion&area=GEO&in=raw_ds_1&sp=whale-x",
      hash: "",
    });
    expect(sel.lyr).toBe("extrisk_bird");
    expect(sel.unit).toBe("ecoregion");
    expect(sel.area).toBe("GEO");
    expect(sel.in).toBe("raw_ds_1");
    expect(sel.sp).toBe("whale-x");
  });

  it("unit and area fall back to their defaults on an empty value", () => {
    expect(parseSel({ search: "?unit=&area=", hash: "" }).unit).toBe("cell");
    expect(parseSel({ search: "?unit=&area=", hash: "" }).area).toBe("FULL");
  });

  it("in falls back to its default ('merged') on an empty value", () => {
    expect(parseSel({ search: "?in=", hash: "" }).in).toBe("merged");
  });

  it("lyr/sp fall back to undefined (their default) on an empty value", () => {
    expect(parseSel({ search: "?lyr=&sp=", hash: "" }).lyr).toBeUndefined();
    expect(parseSel({ search: "?lyr=&sp=", hash: "" }).sp).toBeUndefined();
  });
});

describe("sel: cell:<id> | zone:<unit>:<key> | place:<n>, clamps anything else", () => {
  it("accepts each documented shape", () => {
    expect(parseSel({ search: "?sel=cell:12345", hash: "" }).sel).toBe("cell:12345");
    expect(parseSel({ search: "?sel=zone:programarea:GEO", hash: "" }).sel).toBe(
      "zone:programarea:GEO",
    );
    expect(parseSel({ search: "?sel=place:3", hash: "" }).sel).toBe("place:3");
  });

  it("clamps a malformed token to undefined rather than passing it through", () => {
    expect(parseSel({ search: "?sel=bogus", hash: "" }).sel).toBeUndefined();
    expect(parseSel({ search: "?sel=place:abc", hash: "" }).sel).toBeUndefined();
    expect(parseSel({ search: "?sel=zone:onlyone", hash: "" }).sel).toBeUndefined();
  });
});

describe("show / hide: comma-joined panel-id deltas, default empty", () => {
  it("defaults to an empty array", () => {
    expect(parseSel(EMPTY).show).toEqual([]);
    expect(parseSel(EMPTY).hide).toEqual([]);
  });

  it("splits a comma-joined list and drops blank tokens", () => {
    expect(parseSel({ search: "?show=legend,,flowers", hash: "" }).show).toEqual([
      "legend",
      "flowers",
    ]);
  });

  it("formatSel joins back with commas, and omits the key when empty", () => {
    expect(formatSel({ ...DEFAULT_SEL, show: ["legend", "flowers"] }).search).toBe(
      "?show=legend,flowers",
    );
    expect(formatSel({ ...DEFAULT_SEL, show: [] }).search).toBe("");
  });
});

describe("map: lon,lat,zoom[,bearing,pitch], default undefined (preset applies)", () => {
  it("parses a 3-field tuple", () => {
    expect(parseSel({ search: "?map=-122.4,37.8,6", hash: "" }).map).toEqual({
      lon: -122.4,
      lat: 37.8,
      zoom: 6,
    });
  });

  it("parses a 5-field tuple (bearing, pitch travel together)", () => {
    expect(parseSel({ search: "?map=-122.4,37.8,6,45,30", hash: "" }).map).toEqual({
      lon: -122.4,
      lat: 37.8,
      zoom: 6,
      bearing: 45,
      pitch: 30,
    });
  });

  it("clamps a wrong field count (4) to undefined — falls back to the area preset", () => {
    expect(parseSel({ search: "?map=-122.4,37.8,6,45", hash: "" }).map).toBeUndefined();
  });

  it("clamps a non-numeric field to undefined", () => {
    expect(parseSel({ search: "?map=abc,37.8,6", hash: "" }).map).toBeUndefined();
  });

  it("formatSel round-trips both tuple shapes", () => {
    expect(formatSel({ ...DEFAULT_SEL, map: { lon: -122.4, lat: 37.8, zoom: 6 } }).search).toBe(
      "?map=-122.4,37.8,6",
    );
    expect(
      formatSel({
        ...DEFAULT_SEL,
        map: { lon: -122.4, lat: 37.8, zoom: 6, bearing: 45, pitch: 30 },
      }).search,
    ).toBe("?map=-122.4,37.8,6,45,30");
  });
});

describe("hash: #pl and #t only, never mixed with the query (the seeded fault: hash copied into query)", () => {
  it("pl and t parse from the hash, not the query", () => {
    const sel = parseSel({ search: "", hash: "#pl=g1.a.b~z.pa.1&t=My%20Report" });
    expect(sel.pl).toBe("g1.a.b~z.pa.1");
    expect(sel.t).toBe("My Report");
  });

  it("pl/t in the QUERY position are ignored (they only ever live in the hash)", () => {
    const sel = parseSel({ search: "?pl=g1.a.b&t=Ignored", hash: "" });
    expect(sel.pl).toBeUndefined();
    expect(sel.t).toBeUndefined();
  });

  it("formatSel writes pl/t ONLY into the hash, never the search", () => {
    const { search, hash } = formatSel({ ...DEFAULT_SEL, pl: "g1.a.b", t: "Title" });
    expect(search).toBe("");
    expect(hash).toBe("#pl=g1.a.b&t=Title");
  });

  it("no other field is ever written into the hash", () => {
    const { hash } = formatSel({ ...DEFAULT_SEL, pal: "viridis", lens: "species", sp: "x" });
    expect(hash).toBe("");
  });

  it("`,`/`:` inside the place codec survive the hash un-escaped", () => {
    const pl = "z.pa.1,2,3";
    const { hash } = formatSel({ ...DEFAULT_SEL, pl });
    expect(hash).toBe(`#pl=${pl}`);
    expect(parseSel({ search: "", hash }).pl).toBe(pl);
  });
});

describe("readability: `,` and `:` are un-escaped in the emitted URL", () => {
  it("a comma-joined show list is not percent-encoded", () => {
    const { search } = formatSel({ ...DEFAULT_SEL, show: ["a", "b"] });
    expect(search).not.toContain("%2C");
    expect(search).toBe("?show=a,b");
  });

  it("a colon inside sel is not percent-encoded", () => {
    const { search } = formatSel({ ...DEFAULT_SEL, sel: "zone:programarea:GEO" });
    expect(search).not.toContain("%3A");
    expect(search).toBe("?sel=zone:programarea:GEO");
  });
});

describe("unknown keys are ignored; unknown values fall back to defaults", () => {
  it("an unrecognized query key is dropped silently, not surfaced as an error", () => {
    expect(() => parseSel({ search: "?wat=1&foo=bar", hash: "" })).not.toThrow();
    const sel = parseSel({ search: "?wat=1&pal=viridis", hash: "" });
    expect(sel.pal).toBe("viridis");
    expect((sel as unknown as Record<string, unknown>).wat).toBeUndefined();
  });

  it("an unrecognized value on a known enum key falls back to the default, not an error", () => {
    expect(parseSel({ search: "?theme=neon", hash: "" }).theme).toBe("light");
  });

  it("a formatted-then-reparsed Sel never carries an unknown key forward", () => {
    const sel = parseSel({ search: "?wat=1&pal=viridis", hash: "" });
    const { search } = formatSel(sel);
    expect(search).not.toContain("wat");
  });
});

describe("parsing never throws, even given a hostile loc", () => {
  it("a loc whose search/hash getters throw resolves to DEFAULT_SEL, not an exception", () => {
    const hostile: UrlLike = {
      get search(): string {
        throw new Error("boom");
      },
      hash: "",
    };
    expect(() => parseSel(hostile)).not.toThrow();
    expect(parseSel(hostile)).toEqual(DEFAULT_SEL);
  });

  it("null/undefined-ish search and hash values do not throw", () => {
    expect(() => parseSel({ search: undefined as unknown as string, hash: "" })).not.toThrow();
  });
});

describe("er_clr (legacy debug overlay): tolerated, never rewritten, never round-tripped", () => {
  it("does not error and does not get treated as a legacy sp trigger", () => {
    const sel = parseSel({ search: "?er_clr=1&pal=viridis", hash: "" });
    expect(sel.pal).toBe("viridis");
    expect(sel.sp).toBeUndefined();
  });

  it("does not survive a format round-trip (it is not part of Sel)", () => {
    const sel = parseSel({ search: "?er_clr=1", hash: "" });
    expect(formatSel(sel).search).toBe("");
  });
});

describe("an injected AliasLookup is honoured for the sp/in legacy rewrite", () => {
  it("resolves `in` from a legacy mdl_key via the injected lookup", () => {
    const alias: AliasLookup = {
      resolveInput: (rawKey) => (rawKey === "42" ? { in: "raw_ds_1" } : null),
    };
    const sel = parseSel({ search: "?mdl_key=42", hash: "" }, alias);
    expect(sel.sp).toBe("42");
    expect(sel.in).toBe("raw_ds_1");
  });

  it("with NO_ALIAS_LOOKUP (the default), sp carries through with no `in` resolved", () => {
    const sel = parseSel({ search: "?mdl_seq=99", hash: "" });
    expect(sel.sp).toBe("99");
    expect(sel.in).toBe("merged"); // default, unresolved
  });
});

describe("defaultLens/defaultOut are pure (used identically by parse and format)", () => {
  it("defaultLens", () => {
    expect(defaultLens(undefined)).toBe("scores");
    expect(defaultLens("x")).toBe("species");
  });
});
