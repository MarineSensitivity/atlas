// Shared fixture wiring for the species data-layer tests. Not a test file (vitest only collects
// `*.test.ts`) — it loads the committed fixtures and stands up a `fetchJson` stub keyed by the
// SAME URLs `dataUrl()` builds, so every loader test exercises the real URL formation rather than a
// path the test made up. Provenance of each fixture: tests/fixtures/species/README.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dataUrl } from "../../../src/lib/release/dataBase";
import { parseTaxonShard, type TaxonCard } from "../../../src/lens/species/data/shards";
import { datasetIndex, type DatasetIndex } from "../../../src/lens/species/data/layerBar";
import { parseTaxaIndex, type TaxaIndex } from "../../../src/lens/species/data/picker";

const ROOT = new URL("../../fixtures/species/", import.meta.url);

export function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8")) as unknown;
}

/** every fixture file, keyed by the release path it stands for (`{ver}/app/...`). */
export const FIXTURE_FILES: Record<string, string> = {
  "v9/app/taxa.json": "v9/taxa.json",
  "v9/app/taxon/f9.json": "v9/taxon/f9.json",
  "v9/app/taxon/75.json": "v9/taxon/75.json",
  "v9/app/taxon/03.json": "v9/taxon/03.json",
  "v9/app/taxon/28.json": "v9/taxon/28.json",
  "v9/app/alias/f9.json": "v9/alias/f9.json",
  "v9/app/alias/75.json": "v9/alias/75.json",
  "v9/app/alias/03.json": "v9/alias/03.json",
  "v9/app/alias/28.json": "v9/alias/28.json",
  "v9/app/alias/02.json": "v9/alias/02.json",
  "v9/app/alias/5e.json": "v9/alias/5e.json",
  "v9/app/alias/6d.json": "v9/alias/6d.json",
  "v9/app/alias/9f.json": "v9/alias/9f.json",
  "v7/app/taxa.json": "v7/taxa.json",
  "v7/app/taxon/00.json": "v7/taxon/00.json",
  "v7/app/taxon/6f.json": "v7/taxon/6f.json",
  "v7/app/taxon/e1.json": "v7/taxon/e1.json",
  "v7/app/alias/00.json": "v7/alias/00.json",
  "v7/app/alias/16.json": "v7/alias/16.json",
  "v7/app/alias/6f.json": "v7/alias/6f.json",
  "v7/app/alias/c7.json": "v7/alias/c7.json",
  "v7/app/alias/e1.json": "v7/alias/e1.json",
  "v1/app/taxon/48.json": "v1/taxon/48.json",
};

export interface FetchLog {
  urls: string[];
}

/**
 * A `fetchJson` that serves the fixtures at their real release URLs and 404s everything else
 * (rejecting with a `status`, exactly as the built-in fetcher does, so the error classification is
 * exercised too). `overrides` replaces or adds a body for one release path.
 */
export function fixtureFetch(
  log?: FetchLog,
  overrides: Record<string, unknown> = {},
): (url: string) => Promise<unknown> {
  const byUrl = new Map<string, unknown>();
  for (const [relPath, file] of Object.entries(FIXTURE_FILES)) {
    const ver = relPath.split("/")[0];
    byUrl.set(dataUrl(ver, relPath.slice(ver.length + 1)), readFixture(file));
  }
  for (const [relPath, body] of Object.entries(overrides)) {
    const ver = relPath.split("/")[0];
    byUrl.set(dataUrl(ver, relPath.slice(ver.length + 1)), body);
  }
  return async (url: string) => {
    log?.urls.push(url);
    if (!byUrl.has(url)) throw Object.assign(new Error("HTTP 404"), { status: 404 });
    return byUrl.get(url);
  };
}

function card(file: string, key: string): TaxonCard {
  const shard = parseTaxonShard(readFixture(file));
  if (typeof shard === "string") throw new Error(`${file}: ${shard}`);
  const c = shard.taxa.get(key);
  if (!c) throw new Error(`${file}: no '${key}'`);
  return c;
}

export const CARDS = {
  /** v9 turtle: the default species; AquaX delivered 0-1000; merged extent spans the globe */
  leatherback: () => card("v9/taxon/f9.json", "ms_merge|WORMS:137209"),
  /** v9 mammal: MMPA, an rng_iucn mask, an input with its own bbox */
  walrus: () => card("v9/taxon/75.json", "ms_merge|WORMS:137077"),
  /** v9 bird: ONE input (§11.5), MBTA, botw authority (no WoRMS link) */
  auklet: () => card("v9/taxon/03.json", "ms_merge|BOTW:22694915"),
  /** v9 bird: valid_usa false */
  wrybill: () => card("v9/taxon/28.json", "ms_merge|BOTW:22693928"),
  /** v7 mdl_seq taxon whose inputs publish no assets */
  walrusV7: () => card("v7/taxon/6f.json", "54383"),
  /** v7 taxon with a non-null esa.source ("ch_fws") */
  murrelet: () => card("v7/taxon/00.json", "54272"),
  /** v1 residual taxon: merged null, zero inputs */
  whelk: () => card("v1/taxon/48.json", "17224"),
  /** derived: the 0-360 (lon_span_agg) frame, xmax 210 */
  dateline: () => card("derived/taxon-dateline.json", "ms_merge|DERIVED:257"),
  /** derived: a merged extent that spans the globe */
  globe: () => card("derived/taxon-dateline.json", "ms_merge|DERIVED:513"),
};

export function datasetsFor(ver: "v9" | "v7" | "v1"): DatasetIndex {
  return datasetIndex(readFixture(`${ver}/datasets.json`));
}

export function taxaIndexFor(ver: "v9" | "v7"): TaxaIndex {
  const parsed = parseTaxaIndex(readFixture(`${ver}/taxa.json`));
  if (typeof parsed === "string") throw new Error(`${ver}/taxa.json: ${parsed}`);
  return parsed;
}
