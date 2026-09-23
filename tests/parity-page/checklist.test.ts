// atlas-8 step 5 / Deliverable 2 — the generator behind `docs/parity.html` held to its own rules.
//
// `docs/parity.html` is the page atlas-9's cutover is gated on, so the ways it could lie are what
// this file tests: a checklist line silently dropped on the way in, a positional id re-pointed by
// an upstream edit, a line called "done" with nothing asserting it, and an Evidence cell naming a
// test that does not exist.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  countCheckboxLines,
  extractChecklistSection,
  parseChecklist,
  plainText,
} from "../../scripts/parity-page/checklist-core.mjs";
import { INTENTIONAL } from "../../scripts/parity-page/content.mjs";
import { PHASES, loadPhases } from "../../scripts/parity-page/build.mjs";
import { checkConsistency, mergeStatus } from "../../scripts/parity-page/status.mjs";
import { buildTestIndex, verifyEvidence } from "../../scripts/parity-page/test-index-core.mjs";
import { VOLATILE_FIELDS, canonicalizeHtml } from "../../scripts/parity-page/render.mjs";
import { FAULTY_STATUS, FIXED_STATUS } from "../fixtures/parity-page/status-fault-done-no-test.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SAMPLE = readFileSync(join(ROOT, "tests/fixtures/parity-page/sample-checklist.md"), "utf8");

describe("parseChecklist (the loader docs/parity.html is generated with)", () => {
  const rows = parseChecklist(SAMPLE, { phase: "sample", prefix: "S", source: "sample.md" });

  it("gives one row per checkbox line IN the checklist section, and stops at the next heading", () => {
    // the fixture carries five `- [ ]`/`- [x]` lines; the fifth is under `## Steps`
    expect(countCheckboxLines(SAMPLE)).toBe(5);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.text).join(" ")).not.toContain("OUTSIDE the checklist");
  });

  it("numbers ids in file order, zero-padded, with the phase's prefix", () => {
    expect(rows.map((r) => r.id)).toEqual(["S-01", "S-02", "S-03", "S-04"]);
  });

  it("carries the bold group heading as the row's section", () => {
    expect(rows.map((r) => r.section)).toEqual([
      "Controls (§5.3)",
      "Controls (§5.3)",
      "Map (§6.2–6.4)",
      "Map (§6.2–6.4)",
    ]);
  });

  it("joins a continuation line into the row's text rather than dropping or splitting it", () => {
    expect(rows[1].text).toContain("predates the BOEM Program Areas");
    expect(rows[1].text).not.toContain("\n");
  });

  it("records `checked` and the source line number", () => {
    expect(rows.map((r) => r.checked)).toEqual([false, false, true, false]);
    expect(rows[0].line).toBe(4);
  });

  it("strips markdown emphasis for the table cell but keeps every word", () => {
    expect(plainText("fill by the **11-bin** rule from `ramps.ts`")).toBe(
      "fill by the 11-bin rule from ramps.ts",
    );
  });

  it("refuses a document with no checklist section rather than returning nothing", () => {
    expect(() =>
      parseChecklist("# nothing here\n", { phase: "x", prefix: "X", source: "x.md" }),
    ).toThrow(/no "Parity checklist" section/);
  });

  it("extractChecklistSection cuts the section verbatim, heading included", () => {
    const slice = extractChecklistSection(SAMPLE);
    expect(slice.startsWith("## Parity checklist")).toBe(true);
    expect(slice).not.toContain("## Steps");
    expect(countCheckboxLines(slice)).toBe(4);
  });
});

