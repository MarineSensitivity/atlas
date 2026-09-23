// atlas-8 fiddly bit: "Playwright Firefox teardown race" -- e2e/routeSafety.ts's `safeRoute`
// swallows a route handler's error only when it is the specific "this page/context/browser is
// already gone" shape, never any other error. Pure logic (no browser needed), so it is testable
// here even though the rest of `e2e/**` needs a real Playwright run.
import { describe, expect, it } from "vitest";
import { isTeardownRaceError, safeRoute } from "../../e2e/routeSafety";

describe("isTeardownRaceError", () => {
  it("recognizes the exact message this repo has seen", () => {
    expect(isTeardownRaceError(new Error("route.fetch: Test ended"))).toBe(true);
  });

  it("recognizes the general 'page/context/browser closed' shapes too", () => {
    expect(isTeardownRaceError(new Error("Target page, context or browser has been closed"))).toBe(
      true,
    );
    expect(isTeardownRaceError(new Error("Target closed"))).toBe(true);
  });

  it("does NOT flag an unrelated error (the seeded fault: a real bug must still throw)", () => {
    expect(isTeardownRaceError(new Error("route.fulfill: Invalid header value"))).toBe(false);
    expect(isTeardownRaceError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("handles a non-Error thrown value", () => {
    expect(isTeardownRaceError("Test ended")).toBe(true);
    expect(isTeardownRaceError("boom")).toBe(false);
  });
});

describe("safeRoute", () => {
  it("swallows a teardown-race error and resolves quietly", async () => {
    const wrapped = safeRoute(() => {
      throw new Error("route.fetch: Test ended");
    });
    await expect(wrapped()).resolves.toBeUndefined();
  });

  it("SEEDED FAULT: a real bug in the handler still propagates, not swallowed", async () => {
    const wrapped = safeRoute(() => {
      throw new Error("unexpected token in JSON");
    });
    await expect(wrapped()).rejects.toThrow("unexpected token in JSON");
  });

  it("passes through a successful handler's return value having no effect on the wrapper", async () => {
    let called = false;
    const wrapped = safeRoute((a: number, b: number) => {
      called = true;
      return a + b;
    });
    await wrapped(1, 2);
    expect(called).toBe(true);
  });
});
