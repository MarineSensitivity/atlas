// atlas-0 S3 spike (display question). `spectralR` below is the ORIGINAL, superseded approach: a
// hand-rolled approximation of titiler's `colormap_name=spectral_r`, which conflated
// colormap-implementation differences with real geometry/resampling differences in the pixel
// comparison (fix round 1, task 1). `linearGray` is what src/display.ts uses now: matplotlib's
// "gray" colormap (titiler `colormap_name=gray`, NOT ColorBrewer's non-linear ColorBrewer "greys"
// -- verified empirically, see RESULTS.md) is a plain linear ramp, value 0 -> black, 1 -> white,
// so it can be reproduced exactly (not approximated) with `Math.floor(255 * t)`. Kept `spectralR`
// only because nothing else in this repo needs it removed.
const SPECTRAL_11: [number, number, number][] = [
  [158, 1, 66],
  [213, 62, 79],
  [244, 109, 67],
  [253, 174, 97],
  [254, 224, 139],
  [255, 255, 191],
  [230, 245, 152],
  [171, 221, 164],
  [102, 194, 165],
  [50, 136, 189],
  [94, 79, 162],
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// t in [0,1] low->high; "_r" reverses ColorBrewer's Spectral (which runs red->blue for low->high)
// so low value = blue/purple, high value = red.
export function spectralR(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const stops = SPECTRAL_11.slice().reverse();
  const n = stops.length - 1;
  const pos = clamped * n;
  const i0 = Math.min(n - 1, Math.floor(pos));
  const i1 = i0 + 1;
  const frac = pos - i0;
  const [r0, g0, b0] = stops[i0];
  const [r1, g1, b1] = stops[i1];
  return [Math.round(lerp(r0, r1, frac)), Math.round(lerp(g0, g1, frac)), Math.round(lerp(b0, b1, frac))];
}

export function rescale(val: number, min: number, max: number): number {
  return (val - min) / (max - min);
}

// matplotlib "gray": t in [0,1] -> a single grey level in [0,255], black at 0, white at 1. Verified
// against titiler `colormap_name=gray` at three known raw values (67.10 -> pixel 171, 66.45 ->
// pixel 169, 0.32 -> pixel 0, all against rescale=0,100): `floor`, not `round`, matches exactly --
// titiler/rio-tiler's colormap is a 256-entry LUT indexed by `floor(t*255)`, not rounded.
export function linearGray(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return Math.floor(255 * clamped);
}
