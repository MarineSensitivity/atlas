// Fix round 1's e2e fixture: a real page, real DOM, real `location` (this fixture is navigated to
// with `#pl=g1.test.AAAA&t=secret` already in the URL — see e2e/analytics-privacy.spec.ts), real
// `navigator.sendBeacon`/`fetch`. Everything else about `createAnalytics()` is left at its real,
// guarded defaults EXCEPT `isWebdriver`, which is forced to `false`: Playwright's own automation flag
// sets the real `navigator.webdriver` to `true`, and this fixture exists to test the PRIVACY fix
// (fix round 1), not the separate, already unit-tested webdriver-exclusion gate — forcing it here
// keeps the two concerns apart.
import { createAnalytics } from "../../../src/lib/analytics/analytics";

const gtagCalls: unknown[][] = [];

const analytics = createAnalytics({
  appVersion: "e2e-fixture",
  preview: false,
  logUrl: "/log", // same-origin; e2e/analytics-privacy.spec.ts page.routes this to a fixture handler
  isWebdriver: () => false,
  gtag: (...args: unknown[]) => {
    gtagCalls.push(args);
  },
});

declare global {
  interface Window {
    __gtagCalls: unknown[][];
    __track: () => void;
  }
}

window.__gtagCalls = gtagCalls;
window.__track = () => {
  // an ordinary, non-place event: the point of this fixture is proving page_location/page_title
  // never leak the URL's fragment, not re-testing sanitizeParams()'s own pl/t stripping (that has
  // its own unit coverage in tests/analytics/sanitize.test.ts).
  analytics.track("open_about", {});
  analytics.flush();
};
