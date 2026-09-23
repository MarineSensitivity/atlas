#!/usr/bin/env node
// atlas-8 step 1: `npm run test:faults` -- the SOURCE-EDIT seeded faults, proven against a real
// throwaway checkout rather than a parallel copy inside a test file.
//
// Most of this repo's seeded faults (tests/GATES.md tallies them) already prove themselves on
// every ordinary `npm test`: a wrong implementation kept beside the right one in the SAME test
// file (tests/geo/rmod.test.ts's `noGuard`/`naive`), or a permanent fixture tree a scanner is
// pointed at (tests/fixtures/map/fitbounds-fault/). Neither needs this script.
//
// This script is for the other kind: a fault that has to be applied to the REAL exported
// function `src/` ships, not a copy, because the property under test ("the ratio gate catches an
// O(n^2) rewrite of cellsInPolygon itself", "the eviction order gate catches the literal order
// the plan's wording describes") is about that exact file. Applying it to the working tree even
// briefly would be a lie the moment two things happen at once in this shared repo, so each fault
// runs in its own `git worktree add --detach` copy under $TMPDIR, patched, tested, and discarded
// -- the working tree here never changes.
//
// Manifest: FAULTS below. Each entry names a small unified diff under tests/faults/ (generated
// once with `git diff` against a real edit, then the edit reverted -- see the patch files' own
// header comments) and the vitest invocation that must go from GREEN (unpatched HEAD) to RED
// (patched). A fault whose gate stays green with the patch applied fails this script -- "a check
// that cannot fail is not a check" (CLAUDE.md).
//
// Usage: npm run test:faults  (needs $TMPDIR exported, and a clean `git status` for HEAD to be
// meaningful -- it worktrees off HEAD, not the working tree, on purpose: see each patch's header).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FAULTS = [
  {
    id: "coverage-quadratic-scan",
    patch: "tests/faults/coverage-quadratic-scan.patch",
    describe: "an O(n^2) all-pairs edge scan planted in cellsInPolygon's accumulate()",
    gate: ["npx", "vitest", "run", "tests/geo/coverage.test.ts", "-t", "WIDENED spread"],
  },
  {
    id: "rmod-guard-drop",
    patch: "tests/faults/rmod-guard-drop.patch",
    describe:
      "rmod()'s second (guard) pass dropped -- a tiny negative operand full-turns instead of 0",
    gate: ["npx", "vitest", "run", "tests/geo/rmod.test.ts"],
  },
  {
    id: "opfs-eviction-order",
    patch: "tests/faults/opfs-eviction-order.patch",
    describe:
      "planEviction() restored to the plan's literal 'tiles first' order (overruled by ruling 5)",
    gate: ["npx", "vitest", "run", "tests/engine/opfsPolicy.test.ts"],
  },
  {
    id: "feedback-location-href",
    patch: "tests/faults/feedback-location-href.patch",
    describe:
      "pageUrlFromLocation() ignores its argument and reads the live location.href instead " +
      "(atlas-8 Deliverable 4: leaks the hash into the 'Report a problem' link). This entry drives " +
      "the mechanical (vitest) leg; `e2e/feedback.spec.ts` goes red under the same patch too " +
      "(verified by hand -- see docs/feedback.md). It could now be a Playwright entry like the two " +
      "below, which landed after it; the vitest leg is kept because it is a second or two rather " +
      "than a minute, and the property under test is a pure function.",
    gate: ["npx", "vitest", "run", "tests/feedback/noHash.test.ts"],
  },
  // --- atlas-8 step 3: the two accessibility faults the plan's pyramid row names ------------------
  // These are the first PLAYWRIGHT gates in this manifest. They need a real browser against a real
  // build of the PATCHED tree, so each runs on its own `PW_PORT` (playwright.config.ts honours it
  // and, when it is set, never reuses a server it did not start -- otherwise a `vite preview`
  // already answering 4331 from the UNPATCHED checkout would serve the wrong bytes and the fault
  // would "pass"). One `npm run build` per fault, ~1 minute each.
  {
    id: "hexbutton-unnamed",
    patch: "tests/faults/hexbutton-unnamed.patch",
    describe:
      "the tool rail's HexButton loses its aria-label -- an icon-only button with no accessible name",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/matrix.a11y.spec.ts",
      "-g",
      "shell \\(default\\) @ desktop",
      "--workers=1",
    ],
    env: { PW_PORT: "4391" },
  },
  {
    id: "modal-focus-restore",
    patch: "tests/faults/modal-focus-restore.patch",
    describe:
      "a modal opened by setting the `open` attribute instead of showModal() -- closing it restores focus to nothing",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/keyboard-walk.spec.ts",
      "-g",
      "returns focus to the version chip",
      "--workers=1",
    ],
    env: { PW_PORT: "4392" },
  },
  // atlas-8 step 3's fix round, fix list #1 (docs/accessibility-fixes.md): Modal.svelte's Esc
  // handler used to be attached via a template `onkeydown` -- Svelte 5 DELEGATES that to the app
  // root, which only runs once the native keydown has already finished bubbling through every
  // REAL (imperatively-attached) ancestor listener, including an enclosing Panel's own
  // Esc-collapses-it handler. This patch reintroduces exactly that (moves the listener back onto
  // the template's `onkeydown`, off the `onMount` `addEventListener` the fix uses instead) and
  // must turn the keyboard walk's own A11Y-1 regression test red: Esc in the coordinate dialog
  // collapses the enclosing Places panel instead of returning focus to the opener.
  {
    id: "modal-esc-delegated",
    patch: "tests/faults/modal-esc-delegated.patch",
    describe:
      "Modal's Esc handler moved back to a delegated template onkeydown -- Esc in a panel-hosted " +
      "dialog collapses the panel underneath it again (fix list #1)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/keyboard-walk.spec.ts",
      "-g",
      "A11Y-1: Esc in the coordinate dialog",
      "--workers=1",
    ],
    env: { PW_PORT: "4394" },
  },
  // the `verify` CI job's own fault (atlas-8 step 3, the A11Y-0 post-mortem). `scripts/verify.mjs`
  // imported `routeBasemapTiles` after the basemap round deleted that export; a missing NAMED
  // import from a `.ts` module resolved through this repo's bundler hook is `undefined`, not a
  // load error, so every scores state threw at its first call instead of at load -- and with
  // verify.mjs in no CI job, nothing said so for a day. This patch reintroduces exactly that
  // import and must turn `node scripts/verify.mjs` red.
  //
  // `--limit=2 --engines=chromium` is six runs (2 states x 3 viewports): enough for every one of
  // them to hit `gotoScores()` and throw, and ~40 s including the patched tree's own build, rather
  // than the 8.5 min the full chromium matrix costs. `VERIFY_BASE_URL` moves it off 4331 so it
  // starts its OWN `vite preview` instead of reusing whatever is already there (verify.mjs reuses
  // a server it finds, by design).
  {
    id: "verify-missing-export",
    patch: "tests/faults/verify-missing-export.patch",
    describe:
      "scripts/verify.mjs imports a name e2e/map-hermetic.ts no longer exports -- every scores " +
      "state throws before its first assertion (the real A11Y-0 defect, replayed)",
    gate: ["node", "scripts/verify.mjs", "--engines=chromium", "--limit=2"],
    env: { VERIFY_BASE_URL: "http://localhost:4393" },
  },
  // G-25 (docs/parity.html, atlas-8): `Sel.out` used to round-trip in the URL with nothing
  // reading it. This patch reintroduces exactly that -- `zoneUnitsWithOutline()` accepts `out`
  // but no longer consults it -- and must turn tests/map/style.test.ts's own G-25 cases red.
  // 0.10.20: the basemap that silently never painted. `composeStyle()` reads the resolved CARTO
  // style SYNCHRONOUSLY; before this round nothing told the app when that style had landed, so a
  // style.json arriving after the last reactive recompose was never read again -- the map showed
  // the data over the flat `--surface-map` colour, forever. This patch reinstates exactly that
  // (drops `basemapStyle` from Shell.svelte's own composeStyle input, back onto the non-reactive
  // cache read) and must turn the new slow-style.json gate red. Chromium only: the defect is
  // reactive-wiring, not engine timing -- it reproduces on every engine, and one is enough to
  // prove the gate can fail.
  {
    id: "basemap-not-reactive",
    patch: "tests/faults/basemap-not-reactive.patch",
    describe:
      "Shell.svelte stops passing the resolved CARTO style into composeStyle -- a slow " +
      "style.json means the basemap NEVER paints (0.10.20's real defect, replayed)",
    gate: [
      "npx",
      "playwright",
      "test",
      "--project=chromium",
      "e2e/scores.firstpaint.spec.ts",
      "-g",
      "paints OVER the basemap even when style.json answers late",
      "--workers=1",
    ],
    env: { PW_PORT: "4395" },
  },
  {
    id: "out-outline-ignored",
    patch: "tests/faults/out-outline-ignored.patch",
    describe:
      "zoneUnitsWithOutline() stops reading `out` -- G-25's exact regression (out=none no " +
      "longer hides the zone outline), replayed against the real function",
    gate: ["npx", "vitest", "run", "tests/map/style.test.ts", "-t", "G-25"],
  },
];

