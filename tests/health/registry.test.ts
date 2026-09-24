// V3 (P round, 2026-09-24): the pure state machine — single-flight, exponential backoff (never a
// retry storm when dozens of tiles fail at once), which service's banner wins, and the exact banner
// copy the brief's own worked example specifies.
import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  bannerFor,
  bannerMessage,
  beginProbe,
  canProbe,
  completeProbe,
  initialHealthState,
} from "../../src/lib/health/registry";
import type { ProbeResult, ServiceDef } from "../../src/lib/health/types";

const TILER: ServiceDef = {
  id: "tiler",
  url: "https://titiler-v8.marinesensitivity.org/healthz",
  hostLabel: "titiler-v8.marinesensitivity.org",
  displayName: "Map tiles",
  whatBreaks: "Scores and species rasters cannot be drawn",
  stillWorks: "places, tables and reports from already-loaded data still work",
};
const DATA: ServiceDef = {
  id: "data",
  url: "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v9/app/boot.json",
  hostLabel: "s3.us-east-1.amazonaws.com",
  displayName: "Release data",
  whatBreaks: "New releases and cell/species data cannot be loaded",
  stillWorks: "the current map view and already-loaded panels still work",
};

function down(reason: string, checkedAt = 1000): ProbeResult {
  return { status: "down", url: TILER.url, reason, checkedAt };
}
function ok(checkedAt = 1000): ProbeResult {
  return { status: "ok", url: TILER.url, checkedAt };
}

describe("backoffDelayMs: exponential, capped", () => {
  it("attempt 0 (no failure yet) needs no backoff", () => {
    expect(backoffDelayMs(0, { baseDelayMs: 3000, maxDelayMs: 60_000 })).toBe(0);
  });
  it("attempt 1 -> base, 2 -> 2x, 3 -> 4x", () => {
    const opts = { baseDelayMs: 3000, maxDelayMs: 60_000 };
    expect(backoffDelayMs(1, opts)).toBe(3000);
    expect(backoffDelayMs(2, opts)).toBe(6000);
    expect(backoffDelayMs(3, opts)).toBe(12_000);
  });
  it("caps at maxDelayMs however high attempt climbs", () => {
    expect(backoffDelayMs(20, { baseDelayMs: 3000, maxDelayMs: 60_000 })).toBe(60_000);
  });
});

describe("canProbe: single-flight — max one probe in flight per service, no exceptions", () => {
  it("refuses while inFlight, even with force: true (a Retry click during an in-flight probe is a no-op)", () => {
    const entry = { attempt: 1, inFlight: true, lastProbeAt: 0 };
    expect(canProbe(entry, 100, { force: true })).toBe(false);
  });

  it("allows a first-ever probe (no prior result) immediately, no backoff", () => {
    expect(canProbe(undefined, 0)).toBe(true);
  });

  it("allows immediately when the last result was ok (no backoff needed for a healthy service)", () => {
    const entry = { attempt: 0, inFlight: false, lastProbeAt: 1000, result: ok(1000) };
    expect(canProbe(entry, 1001, { baseDelayMs: 3000 })).toBe(true);
  });
});

describe("canProbe: exponential backoff after a confirmed 'down' — this is the anti-storm gate", () => {
  const entry = { attempt: 1, inFlight: false, lastProbeAt: 1000, result: down("HTTP 503", 1000) };

  it("refuses a second automatic re-probe before backoffDelayMs has elapsed", () => {
    expect(canProbe(entry, 1000 + 2999, { baseDelayMs: 3000 })).toBe(false);
  });

  it("allows it once backoffDelayMs has elapsed", () => {
    expect(canProbe(entry, 1000 + 3000, { baseDelayMs: 3000 })).toBe(true);
  });

  it("force: true (the Retry button) bypasses backoff entirely, even 1ms after the failure", () => {
    expect(canProbe(entry, 1001, { baseDelayMs: 3000, force: true })).toBe(true);
  });
});

