// The species lens' data layer, part 1: the sharded release objects (atlas-1's data contract,
// "The contract (schema 1)"; atlas-5 "How the lens gets its data").
//
// WHY SHARDS AT ALL. A selected species is ONE fetch of <= 25 KB gzip: `app/taxon/{xx}.json` carries
// the card, the input tree, every asset's url/rescale/colormap/source-layer AND the precomputed
// camera bbox. That is what retires the 86,857-row asset-registry lookup and the per-model bbox
// aggregate (a min/max over a whole model joined to the 17 M-row `cell` table — the Shiny app's most
// expensive query, `atlas-refs/"parity species app.md"` §6.3). Nothing in this lens runs an
// aggregate, and nothing here needs DuckDB: a shared species link paints with zero WASM.
//
// EVERYTHING IS A TYPED RESULT. A shard that 404s, times out, is not JSON, or does not match the
// msens schema comes back as `{ok: false, error}` — never a throw into the UI, and never a
// half-validated object. The app's convention everywhere else (release/session.ts, release/boot.ts)
// is "fail closed, never fail open"; this is the same rule for taxon data.
//
// URLs ARE FORMED IN EXACTLY ONE PLACE. `dataUrl()` (release/dataBase.ts) — never a relative fetch,
// which would resolve against the mount point and become `/v9/atlas/v9/...` on the preview host.
import { dataUrl, type SessionLike } from "../../../lib/release/dataBase";

// ---- the sharding rule --------------------------------------------------------------------------

/** trailing run of digits, the only part of a key the shard rule looks at. */
const TRAILING_DIGITS_RE = /[0-9]+$/;

/**
 * The shard a key lives in: `sprintf('%02x', trailing_integer(key) %% 256)`, and `"00"` when the key
 * ends in no digit at all. Verbatim twin of msens `.shard_of()` (msens/R/app_bundle.R:125-134) — the
 * 256-way rule atlas-1 publishes `taxon/{xx}.json` and `alias/{xx}.json` under.
 *
 * `Number`, not a 32-bit int, deliberately: R uses `as.numeric` there for a documented reason — an
 * 11-digit future WoRMS id overflows `as.integer` to NA and would collapse every such taxon onto
 * `"00"`. JS `Number` is the same IEEE double, so both sides round the same way past 2^53.
 *
 * The expected values come from the R twin itself:
 *   Rscript -e 'k <- c("ms_merge|WORMS:137209","am|Rep-3437","54383","ms_merge|BOTW:22694915",
 *                      "rng_iucn|6494","ch_nmfs|Dermochelys_coriacea","0","255","256","12345678901");
 *               m <- regmatches(k, regexpr("[0-9]+$", k)); n <- rep(0, length(k));
 *               hit <- regexpr("[0-9]+$", k) > 0; n[hit] <- as.numeric(m) %% 256;
 *               cat(paste(k, sprintf("%02x", as.integer(n))), sep = "\n")'
 */
export function shardIdFor(key: string): string {
  const m = TRAILING_DIGITS_RE.exec(key);
  const n = m === null ? 0 : Number(m[0]) % 256;
  return (n >>> 0).toString(16).padStart(2, "0");
}

// ---- the shapes (msens/inst/schema/app_taxon.schema.json, app_alias.schema.json) ----------------

/** `[xmin, ymin, xmax, ymax]` in the `lon_span_agg` frame: **`xmax` may exceed 180** and must stay
 * that way all the way to the camera (see camera.ts). `null` = the extent spans the globe, which is
 * an honest answer for an asset and a useless one for a camera. */
export type Bbox = [number, number, number, number];

export interface TaxonAsset {
  /** `"native"` (as delivered) or `"model"` (resampled to the scoring grid). */
  rep: string;
  type: "cog" | "pmtiles";
  url: string;
  /** VERBATIM from the release — AquaX delivered is `[0, 1000]`, everything else `[1, 100]`. Never
   * defaulted here: a guessed rescale silently recolors a raster. */
  rescale: [number, number] | null;
  colormap: string | null;
  sourceLayer: string | null;
  bbox: Bbox | null;
}

export interface TaxonInput {
  dsKey: string;
  mdlKey: string;
  isMask: boolean;
  /** may be EMPTY: an input that fed the merge but has no published surface in this release (every
   * v1-v7 input, and some v8+ ones). That is a first-class state, not an error — see layerBar.ts. */
  assets: TaxonAsset[];
}

export interface MergedSurface {
  type: "cog";
  url: string;
  rescale: [number, number] | null;
  colormap: string | null;
  bbox: Bbox | null;
}

