// atlas-8 fiddly bit: "Playwright Firefox teardown race" -- with the map loading a worker in
// every shell spec, a test ending while a `page.route` handler is mid-fetch reports
// `route.fetch: Test ended` OUTSIDE any test (Playwright attributes it to whichever test happens
// to be running next) and can skip that next test entirely (seen once at load 27, 2 clean runs
// after -- the master plan's own fiddly-bits note). Every hermetic route helper in this repo
// (e2e/hermetic.ts, e2e/map-hermetic.ts, e2e/species-hermetic.ts) wraps its handlers with
// `safeRoute` below; this is its own tiny module (not folded into e2e/hermetic.ts, which
// map-hermetic.ts already imports FROM) so none of the three ends up importing each other in a
// cycle.
/**
 * True for a Playwright error whose message says the page/context/browser a route was answering
 * for has already gone -- the general shape of "this request no longer has anyone listening for
 * its response," not just the one literal message this repo has actually observed.
 */
export function isTeardownRaceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Test ended|Target .*closed/i.test(msg);
}

/**
 * Wraps a `page.route` handler so a teardown-race error (above) is swallowed instead of thrown --
 * the request is simply left unfulfilled, which is fine: nothing is listening for its response
 * once the page/test that made it has already gone. Any OTHER error still propagates, so a real
 * bug in a handler is never hidden by this.
 */
export function safeRoute<Args extends unknown[]>(
  handler: (...args: Args) => unknown | Promise<unknown>,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await handler(...args);
    } catch (err) {
      if (isTeardownRaceError(err)) return;
      throw err;
    }
  };
}
