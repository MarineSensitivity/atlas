import type { Page } from "@playwright/test";

// atlas-0 Step 4, S2: the two known ocean points the pixel-probe gate reads (plan Step 4:
// "the map canvas has painted pixels at two known ocean points (gl.readPixels, lesson 9)").
// Confirmed non-null over the published score COG via titiler's /cog/point before writing this
// harness (see RESULTS.md): -88,27 -> 21.0; -122,36 -> 37.0.
export const OCEAN_POINTS = [
  { lon: -88, lat: 27, label: "Gulf of Mexico" },
  { lon: -122, lat: 36, label: "off central California" },
];

// atlas-refs "calcofi explore review.md" §11 lesson 9: gl.readPixels() at known lon/lat is
// sometimes the only way to assert a layer actually rendered, because the content lives entirely
// inside an opaque canvas to the DOM. Mirrors CalCOFI's own scripts/verify.mjs `probeMap()`
// (c.width / c.clientWidth for the device-pixel-ratio scale, y flipped for the framebuffer's
// bottom-left origin) rather than reinventing the projection math.
export async function readOceanPixel(
  page: Page,
  pt: { lon: number; lat: number },
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(({ lon, lat }) => {
    const map = window.__s2.map;
    if (!map) throw new Error("window.__s2.map not set -- boot() has not run yet");
    const canvas = map.getCanvas();
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext;
    const dpr = canvas.width / canvas.clientWidth;
    const p = map.project([lon, lat]); // CSS pixels, origin top-left
    const fbX = Math.round(p.x * dpr);
    const fbY = Math.round(canvas.height - p.y * dpr); // WebGL framebuffer origin is bottom-left
    const pixel = new Uint8Array(4);
    gl.readPixels(fbX, fbY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] };
  }, pt);
}

// "painted" = not the plain #0b2436 background (11,36,54) and not fully transparent. The score
// raster is colored with the "spectral_r" colormap over [0,90] -- real data at these two points
// (21 and 37, see above) will never land exactly on the background triplet.
export function isPainted(px: { r: number; g: number; b: number; a: number }): boolean {
  if (px.a === 0) return false;
  return !(px.r === 11 && px.g === 36 && px.b === 54);
}
