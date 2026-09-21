#!/usr/bin/env node
// scripts/parity/faults.mjs -- the committed proof that the parity gate can fail.
//
// "Every gate in this repo ships with a seeded fault like this one; a check that cannot fail is not
// a check" (CLAUDE.md). This copies `sql/` to a scratch directory, applies ONE rule-level mutation,
// runs `run.mjs --sql-dir <copy>` against it, and requires a NON-ZERO exit. The committed twins are
// never touched.
//
// Usage: node scripts/parity/faults.mjs [v9 v7] [--only <id>]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL = path.join(ROOT, "sql");

/** each fault names the rule it removes and the version(s) it must turn red. */
const FAULTS = [
  {
    id: "blend-dropped",
    vers: ["v9", "v7"],
    why: "the blend dropped: the denominator becomes the cells that HAVE the metric (the old, unblended formula, which is the `_prepctareaweighting` intermediate)",
    apply: (f) =>
      edit(f, "scores_for_cells.sql", [
        [
          "agg.num_present / w.w_all              AS score",
          "agg.num_present / agg.w_present        AS score",
        ],
      ]),
  },
  {
    id: "clip-removed",
    vers: ["v9"],
    why: "the D7b study-area clip removed: land and foreign waters re-enter a coverage-blended score as zeros",
    apply: (f) =>
      edit(f, "cells_in_study_area.sql", [
        ["  JOIN cell c ON c.cell_id = z.cell_id\n WHERE coalesce(c.in_usa, TRUE)\n", ""],
      ]),
  },
  {
    id: "bare-in-usa",
    vers: ["v7"],
    why: "`coalesce(in_usa, TRUE)` written as a bare `in_usa`: v1-v7 have no such column, atlas-1 writes it as all NULL, and the clip then keeps NOTHING",
    apply: (f) => edit(f, "cells_in_study_area.sql", [["coalesce(c.in_usa, TRUE)", "c.in_usa"]]),
  },
  {
    id: "id-field-hardcoded",
    vers: ["v7"],
    why: "the cell_model join hard-coded to v8+'s mdl_id: v7 stores mdl_seq and has no `model` table to go through",
    apply: (f) =>
      fs.copyFileSync(path.join(f, "cell_model_key.sql"), path.join(f, "cell_model_seq.sql")),
  },
  {
    id: "no-lit",
    vers: ["v9"],
    why: "a parameter interpolated into the SQL text instead of going through lit(): the value arrives already quoted, so lit()'s own quotes nest and the predicate matches nothing (and an injection string would escape)",
    apply: (f) =>
      edit(f, "species_for_zone.sql", [
        ["zone_value = {{zone_value}}", "zone_value = '{{zone_value}}'"],
      ]),
  },
];

function edit(dir, file, pairs) {
  const p = path.join(dir, file);
  let s = fs.readFileSync(p, "utf8");
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`seeded fault: "${from}" not found in ${file}`);
    s = s.replace(from, to);
  }
  fs.writeFileSync(p, s);
}

const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
const vers = args.filter((a) => /^v\d/.test(a));

let bad = 0;
for (const fault of FAULTS) {
  if (only && fault.id !== only) continue;
  const run = (vers.length ? vers : fault.vers).filter((v) => fault.vers.includes(v));
  if (!run.length) continue;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sql-fault-${fault.id}-`));
  fs.cpSync(SQL, dir, { recursive: true });
  fault.apply(dir);
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/parity/run.mjs"), ...run, "--sql-dir", dir],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  const red = r.status !== 0;
  const out = r.stdout ?? "";
  const first = out
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .slice(0, 2);
  // a fault that stops the harness outright (a Binder Error, a syntax error) exits 2 with nothing
  // on stdout: show the first line of the thrown error instead, which is the point of THAT fault
  const thrown = (r.stderr ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 3);
  console.log(`${red ? "RED  " : "GREEN"}  ${fault.id} (${run.join(",")}) exit ${r.status}`);
  console.log(`       ${fault.why}`);
  for (const l of first.length ? first : thrown) console.log(`      ${l.trim()}`);
  if (!red) {
    console.log((r.stdout ?? "").slice(-2000));
    bad = 1;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
if (bad) console.log("\nA seeded fault did NOT turn the gate red: the gate is not a gate.");
process.exit(bad);
