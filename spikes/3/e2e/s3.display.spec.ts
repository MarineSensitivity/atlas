import { test } from "@playwright/test";

// atlas-0 S3 spike, display question: "is client-side COG display worth a later phase?" (plan S3
// paragraph, second half). Separate spec from s3.spec.ts because it depends on
// titiler-v8.marinesensitivity.org being reachable (candidate (a)/(b) do not -- (b) reads COGs
// directly from S3). Measurement only; "No adoption here."

test("deck.gl BitmapLayer vs titiler tiles, z2-z8, 20 probe points + memory", async ({ page }) => {
  await page.goto("/display.html");
  await page.waitForFunction(() => "__spike3Display" in window);

  // `performance.memory.usedJSHeapSize` (read inside display.ts) is intentionally coarsened by
  // Chrome for privacy and, in this headless/non-cross-origin-isolated context, returned the exact
  // same quantized value before and after (see spikes/3/RESULTS.md) -- useless as a before/after
  // delta. CDP's Performance domain reads the real (non-quantized) JSHeapUsedSize instead.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const jsHeapUsedSize = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? null;
  };

  const cdpHeapBefore = await jsHeapUsedSize();
  const result = await page.evaluate(() => window.__spike3Display.run([2, 3, 4, 5, 6, 7, 8]));
  const cdpHeapAfter = await jsHeapUsedSize();

  console.log(
    `[S3][display] performance.memory: before=${result.heapBeforeBytes} after=${result.heapAfterBytes} ` +
      `(Chrome-coarsened, see RESULTS.md) | CDP Performance.getMetrics JSHeapUsedSize: before=${cdpHeapBefore} after=${cdpHeapAfter} delta=${cdpHeapAfter! - cdpHeapBefore!}`,
  );
  for (const z of result.perZoom) {
    console.log(
      `[S3][display][z${z.z}] probes=${z.probes} requests=${z.requests} maxChannelDelta=${z.maxChannelDelta} meanChannelDelta=${z.meanChannelDelta.toFixed(2)}`,
    );
  }
});
