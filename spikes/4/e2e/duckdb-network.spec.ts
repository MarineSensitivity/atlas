// atlas-0 S4 spike, fix round 2, item 1 — is "spatial is statically compiled into duckdb-*.wasm,
// so INSTALL/LOAD spatial touches no network" actually true, or just consistent with
// duckdb_extensions() text (installed=false, install_path="")? Made falsifiable two ways:
//
// (a) observe: page.on("request")/page.on("response") DO see a dedicated Worker's own fetch()
//     calls in this Playwright version — confirmed with a throwaway diagnostic (a worker doing
//     `fetch('https://extensions.duckdb.org/', {mode:'no-cors'})` showed up in both listeners).
//     That contradicts the earlier "page.on('response') can't see worker fetches" note in
//     duckdb-spatial.spec.ts's history — that earlier conclusion was drawn from a run where the
//     listener's `await resp.body()` silently threw for the specific responses at hand (caught by
//     a bare try/catch) or from timing, not from workers being categorically invisible. Here every
//     response is logged via `response.headers()` (no body buffering needed) so nothing can be
//     silently swallowed, and only non-localhost hosts are reported.
// (b) block: page.route() with route.abort() for every non-localhost host, WITH a control run
//     immediately before each blocked cell — a worker fetch to the same control URL — that must
//     itself fail under the block, proving the block reaches worker-initiated fetches for THAT
//     test, not just in isolation.
import { test, expect } from "@playwright/test";

const VERSIONS = ["1.32.0", "next"] as const;
// any real, reachable external host works as the block-reaches-workers control; this happens to
// be the actual real-world DuckDB extension CDN, so a `resp.ok`/opaque success here also somewhat
// corroborates that plain network reachability to that host is not the blocker in the unblocked case.
const CONTROL_URL = "https://extensions.duckdb.org/";