function run(cmd, args, cwd, env) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    // a Playwright gate's own `webServer` build+preview can take a minute; the default 1 MB stdout
    // cap is also far too small for its output, and an exceeded cap kills the child (status null),
    // which would read as "went red" for the wrong reason.
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
}

function runOne(fault) {
  const patchPath = join(ROOT, fault.patch);
  if (!existsSync(patchPath)) {
    return { ok: false, fault, reason: `missing patch file ${fault.patch}` };
  }

  const tmpBase = process.env.TMPDIR ?? tmpdir();
  const worktreeDir = mkdtempSync(join(tmpBase, `test-faults-${fault.id}-`));
  // mkdtempSync already created worktreeDir as an empty directory; `git worktree add` refuses a
  // non-empty target but is fine with an EMPTY one that already exists, so remove it first and
  // let git create it fresh at the same path.
  rmSync(worktreeDir, { recursive: true, force: true });

  try {
    const add = run("git", ["worktree", "add", "--detach", "--quiet", worktreeDir, "HEAD"], ROOT);
    if (add.status !== 0) {
      return { ok: false, fault, reason: `git worktree add failed: ${add.stderr || add.stdout}` };
    }

    // node_modules is not tracked by git, so the fresh worktree has none; symlinking the one this
    // checkout already has avoids an `npm ci` per fault (this script may run several times a day).
    symlinkSync(join(ROOT, "node_modules"), join(worktreeDir, "node_modules"));

    const apply = run("git", ["apply", patchPath], worktreeDir);
    if (apply.status !== 0) {
      return {
        ok: false,
        fault,
        reason: `git apply failed (patch does not apply to HEAD -- rebuild it): ${apply.stderr || apply.stdout}`,
      };
    }

    const gate = run(fault.gate[0], fault.gate.slice(1), worktreeDir, fault.env);
    // status null = killed (timeout/signal), which is NOT the same thing as "the gate failed" --
    // report it as a fault that could not be judged rather than silently counting it as red.
    if (gate.status === null) {
      return {
        ok: false,
        fault,
        reason: `the gate was killed before it could report (${gate.error?.message ?? "signal"})`,
        output: (gate.stdout ?? "") + (gate.stderr ?? ""),
      };
    }
    const wentRed = gate.status !== 0;
    return {
      ok: wentRed,
      fault,
      reason: wentRed
        ? undefined
        : `the gate stayed GREEN with the fault applied -- it cannot fail, so it is not a check`,
      output: gate.stdout + gate.stderr,
    };
  } finally {
    // --force: the worktree holds an applied-but-uncommitted patch, which a plain `remove` refuses.
    run("git", ["worktree", "remove", "--force", worktreeDir], ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

function main() {
  if (!process.env.TMPDIR) {
    process.stderr.write(
      "test-faults: TMPDIR is not set -- export it first (see CLAUDE.md/the dispatch instructions); " +
        "refusing to fall back to the system /tmp for a throwaway git worktree.\n",
    );
    process.exit(1);
  }

  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  process.stdout.write(`test-faults: ${FAULTS.length} fault(s), worktreed off HEAD (${head})\n\n`);

  const rows = [];
  let failed = false;
  for (const fault of FAULTS) {
    const result = runOne(fault);
    rows.push(result);
    if (result.ok) {
      process.stdout.write(`✓ RED as expected — ${fault.id}: ${fault.describe}\n`);
    } else {
      failed = true;
      process.stderr.write(`✗ ${fault.id}: ${fault.describe}\n`);
      process.stderr.write(`    ${result.reason}\n`);
      if (result.output) {
        process.stderr.write(
          result.output
            .split("\n")
            .slice(-15)
            .map((l) => `    | ${l}`)
            .join("\n") + "\n",
        );
      }
    }
  }

  process.stdout.write(
    `\ntest-faults: ${rows.filter((r) => r.ok).length}/${rows.length} faults turned their gate red\n`,
  );
  if (failed) {
    process.stderr.write("\nA seeded fault did NOT turn its gate red: the gate is not a gate.\n");
  }
  process.exit(failed ? 1 : 0);
}

main();
