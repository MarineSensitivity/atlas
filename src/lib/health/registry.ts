// The health state machine, as plain data + pure functions (CLAUDE.md: "keep core logic in an
// exported function... a component calls it") -- store.svelte.ts is the thin reactive wrapper
// around exactly these, so tests/health/registry.test.ts can drive the whole state machine
// (backoff, single-flight, which service's banner wins) without ever touching Svelte or a real
// timer/fetch.
import type { ProbeResult, ServiceDef, ServiceId } from "./types";

export interface HealthEntry {
  result?: ProbeResult;
  /** consecutive-failure count; resets to 0 the moment a probe comes back ok/slow. Drives the
   * exponential backoff below. */
  attempt: number;
  inFlight: boolean;
  lastProbeAt?: number;
}

export type HealthState = Partial<Record<ServiceId, HealthEntry>>;

const EMPTY_ENTRY: HealthEntry = { attempt: 0, inFlight: false };

export function initialHealthState(ids: readonly ServiceId[]): HealthState {
  const state: HealthState = {};
  for (const id of ids) state[id] = { ...EMPTY_ENTRY };
  return state;
}

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_BASE_DELAY_MS = 3000;
const DEFAULT_MAX_DELAY_MS = 60_000;

/** exponential, capped: `attempt` 1 -> `baseDelayMs`, 2 -> `2x`, 3 -> `4x`, ... capped at
 * `maxDelayMs`. `attempt <= 0` -> 0 (no backoff before a first failure has even happened). */
export function backoffDelayMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  if (attempt <= 0) return 0;
  return Math.min(base * 2 ** (attempt - 1), max);
}

export interface CanProbeOptions extends BackoffOptions {
  /** a manual Retry always bypasses backoff (never the single-flight guard -- two rapid clicks
   * while a probe is already in flight still collapse to one request). */
  force?: boolean;
}

/**
 * May a new probe for this entry start right now? "no retries storm... max one probe in flight per
 * service" (brief): `inFlight` always wins first (true single-flight, force included -- a Retry
 * click while a probe from the map-error path is already running does not queue a second one, it
 * is simply a no-op). Otherwise: no prior probe, or the last one was NOT "down" (ok/slow) -> no
 * backoff needed, always allowed (this is how trigger (a)'s boot-time probe and trigger (b)'s FIRST
 * tile-failure report both fire immediately). A "down" result gates every further automatic
 * re-probe behind {@link backoffDelayMs}, unless `force` (the Retry button).
 */
export function canProbe(entry: HealthEntry | undefined, now: number, opts: CanProbeOptions = {}) {
  const e = entry ?? EMPTY_ENTRY;
  if (e.inFlight) return false;
  if (opts.force) return true;
  if (!e.lastProbeAt || e.result?.status !== "down") return true;
  return now - e.lastProbeAt >= backoffDelayMs(e.attempt, opts);
}

export function beginProbe(state: HealthState, id: ServiceId, now: number): HealthState {
  const prev = state[id] ?? { ...EMPTY_ENTRY };
  return { ...state, [id]: { ...prev, inFlight: true, lastProbeAt: now } };
}

export function completeProbe(state: HealthState, id: ServiceId, result: ProbeResult): HealthState {
  const prev = state[id] ?? { ...EMPTY_ENTRY };
  const attempt = result.status === "down" ? prev.attempt + 1 : 0;
  return { ...state, [id]: { ...prev, inFlight: false, result, attempt } };
}

export interface ActiveBanner {
  def: ServiceDef;
  result: ProbeResult;
}

/**
 * Which service's banner (if any) should show right now -- only a confirmed `"down"` result raises
 * one; `"slow"` is recorded but never shown (brief: only an actual failure gets a banner). `defs`'
 * own order is the priority when more than one service is down at once; Shell.svelte registers
 * `[tiler, data]` (map tiles first -- the failure Ben actually hit, and the most visually obvious
 * one) so at most one banner shows at a time, per the brief's "a... top banner" (singular).
 */
export function bannerFor(state: HealthState, defs: readonly ServiceDef[]): ActiveBanner | null {
  for (const def of defs) {
    const result = state[def.id]?.result;
    if (result?.status === "down") return { def, result };
  }
  return null;
}

/** the exact banner copy (brief's own worked example): "<Display>: <host> is not responding
 * (<reason>). <What breaks>; <what still works>." Pure, so tests/health/registry.test.ts asserts it
 * verbatim without mounting HealthBanner.svelte. */
export function bannerMessage(def: ServiceDef, result: ProbeResult): string {
  const reason = result.reason ?? "unknown error";
  return (
    `${def.displayName} unavailable: ${def.hostLabel} is not responding (${reason}). ` +
    `${def.whatBreaks}; ${def.stillWorks}.`
  );
}