async function workerFetchControlProbe(page: any): Promise<{ ok: boolean; status?: number; type?: string; error?: string }> {
  return page.evaluate(async (url: string) => {
    // the URL travels in via postMessage, not string-baked into the worker source — keeps this
    // one worker script reusable regardless of what CONTROL_URL is.
    const code = `
      self.onmessage = async (e) => {
        try {
          const resp = await fetch(e.data, { mode: 'no-cors' });
          self.postMessage({ ok: true, status: resp.status, type: resp.type });
        } catch (err) {
          self.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      };
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    const p = new Promise((resolve) => {
      worker.onmessage = (e: MessageEvent) => resolve(e.data);
    });
    worker.postMessage(url);
    const r = await p;
    worker.terminate();
    return r as any;
  }, CONTROL_URL);
}

interface NetEntry {
  url: string;
  host: string;
  status: number;
  contentLength: string | null;
  ms: number | null;
}

function isNonLocalhost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.hostname !== "localhost" && u.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__spike4 !== undefined);
});

for (const version of VERSIONS) {
  test(`network observed (unblocked), ${version}: INSTALL/LOAD spatial + ST_Read(gulf_rectangle.gpkg)`, async ({
    page,
  }) => {
    const entries: NetEntry[] = [];
    page.on("response", (resp) => {
      const url = resp.url();
      if (!isNonLocalhost(url)) return;
      entries.push({
        url,
        host: new URL(url).hostname,
        status: resp.status(),
        contentLength: resp.headers()["content-length"] ?? null,
        ms: null, // filled in below once request.timing() resolves (only valid after 'requestfinished')
      });
    });
    const timings: Record<string, number> = {};
    page.on("requestfinished", async (req) => {
      if (!isNonLocalhost(req.url())) return;
      try {
        const t = req.timing();
        timings[req.url()] = t.responseEnd - t.requestStart;
      } catch {
        // timing not available for this request type — leave unset, not fatal to the measurement
      }
    });

    const r = await page.evaluate(
      ([v, url]) => (window as any).__spike4.testGpkg(v, url),
      [version, "/gulf_rectangle.gpkg"] as const,
    );

    for (const e of entries) e.ms = timings[e.url] ?? null;

    console.log(`network(unblocked)/${version}: ${JSON.stringify(r)}`);
    console.log(`  non-localhost hosts touched: ${entries.length}`);
    for (const e of entries) {
      console.log(`    - ${e.url} status=${e.status} content-length=${e.contentLength} ms=${e.ms}`);
    }

    // baseline: unblocked, spatial must load and ST_Read must work — same requirement as
    // duckdb-spatial.spec.ts, repeated here so this file's own baseline is self-verifying.
    expect(r.spatialInstallLoadOk, `${version} spatialInstallLoadOk (unblocked)`).toBe(true);
    expect(r.errorText, `${version} errorText (unblocked)`).toBeNull();
  });

  test(`BLOCKED, ${version}: all non-localhost hosts blocked during INSTALL/LOAD spatial + ST_Read`, async ({
    page,
  }) => {
    const aborted: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (isNonLocalhost(url)) {
        aborted.push(url);
        route.abort();
      } else {
        route.continue();
      }
    });

    // control: THIS test's block must reach a worker-initiated fetch to the same real external
    // host, run right before the actual gate cell — proves the block was live for this test.
    const control = await workerFetchControlProbe(page);
    console.log(`blocked/${version} control probe (worker fetch to ${CONTROL_URL}):`, JSON.stringify(control));
    expect(control.ok, `${version} control probe must FAIL under the block (proves block reaches worker fetches)`).toBe(
      false,
    );

    const r = await page.evaluate(
      ([v, url]) => (window as any).__spike4.testGpkg(v, url),
      [version, "/gulf_rectangle.gpkg"] as const,
    );

    console.log(`blocked/${version} result: ${JSON.stringify(r)}`);
    console.log(`  aborted (non-localhost) requests: ${JSON.stringify(aborted)}`);
    console.log(
      `blocked/${version}: LOAD spatial ${r.spatialInstallLoadOk ? "SUCCEEDED" : "FAILED"} with every non-localhost host blocked`,
    );

    // measured, not assumed: real answer is FAILS — spatial is fetched over the network (see the
    // unblocked test above), so blocking every non-localhost host must block that fetch and
    // LOAD spatial must fail. Asserted explicitly (not just logged) so this stays a real gate: if
    // some future duckdb-wasm build genuinely bundles spatial statically, this assertion would
    // start failing here — loudly, not silently passing on unread text.
    expect(r.spatialInstallLoadOk, `${version} spatialInstallLoadOk (blocked) — expected false`).toBe(false);
    expect(r.errorText, `${version} errorText (blocked) — expected a fetch failure`).toContain("Failed to load");
    expect(aborted.some((u) => u.includes("extensions.duckdb.org")), `${version} the spatial extension URL was aborted`).toBe(
      true,
    );
  });
}

function trackNonLocalhost(page: any): { entries: NetEntry[] } {
  const entries: NetEntry[] = [];
  const timings: Record<string, number> = {};
  page.on("response", (resp: any) => {
    const url = resp.url();
    if (!isNonLocalhost(url)) return;
    entries.push({ url, host: new URL(url).hostname, status: resp.status(), contentLength: resp.headers()["content-length"] ?? null, ms: null });
  });
  page.on("requestfinished", (req: any) => {
    if (!isNonLocalhost(req.url())) return;
    try {
      const t = req.timing();
      timings[req.url()] = t.responseEnd - t.requestStart;
    } catch {
      // not fatal — timing just stays unset for this entry
    }
  });
  return {
    get entries() {
      for (const e of entries) e.ms = timings[e.url] ?? e.ms;
      return entries;
    },
  } as any;
}

test(`reload behavior, 1.32.0: does a page reload re-download the spatial extension?`, async ({ page }) => {
  const track1 = trackNonLocalhost(page);
  const r1 = await page.evaluate(
    ([v, url]) => (window as any).__spike4.testGpkg(v, url),
    ["1.32.0", "/gulf_rectangle.gpkg"] as const,
  );
  console.log(`reload-test first load: spatialInstallLoadOk=${r1.spatialInstallLoadOk}`, JSON.stringify(track1.entries));

  await page.reload();
  await page.waitForFunction(() => (window as any).__spike4 !== undefined);

  const track2 = trackNonLocalhost(page);
  const r2 = await page.evaluate(
    ([v, url]) => (window as any).__spike4.testGpkg(v, url),
    ["1.32.0", "/gulf_rectangle.gpkg"] as const,
  );
  console.log(
    `reload-test after page.reload(): spatialInstallLoadOk=${r2.spatialInstallLoadOk}`,
    JSON.stringify(track2.entries),
  );

  expect(r1.spatialInstallLoadOk, "first load spatialInstallLoadOk").toBe(true);
  expect(r2.spatialInstallLoadOk, "post-reload spatialInstallLoadOk").toBe(true);
});

test(`custom_extension_repository, 1.32.0: does a same-origin copy work with the network block on?`, async ({
  page,
}) => {
  const aborted: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (isNonLocalhost(url)) {
      aborted.push(url);
      route.abort();
    } else {
      route.continue();
    }
  });

  const control = await workerFetchControlProbe(page);
  expect(control.ok, "control probe must FAIL under the block").toBe(false);

  // same-origin copy fetched ahead of time by scripts/fetch-extension-cache.mjs into
  // fixtures/.ext-cache/ (gitignored — real, large, third-party binary, not a spike fixture),
  // served by vite's publicDir at this exact path (mirrors the real repo's own relative path
  // structure, which is what custom_extension_repository is documented to append to).
  const localRepoBase = "http://localhost:4314/.ext-cache";
  const r = await page.evaluate(
    ([v, url, repo]) => (window as any).__spike4.testGpkg(v, url, repo),
    ["1.32.0", "/gulf_rectangle.gpkg", localRepoBase] as const,
  );

  console.log(`custom_extension_repository/1.32.0 result: ${JSON.stringify(r)}`);
  console.log(`  aborted (non-localhost) requests: ${JSON.stringify(aborted)}`);
  console.log(
    `custom_extension_repository/1.32.0: LOAD spatial ${r.spatialInstallLoadOk ? "SUCCEEDED" : "FAILED"} from a same-origin repository with the network block on`,
  );
});
