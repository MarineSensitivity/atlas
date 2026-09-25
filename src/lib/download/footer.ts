// R3-W2 Deliverable 2: the map-figure footer's text content, pure (CLAUDE.md) -- `mapPng.ts`/
// `mapSvg.ts` draw these lines onto a canvas/SVG; this module only decides what the lines SAY.
// Shape borrowed from CalCOFI explore's `export.ts#stampLines` (the common brief's own reference),
// not its code: this app has its own release/version vocabulary (`ver`, not "release ###").

export interface FooterInfo {
  /** the layer/species title (e.g. a metric's `label`, or a species' scientific name). */
  title: string;
  /** the value's unit, e.g. "score", "1-100" -- omitted when the surface has none worth stating. */
  unit?: string;
  ver: string;
  /** the app's own share URL, e.g. `location.href` -- ALREADY stripped of its origin by the
   * caller (`shareUrlWithoutOrigin`, below); this module never reads `location` itself (the same
   * "inject, don't read the live page" rule `src/lib/analytics` follows, so this stays Node-testable). */
  url: string;
}

/** strips `https://host` (or `http://host`) off the front of a URL, leaving the path/query/hash --
 * the brief's own "the app's own share URL minus the origin". A URL with no recognizable
 * `scheme://host` prefix (already relative, or malformed) is returned unchanged rather than
 * thrown on -- a footer must never be the reason a download fails. */
export function shareUrlWithoutOrigin(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/i, "") || "/";
}

/** two lines: the title (+ unit) on top, "MarineSensitivity Atlas · {ver} · {url}" below --
 * CalCOFI's own 3-line stamp minus the per-panel "datasets" line (this app's release already
 * names its own datasets in `boot.json`/the manifest, not per-figure). `ver` is already the
 * `^v[0-9]+[a-z]?$`-shaped label the rest of the app uses (`src/lib/release/version.ts`) -- never
 * prefixed with a second "v" here. */
export function footerLines(info: FooterInfo): [string, string] {
  const first = info.unit ? `${info.title} · ${info.unit}` : info.title;
  const second = `MarineSensitivity Atlas · ${info.ver} · ${shareUrlWithoutOrigin(info.url)}`;
  return [first, second];
}
