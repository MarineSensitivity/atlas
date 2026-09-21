import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_GEOMETRY,
  loadPanelGeometry,
  panelStorageKey,
  savePanelGeometry,
  viewportBucket,
} from "../../src/lib/ui/panelGeometry";

/** an in-memory Storage stand-in, so these tests never touch a real browser */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe("viewportBucket (spec.md §10: matchMedia(max-width: 899px))", () => {
  it("390px (phone) is the phone bucket", () => {
    expect(viewportBucket(390)).toBe("phone");
  });
  it("899px is still the phone bucket (inclusive of the breakpoint)", () => {
    expect(viewportBucket(899)).toBe("phone");
  });
  it("900px and 1280px are the desktop bucket", () => {
    expect(viewportBucket(900)).toBe("desktop");
    expect(viewportBucket(1280)).toBe("desktop");
  });
});

describe("panel geometry persistence (chrome only, per viewport size, never the URL)", () => {
  it("keys are namespaced per panel id AND viewport bucket", () => {
    expect(panelStorageKey("layers", "desktop")).toBe("atlas.panel.layers.desktop");
    expect(panelStorageKey("layers", "phone")).not.toBe(panelStorageKey("layers", "desktop"));
  });

  it("falls back to the default geometry when nothing is stored", () => {
    expect(loadPanelGeometry(fakeStorage(), "layers", "desktop")).toEqual(DEFAULT_PANEL_GEOMETRY);
  });

  it("falls back to the default when storage is unavailable (private mode, SSR)", () => {
    expect(loadPanelGeometry(null, "layers", "desktop")).toEqual(DEFAULT_PANEL_GEOMETRY);
    expect(loadPanelGeometry(undefined, "layers", "desktop")).toEqual(DEFAULT_PANEL_GEOMETRY);
  });

  it("round-trips a saved geometry", () => {
    const storage = fakeStorage();
    savePanelGeometry(storage, "layers", "desktop", { collapsed: true, detent: "full" });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual({
      collapsed: true,
      detent: "full",
    });
  });

  it("desktop and phone geometry for the same panel do not collide", () => {
    const storage = fakeStorage();
    savePanelGeometry(storage, "layers", "desktop", { collapsed: false, detent: "full" });
    savePanelGeometry(storage, "layers", "phone", { collapsed: true, detent: "half" });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual({
      collapsed: false,
      detent: "full",
    });
    expect(loadPanelGeometry(storage, "layers", "phone")).toEqual({
      collapsed: true,
      detent: "half",
    });
  });

  it("falls back to the default on malformed JSON", () => {
    const storage = fakeStorage({ "atlas.panel.layers.desktop": "{not json" });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual(DEFAULT_PANEL_GEOMETRY);
  });

  it("falls back to the default when the stored shape is wrong (e.g. an invalid detent)", () => {
    const storage = fakeStorage({
      "atlas.panel.layers.desktop": JSON.stringify({ collapsed: false, detent: "quarter" }),
    });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual(DEFAULT_PANEL_GEOMETRY);
  });

  it("save never throws even if the storage itself throws (quota, private mode)", () => {
    const throwing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() =>
      savePanelGeometry(throwing, "layers", "desktop", DEFAULT_PANEL_GEOMETRY),
    ).not.toThrow();
  });
});
