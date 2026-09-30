// scripts/contact-sheet.mjs -- pure tile list -> HTML for eyes-shots.mjs's SHEET=1 (R4-0).
// kept separate from eyes-shots.mjs because that script runs a browser at import time; this one is
// import-safe so vitest can assert it.
export const TILE_WIDTH = { desktop: 480, phone: 260 };
export const SHEET_MAX_WIDTH = 2400;
export const SHEET_MAX_TILES = 24;
const GAP = 12;
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** tiles per row for a viewport: as many as fit in SHEET_MAX_WIDTH. */
export function tilesPerRow(vp) {
  const w = TILE_WIDTH[vp] ?? TILE_WIDTH.desktop;
  return Math.max(1, Math.floor((SHEET_MAX_WIDTH - GAP) / (w + GAP)));
}

/** split tiles into pages of at most SHEET_MAX_TILES. */
export function paginate(tiles, size = SHEET_MAX_TILES) {
  const pages = [];
  for (let i = 0; i < tiles.length; i += size) pages.push(tiles.slice(i, i + size));
  return pages;
}

/** tile {name, src} -> a labelled grid; `-MISSED` in the name gets a red border + MISSED label. */
export function contactSheetHtml(tiles, vp = "desktop") {
  const w = TILE_WIDTH[vp] ?? TILE_WIDTH.desktop;
  const cols = tilesPerRow(vp);
  const figs = tiles.map((t) => {
    const missed = /-MISSED/.test(t.name);
    const label = t.name.replace(/-MISSED/, "");
    return (
      `<figure class="tile${missed ? " missed" : ""}" data-name="${esc(t.name)}">` +
      `<img src="${esc(t.src)}" width="${w}" alt="${esc(label)}">` +
      `<figcaption>${esc(label)}${missed ? ' <b class="flag">MISSED</b>' : ""}</figcaption></figure>`
    );
  });
  const used = Math.min(cols, Math.max(1, tiles.length));
  const width = used * (w + GAP) + GAP;
  return (
    `<!doctype html><meta charset="utf-8"><style>` +
    `body{margin:0;background:#222;font:12px/1.3 sans-serif;color:#eee}` +
    `#sheet{display:grid;grid-template-columns:repeat(${used},${w}px);gap:${GAP}px;padding:${GAP}px;width:${width - 2 * GAP}px}` +
    `figure{margin:0;border:3px solid transparent}img{display:block;width:${w}px;height:auto}` +
    `figcaption{padding:4px 0}.missed{border-color:#e00}.flag{background:#e00;color:#fff;padding:0 4px}` +
    `</style><div id="sheet" data-cols="${used}">${figs.join("")}</div>`
  );
}
