// analysis/sources.ts -- the browser plumbing under `queries.ts` (atlas-2 Step 3b).
//
// Turns "this release, these tiles" into DuckDB views the `sql/*.sql` twins can name. It is the
// ONLY module that knows a release's objects are fetched over HTTP and registered as virtual files;
// every twin sees plain view names (`cell`, `cell_model`, `cell_model_key`, `taxon`, `zone_taxon`,
// `taxonomy`, `model`), exactly as the R twins see plain table names.
//
// Materialize, then query (plan D3/atlas-2 `engine/`): whole objects through `Engine#load`, no
// httpfs range reads. A `cell` tile is ~110-250 KB and a `cell_model` tile p50 2.1 MB / max 23.7 MB,
// all under the 25 MB materialize guard.
import { MAX_CELL_MODEL_TILES, batchTiles } from "./place";
import { cellModelKeySql, type SqlRunner, type Templates } from "./queries";
import { ident } from "../engine/sql";
import type { Engine } from "../engine/engine";

/** the `boot.tables` entry shape atlas-1 publishes. */
interface BootTable {
  href?: unknown;
  digest?: unknown;
}

export interface SourcesOptions {
  /** builds an absolute URL for a path under this release, e.g. `app/taxon.parquet`. The ONE place
   * a data origin is formed stays `release/dataBase.ts`; this is its caller, never a second copy. */
  url: (path: string) => string;
  /** `boot.json`, parsed. */
  boot: Record<string, unknown>;
  templates: Templates;
}

/** `boot.tables[name].digest`, or a stable fallback so a table is still registered exactly once. */
function digestOf(boot: Record<string, unknown>, name: string, fallback: string): string {
  const tables = boot.tables as Record<string, BootTable> | undefined;
  const d = tables?.[name]?.digest;
  return typeof d === "string" && d.length ? d : fallback;
}

export class AnalysisSources {
  readonly engine: Engine;
  readonly boot: Record<string, unknown>;
  readonly templates: Templates;
  #url: (path: string) => string;
  #mountedCellModel: number[] = [];

  constructor(engine: Engine, opts: SourcesOptions) {
    this.engine = engine;
    this.boot = opts.boot;
    this.templates = opts.templates;
    this.#url = opts.url;
  }

  /** `queries.ts` only ever needs `exec`, so the Engine is handed over as exactly that. */
  get db(): SqlRunner {
    return this.engine;
  }

  get ver(): string {
    return String(this.boot.ver ?? "");
  }

  /** `boot.id_field`: the ONE generation fact the contract lets the browser know (atlas-1). */
  get idField(): string {
    return String(this.boot.id_field ?? "");
  }

  /** load one whole-object table and expose it under `view`. */
  async table(view: string, path: string, bootName = view): Promise<void> {
    const file = `${this.ver}/${path}`;
    await this.engine.load(file, this.#url(path), digestOf(this.boot, bootName, file));
    await this.#view(view, [file]);
  }

  /**
   * The small tables every lens needs. `taxonomy` and `model` are OPTIONAL by presence: a release
   * whose bundle has neither still answers scores and the zone species table.
   *
   * `model` is NOT under `app/`: atlas-1's `boot.tables` publishes only `cell`, `taxon` and
   * `zone_taxon`, yet `sql/cell_model_key.sql` (every v8+ release) must map `mdl_id` -> `mdl_key`.
   * The only published object carrying that map is `{ver}/tables/model.parquet` (1.1 MB, anonymously
   * readable, verified on v7 and v9). REPORTED TO THE R SIDE: it belongs in `app/` with a digest,
   * like `taxonomy.parquet` (the reviewer's finding B), or OPFS can never invalidate either one.
   */
  async coreTables(opts: { taxonomy?: boolean } = {}): Promise<void> {
    await this.table("taxon", "app/taxon.parquet");
    await this.table("zone_taxon", "app/zone_taxon.parquet");
    if (opts.taxonomy !== false) await this.table("taxonomy", "app/taxonomy.parquet");
    if (this.idField === "mdl_key") await this.table("model", "tables/model.parquet");
  }

  /** the wide cell tiles covering a place, as the `cell` view. */
  async cellTiles(tiles: readonly number[]): Promise<void> {
    const names: string[] = [];
    for (const t of tiles) {
      const path = `app/cell/tile=${t}/data_0.parquet`;
      const file = `${this.ver}/${path}`;
      await this.engine.load(file, this.#url(path), `${digestOf(this.boot, "cell", file)}:${t}`);
      names.push(file);
    }
    await this.#view("cell", names);
  }

  /**
   * Mount ONE batch of `cell_model` tiles as `cell_model` + `cell_model_key`.
   *
   * `cell_model` has no `boot.tables` entry either (it lives under `{ver}/serve/`, unchanged from
   * what the server already publishes), so the digest is the release + tile, which is stable and is
   * all a re-registration guard needs.
   */
  async mountCellModel(tiles: readonly number[]): Promise<void> {
    const names: string[] = [];
    for (const t of tiles) {
      const path = `serve/cell_model/tile=${t}/data_0.parquet`;
      const file = `${this.ver}/${path}`;
      await this.engine.load(file, this.#url(path), `${this.ver}:cell_model:${t}`);
      names.push(file);
    }
    await this.#view("cell_model", names);
    await this.engine.exec(
      `CREATE OR REPLACE VIEW cell_model_key AS ${cellModelKeySql(this.templates, this.idField).replace(/;\s*$/, "").trimEnd()};`,
    );
    this.#mountedCellModel = [...tiles];
  }

  /** drop a batch's buffers -- the entire point of batching (plan atlas-2 `engine/`). */
  async unmountCellModel(): Promise<void> {
    const store = this.engine.store;
    for (const t of this.#mountedCellModel) {
      await store?.drop(`${this.ver}/serve/cell_model/tile=${t}/data_0.parquet`);
    }
    this.#mountedCellModel = [];
  }

  /** the batches `speciesForCells()` should walk (<= {@link MAX_CELL_MODEL_TILES} tiles each). */
  batches(tiles: readonly number[], size = MAX_CELL_MODEL_TILES): number[][] {
    return batchTiles(tiles, size);
  }

  /**
   * One view over one or more registered files.
   *
   * `UNION ALL BY NAME`, not positional: two tiles of the same release always carry the same
   * columns today, but a by-name union is the version of this that cannot silently transpose a
   * metric column into another metric's place if that ever stops being true.
   *
   * The FROM fragments come from the store's own `ref()` (`read_parquet('name')` on MEMORY, a bare
   * identifier on OPFS in Step 4), so this module never assumes which tier is live.
   */
  async #view(name: string, files: readonly string[]): Promise<void> {
    if (!files.length) throw new Error(`no files registered for view ${name}`);
    const store = this.engine.store;
    const parts = files.map((f) => {
      const ref = store?.ref(f);
      if (!ref) throw new Error(`table "${f}" is not registered`);
      return `SELECT * FROM ${ref.from}`;
    });
    await this.engine.exec(
      `CREATE OR REPLACE VIEW ${ident(name)} AS ${parts.join(" UNION ALL BY NAME ")};`,
    );
  }
}
