#!/usr/bin/env node
// atlas-0 Step 4, S2, fix round 1: raw FCP / firstDataFrame / zonesPainted / idle measurements on
// a cold profile -- a fresh BROWSER PROCESS and a fresh CONTEXT per run, HTTP cache explicitly
// disabled via CDP (not just relying on a fresh profile having no disk cache to begin with).
// Requires `npm run build && npm run preview` already serving http://localhost:4312/ in another
// shell (or pass MEASURE_BASE_URL).
//
// Fix round 1 correction: the previous version of this script (and the gate) used
// `map.once("render", ...)` as "first frame" -- that fires on the FIRST render of an empty
// background, before any tile has ever arrived, so it said nothing about paint and could never go
// red against the 2.5s budget. This version reads src/main.ts's real marks instead:
//   - firstDataFrame: the first render after which gl.readPixels at BOTH ocean probe points reads
//     back non-background data (checked fresh every render tick inside main.ts itself).
//   - zonesPainted: isSourceLoaded("zones") AND a queryRenderedFeatures hit on the zones-line layer.
//   - idle: MapLibre's own "idle" event.
//
// Cross-origin (S3 + titiler) request/byte counts use the CDP Network domain
// (Network.loadingFinished.encodedDataLength), NOT the page's own Resource Timing API --
// performance.getEntriesByType("resource") zeroes out transferSize/encodedBodySize for
// cross-origin responses that don't send Timing-Allow-Origin (neither S3 nor titiler does), which
// is why the first version of this script could only measure same-origin bytes.
//
// usage: node scripts/measure.mjs [n]   (n = number of runs, default 9)
import { chromium } from "@playwright/test";

const N = Number(process.argv[2] ?? 9);
const BASE_URL = process.env.MEASURE_BASE_URL ?? "http://localhost:4312/";
const S3_HOSTNAME = "s3.us-east-1.amazonaws.com"; // path-style: bucket "oceanmetrics.io-public" is a path segment, not the hostname
const TITILER_HOSTNAME = "titiler-v8.marinesensitivity.org";

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function fmt(nums) {
  if (nums.length === 0) return "n/a";
  return `median=${median(nums).toFixed(1)}ms range=[${Math.min(...nums).toFixed(1)}, ${Math.max(...nums).toFixed(1)}]ms`;
}
// classify by the REAL hostname (new URL().hostname), not a substring match on the whole URL --
// a titiler tile request embeds the S3 COG url as a `?url=` query param, so a naive
// `url.includes("oceanmetrics.io-public")` matched every titiler request too and silently zeroed
// out the titiler bucket (found by running this harness -- see RESULTS.md fix round 1).
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
function isS3(url) {
  return hostOf(url) === S3_HOSTNAME;
}
function isTitiler(url) {
  return hostOf(url) === TITILER_HOSTNAME;
}