export interface TaxonCard {
  key: string;
  sci: string;
  common: string | null;
  spCat: string;
  taxonId: string | null;
  taxonAuthority: string | null;
  /** IUCN RedList code. */
  rl: string | null;
  esa: { code: string | null; source: string | null } | null;
  mmpa: boolean | null;
  mbta: boolean | null;
  erScore: number | null;
  validUsa: boolean | null;
  validGlobal: boolean | null;
  /** `null` = no published surface for this taxon in this release (the ~192 residual taxa, plus
   * every taxon on v7b): the lens shows the same notice production shows today. */
  merged: MergedSurface | null;
  inputs: TaxonInput[];
}

/** one `alias/{xx}.json` entry: a raw input key or a legacy `mdl_seq` -> `[merged_key, ds_key]`.
 * The merged key itself is also present, mapping to itself with `ds_key = "ms_merge"`. */
export interface AliasEntry {
  mergedKey: string;
  dsKey: string;
}

/** `ds_key` of the merged model in the published data — the value `alias/{xx}.json` gives for a
 * merged key, and the key `boot.datasets` carries the merged model's display name under. */
export const MERGED_DS_KEY = "ms_merge";

// ---- typed results ------------------------------------------------------------------------------

export type ShardErrorKind =
  /** the fetch itself rejected (offline, CORS, abort). */
  | "network"
  /** a non-2xx response. */
  | "http"
  /** a 2xx body that is not JSON. */
  | "parse"
  /** valid JSON that does not match the msens schema for this object. */
  | "schema"
  /** the shard loaded and validated, but does not contain the key asked for. */
  | "not-found";

export interface ShardError {
  kind: ShardErrorKind;
  url: string;
  status?: number;
  /** one line, safe to show or log; never an exception object (which can carry a URL with a
   * session-scoped data prefix in it). */
  detail: string;
}

export type ShardResult<T> = { ok: true; value: T } | { ok: false; error: ShardError };

const ok = <T>(value: T): ShardResult<T> => ({ ok: true, value });
const err = <T>(error: ShardError): ShardResult<T> => ({ ok: false, error });

// ---- validation (hand-written against the published JSON Schemas) -------------------------------
//
// Deliberately NOT a JSON-Schema library: this module is on the species lens' first-paint path and
// must stay tiny. tests/lens/species/schema.test.ts closes the gap the other way round — it reads
// msens' own `app_taxon`/`app_alias`/`app_taxa` schema files and, for every `required` property in
// them, deletes that property from a real fixture and asserts these validators reject it. Add a
// required field in msens and this validator goes red until it checks it too.

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function optStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function optBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function optNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** a 2-number array (`rescale`), or null. A wrong length is null, never a partial pair. */
function pair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  return typeof a === "number" && typeof b === "number" ? [a, b] : null;
}

/** a 4-number array (`bbox`), or null. Longitudes are NOT touched: `xmax > 180` is the contract. */
function bbox(v: unknown): Bbox | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [v[0], v[1], v[2], v[3]] as Bbox;
}

export const SHARD_ID_RE = /^[0-9a-f]{2}$/;
export const VER_RE = /^v[0-9]+[a-z]?$/;

/** the three fields every `app/` shard carries (`schema`, `ver`, `shard`). */
function checkEnvelope(raw: unknown, payloadKey: string): string | null {
  if (!isObj(raw)) return "not an object";
  if (typeof raw.schema !== "number" || !Number.isInteger(raw.schema) || raw.schema < 1)
    return "'schema' must be an integer >= 1";
  const ver = str(raw.ver);
  if (ver === null || !VER_RE.test(ver)) return "'ver' must be a version label";
  const shard = str(raw.shard);
  if (shard === null || !SHARD_ID_RE.test(shard)) return "'shard' must be two lowercase hex digits";
  if (!isObj(raw[payloadKey])) return `'${payloadKey}' must be an object`;
  return null;
}

function parseAsset(raw: unknown): TaxonAsset | null {
  if (!isObj(raw)) return null;
  const rep = str(raw.rep);
  const type = str(raw.type);
  const url = str(raw.url);
  if (rep === null || url === null) return null;
  if (type !== "cog" && type !== "pmtiles") return null;
  return {
    rep,
    type,
    url,
    rescale: pair(raw.rescale),
    colormap: optStr(raw.colormap),
    sourceLayer: optStr(raw.source_layer),
    bbox: bbox(raw.bbox),
  };
}

