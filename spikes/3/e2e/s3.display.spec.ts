import { test, expect } from "@playwright/test";

// atlas-0 S3 spike, display question: "is client-side COG display worth a later phase?" (plan S3
// paragraph, second half). Separate spec from s3.spec.ts because it depends on
// titiler-v8.marinesensitivity.org being reachable (candidate (a)/(b) do not -- (b) reads COGs
// directly from S3). Measurement only; "No adoption here."
//
// Fix round 1 (task 1): both sides render with a colormap that is identical by construction (a
// linear grayscale ramp -- see colormap.ts/display.ts) and nearest-neighbour resampling on both
// sides, so deltas measure alignment/resampling only, not colormap-implementation differences.
// Probes are also classified edge (near a nodata/coastline boundary in the source raster) vs.
// interior; an interior delta > 1-2 grey levels would mean misalignment, reported as a number
// here, not a verdict.

test("deck.gl BitmapLayer vs titiler tiles (linear grayscale, nearest resampling), z2-z8, 20 probe points + memory", async ({ page }) => {
  await page.goto("/display.html");
  await page.waitForFunction(() => "__spike3Display" in window);

  // `performance.memory.usedJSHeapSize` is coarsened by Chrome and returned the same quantized
  // value before/after in this headless context (see RESULTS.md); CDP's Performance.getMetrics
  // reads the real (non-quantized) JSHeapUsedSize instead.
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
      `[S3][display][z${z.z}] probes=${z.probes} compared=${z.compared} requests=${z.requests} ` +
        `maxDelta=${z.maxDelta} meanDelta=${z.meanDelta.toFixed(2)}`,
    );
    for (const w of z.worst) {
      console.log(
        `[S3][display][z${z.z}][worst] lon=${w.lon.toFixed(3)} lat=${w.lat.toFixed(3)} delta=${w.delta} ` +
          `deckGrey=${w.deckGrey} titilerGrey=${w.titilerGrey} edge=${w.edge}`,
      );
    }
  }
});

const GATE_Z = 6; // one representative zoom for the pass/fail gate below (z2-z8 already surveyed above)

// gate: interior probes (edge/nodata-boundary probes excluded) must agree within 2 grey levels.
// `SPIKE3_DISPLAY_FAULT_SHIFT=1` seeds the fault this gate must catch -- a one-cell BitmapLayer
// bounds shift, which must make the identical assertion FAIL (same env-var-toggle pattern as
// e2e/s3.spec.ts's SPIKE3_FAULT_OFFSET and e2e/s3.ext.spec.ts's SPIKE3_EXT_FAULT: the default
// suite run stays green, the fault is a separate documented invocation).
const DISPLAY_FAULT_SHIFT = Number(process.env.SPIKE3_DISPLAY_FAULT_SHIFT ?? 0);

test(`gate: interior probes agree within 2 grey levels${DISPLAY_FAULT_SHIFT ? ` [SEEDED FAULT: BitmapLayer bounds shifted ${DISPLAY_FAULT_SHIFT} cell(s)]` : ""}`, async ({ page }) => {
  await page.goto("/display.html");
  await page.waitForFunction(() => "__spike3Display" in window);
  const result = await page.evaluate(([z, shift]) => window.__spike3Display.interiorGate(z, shift), [GATE_Z, DISPLAY_FAULT_SHIFT] as const);
  console.log(`[S3][display][gate] shift=${DISPLAY_FAULT_SHIFT} n=${result.n} maxInteriorDelta=${result.maxInteriorDelta}`);
  expect(result.n).toBeGreaterThan(0);
  expect(result.maxInteriorDelta).toBeLessThanOrEqual(2);
});
