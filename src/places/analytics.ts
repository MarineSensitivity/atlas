// places/analytics.ts -- Deliverable 7: `place_draw`, `place_upload`, `place_share` param
// builders. Counts and buckets ONLY, never a name or a vertex (or, for `place_share`, a hash) --
// `src/lib/analytics/events.ts` already reserves these three names with an open param bag, and
// `src/lib/analytics/analytics.ts`'s own header states that wiring the GA4 loader tag into a real
// page is a later phase's job ("belongs to whichever later phase mounts this into
// index.html/report.html"), not this one's. So every function here returns a plain params object;
// the caller supplies its own `track` (defaulting to a no-op everywhere in src/places), which stays
// a no-op until that wiring lands and nothing here can accidentally start sending events on its own.
export type Track = (
  event: "place_draw" | "place_upload" | "place_share",
  params: Record<string, unknown>,
) => void;

export const noopTrack: Track = () => {};

/** log10 buckets, "1", "10", "100", ... -- never the exact count (a vertex count can fingerprint a
 * specific shape almost as well as the shape itself). */
function bucket(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const pow = Math.floor(Math.log10(n));
  return `${10 ** pow}`;
}

function areaBucket(areaKm2: number): string {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return "0";
  if (areaKm2 < 100) return "<100";
  if (areaKm2 < 1_000) return "100-1k";
  if (areaKm2 < 10_000) return "1k-10k";
  if (areaKm2 < 100_000) return "10k-100k";
  return ">100k";
}

export function placeDrawParams(nVertices: number, areaKm2: number): Record<string, unknown> {
  return { n_vertices: bucket(nVertices), area_bucket: areaBucket(areaKm2) };
}

export function placeUploadParams(opts: {
  format: string;
  bytes: number;
  nFeatures: number;
  outcome: "ok" | "refused";
}): Record<string, unknown> {
  return {
    format: opts.format,
    bytes_bucket: bucket(opts.bytes),
    n_features: bucket(opts.nFeatures),
    outcome: opts.outcome,
  };
}

export function placeShareParams(linkLength: number): Record<string, unknown> {
  return { length_bucket: bucket(linkLength) };
}