function parseInput(raw: unknown): TaxonInput | null {
  if (!isObj(raw)) return null;
  const dsKey = str(raw.ds_key);
  const mdlKey = str(raw.mdl_key);
  if (dsKey === null || mdlKey === null) return null;
  if (!Array.isArray(raw.assets)) return null;
  const assets: TaxonAsset[] = [];
  for (const a of raw.assets) {
    const asset = parseAsset(a);
    if (asset === null) return null;
    assets.push(asset);
  }
  return { dsKey, mdlKey, isMask: raw.is_mask === true, assets };
}

function parseMerged(raw: unknown): MergedSurface | null | undefined {
  // undefined = invalid; null = "no published surface", which is a VALUE, not an error
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) return undefined;
  // `merged.type` is an enum of exactly ["cog"] in the schema; a `type: null` object is the same
  // "no surface" state as a null `merged` (atlas-5: "`merged.type = null` -> the notice")
  if (raw.type === null) return null;
  const url = str(raw.url);
  if (raw.type !== "cog" || url === null) return undefined;
  return {
    type: "cog",
    url,
    rescale: pair(raw.rescale),
    colormap: optStr(raw.colormap),
    bbox: bbox(raw.bbox),
  };
}

/** one taxon object of a taxon shard -> a `TaxonCard`, or null when it does not validate. */
export function parseTaxonCard(raw: unknown): TaxonCard | null {
  if (!isObj(raw)) return null;
  const key = str(raw.key);
  const sci = str(raw.sci);
  const spCat = str(raw.sp_cat);
  if (key === null || sci === null || spCat === null) return null;
  if (!("merged" in raw) || !Array.isArray(raw.inputs)) return null;
  const merged = parseMerged(raw.merged);
  if (merged === undefined) return null;
  const inputs: TaxonInput[] = [];
  for (const i of raw.inputs) {
    const input = parseInput(i);
    if (input === null) return null;
    inputs.push(input);
  }
  const esaRaw = raw.esa;
  return {
    key,
    sci,
    common: optStr(raw.common),
    spCat,
    taxonId: optStr(raw.taxon_id),
    taxonAuthority: optStr(raw.taxon_authority),
    rl: optStr(raw.rl),
    esa: isObj(esaRaw) ? { code: optStr(esaRaw.code), source: optStr(esaRaw.source) } : null,
    mmpa: optBool(raw.mmpa),
    mbta: optBool(raw.mbta),
    erScore: optNum(raw.er_score),
    validUsa: optBool(raw.valid_usa),
    validGlobal: optBool(raw.valid_global),
    merged,
    inputs,
  };
}

export interface TaxonShard {
  ver: string;
  shard: string;
  taxa: Map<string, TaxonCard>;
}

/** `app/taxon/{xx}.json` -> a validated shard, or an error string naming the first violation. */
export function parseTaxonShard(raw: unknown): TaxonShard | string {
  const bad = checkEnvelope(raw, "taxa");
  if (bad !== null) return bad;
  const o = raw as Record<string, unknown>;
  const taxa = new Map<string, TaxonCard>();
  for (const [key, value] of Object.entries(o.taxa as Record<string, unknown>)) {
    const card = parseTaxonCard(value);
    if (card === null) return `taxon '${key}' does not match app_taxon.schema.json`;
    taxa.set(key, card);
  }
  return { ver: o.ver as string, shard: o.shard as string, taxa };
}

export interface AliasShard {
  ver: string;
  shard: string;
  entries: Map<string, AliasEntry>;
}

/** `app/alias/{xx}.json` -> a validated shard, or an error string naming the first violation. */
export function parseAliasShard(raw: unknown): AliasShard | string {
  const bad = checkEnvelope(raw, "alias");
  if (bad !== null) return bad;
  const o = raw as Record<string, unknown>;
  const entries = new Map<string, AliasEntry>();
  for (const [key, value] of Object.entries(o.alias as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length !== 2) return `alias '${key}' is not a 2-item array`;
    const [mergedKey, dsKey] = value;
    if (typeof mergedKey !== "string" || typeof dsKey !== "string")
      return `alias '${key}' must be [merged_key, ds_key] strings`;
    entries.set(key, { mergedKey, dsKey });
  }
  return { ver: o.ver as string, shard: o.shard as string, entries };
}

// ---- loading ------------------------------------------------------------------------------------

export type FetchJson = (url: string) => Promise<unknown>;

/** in-memory only: one entry per `{ver}/{kind}/{xx}` for the life of the page. Shards are small and
 * immutable within a release, and a picker session touches the same handful over and over. Failures
 * are NOT cached (a transient offline must not poison the shard for the rest of the session). */
export interface ShardCache {
  map: Map<string, Promise<ShardResult<unknown>>>;
}

export function createShardCache(): ShardCache {
  return { map: new Map() };
}

