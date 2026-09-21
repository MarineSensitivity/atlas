// The seam that keeps every network call out of tests (module contract: "No network call in tests:
// inject the transport"). `Transport` is the one place analytics.ts hands a body to the network;
// `createBrowserTransport()` is the real, `sendBeacon`-first implementation (a straight port of
// `msens::ga_js`'s `flush()`, analytics.R:367-381), guarded so importing (and calling) it under Node
// (Vitest's `environment: "node"`, no DOM) never sends anything real — see env.ts's header for why
// this checks `hasBrowserGlobals()` rather than `typeof navigator`/`typeof fetch` directly (Node 24
// ships real, working globals for both).
import { hasBrowserGlobals } from "./env";

export interface Transport {
  send(url: string, body: string): void;
}

/** never sends anything — the safe default when no `logUrl`/transport is configured. */
export function noopTransport(): Transport {
  return {
    send() {
      /* no-op */
    },
  };
}

interface NavigatorLike {
  sendBeacon?: (url: string, data?: BodyInit) => boolean;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<unknown>;

function realNavigator(): NavigatorLike | undefined {
  return hasBrowserGlobals() && typeof navigator !== "undefined" ? navigator : undefined;
}

function realFetch(): FetchLike | undefined {
  return hasBrowserGlobals() && typeof fetch !== "undefined" ? fetch : undefined;
}

/**
 * `navigator.sendBeacon` first (survives page unload/hide), falling back to
 * `fetch(..., keepalive, mode:"no-cors")` — the same fallback order as `msens::ga_js`'s `flush()`.
 * `text/plain;charset=UTF-8` keeps the request a CORS "simple request" (the Apps Script `/exec`
 * endpoint answers no `OPTIONS`, so an `application/json` preflight would be dropped).
 *
 * Both parameters default to `undefined` outside a real browser (see `realNavigator`/`realFetch`
 * above) — so `createBrowserTransport()` called with no arguments is a genuine no-op under Node,
 * not just when a caller happens to pass explicit `undefined`s.
 */
export function createBrowserTransport(
  nav: NavigatorLike | undefined = realNavigator(),
  doFetch: FetchLike | undefined = realFetch(),
): Transport {
  return {
    send(url, body) {
      try {
        if (nav?.sendBeacon) {
          const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
          if (nav.sendBeacon(url, blob)) return;
        }
        doFetch?.(url, {
          method: "POST",
          body,
          keepalive: true,
          mode: "no-cors",
          headers: { "Content-Type": "text/plain" },
        })?.catch?.(() => {});
      } catch {
        /* logging must never surface to the user (analytics.R:380) */
      }
    },
  };
}
