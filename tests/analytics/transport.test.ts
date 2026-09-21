import { describe, expect, it, vi } from "vitest";
import { createBrowserTransport, noopTransport } from "../../src/lib/analytics/transport";

describe("noopTransport", () => {
  it("never throws and sends nothing observable", () => {
    const t = noopTransport();
    expect(() => t.send("https://example.test/log", "{}")).not.toThrow();
  });
});

describe("createBrowserTransport (no real network call — this repo's Node test environment has no DOM)", () => {
  it("is a true no-op when neither navigator nor fetch is injected", () => {
    const t = createBrowserTransport(undefined, undefined);
    expect(() => t.send("https://example.test/log", "{}")).not.toThrow();
  });

  it("prefers navigator.sendBeacon when it reports success", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const doFetch = vi.fn();
    const t = createBrowserTransport({ sendBeacon }, doFetch as unknown as typeof fetch);
    t.send("https://example.test/log", '{"rows":[]}');
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe("https://example.test/log");
    expect(doFetch).not.toHaveBeenCalled(); // sendBeacon succeeded, no fallback needed
  });

  it("falls back to fetch(keepalive, no-cors) when sendBeacon is absent", () => {
    const doFetch = vi.fn().mockReturnValue(Promise.resolve());
    const t = createBrowserTransport({}, doFetch as unknown as typeof fetch);
    t.send("https://example.test/log", '{"rows":[]}');
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe("https://example.test/log");
    expect(init).toMatchObject({
      method: "POST",
      body: '{"rows":[]}',
      keepalive: true,
      mode: "no-cors",
    });
  });

  it("falls back to fetch when sendBeacon reports failure", () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    const doFetch = vi.fn().mockReturnValue(Promise.resolve());
    const t = createBrowserTransport({ sendBeacon }, doFetch as unknown as typeof fetch);
    t.send("https://example.test/log", "{}");
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("never throws even if sendBeacon itself throws", () => {
    const sendBeacon = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const t = createBrowserTransport({ sendBeacon }, undefined);
    expect(() => t.send("https://example.test/log", "{}")).not.toThrow();
  });
});
