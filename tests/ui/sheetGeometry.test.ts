import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHEET_DETENT,
  legendChipMode,
  loadSheetDetent,
  saveSheetDetent,
  sheetStorageKey,
} from "../../src/lib/ui/sheetGeometry";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("sheet detent persistence (peek / half / full, no viewport bucket needed)", () => {
  it("keys are namespaced per sheet id", () => {
    expect(sheetStorageKey("place")).toBe("atlas.sheet.place");
  });

  it("falls back to the default (half) when nothing is stored", () => {
    expect(loadSheetDetent(fakeStorage(), "place")).toBe(DEFAULT_SHEET_DETENT);
  });

  it("falls back to the default when storage is unavailable", () => {
    expect(loadSheetDetent(null, "place")).toBe(DEFAULT_SHEET_DETENT);
    expect(loadSheetDetent(undefined, "place")).toBe(DEFAULT_SHEET_DETENT);
  });

  it("round-trips each of the three detents", () => {
    const storage = fakeStorage();
    for (const detent of ["peek", "half", "full"] as const) {
      saveSheetDetent(storage, "place", detent);
      expect(loadSheetDetent(storage, "place")).toBe(detent);
    }
  });

  it("falls back to the default on a stored value that is not a valid detent", () => {
    const storage = fakeStorage({ "atlas.sheet.place": "quarter" });
    expect(loadSheetDetent(storage, "place")).toBe(DEFAULT_SHEET_DETENT);
  });

  it("save never throws even if the storage itself throws", () => {
    const throwing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveSheetDetent(throwing, "place", "full")).not.toThrow();
  });
});

describe("legendChipMode (P1: the phone legend chip's placement rule)", () => {
  it("floats above the sheet at peek", () => {
    expect(legendChipMode("peek")).toBe("floating");
  });

  it("floats above the sheet at half", () => {
    expect(legendChipMode("half")).toBe("floating");
  });

  it("moves inside the sheet's own header block at full -- no room to float above it", () => {
    expect(legendChipMode("full")).toBe("inline");
  });
});
