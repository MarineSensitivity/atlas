// geo/upload/engineRuntime.ts — the ONE real `GeoPackageRuntime` this app builds (Q2, 0.10.52).
//
// `UploadPanel.svelte` used to hardcode `runtime: null` unconditionally, so `parseGeoPackage`
// (`parsers/geopackage.ts`) threw `geopackageNoRuntime` for EVERY `.gpkg`, since 0.10.47 — there
// was no state that hardcoding could ever finish waiting for. This module is the fix: it adapts
// the SAME DuckDB-WASM `Engine` the scores/ResultsPanel already boot (`places/dataEngine.ts`) into
// the structural `GeoPackageRuntime` interface `parseGeoPackage` asks for, so a `.gpkg` is read
// through the app's one existing connection rather than a second engine.
//
// TWO trade-offs this module embodies, stated once:
//  1. `Engine` is referenced only STRUCTURALLY (the `EngineLike` interface below), never imported
//     by type or by value — the same discipline `places/dataEngine.ts`'s own header states for
//     `@duckdb/duckdb-wasm`. This file is reached from `UploadPanel.svelte`'s static import graph
//     (it is tiny and carries no third-party dependency of its own), so it must not itself pull in
//     any reference to the real `Engine` class/bundle loader.
//  2. `getEngine` is called — and therefore boots DuckDB, if it has not already, and lets
//     `parseGeoPackage` fetch the (unmirrored, 23 MB, third-party) `spatial` extension — only on
//     the FIRST `registerFile`/`query`/`dropFile` call. `parseGeoPackage`'s own ordering already
//     asks for consent BEFORE touching `runtime` at all, so this adapter never boots anything a
//     declined or not-yet-attempted `.gpkg` drop didn't ask for.
import type { GeoPackageRuntime } from "./parsers/geopackage";

/** the minimal slice of `lib/engine/engine.ts`'s `Engine` this adapter needs — structural, so no
 * static reference to the real class (see this module's header, point 1). A real `Engine` already
 * satisfies it via its own `registerFile`/`dropFile`/`exec` methods. */
export interface EngineLike {
  registerFile(name: string, bytes: Uint8Array): Promise<void>;
  dropFile(name: string): Promise<void>;
  exec<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

/**
 * Build a `GeoPackageRuntime` over a LAZILY resolved engine. `getEngine` is whatever the caller
 * already has for reaching the one booted `Engine` — `places/dataEngine.ts`'s own cache means
 * calling it more than once here costs nothing extra.
 */
export function geoPackageRuntime(getEngine: () => Promise<EngineLike>): GeoPackageRuntime {
  return {
    async registerFile(name, bytes) {
      const engine = await getEngine();
      await engine.registerFile(name, bytes);
    },
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      const engine = await getEngine();
      return engine.exec<T>(sql);
    },
    async dropFile(name) {
      const engine = await getEngine();
      await engine.dropFile(name);
    },
  };
}
