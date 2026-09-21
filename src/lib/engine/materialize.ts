// atlas-2 Step 3a fix round 1: the 25 MB materialize guard must refuse BEFORE the download
// happens, not after. The original `engine.ts` checked `buf.byteLength` only once the whole
// response body was already in memory (`await resp.arrayBuffer()`), so a 374 MB `cell.parquet`
// would download in full on a phone and then be thrown away -- exactly backwards. Two layers, in
// order:
// 1. **`Content-Length` pre-check.** If the header is present and already exceeds the guard, abort
//    the request (`AbortController`) and throw WITHOUT ever calling `resp.body.getReader()` -- the
//    body is never touched.
// 2. **Streaming cap.** `Content-Length` can be absent (chunked transfer) or WRONG (a proxy/cache
//    that lies), so the real enforcement reads the body as a stream and aborts the moment the
//    running total crosses the guard -- never buffering more than `maxBytes` plus one chunk.
/** whole-object fetch + registerFileBuffer for anything at or under this size (plan `engine/`): "no
 * object the app needs is both large and prunable, so no httpfs range reads in v1." Anything larger
 * is refused, loudly, rather than silently falling back to a range read this app never wires up.
 * Defined here (not `engine.ts`) so this module has no dependency on it -- `engine.ts` imports
 * `fetchWithSizeGuard` from here instead. */
export const MATERIALIZE_MAX_BYTES = 25 * 1024 * 1024;

export class MaterializeTooLargeError extends Error {
  readonly bytesKnown: number;
  readonly maxBytes: number;
  readonly reason: "content-length" | "stream";

  constructor(bytesKnown: number, maxBytes: number, reason: "content-length" | "stream") {
    const basis = reason === "content-length" ? "Content-Length header" : "streamed bytes";
    super(
      `refusing to materialize (${bytesKnown} B ${basis}): exceeds the ${maxBytes} B whole-object ` +
        `guard -- httpfs range reads are not used in v1 (plan engine/ contract)`,
    );
    this.name = "MaterializeTooLargeError";
    this.bytesKnown = bytesKnown;
    this.maxBytes = maxBytes;
    this.reason = reason;
  }
}

export interface MaterializeOptions {
  fetchImpl: typeof fetch;
  maxBytes?: number;
}

/**
 * Fetch `url` and return its whole body as one `Uint8Array`, refusing (throwing
 * {@link MaterializeTooLargeError}) anything over `maxBytes` -- checked from `Content-Length`
 * before the body is read at all when the header is present and already too large, and from the
 * actual streamed byte count otherwise (or in addition, when `Content-Length` under-reports the
 * real size -- see the module header). On either path the underlying request is aborted, not left
 * to finish downloading in the background.
 */
export async function fetchWithSizeGuard(
  url: string,
  opts: MaterializeOptions,
): Promise<Uint8Array> {
  const maxBytes = opts.maxBytes ?? MATERIALIZE_MAX_BYTES;
  const controller = new AbortController();
  const resp = await opts.fetchImpl(url, { signal: controller.signal });
  if (!resp.ok) throw new Error(`fetch ${url}: HTTP ${resp.status}`);

  const declared = resp.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      controller.abort();
      throw new MaterializeTooLargeError(n, maxBytes, "content-length");
    }
  }

  if (!resp.body) {
    // no stream available at all (a non-conforming test double or environment) -- the best this
    // path can do is the old after-the-fact check; every real fetch() Response has .body.
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength > maxBytes)
      throw new MaterializeTooLargeError(buf.byteLength, maxBytes, "stream");
    return buf;
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw new MaterializeTooLargeError(total, maxBytes, "stream");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released by cancel() on the guard-tripped path -- fine either way.
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
