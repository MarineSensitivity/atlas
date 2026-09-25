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

// P round 2 (CI run 36070452831): a hermetic e2e fixture's app/boot.json legitimately 404s (no
// release publishes it yet, routeBucket()'s own default when no `boot` fixture is given) -- the
// OLD `!res.ok` gate misread that as "down", raising the banner on nearly every shell spec and
// blocking every topbar click underneath it. A 403/404 proves the host answered; only a genuine
// 5xx (or a network error/timeout, below) means the service itself is broken.
describe("probeUrl: a reachable-but-non-2xx response (403/404) is NOT down", () => {
  it("classifies a 404 as ok, not down", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    const result = await probeUrl("https://example.test/app/boot.json", { fetchImpl });
    expect(result).toMatchObject({ status: "ok", url: "https://example.test/app/boot.json" });
    expect(result.reason).toBeUndefined();
  });

  it("classifies a 403 as ok, not down", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }) as Response);
    const result = await probeUrl("https://example.test/app/boot.json", { fetchImpl });
    expect(result.status).toBe("ok");
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
