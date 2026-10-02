// prepublish-check.mjs -- open the Atlas with a release's STAGED bundle files served from a local
// directory, before anything is published. Read-only: requests are intercepted in the browser; nothing
// is written to the bucket or to any host.
//
//   node scripts/prepublish-check.mjs --stage <publish_stage dir> --ver v7 \
//     --url "https://marinesensitivity.org/atlas/" --q "lens=species&sp=54272&in=bl" \
//     [--map <csv: key,src_key>] [--out .tmp/prepub] [--name bl]
//
// - `--stage`: a local mirror of the bucket layout, `{stage}/{ver}/manifest.json`,
//   `{stage}/{ver}/app/{taxon,alias}/{xx}.json` (workflows `stage_publish.qmd` writes one).
// - `--map`: optional CSV (header `key,src_key`) for store objects that do not exist yet: a request for
//   `marine-atlas/{key}` is continued to `{bucket}/{src_key}` (the object a migration plan would copy
//   there). Omit it once the store is populated.
// - prints one JSON line: which staged files were served, which store keys were re-routed, the status
//   of every non-zone `.pmtiles` response, the representation switch's text and pressed option, the
//   legend text; writes a screenshot. Exit 1 when no staged file was served (the check proved nothing).
//
// - `--live`: AFTER a release is published, the same look with nothing intercepted (no `--stage`):
//   the app reads the published bundle. Exit 1 unless the representation switch is on the page and,
//   when an original range was requested, a non-zone `.pmtiles` answered 206.
//     node scripts/prepublish-check.mjs --live --ver v7 --q "lens=species&sp=54272&in=bl" --name bl
//
// why it exists (round 4, 2026-10-02): the staged v7 backfill passed every table/shard diff and still
// drew NOTHING for an original range -- the tile was fetched (206) and the feature filter matched no
// feature (`source_key`, atlas 0.10.86 + msens 0.50.0). Only a browser on the real app showed it.
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const BUCKET = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const stage = arg("stage");
const ver = arg("ver", "v7");
const base = arg("url", "https://marinesensitivity.org/atlas/");
const query = arg("q", "lens=species&sp=54272&in=bl");
const mapCsv = arg("map");
const out = arg("out", ".tmp/prepub");
const name = arg("name", "check");
const live = process.argv.includes("--live");
if (live && stage) {
  console.error("prepublish-check: --live reads the published bundle; drop --stage");
  process.exit(2);
}
if (!live && (!stage || !existsSync(`${stage}/${ver}`))) {
  console.error(`prepublish-check: --stage must hold a ${ver}/ directory (got ${stage})`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const copyMap = new Map();
if (mapCsv) {
  for (const line of readFileSync(mapCsv, "utf8").trim().split("\n").slice(1)) {
    const i = line.indexOf(",");
    copyMap.set(line.slice(0, i), line.slice(i + 1));
  }
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const staged = new Set();
const rerouted = new Set();
const tiles = new Set();

const stagedRe = new RegExp(
  `marine-atlas/${ver}/(app/(taxon|alias)/[0-9a-f]{2}\\.json|manifest\\.json)(\\?.*)?$`,
);
if (!live)
  await page.route(stagedRe, async (route) => {
    const rel = new URL(route.request().url()).pathname.split(`/marine-atlas/${ver}/`)[1];
    const file = `${stage}/${ver}/${rel}`;
    if (!existsSync(file)) return route.continue();
    staged.add(rel);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: readFileSync(file),
    });
  });
if (copyMap.size) {
  await page.route(/marine-atlas\/(native|cog\/global05)\//, async (route) => {
    const key = new URL(route.request().url()).pathname.split("/marine-atlas/")[1];
    const src = copyMap.get(key);
    if (!src) return route.continue();
    rerouted.add(key);
    await route.continue({ url: BUCKET + src });
  });
}
page.on("response", (r) => {
  const u = r.url();
  if (/\.pmtiles/.test(u) && !/\/zones\//.test(u))
    tiles.add(`${r.status()} ${u.split("/marine-atlas/")[1]}`);
});

await page.goto(`${base}?${query}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const explore = page.getByRole("button", { name: "Explore", exact: true });
if (await explore.isVisible().catch(() => false)) await explore.click();
await page.waitForTimeout(10000);

const rep = page.locator('[data-testid="representation"]');
const result = {
  ver,
  query,
  staged: [...staged],
  rerouted: [...rerouted],
  tiles: [...tiles],
  representation: (await rep.innerText().catch(() => "")).replace(/\s+/g, " ") || null,
  pressed: await rep
    .locator('button[aria-pressed="true"]')
    .innerText()
    .catch(() => null),
  legend: (
    await page
      .locator('[class*="legend"]')
      .first()
      .innerText()
      .catch(() => "")
  )
    .replace(/\s+/g, " ")
    .slice(0, 160),
  screenshot: `${out}/prepub-${ver}-${name}.png`,
};
await page.screenshot({ path: result.screenshot });
console.log(JSON.stringify(result));
await browser.close();
const drew = !result.tiles.length || result.tiles.some((t) => t.startsWith("206 "));
const liveOk = /Original/.test(result.representation ?? "") && drew;
process.exit((live ? liveOk : staged.size) ? 0 : 1);
