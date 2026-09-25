// Ben's ask (round-3 review, 2026-09-25 — folded in as UI-L2): "Given the different toolbar
// selections and data layer options, we should probably update the Legend to mention which layer
// is being displayed." ONE pure builder, used by the desktop legend card
// (`Legend.svelte`/`ScoresLegend.svelte`/`SpeciesLegend.svelte`), the phone legend chip's short
// form, the phone Legend modal, and the Download menu's PNG/SVG footer title (`lib/download/
// legendFormat.ts`) — so an exported figure says the same thing the screen does.
//
// Three forms (brief, verbatim):
//   - scores, raster cells:   "Overall score" title, "Raster cells · {zoom region} · {release}"
//     subtitle (a component layer instead names the category, e.g. "Bird: extinction risk ·
//     rescaled 0–100 by ecoregion" when the manifest says it is rescaled).
//   - scores, Program areas:  "{metric label} · Program Areas · {release}".
//   - species:                "{common name} (*{binomial}*)" title, "{input label} ·
//     {representation} · {value semantics}" subtitle.
export interface LegendTitleContext {
  lens: "scores" | "species";
  /** scores only: which branch is on screen. */
  branch?: "raster" | "zone";
  /** the metric's own display label (already resolved by the caller, e.g. `metricKeyLabel()`). */
  metricLabel?: string;
  /** the zoom-to-region select's current label (`"All US waters"` when nothing is chosen — the
   * SAME no-selection label `lib/format.ts#formatSubject` uses, UI-5). Omitted entirely when the
   * caller has not wired it through yet — the subtitle just carries fewer clauses, never a blank
   * one. */
  zoomRegionLabel?: string | null;
  /** the release id ("v7"), shown last in every scores subtitle. */
  release?: string | null;
  /** true when this metric is a component whose values are rescaled 0-100 within each ecoregion
   * (the manifest's own `component`/"Rescaled by ecoregion" wording, `boot.ts`) — folds a second
   * clause onto the subtitle rather than a plain unit label. */
  rescaledByEcoregion?: boolean;
  /** species only. */
  commonName?: string;
  scientificName?: string;
  /** the active input pill's own label (e.g. "FWS Range", "Merged model", "AquaMaps"). */
  inputLabel?: string;
  /** "presence", "habitat suitability 1–100", "as delivered", … */
  valueSemantics?: string;
  /** "presence" / "habitat suitability" / … — `layerBar.ts`'s own representation word, distinct
   * from `valueSemantics` (the brief's forms combine them into one clause per example, so a caller
   * with only one of the two may pass either and leave the other empty). */
  representation?: string;
}

export interface LegendTitle {
  title: string;
  /** `null` when there is nothing more to say than the title (an "unavailable"/"empty" legend, or
   * a caller that supplied no context beyond the bare metric label). */
  subtitle: string | null;
}

function joinClauses(clauses: readonly (string | null | undefined)[]): string | null {
  const parts = clauses.filter((c): c is string => Boolean(c && c.trim()));
  return parts.length ? parts.join(" · ") : null;
}

/** the scores lens' two branches. */
function scoresLegendTitle(ctx: LegendTitleContext): LegendTitle {
  const title = ctx.metricLabel ?? "Score";
  if (ctx.branch === "zone") {
    return { title, subtitle: joinClauses(["Program Areas", ctx.release]) };
  }
  // raster (default branch when unspecified — every scores legend that is not the zone
  // choropleth is a raster-cells one).
  const unit = ctx.rescaledByEcoregion ? "Rescaled 0-100 by ecoregion" : "Raster cells";
  return { title, subtitle: joinClauses([unit, ctx.zoomRegionLabel, ctx.release]) };
}

/** the species lens: common name + italic-flagged binomial as the title (the caller renders the
 * `.sci`/italics styling — this module only marks WHERE the scientific name is, via the return
 * shape below, never markup). */
function speciesLegendTitle(ctx: LegendTitleContext): LegendTitle {
  const common = ctx.commonName?.trim();
  const sci = ctx.scientificName?.trim();
  const title = common && sci ? `${common} (${sci})` : (common ?? sci ?? "Species");
  return { title, subtitle: joinClauses([ctx.inputLabel, ctx.representation, ctx.valueSemantics]) };
}

/**
 * The legend's title + subtitle for `ctx` — see the module header for the three forms. Never
 * throws on a partial context: every field not supplied just drops its clause from the subtitle
 * (a caller mid-wiring, or a release that publishes less metadata than another, still gets a
 * correct — if shorter — legend rather than an error).
 */
export function legendTitle(ctx: LegendTitleContext): LegendTitle {
  return ctx.lens === "species" ? speciesLegendTitle(ctx) : scoresLegendTitle(ctx);
}

/** the phone legend chip's SHORT form — the title alone (module header: "the chip's short form is
 * the title only"). */
export function legendChipTitle(ctx: LegendTitleContext): string {
  return legendTitle(ctx).title;
}
