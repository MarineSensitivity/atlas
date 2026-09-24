// A single bounded HTTP probe. Pure aside from `fetch`/`AbortController`/timers, all three
// injectable so tests/health/probe.test.ts never touches the real network or a real clock.
import type { ProbeResult, ProbeStatus } from "./types";

export interface ProbeOptions {
  /** the probe is abandoned (classified "down", reason "timeout") past this. Default 5000ms per
   * brief. */
  timeoutMs?: number;
  /** a response slower than this (but inside `timeoutMs`) is `"slow"`, not `"ok"`. */
  slowMs?: number;
  fetchImpl?: typeof fetch;
  /** injected clock, ms since epoch -- tests advance it deterministically. */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SLOW_MS = 2500;

/** a `fetch` rejection's message, reduced to one of the two reasons the banner ever quotes for a
 * network-level failure (never the raw browser error text, which varies by engine: Chromium says
 * "Failed to fetch", WebKit "Load failed", Firefox "NetworkError when attempting to fetch
 * resource"). `AbortError` is handled by the caller (it means the timeout fired), not here. */
function classifyFetchError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  return "network error";
}

/**
 * One probe of `url`: `ok` (2xx, under `slowMs`), `slow` (2xx, `slowMs`..`timeoutMs`), or `down`
 * (non-2xx, a network error, or the timeout firing) -- classification P8/analysis/sources.ts's
 * `isMissingTileStatus` already uses for a MISSING tile (403/404 = empty, not a failure) does NOT
 * apply here: this probes a route that is either healthy (200) or actually broken, never a
 * "legitimately absent" 403/404 the way a per-model tile can be.
 */
export async function probeUrl(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const slowMs = opts.slowMs ?? DEFAULT_SLOW_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = now();
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    const durationMs = now() - start;
    if (!res.ok) {
      return { status: "down", url, reason: `HTTP ${res.status}`, checkedAt: now(), durationMs };
    }
    const status: ProbeStatus = durationMs >= slowMs ? "slow" : "ok";
    return { status, url, checkedAt: now(), durationMs };
  } catch (err) {
    const durationMs = now() - start;
    return { status: "down", url, reason: classifyFetchError(err), checkedAt: now(), durationMs };
  } finally {
    clearTimeout(timer);
  }
}
