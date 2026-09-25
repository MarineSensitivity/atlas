#!/usr/bin/env node
// R3-D1: install the LINUX gallery screenshot baselines from a CI run.
//
// `e2e/gallery.spec.ts`'s baselines carry a PLATFORM suffix (`-chromium-linux.png`), so they can
// only be produced by a linux Playwright run -- exactly like the root three-engine suite's own
// linux baselines (CLAUDE.md's "0.10.14" note). CI's `e2e-gallery` job
// (`.github/workflows/pages.yml`) uploads its `test-results/` directory -- every `*-actual.png`
// Playwright wrote for a screenshot that did not match its (possibly still-darwin, possibly
// missing) baseline -- as the `gallery-test-results` artifact, but ONLY when the job fails
// (`if: failure()`). This script downloads that artifact for a given run id, keeps each
// screenshot's FINAL (highest-retry) attempt, and copies it over the matching file in
// `e2e/gallery.spec.ts-snapshots/`, printing what it replaced or added so a reviewer can
// `git diff --stat` the result before committing it -- committing an unreviewed linux screenshot
// as truth would defeat the point of a visual baseline.
//
// A CI actual (`<stem>-actual.png`) carries NO platform suffix itself -- `gallery-baselines-from-
// ci-core.mjs#baselineNameFor()` is the one place that adds `-chromium-linux` to land on the
// suffixed baseline name the spec actually reads; see that function's own header for why (a
// suffix-less mapping shipped once, commit 6aa87aa fixed it by hand after the fact).
//
// Usage: node scripts/gallery-baselines-from-ci.mjs <run-id>
//   (a "run id" is the numeric id `gh run list` / the Actions URL shows, e.g. 36114961882)
// Needs `gh` authenticated for this repo (`gh auth status`).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineNameFor, finalAttemptActuals } from "./gallery-baselines-from-ci-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOTS_DIR = join(ROOT, "e2e", "gallery.spec.ts-snapshots");
const ARTIFACT_NAME = "gallery-test-results";

const runId = process.argv[2];
if (!runId) {
  process.stderr.write("usage: node scripts/gallery-baselines-from-ci.mjs <run-id>\n");
  process.exit(1);
}

function walkActuals(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkActuals(full));
    else if (entry.name.endsWith("-actual.png")) out.push(full);
  }
  return out;
}

const scratch = mkdtempSync(join(tmpdir(), "gallery-baselines-"));
try {
  process.stdout.write(
    `gallery-baselines-from-ci: downloading "${ARTIFACT_NAME}" from run ${runId}...\n`,
  );
  try {
    execFileSync("gh", ["run", "download", runId, "-n", ARTIFACT_NAME, "-D", scratch], {
      stdio: "inherit",
    });
  } catch (e) {
    process.stderr.write(
      `gallery-baselines-from-ci: "gh run download" failed -- is the run id right, is "gh" ` +
        `authenticated (gh auth status), and did that run actually fail (the artifact is only ` +
        `uploaded on failure)? ${String(e.message ?? e)}\n`,
    );
    process.exit(1);
  }

  const allActuals = walkActuals(scratch);
  if (allActuals.length === 0) {
    process.stdout.write(
      "gallery-baselines-from-ci: no *-actual.png files in the artifact -- nothing to install " +
        "(a green run uploads nothing at all; see the job's own conditional).\n",
    );
    process.exit(0);
  }

  const relPaths = allActuals.map((p) => relative(scratch, p));
  const finalPaths = new Set(finalAttemptActuals(relPaths));

  let replaced = 0;
  let added = 0;
  let skippedStale = 0;
  let skippedUnrecognized = 0;
  for (const rel of relPaths) {
    if (!finalPaths.has(rel)) {
      skippedStale++;
      continue;
    }
    const fileName = rel.split("/").pop();
    const baseline = baselineNameFor(fileName);
    if (!baseline) {
      process.stdout.write(`  ? skipping unrecognized file: ${rel}\n`);
      skippedUnrecognized++;
      continue;
    }
    const target = join(SNAPSHOTS_DIR, baseline);
    const isNew = !existsSync(target);
    copyFileSync(join(scratch, rel), target);
    if (isNew) {
      added++;
      process.stdout.write(`  + ${baseline} (new)\n`);
    } else {
      replaced++;
      process.stdout.write(`  ~ ${baseline}\n`);
    }
  }
  process.stdout.write(
    `gallery-baselines-from-ci: replaced ${replaced}, added ${added} baseline(s); skipped ` +
      `${skippedStale} stale earlier-attempt file(s)` +
      (skippedUnrecognized ? `, ${skippedUnrecognized} unrecognized file(s)` : "") +
      ` -- review with \`git diff --stat -- ${relative(ROOT, SNAPSHOTS_DIR)}\` before committing.\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
