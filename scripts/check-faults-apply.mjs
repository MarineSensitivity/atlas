#!/usr/bin/env node
// R3-D2: `git apply --check` over every patch referenced in scripts/test-faults.mjs's own FAULTS
// manifest, against a clean HEAD -- a much cheaper first line of defense than discovering a stale
// patch mid-`npm run test:faults` (a full gate run, sometimes a real browser build, per entry).
//
// "Round-2 lessons" (CLAUDE.md): six of this repo's seeded-fault patches went stale in ONE round
// alone -- a whitespace shift or a neighboring edit is enough to invalidate a unified diff that
// was never wrong about the FAULT itself. This script is the mechanical half of that lesson's
// rule ("git apply --check every tests/faults/*.patch after every merge"); the other half (prove
// red with `--only <id>` before writing the commit message) still has to be done by hand once a
// patch is regenerated.
//
// Usage: npm run faults:check   (or: node scripts/check-faults-apply.mjs)
// Exit 1 and lists every stale patch id; exit 0 (and lists nothing) when every patch applies.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FAULTS } from "./test-faults.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const stale = [];
for (const fault of FAULTS) {
  const patchPath = join(ROOT, fault.patch);
  if (!existsSync(patchPath)) {
    stale.push({ id: fault.id, patch: fault.patch, reason: "file does not exist" });
    continue;
  }
  try {
    execFileSync("git", ["apply", "--check", patchPath], { cwd: ROOT, stdio: "pipe" });
  } catch (e) {
    stale.push({
      id: fault.id,
      patch: fault.patch,
      reason: (e.stderr?.toString() || e.message || "git apply --check failed").trim(),
    });
  }
}

if (stale.length > 0) {
  process.stderr.write(
    `check-faults-apply: FAIL — ${stale.length}/${FAULTS.length} fault patch(es) do not apply to HEAD:\n`,
  );
  for (const s of stale) {
    process.stderr.write(`  ✗ ${s.id} (${s.patch})\n`);
    for (const line of s.reason.split("\n").slice(0, 4)) process.stderr.write(`      ${line}\n`);
  }
  process.stderr.write(
    "\nRegenerate each on an otherwise clean tree (git diff HEAD -- <one file>, after reverting " +
      "the hand edit), then prove it red-first: node scripts/test-faults.mjs --only <id>\n",
  );
  process.exit(1);
}

process.stdout.write(
  `check-faults-apply: PASS — all ${FAULTS.length} fault patches apply to HEAD\n`,
);
