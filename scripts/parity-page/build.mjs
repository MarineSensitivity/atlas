#!/usr/bin/env node
// scripts/parity-page/build.mjs -- atlas-8 step 5 / Deliverable 2: generate `docs/parity.html`.
//
//   node scripts/parity-page/build.mjs            # regenerate the page
//   node scripts/parity-page/build.mjs --sync     # re-extract the checklists from the plan files first
//   node scripts/parity-page/build.mjs --check    # fail if the committed page is stale (CI-style)
//
// The three parity checklists live in plan files OUTSIDE this repo
// (`../workflows/.claude/plans_todo/`). `--sync` copies each checklist SECTION verbatim into
// `docs/parity/checklists/` next to a `sources.json` recording the source path, line range and
// sha256 of both the slice and the whole plan file. Everything downstream — the page, the unit
// test — reads the committed copies, so the page can be rebuilt and the test can run without the
// plans; and when the plans ARE reachable, every build re-extracts and refuses to run on a
// difference (the same "byte-identical to the msens copy" discipline as tests/geo/adoptedFixtures).
//
// Three things the build refuses to produce a page over, because each would put a claim on a page
// that gets SIGNED:
//   1. a checklist row with no status entry, or a status entry whose `match` no longer appears in
//      the parsed line (a plan line moved -> a positional id now points somewhere else);
//   2. an evidence reference to a test that does not exist (file missing, or the title is not in
//      it) -- in the checklist rows AND in the intentional-differences list;
//   3. a row marked `done` whose evidence is "no test".

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GAPS, INTENTIONAL } from "./content.mjs";
import { countCheckboxLines, extractChecklistSection, parseChecklist } from "./checklist-core.mjs";
import { renderPage } from "./render.mjs";
import { checkConsistency, mergeStatus } from "./status.mjs";
import { buildTestIndex, verifyEvidence } from "./test-index-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECKLIST_DIR = join(ROOT, "docs/parity/checklists");
const SHOTS_JSON = join(ROOT, "docs/parity/shots/shots.json");
const OUT = join(ROOT, "docs/parity.html");

/** the three checklists, in the order they appear on the page. */
export const PHASES = [
  {
    key: "scores",
    prefix: "S",
    label: "atlas-4 · Scores lens",
    file: "atlas-4-scores.md",
    plan: "atlas-4 scores lens.md",
    expected: 22,
  },
  {
    key: "species",
    prefix: "P",
    label: "atlas-5 · Species lens",
    file: "atlas-5-species.md",
    plan: "atlas-5 species lens.md",
    expected: 22,
  },
  {
    key: "report",
    prefix: "R",
    label: "atlas-7 · Report",
    file: "atlas-7-report.md",
    plan: "atlas-refs/report pipeline spec.md",
    expected: 28,
  },
];

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** the plan directory, if it is reachable from here: `<something>/workflows/.claude/plans_todo`. */
export function findPlansDir(start = ROOT) {
  if (process.env.ATLAS_PLANS_DIR) return process.env.ATLAS_PLANS_DIR;
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "workflows/.claude/plans_todo");
    if (existsSync(join(candidate, "atlas-4 scores lens.md"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function syncChecklists(plansDir) {
  mkdirSync(CHECKLIST_DIR, { recursive: true });
  const sources = [];
  for (const phase of PHASES) {
    const planPath = join(plansDir, phase.plan);
    const md = readFileSync(planPath, "utf8");
    const slice = extractChecklistSection(md);
    writeFileSync(join(CHECKLIST_DIR, phase.file), slice);
    sources.push({
      file: phase.file,
      plan: `../workflows/.claude/plans_todo/${phase.plan}`,
      boxes: countCheckboxLines(slice),
      sliceSha256: sha256(slice),
      planSha256: sha256(md),
    });
  }
  writeFileSync(
    join(CHECKLIST_DIR, "sources.json"),
    `${JSON.stringify({ extracted: new Date().toISOString(), sources }, null, 2)}\n`,
  );
  return sources;
}

/** every committed checklist slice, re-verified against the plan files when they are reachable. */
export function loadPhases({ plansDir = findPlansDir(), strict = true } = {}) {
  const out = [];
  for (const phase of PHASES) {
    const path = join(CHECKLIST_DIR, phase.file);
    const slice = readFileSync(path, "utf8");
    if (plansDir && strict) {
      const live = extractChecklistSection(readFileSync(join(plansDir, phase.plan), "utf8"));
      if (live !== slice) {
        throw new Error(
          `loadPhases: docs/parity/checklists/${phase.file} no longer matches "${phase.plan}". ` +
            "Re-run `node scripts/parity-page/build.mjs --sync` and review what changed — the page " +
            "must be generated from the checklist as it stands, never from a stale copy.",
        );
      }
    }
    const rows = parseChecklist(slice, {
      phase: phase.label,
      prefix: phase.prefix,
      source: `docs/parity/checklists/${phase.file}`,
    });
    const boxes = countCheckboxLines(slice);
    if (rows.length !== boxes) {
      throw new Error(
        `loadPhases: ${phase.file} has ${boxes} checkbox lines but parsed ${rows.length} rows`,
      );
    }
    if (rows.length !== phase.expected) {
      throw new Error(
        `loadPhases: ${phase.file} parsed ${rows.length} rows, expected ${phase.expected} — ` +
          "a checklist line was added or removed upstream; update PHASES.expected and the status table together.",
      );
    }
    out.push({
      key: phase.key,
      label: phase.label,
      idRange: `${rows[0].id}–${rows[rows.length - 1].id}`,
      source: `docs/parity/checklists/${phase.file}`,
      plan: phase.plan,
      rows,
    });
  }
  return out;
}

function gitMeta() {
  // no child_process: read .git directly, so this works in a worktree too
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  let sha = "unknown";
  try {
    const gitPath = join(ROOT, ".git");
    const stat = readFileSync(gitPath, "utf8"); // a worktree's .git is a FILE pointing at the real dir
    const gitDir = stat.startsWith("gitdir:") ? stat.slice(7).trim() : gitPath;
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5).trim();
      const common = existsSync(join(gitDir, "commondir"))
        ? resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim())
        : gitDir;
      const refFile = existsSync(join(gitDir, ref)) ? join(gitDir, ref) : join(common, ref);
      if (existsSync(refFile)) sha = readFileSync(refFile, "utf8").trim();
      else {
        const packed = readFileSync(join(common, "packed-refs"), "utf8");
        const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
        if (line) sha = line.split(" ")[0];
      }
    } else sha = head;
  } catch {
    /* an export with no .git: "unknown" is the honest answer */
  }
  return { version: pkg.version, sha: sha.slice(0, 10) };
}

