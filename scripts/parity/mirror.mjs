// scripts/parity/mirror.mjs -- a local stand-in for the release bucket.
//
// The `app/` objects are NOT on S3 yet: complete dry-run bundles exist locally (atlas-1's
// `_output/app_bundle/{v9,v7}/`), v9's `serve/cell_model/` tiles are on the public bucket AND under
// ~/_big, and v7's exist only under ~/_big (757 MB, never pushed). This assembles all of that into
// ONE directory laid out exactly like the bucket --
//
//   {ver}/app/{boot.json,taxon.parquet,zone_taxon.parquet,taxonomy.parquet,cell/tile=*/data_0.parquet}
//   {ver}/serve/cell_model/tile=*/data_0.parquet
//   {ver}/tables/model.parquet
//
// -- so `run.mjs --base <mirror>` and `run.mjs --base https://s3.../marine-atlas/` differ in one
// string and nothing else. Symlinks, never copies: nothing is duplicated and nothing is written
// into either source tree, both of which are read-only for this work.
//
// `{ver}/tables/model.parquet` is the one object that must be fetched (1.1 MB), because `mdl_id` ->
// `mdl_key` is not published under `app/` at all -- see `src/lib/analysis/sources.ts`'s note.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = process.env.HOME ?? "";
export const BUCKET = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";

function firstDir(...candidates) {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

function bundleDir(ver) {
  return firstDir(
    process.env.BUNDLE_DIR && path.join(process.env.BUNDLE_DIR, ver),
    path.join(ROOT, ".claude/worktrees/contract/workflows/_output/app_bundle", ver),
    path.join(ROOT, "../contract/workflows/_output/app_bundle", ver),
    path.join(ROOT, "../../../.claude/worktrees/contract/workflows/_output/app_bundle", ver),
  );
}

function cellModelDir(ver) {
  return firstDir(
    process.env.CELL_MODEL_DIR && path.join(process.env.CELL_MODEL_DIR, ver, "cell_model"),
    path.join(HOME, "_big/msens/derived", ver, "cell_model"),
    path.join(HOME, "_big/msens/derived", ver, "marine-atlas/serve/cell_model"),
  );
}

function link(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
  fs.symlinkSync(from, to);
}

/**
 * Build (idempotently) the mirror and return its path.
 *
 * `PARITY_MIRROR` overrides the location; the default lives beside the repo in `.parity-mirror/`,
 * which `.gitignore` covers -- nothing here is ever committed.
 */
export function ensureMirror(vers) {
  const root = process.env.PARITY_MIRROR ?? path.join(ROOT, ".parity-mirror");
  for (const ver of vers) {
    const bundle = bundleDir(ver);
    if (!bundle) throw new Error(`no app bundle for ${ver} (set BUNDLE_DIR)`);
    link(bundle, path.join(root, ver, "app"));

    const cm = cellModelDir(ver);
    if (cm) link(cm, path.join(root, ver, "serve/cell_model"));
    else console.warn(`  (no local serve/cell_model for ${ver}; species-for-cell will fail)`);

    const model = path.join(root, ver, "tables/model.parquet");
    if (!fs.existsSync(model)) {
      fs.mkdirSync(path.dirname(model), { recursive: true });
      const url = `${BUCKET}${ver}/tables/model.parquet`;
      console.log(`  fetching ${url}`);
      execFileSync("curl", ["-fsSL", "-o", model, url], { stdio: ["ignore", "ignore", "inherit"] });
    }
  }
  return root;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const vers = process.argv.slice(2);
  console.log(ensureMirror(vers.length ? vers : ["v9", "v7"]));
}
