// atlas-8 step 5 / Deliverable 2: the checklist loader behind `docs/parity.html`.
//
// The three parity checklists are prose in the PLAN files (read-only, outside this repo):
// `atlas-4 scores lens.md`, `atlas-5 species lens.md` and `atlas-refs/report pipeline spec.md` §7.
// This module turns them into rows so the page Ben signs is generated from the checklists rather
// than retyped from them -- retyping is exactly how a line goes missing between the plan and the
// sign-off. Pure, no fs, no network: `tests/parity-page/checklist.test.ts` asserts it.
//
// Ids are POSITIONAL (`S-01`... in file order) so they are stable and quotable, but a positional id
// silently re-points if a checklist line is inserted upstream. That is why every status entry in
// `status.mjs` also carries a `match` substring which `mergeStatus()` re-verifies against the parsed
// text: a shifted id fails the build instead of mislabelling a line.

/** `- [ ]` / `- [x]` at the start of a line. */
const BOX_RE = /^- \[([ xX])\] (.*)$/;
/** a bold-on-its-own-line group heading, e.g. `**Controls (§5.3)**` (atlas-4/-5). */
const BOLD_HEADING_RE = /^\*\*(.+?)\*\*$/;
/** a `### Structure` group heading (the report pipeline spec's §7). */
const HASH_HEADING_RE = /^(#{3,6})\s+(.+?)\s*$/;
/** the section this module reads: `## Parity checklist ...` / `## 7. Parity checklist ...`. */
const SECTION_RE = /^(#{2,3})\s+.*parity checklist/i;

/** strip markdown emphasis/code/link syntax for a plain-text cell; keeps the words, drops `**`. */
export function plainText(md) {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,;:]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse ONE checklist section out of a markdown document.
 *
 * @param {string} md markdown source
 * @param {{phase: string, prefix: string, source: string}} opts
 *   `phase` is the label shown on the page, `prefix` the id prefix (`S`/`P`/`R`), `source` the
 *   repo-or-plan-relative path recorded on every row.
 * @returns {{id: string, phase: string, section: string, text: string, raw: string,
 *            checked: boolean, line: number, source: string}[]}
 */
export function parseChecklist(md, opts) {
  const { phase, prefix, source } = opts;
  const lines = md.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error(`parseChecklist: no "Parity checklist" section in ${source}`);
  const depth = lines[start].match(SECTION_RE)[1].length;

  const rows = [];
  let section = "";
  let current = null;

  const flush = () => {
    if (!current) return;
    current.text = plainText(current.raw);
    rows.push(current);
    current = null;
  };

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];

    // a heading at the section's own level (or shallower) ends the section
    const h = line.match(HASH_HEADING_RE) ?? line.match(/^(#{1,6})\s+/);
    if (h && h[1].length <= depth) {
      flush();
      break;
    }

    const box = line.match(BOX_RE);
    if (box) {
      flush();
      current = {
        id: `${prefix}-${String(rows.length + 1).padStart(2, "0")}`,
        phase,
        section,
        text: "",
        raw: box[2].trim(),
        checked: box[1].toLowerCase() === "x",
        line: i + 1,
        source,
      };
      continue;
    }

    // a continuation line of the checkbox item: indented, non-empty, not a new list item
    if (current && /^\s{2,}\S/.test(line) && !/^\s*[-*]\s/.test(line)) {
      current.raw += " " + line.trim();
      continue;
    }

    flush();

    const hh = line.match(HASH_HEADING_RE);
    if (hh) {
      section = plainText(hh[2]);
      continue;
    }
    const bh = line.trim().match(BOLD_HEADING_RE);
    if (bh) {
      section = plainText(bh[1]);
      continue;
    }
  }
  flush();

  return rows;
}

/** count every `- [ ]`/`- [x]` line in a document, whatever section it is in (the drop detector). */
export function countCheckboxLines(md) {
  return md.split(/\r?\n/).filter((l) => BOX_RE.test(l)).length;
}

/**
 * Cut the checklist section out of a plan file, VERBATIM (heading line included, trailing blank
 * lines trimmed). `scripts/parity-page/build.mjs --sync` writes the result under
 * `docs/parity/checklists/` so the page can be generated, and its test can run, without the plan
 * files (which live outside this repo); when they ARE reachable the build re-extracts and refuses
 * to run on a difference. Same discipline as `tests/geo/adoptedFixtures.test.ts`'s msens copies.
 */
export function extractChecklistSection(md) {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error('extractChecklistSection: no "Parity checklist" section');
  const depth = lines[start].match(SECTION_RE)[1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s+/);
    if (h && h[1].length <= depth) {
      end = i;
      break;
    }
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  return `${lines.slice(start, end).join("\n").replace(/\s+$/, "")}\n`;
}