/** the cache every caller gets unless it passes its own (tests always pass their own). */
export const defaultShardCache: ShardCache = createShardCache();

export function clearShardCache(cache: ShardCache = defaultShardCache): void {
  cache.map.clear();
}

export interface LoadOptions {
  fetchJson?: FetchJson;
  session?: SessionLike | null;
  cache?: ShardCache | null;
}

/** `globalThis.fetch` as a JSON getter. Rejects on a non-2xx so the caller can label it `http`.
 * Exported so picker.ts (`app/taxa.json`, not a shard) uses the same one rather than a second copy. */
export async function builtinFetchJson(url: string): Promise<unknown> {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) throw new Error("no fetch available");
  const res = await f(url);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return (await res.json()) as unknown;
}

/** one classification of a failed fetch, shared by every loader in this directory. */
export function errorFor(url: string, cause: unknown): ShardError {
  const status = isObj(cause) && typeof cause.status === "number" ? cause.status : undefined;
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (status !== undefined) return { kind: "http", url, status, detail };
  // a JSON body that does not parse arrives as a SyntaxError from `res.json()`
  return { kind: cause instanceof SyntaxError ? "parse" : "network", url, detail };
}

/** fetch + validate one shard, through the cache. Shared by both shard kinds. */
async function loadShard<T>(
  ver: string,
  kind: "taxon" | "alias",
  shard: string,
  parse: (raw: unknown) => T | string,
  opts: LoadOptions,
): Promise<ShardResult<T>> {
  const url = dataUrl(ver, `app/${kind}/${shard}.json`, opts.session);
  const cache = opts.cache === null ? null : (opts.cache ?? defaultShardCache);
  const cacheKey = url;
  const hit = cache?.map.get(cacheKey);
  if (hit) return (await hit) as ShardResult<T>;

  const fetchJson = opts.fetchJson ?? builtinFetchJson;
  const run = (async (): Promise<ShardResult<T>> => {
    let raw: unknown;
    try {
      raw = await fetchJson(url);
    } catch (cause) {
      return err<T>(errorFor(url, cause));
    }
    const parsed = parse(raw);
    if (typeof parsed === "string")
      return err<T>({ kind: "schema", url, detail: `app/${kind}/${shard}.json: ${parsed}` });
    return ok(parsed);
  })();

  cache?.map.set(cacheKey, run as Promise<ShardResult<unknown>>);
  const result = await run;
  // never cache a failure: the next attempt must really retry
  if (!result.ok) cache?.map.delete(cacheKey);
  return result;
}

/** the whole `taxon/{xx}.json` shard `key` lives in (cached). */
export function loadTaxonShard(
  ver: string,
  key: string,
  opts: LoadOptions = {},
): Promise<ShardResult<TaxonShard>> {
  return loadShard(ver, "taxon", shardIdFor(key), parseTaxonShard, opts);
}

/**
 * One taxon card. A missing key inside a well-formed shard is `{kind: "not-found"}` — a normal
 * answer (a retired `mdl_key` in a shared link), not an error state.
 */
export async function loadTaxon(
  ver: string,
  key: string,
  opts: LoadOptions = {},
): Promise<ShardResult<TaxonCard>> {
  const shard = await loadTaxonShard(ver, key, opts);
  if (!shard.ok) return shard;
  const card = shard.value.taxa.get(key);
  if (!card)
    return err({
      kind: "not-found",
      url: dataUrl(ver, `app/taxon/${shardIdFor(key)}.json`, opts.session),
      detail: `no taxon '${key}' in ${ver}`,
    });
  return ok(card);
}

/** the whole `alias/{xx}.json` shard `key` lives in (cached). */
export function loadAliasShard(
  ver: string,
  key: string,
  opts: LoadOptions = {},
): Promise<ShardResult<AliasShard>> {
  return loadShard(ver, "alias", shardIdFor(key), parseAliasShard, opts);
}

/**
 * Resolve one raw input key or legacy `mdl_seq` through its shard. Same "not-found is a value"
 * rule as {@link loadTaxon}: an unknown key is a typed result the deep-link resolver turns into the
 * "Model not found" explanation, never a throw.
 */
export async function loadAlias(
  ver: string,
  key: string,
  opts: LoadOptions = {},
): Promise<ShardResult<AliasEntry>> {
  const shard = await loadAliasShard(ver, key, opts);
  if (!shard.ok) return shard;
  const entry = shard.value.entries.get(key);
  if (!entry)
    return err({
      kind: "not-found",
      url: dataUrl(ver, `app/alias/${shardIdFor(key)}.json`, opts.session),
      detail: `no alias '${key}' in ${ver}`,
    });
  return ok(entry);
}
