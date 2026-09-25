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
 * (a 5xx, a network error, or the timeout firing).
 *
 * P round 2 fix (CI run 36070452831, Ben's report): this used to gate on `!res.ok`, so ANY
 * non-2xx -- including a 403/404 -- read as the service being DOWN. `dataServiceDef`'s probe
 * target is `{ver}/app/boot.json`, which legitimately 404s in every hermetic e2e fixture that
 * doesn't hand `routeBucket()` a `boot` fixture (it isn't published for any release yet, atlas-1)
 * -- so the banner showed on nearly every shell spec and, being a covering overlay, blocked every
 * topbar click underneath it (feedback.spec.ts, shell.chrome.spec.ts, shell.url-state.spec.ts,
 * shell.chunk-error.spec.ts, ...). A 403/404 (or any other non-5xx status) proves the HOST
 * answered -- reachable, not down -- matching P8/analysis/sources.ts's own `isMissingTileStatus`
 * precedent (403/404 = legitimately absent, not a failure). Only a genuine 5xx, a network error or
 * the timeout firing still means the service itself is broken.
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
    if (res.status >= 500) {
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
