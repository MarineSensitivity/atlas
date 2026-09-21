// atlas-0 S3 spike (display question): a hand-rolled approximation of the "spectral_r" ramp the
// manifest's COGs are styled with (titiler's `colormap_name=spectral_r`, presumably a matplotlib
// registered colormap under rio-tiler). Reproduced from ColorBrewer's 11-class "Spectral" scheme
// (the same 11-stop convention CLAUDE.md/atlas-refs call out for this org's ramps), reversed for
// the "_r" suffix. This is an APPROXIMATION -- see spikes/3/RESULTS.md's methodology note: any
// pixel delta between our own render and titiler's may include colormap-implementation
// differences, not just geometric/resampling differences.
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