describe("the three REAL checklists (docs/parity/checklists/, verbatim slices of the plan files)", () => {
  const phases = loadPhases({ plansDir: null, strict: false });

  it("every `- [ ]`/`- [x]` line yields exactly one row — no silent parse drop", () => {
    for (const [i, phase] of phases.entries()) {
      const md = readFileSync(join(ROOT, phase.source), "utf8");
      expect(phase.rows.length, `${phase.source} rows vs checkbox lines`).toBe(
        countCheckboxLines(md),
      );
      expect(phase.rows.length, `${phase.source} expected count`).toBe(PHASES[i].expected);
    }
  });

  it("is 72 lines: 22 scores + 22 species + 28 report", () => {
    expect(phases.flatMap((p) => p.rows)).toHaveLength(72);
    expect(phases.map((p) => p.rows.length)).toEqual([22, 22, 28]);
  });

  it("gives every row a status entry whose `match` still appears in the parsed line", () => {
    // mergeStatus throws on a drifted id or an unmatched status entry; this is that gate.
    const merged = mergeStatus(phases.flatMap((p) => p.rows));
    expect(merged).toHaveLength(72);
    expect(merged.every((r) => typeof r.status === "string" && r.status.length > 0)).toBe(true);
  });

  it("is internally consistent: nothing is `done` on the strength of a test that does not exist", () => {
    expect(checkConsistency(mergeStatus(phases.flatMap((p) => p.rows)))).toEqual([]);
  });

  it("names only tests that REALLY exist — in the rows and in the intentional-differences list", () => {
    const index = buildTestIndex(ROOT);
    const rows = mergeStatus(phases.flatMap((p) => p.rows));
    expect(verifyEvidence(rows, index)).toEqual([]);
    expect(
      verifyEvidence(
        INTENTIONAL.map((d) => ({ id: d.id, evidence: d.where })),
        index,
      ),
    ).toEqual([]);
  });

  it("every intentional difference and every checklist cross-reference resolves to a real id", () => {
    const rows = mergeStatus(phases.flatMap((p) => p.rows));
    const ids = new Set(rows.map((r) => r.id));
    const diffIds = new Set(INTENTIONAL.map((d) => d.id));
    for (const d of INTENTIONAL)
      for (const r of d.rows ?? []) expect(ids, `${d.id} -> ${r}`).toContain(r);
    for (const r of rows)
      for (const d of r.diffs ?? []) expect(diffIds, `${r.id} -> ${d}`).toContain(d);
  });
});

describe("the consistency rule's seeded fault (a permanent red case)", () => {
  const rows = parseChecklist(SAMPLE, { phase: "sample", prefix: "S", source: "sample.md" });

  it("flags a row that claims `done` while its evidence says 'no test'", () => {
    const problems = checkConsistency(mergeStatus(rows, FAULTY_STATUS));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("S-01");
    expect(problems[0]).toContain("no test");
  });

  it("does NOT flag `partial` or `deferred` with 'no test' — honesty is not the fault", () => {
    const problems = checkConsistency(mergeStatus(rows, FIXED_STATUS));
    expect(problems).toEqual([]);
  });
});

describe("`--check`'s canonicalization (the fix for a check that could never stay green)", () => {
  // Found on merge commit 609982b: the page embeds the git HEAD sha and two timestamps, so
  // `--check` was stale on every commit AFTER the one that rendered it — with no edit anywhere.
  const page = (sha: string, stamp: string, shots: string, status = "done") =>
    `<dd>0.10.17 · commit <code data-volatile="sha">${sha}</code></dd>` +
    `<dd><span data-volatile="generated">${stamp}</span></dd>` +
    `<dd>taken <span data-volatile="shots-generated">${shots}</span></dd>` +
    `<td class="status"><span class="pill ${status}">${status}</span></td>`;

  it("two renders of the SAME content at different commits/times compare equal", () => {
    const a = page("748de16c7d", "2026-09-23 07:41 UTC", "2026-09-23T08:00:00.000Z");
    const b = page("609982bfff", "2026-09-24 11:02 UTC", "2026-09-24T09:30:00.000Z");
    expect(a).not.toBe(b);
    expect(canonicalizeHtml(a)).toBe(canonicalizeHtml(b));
  });

  it("a REAL content change (a row's status) still compares different", () => {
    const a = page("748de16c7d", "t1", "s1", "done");
    const b = page("748de16c7d", "t1", "s1", "partial");
    expect(canonicalizeHtml(a)).not.toBe(canonicalizeHtml(b));
  });

  it("blanks only the marked fields, and leaves every other span/code alone", () => {
    const canon = canonicalizeHtml(page("abc", "t", "s"));
    expect(canon).not.toContain("abc");
    expect(canon.match(/<!--volatile-->/g)).toHaveLength(VOLATILE_FIELDS.length);
    expect(canonicalizeHtml("<code>docs/parity/checklists/atlas-4-scores.md</code>")).toContain(
      "atlas-4-scores.md",
    );
  });

  it("the REAL page carries exactly the volatile fields VOLATILE_FIELDS names", () => {
    const html = readFileSync(join(ROOT, "docs/parity.html"), "utf8");
    const found = [...html.matchAll(/data-volatile="([^"]+)"/g)].map((m) => m[1]);
    expect(found.sort()).toEqual([...VOLATILE_FIELDS].sort());
    expect(canonicalizeHtml(html)).not.toBe(html);
  });
});

