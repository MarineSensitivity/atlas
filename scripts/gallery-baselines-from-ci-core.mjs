// R3-D1: the pure part of scripts/gallery-baselines-from-ci.mjs -- kept separate from the
// gh/filesystem side effects so it has a plain vitest test (tests/scripts/galleryBaselinesFromCi.test.ts),
// the same split scripts/check-relative-assets.mjs and its -core.mjs sibling already use.
import { basename } from "node:path";

/**
 * Playwright's own CI retry convention: a test's output directory under `test-results/` gets a
 * `-retryN` suffix for its Nth retry (no suffix = attempt 0, the first run). This repo's gallery
 * job (`playwright.gallery.config.ts`: `retries: process.env.CI ? 2 : 0`) can leave up to three
 * attempts' worth of `*-actual.png` in the uploaded artifact when a screenshot stays mismatched
 * across retries -- `0` for a directory with no `-retryN` suffix at all.
 */
export function retryOf(dirName) {
  const m = /-retry(\d+)$/.exec(dirName);
  return m ? Number(m[1]) : 0;
}

function parentDirName(relPath) {
  const i = relPath.lastIndexOf("/");
  return i === -1 ? "" : basename(relPath.slice(0, i));
}

/**
 * `relPaths` are POSIX-relative paths (relative to the downloaded artifact root) to every
 * `*-actual.png` file it contains. A screenshot name that appears under more than one retry
 * directory keeps only its HIGHEST-retry (final, most-recent) copy -- an earlier attempt's actual
 * is stale the moment a later one exists, and copying it over a baseline would install what CI
 * rejected on its first try instead of what it rejected LAST. Returns the subset of `relPaths` to
 * actually use, order preserved.
 */
export function finalAttemptActuals(relPaths) {
  const bestByName = new Map(); // basename(file) -> { path, retry }
  for (const p of relPaths) {
    const name = basename(p);
    const retry = retryOf(parentDirName(p));
    const prev = bestByName.get(name);
    if (!prev || retry > prev.retry) bestByName.set(name, { path: p, retry });
  }
  const keep = new Set([...bestByName.values()].map((v) => v.path));
  return relPaths.filter((p) => keep.has(p));
}

/**
 * `<stem>-actual.png` -> `<stem>.png` -- the baseline filename `toHaveScreenshot` resolves to
 * (its own `-{project}-{platform}` suffix, e.g. `-chromium-linux`, is already baked into the name
 * a spec passes it, so this is literally just dropping the `-actual` Playwright itself inserts
 * before the extension when it writes a mismatch's artifacts). `null` for anything that is not a
 * `*-actual.png` filename -- defensive: an artifact should never contain one, but this is the one
 * place a stray file would otherwise silently overwrite the wrong baseline.
 */
export function baselineNameFor(actualFileName) {
  const m = /^(.*)-actual\.png$/.exec(actualFileName);
  return m ? `${m[1]}.png` : null;
}
