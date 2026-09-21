// A single, strict "are we actually in a browser" check, shared by analytics.ts and transport.ts.
//
// Node 24 (this repo's Vitest runs under Node — vitest.config.ts's `environment: "node"`) ships
// GLOBAL `navigator`, `fetch` and `Blob` stubs of its own (`navigator.userAgent === "Node.js/24"`,
// `navigator.sendBeacon` absent but `fetch` fully functional) — so gating a "real browser" default on
// `typeof navigator !== "undefined"` or `typeof fetch !== "undefined"` alone is NOT safe under this
// repo's test environment: it would silently pick up Node's real `fetch` and could make an actual
// network call from a unit test. `window` and `document` remain `undefined` under plain Node, so
// THOSE are the signal every guarded default in this directory keys off instead.
export function hasBrowserGlobals(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