describe("the plan files' progress logs must never fail a build", () => {
  // The orchestrator appends progress-log lines to those plans continually. `loadPhases()` compares
  // the extracted checklist SLICE, never the whole file, and `sources.json`'s `planSha256` is
  // informative only — this proves both, against a SCRATCH copy (the real plans are read-only).
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  /** a synthetic plan dir: front matter + the committed slice + a progress log, per phase. */
  function scratchPlans(mutate: (slice: string) => string = (s) => s): string {
    dir = mkdtempSync(join(tmpdir(), "atlas-plans-"));
    for (const phase of PHASES) {
      const slice = readFileSync(join(ROOT, "docs/parity/checklists", phase.file), "utf8");
      const path = join(dir, phase.plan);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        `# ${phase.plan}\n\nPreamble the build never reads.\n\n${mutate(slice)}\n## Progress log (orchestrator)\n- an existing line\n`,
      );
    }
    return dir;
  }

  it("loads cleanly from a plan file that wraps the slice in other sections", () => {
    const phases = loadPhases({ plansDir: scratchPlans() });
    expect(phases.flatMap((p) => p.rows)).toHaveLength(72);
  });

  it("APPENDING a progress-log line does not fail it (the whole-file hash is not a gate)", () => {
    const plans = scratchPlans();
    for (const phase of PHASES) {
      const path = join(plans, phase.plan);
      writeFileSync(
        path,
        `${readFileSync(path, "utf8")}- 2026-09-24 · another orchestrator note\n`,
      );
    }
    expect(() => loadPhases({ plansDir: plans })).not.toThrow();
    expect(loadPhases({ plansDir: plans }).flatMap((p) => p.rows)).toHaveLength(72);
  });

  it("but a change INSIDE the checklist slice does fail it", () => {
    const plans = scratchPlans((s) => s.replace("- [ ] Study area:", "- [ ] Study areas:"));
    expect(() => loadPhases({ plansDir: plans })).toThrow(/no longer matches/);
  });
});

describe("mergeStatus's drift guard (a positional id must not silently re-point)", () => {
  it("throws when the checklist line no longer contains the status entry's `match`", () => {
    const shifted = SAMPLE.replace(
      "- [ ] Study area: FULL / AK presets",
      "- [ ] A NEW LINE INSERTED UPSTREAM\n- [ ] Study area: FULL / AK presets",
    );
    const rows = parseChecklist(shifted, { phase: "sample", prefix: "S", source: "sample.md" });
    expect(() => mergeStatus(rows, FIXED_STATUS)).toThrow(/a checklist line moved/);
  });

  it("throws when a status entry has no checklist row at all", () => {
    const rows = parseChecklist(SAMPLE, {
      phase: "sample",
      prefix: "S",
      source: "sample.md",
    }).slice(0, 3);
    expect(() => mergeStatus(rows, FIXED_STATUS)).toThrow(/status entries with no checklist row/);
  });
});
