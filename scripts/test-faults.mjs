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
];

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8" });
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

    const gate = run(fault.gate[0], fault.gate.slice(1), worktreeDir);
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
