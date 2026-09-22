import { describe, expect, it } from "vitest";
import {
  clearRecents,
  loadRecents,
  MAX_RECENTS,
  pushRecent,
  recentPlace,
} from "../../src/places/recents";
import { encodePlace } from "../../src/lib/geo/placeCodec";

/** a minimal, in-memory Storage double -- no jsdom needed (vitest.config.ts runs environment: "node"). */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const TOKEN_A = encodePlace({ kind: "zone", set: "pa", keys: ["GAA"] });
const TOKEN_B = encodePlace({ kind: "zone", set: "pa", keys: ["WGA"] });

describe("loadRecents / pushRecent", () => {
  it("starts empty", () => {
    expect(loadRecents(fakeStorage())).toEqual([]);
  });

  it("pushes to the FRONT", () => {
    const s = fakeStorage();
    pushRecent(s, TOKEN_A);
    const after = pushRecent(s, TOKEN_B);
    expect(after).toEqual([TOKEN_B, TOKEN_A]);
  });

  it("de-duplicates: re-pushing an existing token moves it to the front, not a second copy", () => {
    const s = fakeStorage();
    pushRecent(s, TOKEN_A);
    pushRecent(s, TOKEN_B);
    const after = pushRecent(s, TOKEN_A);
    expect(after).toEqual([TOKEN_A, TOKEN_B]);
  });

  it(`caps at ${MAX_RECENTS}`, () => {
    const s = fakeStorage();
    for (let i = 0; i < MAX_RECENTS + 5; i++) {
      pushRecent(s, encodePlace({ kind: "zone", set: "pa", keys: [`Z${i}`] }));
    }
    expect(loadRecents(s)).toHaveLength(MAX_RECENTS);
  });

  it("null storage (private mode) is inert, never throws", () => {
    expect(loadRecents(null)).toEqual([]);
    expect(pushRecent(null, TOKEN_A)).toEqual([TOKEN_A]);
  });

  it("a corrupted value reads as no recents, not a throw", () => {
    const s = fakeStorage();
    s.setItem("atlas.places.recent", "{not json");
    expect(loadRecents(s)).toEqual([]);
  });
});

describe("clearRecents", () => {
  it("empties the list", () => {
    const s = fakeStorage();
    pushRecent(s, TOKEN_A);
    clearRecents(s);
    expect(loadRecents(s)).toEqual([]);
  });

  it("null storage is inert", () => {
    expect(() => clearRecents(null)).not.toThrow();
  });
});

describe("recentPlace", () => {
  it("decodes a valid token", () => {
    expect(recentPlace(TOKEN_A)).toEqual({ kind: "zone", set: "pa", keys: ["GAA"] });
  });

  it("answers null for an unparseable token, never throws", () => {
    expect(recentPlace("garbage")).toBeNull();
  });
});
