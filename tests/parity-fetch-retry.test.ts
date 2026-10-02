// R5-4: scripts/parity/fetch-retry.mjs -- the bounded retry around run.mjs's boot.json fetch. The
// CI failure it fixes: `SocketError: other side closed` on a stale keep-alive socket, AFTER v9's
// comparison had printed PASS. One fixture per rule/branch; no network, no real waiting.
import { describe, expect, it } from "vitest";
import {
  FETCH_ATTEMPTS,
  fetchWithRetry,
  isRetryableStatus,
} from "../scripts/parity/fetch-retry.mjs";

const URL_ = "https://example.test/marine-atlas/v7/app/boot.json";
const ok = (status = 200) => ({ ok: status < 400, status }) as Response;
const socketClosed = () =>
  Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });

/** a fetch stub that replays `steps` (a Response or an Error to throw), recording calls. */
function stub(steps: (Response | Error)[]) {
  const calls: string[] = [];
  const waits: number[] = [];
  return {
    calls,
    waits,
    opts: {
      fetchImpl: (async (u: string) => {
        calls.push(u);
        const step = steps[calls.length - 1];
        if (step instanceof Error) throw step;
        return step;
      }) as unknown as typeof fetch,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      log: () => {},
    },
  };
}

describe("fetchWithRetry", () => {
  it("REGRESSION (other side closed): a dropped keep-alive socket is retried on a fresh one and succeeds", async () => {
    const s = stub([socketClosed(), ok()]);
    const resp = await fetchWithRetry(URL_, s.opts);
    expect(resp.status).toBe(200);
    expect(s.calls).toHaveLength(2);
    expect(s.waits).toEqual([500]);
  });

  it("backs off exponentially across consecutive failures", async () => {
    const s = stub([socketClosed(), socketClosed(), socketClosed(), ok()]);
    await fetchWithRetry(URL_, s.opts);
    expect(s.waits).toEqual([500, 1000, 2000]);
  });

  it("is bounded: gives up after FETCH_ATTEMPTS and throws the last network error", async () => {
    const err = socketClosed();
    const s = stub(Array.from({ length: FETCH_ATTEMPTS + 3 }, () => err));
    await expect(fetchWithRetry(URL_, s.opts)).rejects.toBe(err);
    expect(s.calls).toHaveLength(FETCH_ATTEMPTS);
    expect(s.waits).toHaveLength(FETCH_ATTEMPTS - 1);
  });

  it("retries a 5xx / 429, then returns the good response", async () => {
    const s = stub([ok(503), ok(429), ok()]);
    expect((await fetchWithRetry(URL_, s.opts)).status).toBe(200);
    expect(s.calls).toHaveLength(3);
  });

  it("a 5xx on every attempt returns the last response (the caller reports the status)", async () => {
    const s = stub(Array.from({ length: FETCH_ATTEMPTS }, () => ok(502)));
    expect((await fetchWithRetry(URL_, s.opts)).status).toBe(502);
    expect(s.calls).toHaveLength(FETCH_ATTEMPTS);
  });

  it("a 404 is an ANSWER, never retried: a missing release still fails the gate on the first try", async () => {
    const s = stub([ok(404), ok()]);
    expect((await fetchWithRetry(URL_, s.opts)).status).toBe(404);
    expect(s.calls).toHaveLength(1);
    expect(s.waits).toEqual([]);
  });

  it("a first-try success makes exactly one request and waits for nothing", async () => {
    const s = stub([ok()]);
    await fetchWithRetry(URL_, s.opts);
    expect(s.calls).toEqual([URL_]);
    expect(s.waits).toEqual([]);
  });

  it("isRetryableStatus: 5xx and 429 only", () => {
    expect([200, 301, 403, 404, 429, 500, 503].map(isRetryableStatus)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});
