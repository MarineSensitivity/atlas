#!/usr/bin/env node
// atlas-0 Step 4, S2: raw FCP / map-first-frame / bytes-and-requests-before-first-frame
// measurements on a cold profile (a fresh browser process per run -- no disk cache, no in-memory
// cache reuse between runs). Requires `npm run build && npm run preview` already serving
// http://localhost:4312/ in another shell (or pass MEASURE_BASE_URL).
//
// usage: node scripts/measure.mjs [n]   (n = number of runs, default 7)
import { chromium } from "@playwright/test";

const N = Number(process.argv[2] ?? 7);
const BASE_URL = process.env.MEASURE_BASE_URL ?? "http://localhost:4312/";

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function runOnce() {
  // a fresh browser process per run = the "cold profile" -- slower to launch than reusing one
  // browser, but that IS the point: no warm disk/memory cache carried from a previous run.
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl-software-rendering", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage();

    await page.goto(BASE_URL, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__s2?.marks?.firstRender !== undefined, {
      timeout: 15_000,
    });

    // Resource Timing API (transferSize/encodedBodySize), not response content-length headers:
    // `vite preview` serves gzip over chunked transfer-encoding with NO content-length header at
    // all, which under-reported every same-origin asset as 0B when this script tracked
    // page.on("response") headers instead (found by running this harness -- see RESULTS.md).
    const { marks, paint, resources } = await page.evaluate(() => ({
      marks: window.__s2.marks,
      paint: Object.fromEntries(
        performance.getEntriesByType("paint").map((e) => [e.name, e.startTime]),
      ),
      // the top-level document request isn't a "resource" entry -- it's "navigation" -- so it's
      // stitched in here to get a complete before-first-frame byte count.
      resources: [
        ...performance.getEntriesByType("navigation").map((e) => ({
          name: e.name,
          startTime: e.startTime,
          transferSize: e.transferSize,
          encodedBodySize: e.encodedBodySize,
          decodedBodySize: e.decodedBodySize,
        })),
        ...performance.getEntriesByType("resource").map((e) => ({
          name: e.name,
          startTime: e.startTime,
          transferSize: e.transferSize,
          encodedBodySize: e.encodedBodySize,
          decodedBodySize: e.decodedBodySize,
        })),
      ],
    }));

    const firstFrameMs = marks.firstRender - marks.scriptStart;
    const fcpMs = paint["first-contentful-paint"] ?? null;

    // "before first frame" = every resource whose fetch STARTED before the firstRender mark
    // (both timestamps are performance.now() values relative to the same navigationStart, so no
    // wall-clock reconciliation needed here, unlike an earlier version of this script).
    const before = resources.filter((r) => r.startTime <= marks.firstRender);
    const bytes = before.reduce((sum, r) => sum + (r.transferSize || 0), 0);

    return {
      fcpMs,
      firstFrameMs,
      requestCount: before.length,
      bytes,
      requests: before.map((r) => `${r.name} (transfer ${r.transferSize}B, decoded ${r.decodedBodySize}B)`),
    };
  } finally {
    await browser.close();
  }
}

const results = [];
for (let i = 0; i < N; i++) {
  const r = await runOnce();
  results.push(r);
  console.log(
    `run ${i + 1}/${N}: FCP=${r.fcpMs?.toFixed(1)}ms firstFrame=${r.firstFrameMs.toFixed(1)}ms ` +
      `requests=${r.requestCount} bytes=${r.bytes}`,
  );
}

const fcps = results.map((r) => r.fcpMs).filter((x) => x !== null);
const frames = results.map((r) => r.firstFrameMs);

console.log("\n--- summary ---");
console.log(
  `FCP: median=${median(fcps).toFixed(1)}ms range=[${Math.min(...fcps).toFixed(1)}, ${Math.max(...fcps).toFixed(1)}]ms`,
);
console.log(
  `map-first-frame: median=${median(frames).toFixed(1)}ms range=[${Math.min(...frames).toFixed(1)}, ${Math.max(...frames).toFixed(1)}]ms`,
);
console.log(`requests before first frame (run 1 of ${N}): ${results[0].requestCount}`);
console.log(`bytes before first frame (run 1 of ${N}): ${results[0].bytes}`);
console.log(`request list (run 1 of ${N}):`);
for (const u of results[0].requests) console.log(`  ${u}`);
