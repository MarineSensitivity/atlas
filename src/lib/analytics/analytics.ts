// Port of `msens::ga_js()` (analytics.R:283-448): GA4 config + a batched Sheet-log beacon, driven
// entirely from the browser so nothing here ever blocks on network I/O. Every browser global this
// needs (navigator, document, window, localStorage, sessionStorage, gtag, the clock) is injected
// with a guarded default, so `createAnalytics()` runs under Node with zero DOM and sends nothing
// unless a test hands it a fake transport — see transport.ts's header and this repo's "No network
// call in tests: inject the transport" contract.
//
// Differences from the R original, both required by atlas's URL-as-state design (plan D8):
//   1. `page_location`/the Sheet's `page` column are REBUILT via pageLocation.ts, never read off
//      `location.href`/`location.pathname + location.search` directly — GA4's own auto-captured
//      `page_location` includes the hash, and the hash carries place geometry and the report title.
//   2. `navigator.webdriver` sessions are excluded ENTIRELY (no GA4 config call, no queued row) —
//      the Shiny apps have no analogous concept; this keeps Playwright/CI runs out of both legs.
//
// OUT OF SCOPE here: inserting the `<script async src="https://www.googletagmanager.com/gtag/js?...">`
// loader tag. That is wiring into a real page (this phase ships "plain TypeScript modules ... nothing
// added to the entry's static graph yet") and belongs to whichever later phase mounts this into
// index.html/report.html. `gtag`/`window.dataLayer` are still installed the same way `ga_js()`'s
// inline script does, so `track()` calls made before that loader tag lands simply queue into
// `dataLayer` the way GA4's own snippet already expects.
import { EVENT_NAMES, type EventName, type EventParamsMap } from "./events";
import { hasBrowserGlobals } from "./env";
import { GA_MAX_PARAM_CHARS, msEvent } from "./msEvent";
import { sanitizeParams } from "./sanitize";
import { buildPagePath, type LocationLike } from "./pageLocation";
import { createBrowserTransport, noopTransport, type Transport } from "./transport";

/** the production GA4 measurement ID (one id across every MarineSensitivity product; see
 * `msens::.MS_GA_ID`, analytics.R:44). */
export const GA_MEASUREMENT_ID = "G-9HW6L751XG";

/** `app`/`app_name` on every event — content_group is what varies with preview mode (below), not
 * this (plan atlas-2 `analytics/` contract: "content_group atlas / atlas-preview"). */
const APP_NAME = "atlas";

const DEFAULT_BATCH = 10; // .MS_LOG_BATCH, analytics.R:47
const DEFAULT_INTERVAL_MS = 15000; // .MS_LOG_INTERVAL_MS, analytics.R:48

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type GtagFn = (...args: unknown[]) => void;

export interface AnalyticsOptions {
  /** the deployed build's git short SHA (ms_track's `app_version`). */
  appVersion: string;
  /** true on the preview host -> `content_group = "atlas-preview"`; false -> `"atlas"`. */
  preview: boolean;
  measurementId?: string;
  /** `VITE_LOG_URL`; unset/empty -> the Sheet leg is a silent no-op (GA4 still receives events if
   * not a webdriver session). */
  logUrl?: string;
  /** injected so tests never touch the network; defaults to a guarded `sendBeacon`/`fetch`
   * implementation that is a true no-op under Node (no DOM). */
  transport?: Transport;
  /** injected for tests; defaults to reading the real `navigator.webdriver`, guarded for a Node
   * environment with no `navigator`. */
  isWebdriver?: () => boolean;
  now?: () => number;
  /** defaults to `window.localStorage`, guarded; pass `null` explicitly (or a fake) in a test. */
  clientStore?: KeyValueStore | null;
  /** defaults to `window.sessionStorage`, guarded. */
  sessionStore?: KeyValueStore | null;
  /** defaults to reading the real `location`, guarded for Node (returns empty strings). */
  location?: () => LocationLike;
  /** injected GA4 sink; defaults to installing `window.dataLayer`/`window.gtag` the same way
   * `ga_js()`'s inline script does, guarded to a no-op under Node. */
  gtag?: GtagFn;
  batchSize?: number;
  flushIntervalMs?: number;
  /** wires `flush()` to `visibilitychange -> hidden` and `pagehide`; defaults to a guarded DOM
   * listener, no-op under Node. Returns a teardown function used by `destroy()`. */
  addVisibilityListener?: (flush: () => void) => (() => void) | void;
}

export interface Analytics {
  track<E extends EventName>(event: E, params: EventParamsMap[E]): void;
  /** flushes the queued Sheet-log rows immediately (normally called on the batch/interval/visibility
   * triggers below); a no-op when the queue is empty or `logUrl` is unset. */
  flush(): void;
  /** tears down the interval timer and any DOM listeners — call this if an `Analytics` is ever
   * replaced within one page lifetime (tests always call it in `afterEach`). */
  destroy(): void;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// `stored()` (analytics.R:348-354): read-or-create a persisted id, "na" on any storage failure
// (private mode, storage disabled) or when no store is available at all.
function stored(store: KeyValueStore | null, key: string): string {
  if (!store) return "na";
  try {
    let v = store.getItem(key);
    if (!v) {
      v = uid();
      store.setItem(key, v);
    }
    return v;
  } catch {
    return "na";
  }
}

// every default below is gated on `hasBrowserGlobals()` (env.ts), not a piecemeal `typeof navigator`/
// `typeof location` check — Node 24 (this repo's Vitest environment) ships real, working `navigator`
// and `fetch` globals of its own, so checking those alone would silently pick up Node's stand-ins
// under a unit test instead of resolving to "not in a browser".
function defaultIsWebdriver(): boolean {
  return hasBrowserGlobals() && typeof navigator !== "undefined" && navigator.webdriver === true;
}

function defaultLocation(): LocationLike {
  if (!hasBrowserGlobals() || typeof location === "undefined") {
    return { origin: "", pathname: "", search: "" };
  }
  return { origin: location.origin, pathname: location.pathname, search: location.search };
}

function defaultGtag(): GtagFn {
  if (!hasBrowserGlobals()) return () => {};
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: GtagFn };
  w.dataLayer = w.dataLayer || [];
  const fn: GtagFn = (...args) => {
    w.dataLayer!.push(args);
  };
  w.gtag = w.gtag || fn;
  return w.gtag;
}

