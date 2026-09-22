import { describe, expect, it, vi } from "vitest";
import { installPickMode, type PickMapLike } from "../../src/places/pickInstall";
import { zoneFillId, zoneKeyProperty, zoneNameProperty } from "../../src/lib/map/layers/zones";
import type { ZoneUnitSpec } from "../../src/lib/map/types";
import type { PickState } from "../../src/places/pick";

const UNIT: ZoneUnitSpec = {
  unit: "programarea",
  pmtiles: "https://s3.example/zones/programarea/zones.pmtiles",
  sourceLayer: "programarea",
};

/** a minimal fake map: every query returns ONE feature for whichever key `nextKey()` currently
 * names (defaults to always the same key) -- this test is about the click/long-press/modifier
 * WIRING, not hit resolution (covered by tests/map/interaction.test.ts and
 * tests/places/pick.test.ts). */
function fakeMap(nextKey: () => string) {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const map: PickMapLike = {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    queryRenderedFeatures() {
      const key = nextKey();
      return [
        {
          layer: { id: zoneFillId(UNIT.unit) },
          properties: { [zoneKeyProperty(UNIT.unit)]: key, [zoneNameProperty(UNIT.unit)]: key },
        },
      ];
    },
    project: () => ({ x: 0, y: 0 }),
  };
  const fire = (type: string, e: unknown = { point: { x: 1, y: 1 } }) => {
    for (const l of listeners.get(type) ?? []) l(e);
  };
  return { map, fire };
}

/** the fixed-key convenience most tests below want. */
function fakeMapOf(key: string) {
  return fakeMap(() => key);
}

describe("installPickMode", () => {
  it("a plain click resolves and reports a single-key pick", () => {
    const { map, fire } = fakeMapOf("GAA");
    const changes: PickState[] = [];
    installPickMode(map, [UNIT], (s) => changes.push(s));
    fire("click");
    expect(changes).toEqual([{ unit: "programarea", keys: ["GAA"] }]);
  });

  it("a ctrl-click on a DIFFERENT zone is a multi-select add", () => {
    const keys = ["GAA", "WGA"];
    const { map, fire } = fakeMap(() => keys.shift()!);
    const changes: PickState[] = [];
    installPickMode(map, [UNIT], (s) => changes.push(s));
    fire("click");
    fire("click", { point: { x: 1, y: 1 }, originalEvent: { ctrlKey: true } });
    expect(changes[changes.length - 1]).toEqual({ unit: "programarea", keys: ["GAA", "WGA"] });
  });

  it("a ctrl-click on the SAME already-picked zone toggles it back off (pick.ts's own rule)", () => {
    const { map, fire } = fakeMapOf("GAA");
    const changes: PickState[] = [];
    installPickMode(map, [UNIT], (s) => changes.push(s));
    fire("click");
    fire("click", { point: { x: 1, y: 1 }, originalEvent: { ctrlKey: true } });
    expect(changes[changes.length - 1]).toEqual({ unit: "programarea", keys: [] });
  });

  it("a long-press (touchstart held past the threshold) adds, and the FOLLOWING click is swallowed", () => {
    vi.useFakeTimers();
    try {
      const { map, fire } = fakeMapOf("WGA");
      const changes: PickState[] = [];
      installPickMode(map, [UNIT], (s) => changes.push(s));
      fire("touchstart");
      vi.advanceTimersByTime(600);
      expect(changes).toEqual([{ unit: "programarea", keys: ["WGA"] }]);
      fire("click"); // the browser's own synthesized click after a touch -- must not double-apply
      expect(changes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("touchend before the threshold cancels the long-press timer", () => {
    vi.useFakeTimers();
    try {
      const { map, fire } = fakeMapOf("WGA");
      const changes: PickState[] = [];
      installPickMode(map, [UNIT], (s) => changes.push(s));
      fire("touchstart");
      vi.advanceTimersByTime(100);
      fire("touchend");
      vi.advanceTimersByTime(600);
      expect(changes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uninstall stops every listener (a subsequent click reports nothing)", () => {
    const { map, fire } = fakeMapOf("GAA");
    const changes: PickState[] = [];
    const handle = installPickMode(map, [UNIT], (s) => changes.push(s));
    handle.uninstall();
    fire("click");
    expect(changes).toEqual([]);
  });

  it("uninstall is safe to call twice", () => {
    const { map } = fakeMapOf("GAA");
    const handle = installPickMode(map, [UNIT], () => {});
    handle.uninstall();
    expect(() => handle.uninstall()).not.toThrow();
  });
});
