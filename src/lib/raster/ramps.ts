// THE ONLY place a color ramp is defined (atlas-2 `raster/` contract). The 11 stops per palette are
// NOT hardcoded here — R writes them into `boot.palettes` at publish time
// (`colorRampPalette(space = "Lab")(11)`, msens) and this module only operates on whatever boot.json
// hands it, so a brand or ramp change is a DATA change, never a code change. Ramp colors are data
// colors, not brand tokens: they must never be added to src/lib/brand/tokens.css (that file's rule
// is enforced by scripts/check-hex-literals.mjs, a separate gate from this one).
//
// Every legend, click popup, zone choropleth and report gradient key must import from here —
// tests/raster/ramps.wiring.test.ts is the seeded-fault gate that scans src/ and fails if a second
// ramp or palette array is ever planted outside this file.
import type { Palette } from "../state/types";

/** re-exported under this module's own name so callers of raster/ don't have to know the palette
 * name lives in state/types.ts too (plan D8's `pal` query key uses the exact same four names — this
 * alias, not a duplicate list, is what keeps them from drifting apart). */
export type PaletteName = Palette;

/** `boot.palettes[name]` — exactly 11 hex stops per the atlas-1 data contract
 * (`palettes{name:[11 hex]}`, `colorRampPalette(space = "Lab")(11)`). Nothing here validates the
 * *count*: callers pass whatever boot.json contains, and a wrong count is a publish-time (atlas-1)
 * data bug, not something this module should silently paper over by resampling. */
export type PaletteStops = readonly string[];

/**
 * Reads `boot.palettes[name]` with a runtime guard. `boot.json`'s real JSON Schema has not landed
 * yet (see src/lib/release/boot.ts's TODO), so this file cannot assume the key exists or is
 * well-formed — a missing/malformed `palettes` object resolves to `null`, never a throw, matching
 * this repo's "fail closed, never fail open" convention for not-yet-schema'd release data.
 */
export function paletteStopsFromBoot(
  boot: { palettes?: unknown } | null | undefined,
  name: PaletteName,
): PaletteStops | null {
  const palettes = boot?.palettes;
  if (!palettes || typeof palettes !== "object") return null;
  const stops = (palettes as Record<string, unknown>)[name];
  if (!Array.isArray(stops) || stops.length === 0 || !stops.every((s) => typeof s === "string")) {
    return null;
  }
  return stops as PaletteStops;
}

export interface LegendStop {
  /** the hex color at this stop, straight from `boot.palettes` — never recomputed. */
  color: string;
  /** the data value this stop represents, linearly spaced across `[min, max]`. */
  value: number;
}

/**
 * The legend stops for `stops`, each paired with the data value it represents (evenly spaced across
 * `[min, max]`) — what the map legend and the report's gradient key render (plan: "values =
 * signif(meta$rescale, 3)" plus the 11 palette colors, ported from `app.R:2149-2150`).
 */
export function legendStops(stops: PaletteStops, min: number, max: number): LegendStop[] {
  const n = stops.length;
  return stops.map((color, i) => ({
    color,
    value: n <= 1 ? min : min + (i / (n - 1)) * (max - min),
  }));
}

// local half-even (banker's) rounding to the nearest integer — R's `round()` default, and the exact
// behavior the choropleth bin formula requires (a drawn rectangle produces exact `.5` fractions, and
// `Math.round` always rounds `.5` UP, silently shifting every exact-half cell into the next bin — the
// seeded fault this gate exists to catch).
//
// TODO(atlas-2 geo/): replace this private copy with `import { roundHalfEven } from
// "../geo/round"` once that branch merges. DO NOT create src/lib/geo/round.ts from here — geo/ is
// another agent's territory (see this repo's worktree instructions) — so this stays a small, tested
// duplicate until then.
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // exact half: round to the nearest EVEN integer
  return floor % 2 === 0 ? floor : floor + 1;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * The choropleth bin, 1..11, for `value` —
 * `clamp(roundHalfEven((v-min)/max(max-min,1e-6)*10)+1, 1, 11)`, byte-identical to the plan's
 * `raster/` contract and to R's `round()` semantics. Distinct from `colorForValue`'s continuous
 * blend: this SNAPS a value into one of the 11 discrete stops, for a zone choropleth fill.
 */
export function choroplethBin(value: number, min: number, max: number): number {
  const denom = Math.max(max - min, 1e-6);
  return clamp(roundHalfEven(((value - min) / denom) * 10) + 1, 1, 11);
}

/** the discrete stop color for `value`'s choropleth bin. */
export function binColor(stops: PaletteStops, value: number, min: number, max: number): string {
  const bin = choroplethBin(value, min, max); // 1..11
  return stops[clamp(bin - 1, 0, stops.length - 1)];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`raster/ramps.ts: not a 6-digit hex color: ${JSON.stringify(hex)}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * The continuous color for `value` — linear RGB interpolation between the two nearest of the 11
 * stops (distinct from `choroplethBin`/`binColor`'s discrete 1-of-11 snap). Used for the click popup
 * and any other "the exact value's color" surface.
 *
 * Interpolating in sRGB rather than re-deriving Lab space is a deliberate simplification: the 11
 * stops were already built in Lab space by `colorRampPalette(space = "Lab")`, so this only blends
 * BETWEEN two already-Lab-spaced neighboring stops, where sRGB and Lab interpolation are visually
 * indistinguishable over that short a span.
 */
export function colorForValue(
  stops: PaletteStops,
  value: number,
  min: number,
  max: number,
): string {
  if (stops.length === 0)
    throw new Error("raster/ramps.ts: colorForValue requires at least one stop");
  if (stops.length === 1) return stops[0];
  const denom = Math.max(max - min, 1e-6);
  const t = clamp((value - min) / denom, 0, 1) * (stops.length - 1);
  const lo = Math.floor(t);
  const hi = Math.min(lo + 1, stops.length - 1);
  const frac = t - lo;
  const a = hexToRgb(stops[lo]);
  const b = hexToRgb(stops[hi]);
  const mixed: [number, number, number] = [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
  return rgbToHex(mixed);
}
