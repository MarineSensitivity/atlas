import { describe, expect, it } from "vitest";
import {
  clampPanelSize,
  DEFAULT_PANEL_GEOMETRY,
  loadPanelGeometry,
  PANEL_SIZE_MAX,
  PANEL_SIZE_MIN,
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

describe("clampPanelSize (R1: 320-720 px)", () => {
  it("passes a value already in range through untouched", () => {
    expect(clampPanelSize(500)).toBe(500);
  });
  it("clamps below the floor", () => {
    expect(clampPanelSize(10)).toBe(PANEL_SIZE_MIN);
  });
  it("clamps above the ceiling", () => {
    expect(clampPanelSize(5000)).toBe(PANEL_SIZE_MAX);
  });
  it("rounds a fractional size", () => {
    expect(clampPanelSize(400.6)).toBe(401);
  });
  it("falls back to the default on a non-finite value", () => {
    expect(clampPanelSize(NaN)).toBe(DEFAULT_PANEL_GEOMETRY.size);
    expect(clampPanelSize(Infinity)).toBe(DEFAULT_PANEL_GEOMETRY.size);
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
    savePanelGeometry(storage, "layers", "desktop", {
      collapsed: true,
      maximized: false,
      dock: "left",
      size: 420,
    });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual({
      collapsed: true,
      maximized: false,
      dock: "left",
      size: 420,
    });
  });

  it("round-trips a maximized, bottom-docked geometry", () => {
    const storage = fakeStorage();
    savePanelGeometry(storage, "layers", "desktop", {
      collapsed: false,
      maximized: true,
      dock: "bottom",
      size: 500,
    });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual({
      collapsed: false,
      maximized: true,
      dock: "bottom",
      size: 500,
    });
  });

  it("clamps a stored size back into range on load (a manually-edited or stale value)", () => {
    const storage = fakeStorage({
      "atlas.panel.layers.desktop": JSON.stringify({
        collapsed: false,
        maximized: false,
        dock: "right",
        size: 5,
      }),
    });
    expect(loadPanelGeometry(storage, "layers", "desktop").size).toBe(PANEL_SIZE_MIN);
  });

  it("desktop and phone geometry for the same panel do not collide", () => {
    const storage = fakeStorage();
    savePanelGeometry(storage, "layers", "desktop", {
      collapsed: false,
      maximized: false,
      dock: "right",
      size: 400,
    });
    savePanelGeometry(storage, "layers", "phone", {
      collapsed: true,
      maximized: false,
      dock: "bottom",
      size: 500,
    });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual({
      collapsed: false,
      maximized: false,
      dock: "right",
      size: 400,
    });
    expect(loadPanelGeometry(storage, "layers", "phone")).toEqual({
      collapsed: true,
      maximized: false,
      dock: "bottom",
      size: 500,
    });
  });

  it("falls back to the default on malformed JSON", () => {
    const storage = fakeStorage({ "atlas.panel.layers.desktop": "{not json" });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual(DEFAULT_PANEL_GEOMETRY);
  });

  it("falls back to the default when the stored shape is wrong (e.g. an invalid dock)", () => {
    const storage = fakeStorage({
      "atlas.panel.layers.desktop": JSON.stringify({
        collapsed: false,
        maximized: false,
        dock: "top",
        size: 400,
      }),
    });
    expect(loadPanelGeometry(storage, "layers", "desktop")).toEqual(DEFAULT_PANEL_GEOMETRY);
  });

  it("falls back to the default on the OLD (pre-R1) 'detent' shape -- no silent migration", () => {
    const storage = fakeStorage({
      "atlas.panel.layers.desktop": JSON.stringify({ collapsed: true, detent: "half" }),
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