function defaultStore(pick: (w: Window) => Storage | undefined): KeyValueStore | null {
  if (!hasBrowserGlobals()) return null;
  try {
    const s = pick(window);
    return s ?? null;
  } catch {
    return null; // storage access can throw (private mode) before a single getItem is even tried
  }
}

function defaultVisibilityListener(flush: () => void): (() => void) | undefined {
  if (!hasBrowserGlobals()) return undefined;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
  };
}

function defaultReferrer(): string {
  return hasBrowserGlobals() ? document.referrer || "" : "";
}

function defaultUserAgent(): string {
  return hasBrowserGlobals() && typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
}

/** builds one `Analytics` instance. Nothing here is a module-level singleton — the caller (a later
 * phase's app entry) owns the instance and its lifetime. */
export function createAnalytics(opts: AnalyticsOptions): Analytics {
  const webdriver = (opts.isWebdriver ?? defaultIsWebdriver)();
  const measurementId = opts.measurementId ?? GA_MEASUREMENT_ID;
  const contentGroup = opts.preview ? "atlas-preview" : "atlas";
  const logUrl = opts.logUrl ?? "";
  const transport = opts.transport ?? (logUrl ? createBrowserTransport() : noopTransport());
  const now = opts.now ?? Date.now;
  const getLocation = opts.location ?? defaultLocation;
  const gtag = opts.gtag ?? defaultGtag();
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_INTERVAL_MS;

  const clientStore =
    "clientStore" in opts ? opts.clientStore! : defaultStore((w) => w.localStorage);
  const sessionStoreOpt =
    "sessionStore" in opts ? opts.sessionStore! : defaultStore((w) => w.sessionStorage);
  const clientId = stored(clientStore, "msens_client_id");
  const sessionId = stored(sessionStoreOpt, "msens_session_id");

  let queue: Record<string, unknown>[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let removeVisibility: (() => void) | undefined;

  function flush(): void {
    if (!logUrl || queue.length === 0) return;
    const rows = queue;
    queue = [];
    try {
      transport.send(logUrl, JSON.stringify({ rows }));
    } catch {
      /* logging must never surface to the user */
    }
  }

  // webdriver sessions get NEITHER leg: no GA4 config call, no interval, no listeners, and
  // track() below becomes a full no-op for them too (the seeded fault this guards against:
  // "navigator.webdriver sessions logged").
  if (!webdriver) {
    timer = setInterval(flush, flushIntervalMs);
    removeVisibility =
      (opts.addVisibilityListener ?? defaultVisibilityListener)(flush) ?? undefined;
    try {
      gtag("js", new Date(now()));
      gtag("config", measurementId, {
        content_group: contentGroup,
        app_name: APP_NAME,
        app_version: opts.appVersion,
      });
    } catch {
      /* GA must never break the app */
    }
  }

  function track<E extends EventName>(event: E, params: EventParamsMap[E]): void {
    if (webdriver) return;
    if (!EVENT_NAMES.includes(event)) return; // defensive: an unknown name from untyped call sites

    const clean = sanitizeParams(params as Record<string, unknown>);
    const payload = msEvent(event, clean);

    try {
      const gaParams: Record<string, unknown> = {
        content_group: contentGroup,
        app_name: APP_NAME,
        app_version: opts.appVersion,
      };
      for (const [k, v] of Object.entries(payload.params)) {
        gaParams[k] = v.length > GA_MAX_PARAM_CHARS ? v.slice(0, GA_MAX_PARAM_CHARS) : v;
      }
      gtag("event", payload.event, gaParams);
    } catch {
      /* GA must never break the app */
    }

    if (!logUrl) return;
    const loc = getLocation();
    queue.push({
      timestamp: new Date(now()).toISOString(),
      ip: "", // no server leg in a static app; kept for LOG_HEADER column parity
      session: "",
      event: payload.event,
      params: JSON.stringify(payload.params),
      n_rows: payload.metrics.n_rows ?? "",
      ms: payload.metrics.ms ?? "",
      status: payload.metrics.status ?? "",
      error: payload.metrics.error ?? "",
      app_version: opts.appVersion,
      app: APP_NAME,
      client_id: clientId,
      session_id: sessionId,
      page: buildPagePath(loc),
      referrer: defaultReferrer(),
      user_agent: defaultUserAgent(),
    });
    if (queue.length >= batchSize) flush();
  }

  function destroy(): void {
    if (timer) clearInterval(timer);
    removeVisibility?.();
  }

  return { track, flush, destroy };
}
