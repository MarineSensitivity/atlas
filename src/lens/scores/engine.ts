// atlas-4 step 2 — the lazy DuckDB-WASM boot, reached ONLY through dynamic `import()` (CLAUDE.md's
// budget rules: "the whole analysis layer is reached only through a dynamic import() from a
// lens, like duckdb itself" — `analysis/templates.ts`'s own header). This module is the ONE place
// the scores lens crosses into the engine; every caller (a cell click, opening the species table)
// goes through `getAnalysisSources()`, which is memoised per release so a second click reuses the
// same booted engine and registered tables instead of re-fetching them.
import type { Engine as EngineType } from "../../lib/engine/engine";
import type { AnalysisSources as AnalysisSourcesType } from "../../lib/analysis/sources";

interface Modules {
  Engine: typeof EngineType;
  AnalysisSources: typeof AnalysisSourcesType;
  templates: AnalysisSourcesType["templates"];
  dataUrl: (ver: string, path: string) => string;
}

let modulesPromise: Promise<Modules> | null = null;

function loadModules(): Promise<Modules> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import("../../lib/engine/engine"),
      import("../../lib/analysis/sources"),
      import("../../lib/analysis/templates"),
      import("../../lib/release/dataBase"),
    ]).then(([engineMod, sourcesMod, templatesMod, dataBaseMod]) => ({
      Engine: engineMod.Engine,
      AnalysisSources: sourcesMod.AnalysisSources,
      templates: templatesMod.TEMPLATES,
      // public-host data origin only (this phase does not thread a preview `session` through the
      // shell into the engine yet — see the atlas-4 report's "could not satisfy" list).
      dataUrl: (ver: string, path: string) => dataBaseMod.dataUrl(ver, path, null),
    }));
  }
  return modulesPromise;
}

let sources: AnalysisSourcesType | null = null;
let sourcesVer: string | null = null;

/**
 * The current release's `AnalysisSources`, booting the engine on first call and reusing it for
 * every later one AS LONG AS `ver` has not changed (a version switch tears down and rebuilds —
 * the old engine's registered tables belong to a different release's grid/schema).
 */
export async function getAnalysisSources(
  ver: string,
  boot: Record<string, unknown>,
): Promise<AnalysisSourcesType> {
  if (sources && sourcesVer === ver) return sources;
  const { Engine, AnalysisSources, templates, dataUrl } = await loadModules();
  if (sources && sourcesVer !== ver) await sources.engine.dispose().catch(() => {});
  const engine = new Engine();
  sources = new AnalysisSources(engine, { url: (path) => dataUrl(ver, path), boot, templates });
  sourcesVer = ver;
  return sources;
}
