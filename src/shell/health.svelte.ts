// Shell's own thin REACTIVE wrapper around src/lib/health's pure state machine. `$state` has to
// live here, not under src/lib/health/ -- tests/state/invariants.test.ts's atlas-2 Step 2 gate ("no
// module in src/lib imports svelte, except state/") keeps everything else in src/lib directly
// Node-testable, the same "wiring only, rules live in plain modules" split
// src/lens/species/state.svelte.ts already documents for its own reactive core.
import { DEFAULT_TITILER_HOST } from "../lib/raster/tiles";
import { classifyMapTileError } from "../lib/health/mapError";
import { probeUrl } from "../lib/health/probe";
import {
  bannerFor,
  beginProbe,
  canProbe,
  completeProbe,
  initialHealthState,
  type ActiveBanner,
  type HealthState,
} from "../lib/health/registry";
import { dataServiceDef, tilerServiceDef } from "../lib/health/services";
import type { ServiceDef, ServiceId } from "../lib/health/types";

export interface HealthStoreOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  slowMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  /** override only in a test -- production always uses the real titiler-v8 origin. */
  tilerHost?: string;
}

export interface HealthStore {
  /** the one service (if any) currently `"down"`, and its confirmed probe result -- `null` means
   * "show no banner". */
  readonly banner: ActiveBanner | null;
  /** drives ScoresLegend.svelte/SpeciesLegend.svelte's compact "tiles unavailable" state. */
  isDown(id: ServiceId): boolean;
  /** trigger (a), tiler half: call once at boot -- the tiler origin is a fixed constant, so this
   * never has to wait on anything. */
  probeTiler(): void;
  /** trigger (a), data half: call once `ver` resolves (`window.__early.version`). Registers the
   * `"data"` service on first call (its URL depends on `ver`, unlike the tiler's). `base`, when
   * given, is the resolved data origin `window.__early.base` carried (P round 2 fix: probe the
   * SAME base the release's own boot.json fetch used, not always the public bucket -- see
   * services.ts#dataServiceDef). */
  probeData(ver: string, base?: string): void;
  /** trigger (b): hand the map's raw `error` event straight from `map.on("error", ...)` -- this
   * classifies it itself (ignoring a missing-tile 403/404 and anything not under the tiler host)
   * and, for a real failure, kicks a backoff-gated re-probe; the banner's own text always comes
   * from that CONFIRMED probe, never the raw tile error. */
  reportMapError(error: unknown): void;
  /** trigger (c): the banner's own Retry button -- bypasses backoff, still single-flight. */
  retry(id: ServiceId): void;
}

/**
 * `tilerHost` is threaded through to both `tilerServiceDef` (the probe URL) and
 * `classifyMapTileError` (which service a failing map tile belongs to) so the two can never drift
 * to different hosts.
 */
export function createHealthStore(opts: HealthStoreOptions = {}): HealthStore {
  const tilerHost = opts.tilerHost ?? DEFAULT_TITILER_HOST;
  const tiler = tilerServiceDef(tilerHost);
  const now = opts.now ?? Date.now;

  let defs: ServiceDef[] = [tiler]; // tiler first: registry.ts#bannerFor's priority order
  let state = $state<HealthState>(initialHealthState(["tiler"]));

  function defFor(id: ServiceId): ServiceDef | undefined {
    return defs.find((d) => d.id === id);
  }

  async function run(id: ServiceId, def: ServiceDef, force: boolean): Promise<void> {
    if (
      !canProbe(state[id], now(), {
        baseDelayMs: opts.baseDelayMs,
        maxDelayMs: opts.maxDelayMs,
        force,
      })
    )
      return;
    state = beginProbe(state, id, now());
    const result = await probeUrl(def.url, {
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
      slowMs: opts.slowMs,
      now,
    });
    state = completeProbe(state, id, result);
  }

  return {
    get banner() {
      return bannerFor(state, defs);
    },
    isDown(id) {
      return state[id]?.result?.status === "down";
    },
    probeTiler() {
      void run("tiler", tiler, false);
    },
    probeData(ver: string, base?: string) {
      if (!defFor("data")) {
        defs = [...defs, dataServiceDef(ver, base)];
        state = { ...state, data: state.data ?? { attempt: 0, inFlight: false } };
      }
      const def = defFor("data");
      if (def) void run("data", def, false);
    },
    reportMapError(error: unknown) {
      const c = classifyMapTileError(error, { tilerHost });
      if (c.kind !== "failure" || !c.service) return;
      void run(c.service, defFor(c.service) ?? tiler, false);
    },
    retry(id: ServiceId) {
      const def = defFor(id);
      if (def) void run(id, def, true);
    },
  };
}
