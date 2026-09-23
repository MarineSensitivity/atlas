// release/cite.ts -- THE one dataset-citation path (atlas-7 §7 / the phase's review checklist:
// "the report reads the same ramps.ts, categories.ts, cite.ts and SQL files as the app: no second
// copy").
//
// NEW IN atlas-7, AND DELIBERATELY NOT UNDER `src/lib/report/`. Before this file there was no
// shared citation path at all: `src/lens/species/data/layerBar.ts#datasetIndex()` reads
// `boot.datasets` for the layer pills but keeps only `name_display`/`value_info`/`sort_order` and
// never looks at `citation`/`link_info`. It lives in `release/` because a citation is RELEASE
// METADATA (it comes out of `boot.json`, like every other reader here) and because `src/lib/report/`
// is reachable only from `report.html` -- a lens importing a module from there would drag the whole
// report into `index.html`'s static graph and blow the 450 KB budget. Anything that wants to print
// "where did this number come from" imports THIS.
//
// Defensive, like every other boot reader (`release/boot.ts`'s rule): a malformed row is skipped,
// never thrown on -- a missing citation degrades to "no citation published", which is legible.

export interface Citation {
  /** `dataset.ds_key`, the join key the rest of the app names a dataset by. */
  dsKey: string;
  /** `dataset.name_display`, else the key itself. */
  label: string;
  /** `dataset.citation` -- the full reference string, verbatim, or `null` when unpublished. */
  citation: string | null;
  /** `dataset.link_info` -- the dataset's own page, or `null`. */
  href: string | null;
}

interface RawDataset {
  ds_key?: unknown;
  name_display?: unknown;
  citation?: unknown;
  link_info?: unknown;
  sort_order?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * `boot.datasets` -> the citation list, in `dataset.sort_order` (a `null` order sorts LAST -- the
 * same rule `layerBar.ts#compareDs` uses for the pills), ties broken by `ds_key` so the order is
 * total and a report regenerated from the same release is byte-identical.
 *
 * `[]` for a release that publishes no `datasets` block (v1-era bundles), never a throw.
 */
export function citations(boot: unknown): Citation[] {
  const rows = (boot as { datasets?: unknown } | null | undefined)?.datasets;
  if (!Array.isArray(rows)) return [];
  const out: { c: Citation; order: number | null }[] = [];
  for (const raw of rows as RawDataset[]) {
    if (!raw || typeof raw !== "object") continue;
    const dsKey = str(raw.ds_key);
    if (!dsKey) continue;
    out.push({
      c: {
        dsKey,
        label: str(raw.name_display) ?? dsKey,
        citation: str(raw.citation),
        href: str(raw.link_info),
      },
      order:
        typeof raw.sort_order === "number" && Number.isFinite(raw.sort_order)
          ? raw.sort_order
          : null,
    });
  }
  out.sort((a, b) => {
    if (a.order !== b.order) {
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order;
    }
    return a.c.dsKey < b.c.dsKey ? -1 : a.c.dsKey > b.c.dsKey ? 1 : 0;
  });
  return out.map((r) => r.c);
}

/** only the datasets that actually published a citation -- what a "Sources" section lists. */
export function citedDatasets(boot: unknown): Citation[] {
  return citations(boot).filter((c) => c.citation !== null);
}