async function runOnce() {
  // a fresh browser PROCESS per run = the "cold profile" -- slower to launch than reusing one
  // browser, but that IS the point: no warm disk/memory cache carried from a previous run.
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl-software-rendering", "--ignore-gpu-blocklist"],
  });
  try {
    // a fresh CONTEXT too (not just reusing the browser's default one) -- explicit, not implied.
    const context = await browser.newContext();
    const page = await context.newPage();

    // CDP: disable the HTTP cache outright (belt-and-suspenders over "fresh profile has no cache
    // yet") and track every request's real wire bytes via Network.loadingFinished, which reports
    // encodedDataLength regardless of CORS/Timing-Allow-Origin (unlike the page's own Resource
    // Timing API).
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

    /** @type {Map<string, {url:string, sentAt:number, finishedAt?:number, encodedDataLength?:number}>} */
    const cdpRequests = new Map();
    let t0 = null; // CDP "timestamp" (seconds, monotonic) of the main document request
    cdp.on("Network.requestWillBeSent", (e) => {
      if (t0 === null && e.type === "Document") t0 = e.timestamp;
      cdpRequests.set(e.requestId, { url: e.request.url, sentAt: e.timestamp });
    });
    cdp.on("Network.loadingFinished", (e) => {
      const r = cdpRequests.get(e.requestId);
      if (r) {
        r.finishedAt = e.timestamp;
        r.encodedDataLength = e.encodedDataLength;
      }
    });

    // NOTE (fix round 3): page.waitForFunction(pageFunction, arg, options) -- options go THIRD.
    // `.waitForFunction(fn, {timeout:N})` (2-arg) silently passes the options object as `arg`
    // instead, so these used to fall through to Playwright's hard default (30s) rather than the
    // intended 20s -- found while debugging a hang in e2e/s2.spike.spec.ts, same bug there. Never
    // mattered here in practice (titiler was reachable for every real measure.mjs run), but fixed
    // for correctness -- see RESULTS.md fix round 3.
    await page.goto(BASE_URL, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__s2?.marks?.firstDataFrame !== undefined, undefined, {
      timeout: 20_000,
    });
    await page.waitForFunction(() => window.__s2?.marks?.zonesPainted !== undefined, undefined, {
      timeout: 20_000,
    });
    await page.waitForFunction(() => window.__s2?.marks?.idle !== undefined, undefined, {
      timeout: 20_000,
    });
    // let any just-completed CDP loadingFinished events flush before reading cdpRequests.
    await page.waitForTimeout(300);

    const { marks, paint } = await page.evaluate(() => ({
      marks: window.__s2.marks,
      paint: Object.fromEntries(
        performance.getEntriesByType("paint").map((e) => [e.name, e.startTime]),
      ),
    }));

    const fcpMs = paint["first-contentful-paint"] ?? null;
    const firstDataFrameMs = marks.firstDataFrame - marks.scriptStart;
    const zonesPaintedMs = marks.zonesPainted - marks.scriptStart;
    const idleMs = marks.idle - marks.scriptStart;

    // CDP timestamps are seconds since an arbitrary (but monotonic, per-session) epoch; t0 (the
    // main document request) approximates the same instant as performance.now()'s navigationStart
    // -- so (cdpTimestamp - t0) * 1000 approximates the same clock the marks above use. This is an
    // approximation (not exact to the millisecond), same caveat as fix round 0's wall-clock
    // reconciliation.
    function beforeMs(budgetMs) {
      const cutoffCdp = t0 + budgetMs / 1000;
      let s3Requests = 0,
        s3Bytes = 0,
        titilerRequests = 0,
        titilerBytes = 0;
      for (const r of cdpRequests.values()) {
        const at = r.finishedAt ?? r.sentAt;
        if (at > cutoffCdp) continue;
        const bytes = r.encodedDataLength ?? 0;
        if (isS3(r.url)) {
          s3Requests++;
          s3Bytes += bytes;
        } else if (isTitiler(r.url)) {
          titilerRequests++;
          titilerBytes += bytes;
        }
      }
      return { s3Requests, s3Bytes, titilerRequests, titilerBytes };
    }

    return {
      fcpMs,
      firstDataFrameMs,
      zonesPaintedMs,
      idleMs,
      beforeFirstDataFrame: beforeMs(firstDataFrameMs),
      beforeIdle: beforeMs(idleMs),
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
    `run ${i + 1}/${N}: FCP=${r.fcpMs?.toFixed(1)}ms firstDataFrame=${r.firstDataFrameMs.toFixed(1)}ms ` +
      `zonesPainted=${r.zonesPaintedMs.toFixed(1)}ms idle=${r.idleMs.toFixed(1)}ms | ` +
      `before firstDataFrame: S3 ${r.beforeFirstDataFrame.s3Requests}req/${r.beforeFirstDataFrame.s3Bytes}B, ` +
      `titiler ${r.beforeFirstDataFrame.titilerRequests}req/${r.beforeFirstDataFrame.titilerBytes}B | ` +
      `before idle: S3 ${r.beforeIdle.s3Requests}req/${r.beforeIdle.s3Bytes}B, ` +
      `titiler ${r.beforeIdle.titilerRequests}req/${r.beforeIdle.titilerBytes}B`,
  );
}

const fcps = results.map((r) => r.fcpMs).filter((x) => x !== null);
const firstDataFrames = results.map((r) => r.firstDataFrameMs);
const zonesPainteds = results.map((r) => r.zonesPaintedMs);
const idles = results.map((r) => r.idleMs);

console.log("\n--- summary (N=" + N + ") ---");
console.log(`FCP: ${fmt(fcps)}`);
console.log(`firstDataFrame: ${fmt(firstDataFrames)}  (gate: <= 2500ms)`);
console.log(`zonesPainted: ${fmt(zonesPainteds)}`);
console.log(`idle: ${fmt(idles)}`);

const medianRun = results[Math.floor(N / 2)];
console.log(`\ncross-origin bytes/requests, representative run (index ${Math.floor(N / 2)}):`);
console.log(
  `  before firstDataFrame: S3 ${medianRun.beforeFirstDataFrame.s3Requests} requests / ${medianRun.beforeFirstDataFrame.s3Bytes} bytes, ` +
    `titiler ${medianRun.beforeFirstDataFrame.titilerRequests} requests / ${medianRun.beforeFirstDataFrame.titilerBytes} bytes`,
);
console.log(
  `  before idle: S3 ${medianRun.beforeIdle.s3Requests} requests / ${medianRun.beforeIdle.s3Bytes} bytes, ` +
    `titiler ${medianRun.beforeIdle.titilerRequests} requests / ${medianRun.beforeIdle.titilerBytes} bytes`,
);