/**
 * The capture FACTS come from `shots.json` (what the browser actually did); the title, caption and
 * checklist ids come from `scripts/shots.mjs`'s own STATES, so page text can be edited without
 * re-shooting 15 states against two live servers. A state in the manifest that STATES no longer
 * defines is dropped, loudly.
 */
async function loadShots() {
  if (!existsSync(SHOTS_JSON)) return { states: [] };
  const manifest = JSON.parse(readFileSync(SHOTS_JSON, "utf8"));
  const { STATES } = await import("../shots.mjs");
  const byId = new Map(STATES.map((s) => [s.id, s]));
  const states = [];
  for (const captured of manifest.states ?? []) {
    const state = byId.get(captured.id);
    if (!state) {
      console.warn(
        `  ! shots.json has "${captured.id}", which scripts/shots.mjs no longer defines — dropped`,
      );
      continue;
    }
    states.push({
      ...captured,
      title: state.title,
      caption: state.caption,
      rows: state.rows,
      atlasOnly: !state.shiny,
    });
  }
  return { ...manifest, states };
}

export async function build({ sync = false, check = false } = {}) {
  const plansDir = findPlansDir();
  if (sync) {
    if (!plansDir)
      throw new Error(
        "--sync needs the plan files; set ATLAS_PLANS_DIR or run beside ../workflows",
      );
    const sources = syncChecklists(plansDir);
    console.log(
      `synced ${sources.length} checklists (${sources.map((s) => s.boxes).join(" + ")} lines)`,
    );
  }

  const phases = loadPhases({ plansDir });
  // ONE mergeStatus call over every row: it also checks the other way round (a status entry with no
  // checklist row), which only means anything when it sees all three checklists at once.
  const rows = mergeStatus(phases.flatMap((p) => p.rows));
  for (const p of phases) p.rows = rows.filter((r) => r.phase === p.label);

  const problems = checkConsistency(rows);
  if (problems.length) throw new Error(`consistency:\n  ${problems.join("\n  ")}`);

  const index = buildTestIndex(ROOT);
  const missing = [
    ...verifyEvidence(rows, index),
    ...verifyEvidence(
      INTENTIONAL.map((d) => ({ id: d.id, evidence: d.where })),
      index,
    ),
  ];
  if (missing.length)
    throw new Error(`evidence names a test that does not exist:\n  ${missing.join("\n  ")}`);

  const shots = await loadShots();

  // every cross-reference on the page resolves: a screenshot state, an intentional difference and a
  // gap all cite checklist ids, and a dangling "S-99" would read as a line that was compared when
  // nothing of the sort exists.
  const ids = new Set(rows.map((r) => r.id));
  const dangling = [
    ...(shots.states ?? []).flatMap((s) => (s.rows ?? []).map((r) => [`shot ${s.id}`, r])),
    ...INTENTIONAL.flatMap((d) => (d.rows ?? []).map((r) => [d.id, r])),
    ...GAPS.flatMap((g) => (g.rows ?? []).map((r) => [g.id, r])),
  ].filter(([, r]) => !ids.has(r));
  if (dangling.length)
    throw new Error(
      `cross-reference to a checklist id that does not exist:\n  ${dangling
        .map(([from, r]) => `${from} -> ${r}`)
        .join("\n  ")}`,
    );

  const meta = {
    ...gitMeta(),
    generated: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
    shinyBase: shots.shinyBase,
    atlasBase: shots.atlasBase,
  };
  const html = renderPage({ phases, shots, meta });

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    // the generated stamp moves every run; compare everything else
    const strip = (s) => s.replace(/<dd>[^<]*UTC<\/dd>/, "");
    if (strip(current) !== strip(html)) {
      throw new Error("docs/parity.html is stale — re-run `node scripts/parity-page/build.mjs`");
    }
    console.log("docs/parity.html is up to date");
    return { html, phases, rows };
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  const failed = (shots.states ?? []).filter((s) => !s.ok).length;
  console.log(
    `docs/parity.html · ${rows.length} lines (${Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}) · ${(shots.states ?? []).length} screenshot states (${failed} failed) · ` +
      `${readdirSync(join(ROOT, "docs/parity/shots")).filter((f) => /\.(jpg|png)$/.test(f)).length} images`,
  );
  return { html, phases, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  try {
    await build({ sync: args.includes("--sync"), check: args.includes("--check") });
  } catch (err) {
    console.error(`FAIL ${err.message}`);
    process.exit(1);
  }
}