describe("beginProbe / completeProbe: attempt count resets on ok, climbs on down", () => {
  it("a fresh state has attempt 0 and no result for every registered id", () => {
    const state = initialHealthState(["tiler", "data"]);
    expect(state.tiler).toEqual({ attempt: 0, inFlight: false });
    expect(state.data).toEqual({ attempt: 0, inFlight: false });
  });

  it("beginProbe marks inFlight and records lastProbeAt", () => {
    const state = beginProbe(initialHealthState(["tiler"]), "tiler", 500);
    expect(state.tiler).toMatchObject({ inFlight: true, lastProbeAt: 500 });
  });

  it("completeProbe with a down result increments attempt and clears inFlight", () => {
    let state = beginProbe(initialHealthState(["tiler"]), "tiler", 500);
    state = completeProbe(state, "tiler", down("timeout", 600));
    expect(state.tiler).toMatchObject({ inFlight: false, attempt: 1 });
  });

  it("a SECOND down completion climbs attempt to 2 (drives the next backoff tier)", () => {
    let state = beginProbe(initialHealthState(["tiler"]), "tiler", 500);
    state = completeProbe(state, "tiler", down("timeout", 600));
    state = beginProbe(state, "tiler", 700);
    state = completeProbe(state, "tiler", down("HTTP 503", 800));
    expect(state.tiler?.attempt).toBe(2);
  });

  it("an ok completion resets attempt to 0, even after prior failures", () => {
    let state = beginProbe(initialHealthState(["tiler"]), "tiler", 500);
    state = completeProbe(state, "tiler", down("timeout", 600));
    state = beginProbe(state, "tiler", 700);
    state = completeProbe(state, "tiler", ok(800));
    expect(state.tiler?.attempt).toBe(0);
  });
});

describe("bannerFor: only a confirmed 'down' raises a banner; 'slow' never does", () => {
  it("no banner when every registered service is ok/unprobed", () => {
    const state = initialHealthState(["tiler", "data"]);
    expect(bannerFor(state, [TILER, DATA])).toBeNull();
  });

  it("no banner for 'slow' — latency alone is not a failure the brief asks to surface", () => {
    let state = beginProbe(initialHealthState(["tiler"]), "tiler", 0);
    state = completeProbe(state, "tiler", { status: "slow", url: TILER.url, checkedAt: 100 });
    expect(bannerFor(state, [TILER])).toBeNull();
  });

  it("a confirmed down raises the banner for that service, carrying its result", () => {
    let state = beginProbe(initialHealthState(["tiler"]), "tiler", 0);
    state = completeProbe(state, "tiler", down("HTTP 503"));
    const banner = bannerFor(state, [TILER]);
    expect(banner?.def.id).toBe("tiler");
    expect(banner?.result.reason).toBe("HTTP 503");
  });

  it("when both are down, the FIRST service in defs order wins (tiler before data)", () => {
    let state = initialHealthState(["tiler", "data"]);
    state = completeProbe(beginProbe(state, "tiler", 0), "tiler", down("timeout"));
    state = completeProbe(beginProbe(state, "data", 0), "data", down("HTTP 500"));
    expect(bannerFor(state, [TILER, DATA])?.def.id).toBe("tiler");
    expect(bannerFor(state, [DATA, TILER])?.def.id).toBe("data");
  });
});

describe("bannerMessage: the exact copy the brief's worked example specifies", () => {
  it("matches the brief's own worked example verbatim (tiler, timeout)", () => {
    const result: ProbeResult = { status: "down", url: TILER.url, reason: "timeout", checkedAt: 0 };
    expect(bannerMessage(TILER, result)).toBe(
      "Map tiles unavailable: titiler-v8.marinesensitivity.org is not responding (timeout). " +
        "Scores and species rasters cannot be drawn; places, tables and reports from " +
        "already-loaded data still work.",
    );
  });

  it("names the data origin and its own reason for the data service", () => {
    const result: ProbeResult = { status: "down", url: DATA.url, reason: "HTTP 503", checkedAt: 0 };
    expect(bannerMessage(DATA, result)).toBe(
      "Release data unavailable: s3.us-east-1.amazonaws.com is not responding (HTTP 503). " +
        "New releases and cell/species data cannot be loaded; the current map view and " +
        "already-loaded panels still work.",
    );
  });

  it("never uses a blame word — plain, factual failure vocabulary only", () => {
    const result: ProbeResult = { status: "down", url: TILER.url, reason: "timeout", checkedAt: 0 };
    const text = bannerMessage(TILER, result).toLowerCase();
    for (const blame of ["broken", "error occurred", "failed due to", "our fault", "sorry"]) {
      expect(text).not.toContain(blame);
    }
  });
});
