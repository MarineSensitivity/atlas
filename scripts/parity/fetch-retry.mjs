// scripts/parity/fetch-retry.mjs -- a bounded retry for the ONE `fetch` the parity harness makes
// (`run.mjs#readBoot`, each release's `app/boot.json`).
//
// WHY (R5-4, CI runs 36944227000 / 36982576967 and the two before them): `run.mjs v9 v7` reads v9's
// boot.json, spends minutes on v9's DuckDB queries, prints `PASS (max|delta| < 1e-9 ...)`, and then
// reads v7's boot.json. Node's fetch (undici) reuses the pooled keep-alive TLS connection from the
// v9 read; S3 closed it server-side during the long idle, so the first write on it dies with
// `TypeError: fetch failed` / `SocketError: other side closed` (UND_ERR_SOCKET) -- a transport
// failure after a PASSING comparison, not a parity result. The boot.json IS needed for the verdict
// (grid, id_field and layers decide how v7's quantities are computed), so it cannot be dropped; a
// bounded retry opens a fresh connection and succeeds.
//
// WHAT IS RETRIED: only what a second attempt can change -- a thrown network error, or an HTTP 5xx /
// 429. A 4xx (the 404 of a missing release, a 403) is an ANSWER and is returned on the first try, so
// a genuinely absent object still fails the gate immediately and loudly. Nothing here touches the
// comparison itself.

/** how many attempts in total (1 try + 3 retries). */
export const FETCH_ATTEMPTS = 4;
/** the first backoff; doubles each retry (500, 1000, 2000 ms). */
export const FETCH_BACKOFF_MS = 500;

/** a response a retry could change: server-side trouble or throttling. */
export function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

/**
 * `fetch(url)` with a bounded retry + exponential backoff. `fetchImpl`/`sleep` are injectable so the
 * unit test drives it with no network and no real waiting. Returns the final `Response` (which may
 * still be non-OK -- the caller decides), or throws the LAST network error once attempts run out.
 */
export async function fetchWithRetry(
  url,
  {
    attempts = FETCH_ATTEMPTS,
    backoffMs = FETCH_BACKOFF_MS,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = (msg) => console.error(msg),
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await fetchImpl(url);
      if (!isRetryableStatus(resp.status) || attempt === attempts) return resp;
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === attempts) throw err;
    }
    const wait = backoffMs * 2 ** (attempt - 1);
    log(
      `  fetch ${url}: attempt ${attempt}/${attempts} failed (${lastError?.cause?.code ?? lastError?.message}); retrying in ${wait} ms`,
    );
    await sleep(wait);
  }
  throw lastError;
}
