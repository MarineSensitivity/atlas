import { describe, expect, it, vi } from "vitest";
import { fetchWithSizeGuard, MaterializeTooLargeError } from "../../src/lib/engine/materialize";

/** a hand-rolled `ReadableStreamDefaultReader` double (not a real stream) so a test can assert
 * exactly how many `read()` calls happened before the guard aborted -- a real `ReadableStream`
 * would work too, but hides that count behind its own internal buffering. */
function chunkReader(chunkBytes: number, chunkCount: number) {
  let emitted = 0;
  const read = vi.fn(async () => {
    if (emitted >= chunkCount) return { done: true, value: undefined };
    emitted += 1;
    return { done: false, value: new Uint8Array(chunkBytes) };
  });
  const cancel = vi.fn().mockResolvedValue(undefined);
  const releaseLock = vi.fn();
  return { read, cancel, releaseLock, readCalls: () => read.mock.calls.length };
}

interface MockOpts {
  ok?: boolean;
  status?: number;
  contentLength?: string | null;
  reader?: ReturnType<typeof chunkReader>;
}

function mockResponse(opts: MockOpts = {}) {
  const { ok = true, status = 200, contentLength = null, reader } = opts;
  const getReader = vi.fn(() => {
    if (!reader) throw new Error("test double: no reader configured");
    return reader;
  });
  return {
    ok,
    status,
    headers: {
      get: (key: string) => (key.toLowerCase() === "content-length" ? contentLength : null),
    },
    body: { getReader },
    getReaderSpy: getReader,
  };
}

function fetchImplFor(resp: ReturnType<typeof mockResponse>) {
  let capturedSignal: AbortSignal | undefined;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    capturedSignal = init?.signal ?? undefined;
    return resp as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, signal: () => capturedSignal };
}

describe("fetchWithSizeGuard", () => {
  // (a) an over-size Content-Length header rejects BEFORE the body is touched at all.
  it("Content-Length over the guard: rejects without ever calling getReader(), and aborts", async () => {
    const resp = mockResponse({ contentLength: "1000" });
    const { fetchImpl, signal } = fetchImplFor(resp);

    await expect(
      fetchWithSizeGuard("https://x.test/big", { fetchImpl, maxBytes: 100 }),
    ).rejects.toThrow(MaterializeTooLargeError);
    expect(resp.getReaderSpy).not.toHaveBeenCalled();
    expect(signal()?.aborted).toBe(true);

    try {
      await fetchWithSizeGuard("https://x.test/big", { fetchImpl, maxBytes: 100 });
    } catch (err) {
      expect(err).toBeInstanceOf(MaterializeTooLargeError);
      expect((err as MaterializeTooLargeError).reason).toBe("content-length");
      expect((err as MaterializeTooLargeError).bytesKnown).toBe(1000);
    }
  });

  // (b) no Content-Length: the streaming cap aborts mid-stream, never buffering more than
  // maxBytes + one chunk -- read() is called a small, bounded number of times, not once per
  // chunk in the (much larger) full body.
  it("no Content-Length, body larger than the guard: aborted mid-stream, bounded reads", async () => {
    const CHUNK = 10;
    const TOTAL_CHUNKS = 1000; // 10,000 B if fully read
    const reader = chunkReader(CHUNK, TOTAL_CHUNKS);
    const resp = mockResponse({ contentLength: null, reader });
    const { fetchImpl, signal } = fetchImplFor(resp);

    await expect(
      fetchWithSizeGuard("https://x.test/nolen", { fetchImpl, maxBytes: 55 }),
    ).rejects.toThrow(MaterializeTooLargeError);

    // never more than maxBytes + one chunk read before aborting: ceil(55/10) + 1 = 7 reads max.
    expect(reader.readCalls()).toBeLessThanOrEqual(7);
    expect(reader.readCalls()).toBeGreaterThan(0);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(signal()?.aborted).toBe(true);
  });

  // (c) a LYING Content-Length (small header, large actual body): the header alone would pass,
  // but the streaming cap still catches and aborts it.
  it("lying Content-Length (small header, large body): still aborted mid-stream", async () => {
    const reader = chunkReader(20, 500); // 10,000 B if fully read
    const resp = mockResponse({ contentLength: "5", reader }); // header claims 5 B
    const { fetchImpl, signal } = fetchImplFor(resp);

    await expect(
      fetchWithSizeGuard("https://x.test/lying", { fetchImpl, maxBytes: 100 }),
    ).rejects.toThrow(MaterializeTooLargeError);

    expect(reader.readCalls()).toBeGreaterThan(0);
    expect(reader.readCalls()).toBeLessThan(500); // nowhere near the full (lying) body
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(signal()?.aborted).toBe(true);
  });

  // (d) exactly at the guard: accepted, not aborted, no cancel().
  it("exactly at the guard: accepted", async () => {
    const reader = chunkReader(25, 4); // 100 B total, maxBytes = 100
    const resp = mockResponse({ contentLength: null, reader });
    const { fetchImpl, signal } = fetchImplFor(resp);

    const buf = await fetchWithSizeGuard("https://x.test/atlimit", { fetchImpl, maxBytes: 100 });
    expect(buf.byteLength).toBe(100);
    expect(reader.cancel).not.toHaveBeenCalled();
    expect(signal()?.aborted).toBeFalsy();
  });

  it("a Content-Length exactly at the guard is accepted, not pre-emptively rejected", async () => {
    const reader = chunkReader(50, 2); // 100 B total
    const resp = mockResponse({ contentLength: "100", reader });
    const { fetchImpl } = fetchImplFor(resp);

    const buf = await fetchWithSizeGuard("https://x.test/atlimit2", { fetchImpl, maxBytes: 100 });
    expect(buf.byteLength).toBe(100);
  });

  it("propagates a non-2xx HTTP status as a plain error, guard not involved", async () => {
    const resp = mockResponse({ ok: false, status: 404 });
    const { fetchImpl } = fetchImplFor(resp);
    await expect(
      fetchWithSizeGuard("https://x.test/404", { fetchImpl, maxBytes: 100 }),
    ).rejects.toThrow(/HTTP 404/);
    expect(resp.getReaderSpy).not.toHaveBeenCalled();
  });
});
