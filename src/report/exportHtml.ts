// report/exportHtml.ts -- atlas-7 step 3, Export 2 ("Download HTML"): the rendered document
// serialized to ONE self-contained file (spec: inline CSS, SVG, PNG data URIs, embedded fonts).
//
// This app never loads a custom web font for `report.html` (report.css imports only
// `lib/brand/tokens.css`'s tokens, not `lib/brand/fonts.css`'s `@font-face` rules -- see report.css's
// own header) precisely so this export needs nothing "embedded": the `--font-body`/`--font-display`
// fallback chains resolve to system fonts everywhere, so there is no remote font request to inline
// in the first place. SVGs (the flowers, the permalink QR) are already inline markup in the live
// DOM; the map is a `<img>` PNG data URI by the time this runs (mapPng.ts, taken after `idle`) --
// there is no live MapLibre canvas to strip because the print/export map section never mounts one
// (see Report.svelte's header: the interactive map is index.html's job, not this one's).
//
// `assembleStandaloneHtml` is the pure part (string concatenation, unit-tested); `collectPageCss`
// walks `document.styleSheets`, which only exists in a real browser/jsdom document.
export function collectPageCss(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
    } catch {
      // a cross-origin stylesheet's `cssRules` throws (SecurityError) -- report.html loads none,
      // but this stays defensive rather than assuming that forever.
    }
  }
  return parts.join("\n");
}

export interface StandaloneHtmlInput {
  title: string;
  css: string;
  /** the document root's `innerHTML` (Report.svelte hands over `#report-root`'s own markup). */
  bodyHtml: string;
  lang?: string;
}

/** PURE: assembles the final byte string. No DOM here -- unit-tested directly. */
export function assembleStandaloneHtml(input: StandaloneHtmlInput): string {
  const lang = input.lang ?? "en";
  return (
    `<!doctype html>\n<html lang="${lang}">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
    `<title>${escapeHtml(input.title)}</title>\n` +
    `<style>${input.css}</style>\n</head>\n<body>\n${input.bodyHtml}\n</body>\n</html>\n`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DownloadStandaloneHtmlOptions {
  rootId?: string;
  /**
   * Runs on a DETACHED CLONE of `#report-root` before it is serialized -- Report.svelte uses this
   * to swap the live, interactive map container for the static print `<img>` (the download ships
   * no JavaScript at all, so a live MapLibre container would serialize as a permanently empty
   * `<div>`; see report.css's `.map-live`/`.map-print` pair).
   */
  transform?: (clone: HTMLElement) => void;
}

/** builds the standalone document from the LIVE page (`document`) and downloads it. `rootId`
 * defaults to `report-root` (`report.html`'s mount point). */
export function downloadStandaloneHtml(
  fileStem: string,
  title: string,
  opts: DownloadStandaloneHtmlOptions = {},
): void {
  const root = document.getElementById(opts.rootId ?? "report-root");
  if (!root) throw new Error(`exportHtml: #${opts.rootId ?? "report-root"} not found`);
  const clone = root.cloneNode(true) as HTMLElement;
  opts.transform?.(clone);
  const html = assembleStandaloneHtml({
    title,
    css: collectPageCss(document),
    bodyHtml: clone.outerHTML,
  });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem}.html`;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
