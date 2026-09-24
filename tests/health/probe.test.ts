// V3 (P round, 2026-09-24): probeUrl's classification -- ok/slow (a real 2xx, fast vs. slow),
// down/HTTP (a real non-2xx), down/network error (fetch rejects with something other than an
// abort), down/timeout (the AbortController actually fires). Every clock/fetch is injected so this
// never touches the real network or a real timer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUrl } from "../../src/lib/health/probe";

afterEach(() => {
  vi.useRealTimers();
});

function okResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

function fakeClock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("probeUrl: a healthy response", () => {
  it("classifies a fast 2xx as ok, with no reason", async () => {
    const clock = fakeClock();
    const fetchImpl = vi.fn(async () => {
      clock.advance(10);
      return okResponse();
    });
    const result = await probeUrl("https://example.test/healthz", {
      fetchImpl,
      now: clock.now,
      slowMs: 2500,
    });
    expect(result).toMatchObject({ status: "ok", url: "https://example.test/healthz" });
    expect(result.reason).toBeUndefined();
  });

  it("classifies a 2xx that took longer than slowMs as slow, not ok", async () => {
    const clock = fakeClock();
    const fetchImpl = vi.fn(async () => {
      clock.advance(3000);
      return okResponse();
    });
    const result = await probeUrl("https://example.test/healthz", {
      fetchImpl,
      now: clock.now,
      slowMs: 2500,
    });
    expect(result.status).toBe("slow");
  });
});

describe("probeUrl: a real failure — every kind is 'down', with the reason the banner quotes", () => {
  it("classifies a non-2xx response as down, reason 'HTTP <code>'", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    const result = await probeUrl("https://example.test/healthz", { fetchImpl });
    expect(result).toMatchObject({ status: "down", reason: "HTTP 503" });
  });

  it("classifies a rejected fetch (network error / CORS block) as down, reason 'network error'", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await probeUrl("https://example.test/healthz", { fetchImpl });
    expect(result).toMatchObject({ status: "down", reason: "network error" });
  });

  it("classifies the AbortController firing (a real timeout) as down, reason 'timeout'", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const pending = probeUrl("https://example.test/healthz", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result).toMatchObject({ status: "down", reason: "timeout" });
  });
});
