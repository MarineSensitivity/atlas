// atlas-8 step 5 / Deliverable 2: `docs/parity.html`'s renderer.
//
// One pure function from data to a self-contained HTML string: no build step, no framework, plain
// CSS, relative image paths, and a print stylesheet (this page is meant to be signed, on paper or
// as a PDF). `build.mjs` does the IO; everything shaped here is testable.

import { GAPS, INTENTIONAL, NOT_COMPARED } from "./content.mjs";
import { STATUS_LABEL, STATUS_ORDER } from "./status.mjs";

const GH = "https://github.com/MarineSensitivity/atlas/blob/main";

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `**bold**` and `` `code` `` only — the lists above are written in that much markdown. */
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Blank out the VOLATILE fields so two renders of the same content compare equal.
 *
 * Why this exists (fix, 2026-09-23, found on the merge commit `609982b`): the page prints the git
 * HEAD sha, the render timestamp and the screenshot run's timestamp. Every one of those moves
 * without anything about the CONTENT changing, so `--check` was red on every commit after the one
 * that rendered the page — a check nobody can keep green is a check everyone learns to ignore.
 *
 * The volatile values are marked in the HTML itself (`data-volatile="..."`) rather than matched by
 * a regex over prose, so adding a fourth one is an attribute, not a new pattern here. Everything
 * else — every status, note, caption, url, byte count and wall time — still compares literally, so
 * a real edit is still caught (`tests/parity-page/checklist.test.ts`).
 */
export function canonicalizeHtml(html) {
  return html.replace(
    /(<(?:span|code)\b[^>]*\bdata-volatile="[^"]*"[^>]*>)[^<]*(<\/(?:span|code)>)/g,
    "$1<!--volatile-->$2",
  );
}

/** the volatile field names this page carries, for the test and the `--check` message. */
export const VOLATILE_FIELDS = ["sha", "generated", "shots-generated"];

function evidenceCell(evidence) {
  if (!evidence?.length) return '<span class="no-test">no test</span>';
  return evidence
    .map((e) => {
      if (e.file === "no test") return '<span class="no-test">no test</span>';
      return `<a href="${GH}/${esc(e.file)}"><code>${esc(e.file.replace(/^(tests|e2e)\//, ""))}</code></a> <span class="tname">${esc(e.name)}</span>`;
    })
    .join("<br>");
}

function countsByStatus(rows) {
  const out = {};
  for (const s of STATUS_ORDER) out[s] = rows.filter((r) => r.status === s).length;
  return out;
}

function summaryTable(phases) {
  const head = STATUS_ORDER.map((s) => `<th>${esc(STATUS_LABEL[s])}</th>`).join("");
  const body = phases
    .map((p) => {
      const c = countsByStatus(p.rows);
      const cells = STATUS_ORDER.map(
        (s) => `<td class="n ${s}">${c[s] || '<span class="zero">0</span>'}</td>`,
      ).join("");
      return `<tr><th scope="row">${esc(p.label)}<br><span class="dim">${esc(p.idRange)}</span></th>${cells}<td class="n total">${p.rows.length}</td></tr>`;
    })
    .join("\n");
  const all = phases.flatMap((p) => p.rows);
  const c = countsByStatus(all);
  const totals = STATUS_ORDER.map((s) => `<td class="n total">${c[s]}</td>`).join("");
  return `<table class="summary">
<thead><tr><th scope="col">phase</th>${head}<th scope="col">lines</th></tr></thead>
<tbody>
${body}
<tr class="grand"><th scope="row">all three</th>${totals}<td class="n total">${all.length}</td></tr>
</tbody></table>`;
}

function rowTable(rows) {
  const body = rows
    .map(
      (r) => `<tr id="${esc(r.id)}">
  <td class="id"><a href="#${esc(r.id)}">${esc(r.id)}</a></td>
  <td class="text">${inline(r.text)}${r.note ? `<div class="note">${inline(r.note)}</div>` : ""}${
    r.diffs?.length
      ? `<div class="diffs">see ${r.diffs.map((d) => `<a href="#${esc(d)}">${esc(d)}</a>`).join(", ")}</div>`
      : ""
  }</td>
  <td class="status"><span class="pill ${esc(r.status)}">${esc(STATUS_LABEL[r.status])}</span></td>
  <td class="evidence">${evidenceCell(r.evidence)}</td>
</tr>`,
    )
    .join("\n");
  return `<table class="rows">
<thead><tr><th scope="col">id</th><th scope="col">checklist line</th><th scope="col">status</th><th scope="col">evidence (test file · test name)</th></tr></thead>
<tbody>
${body}
</tbody></table>`;
}

function shotFigure(state) {
  const side = (s, label) => {
    if (!s) {
      return `<figure class="shot none"><figcaption><b>${esc(label)}</b> — no equivalent in the Shiny apps</figcaption></figure>`;
    }
    const img = s.file
      ? `<img src="parity/${esc(s.file)}" alt="${esc(label)}: ${esc(state.title)}" loading="lazy">`
      : `<div class="missing">no capture</div>`;
    const status = s.ok
      ? `<span class="ok">rendered</span>`
      : `<span class="bad">FAILED — ${esc(s.reason ?? "unknown")}</span>`;
    return `<figure class="shot ${s.ok ? "" : "failed"}">
  ${img}
  <figcaption><b>${esc(label)}</b> ${status}<br><code class="url">${esc(s.url)}</code><br><span class="dim">${esc(s.ms)} ms · ${esc(Math.round((s.bytes ?? 0) / 1024))} KB</span></figcaption>
</figure>`;
  };
  const rows = state.rows?.length
    ? `<p class="dim">checklist lines: ${state.rows.map((r) => `<a href="#${esc(r)}">${esc(r)}</a>`).join(", ")}</p>`
    : "";
  return `<section class="pair ${state.ok ? "" : "failed"}" id="shot-${esc(state.id)}">
<h3>${esc(state.title)}${state.atlasOnly ? ' <span class="tag">atlas only</span>' : ""}${state.ok ? "" : ' <span class="tag bad">failed pair</span>'}</h3>
<p>${inline(state.caption)}</p>
${rows}
<div class="shots">
${side(state.shiny, "Shiny (v7)")}
${side(state.atlas, "Atlas")}
</div>
</section>`;
}

function intentionalList() {
  return INTENTIONAL.map(
    (d) => `<section class="diff" id="${esc(d.id)}">
<h3>${esc(d.id)} · ${inline(d.title)}</h3>
<p><b>What differs.</b> ${inline(d.what)}</p>
<p><b>Why.</b> ${inline(d.why)}</p>
<p><b>Where the atlas behaviour is asserted.</b> ${
      d.where
        .map(
          (w) =>
            `<a href="${GH}/${esc(w.file)}"><code>${esc(w.file)}</code></a> <span class="tname">${esc(w.name)}</span>`,
        )
        .join("<br>") || '<span class="no-test">no test</span>'
    }</p>
${d.rows?.length ? `<p class="dim">checklist lines: ${d.rows.map((r) => `<a href="#${esc(r)}">${esc(r)}</a>`).join(", ")}</p>` : ""}
</section>`,
  ).join("\n");
}

// M7 (atlas-8 phase review): a gap that has since been fixed (e.g. G-23/G-25 in 0.10.19, G-24 in
// 0.10.24) is NOT deleted from GAPS -- the citations (`rows`, evidence elsewhere) stay valid, and
// deleting it would silently drop the record that it was ever wrong. It carries `fixedIn` instead,
// and this table's status column is the "fixed in <version>" status the review asked for -- a gap
// stays visible here, sorted with the still-open ones, but reads as resolved rather than pending.
function gapsList() {
  return `<table class="rows gaps">
<thead><tr><th scope="col">id</th><th scope="col">gap</th><th scope="col">owner</th><th scope="col">status</th><th scope="col">lines</th></tr></thead>
<tbody>
${GAPS.slice()
  // by id, so a gap added later to the middle of the source list still reads G-01…G-nn here
  .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))
  .map(
    (
      g,
    ) => `<tr id="${esc(g.id)}" class="${g.fixedIn ? "fixed" : ""}"><td class="id"><a href="#${esc(g.id)}">${esc(g.id)}</a></td>
<td class="text"><b>${inline(g.title)}</b><div class="note">${inline(g.detail)}</div></td>
<td class="owner">${inline(g.owner)}</td>
<td class="dim">${g.fixedIn ? `<span class="pill done">Fixed in ${esc(g.fixedIn)}</span>` : "open"}</td>
<td class="dim">${(g.rows ?? []).map((r) => `<a href="#${esc(r)}">${esc(r)}</a>`).join(", ") || "—"}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`;
}

const CSS = `
:root {
  --ink: #12263a; --dim: #5a6b7c; --line: #d8e0e8; --bg: #ffffff; --panel: #f5f8fa;
  --done: #1a7f52; --partial: #9a6b00; --deferred: #8a3b3b; --intent: #3a4fa0; --bad: #b3261e;
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 62rem; padding: 2rem 1rem 6rem; background: var(--bg); color: var(--ink);
  font: 16px/1.55 "Carlito", "Calibri", system-ui, -apple-system, "Segoe UI", sans-serif; }
h1, h2, h3 { font-family: "Jost", "Avenir Next", system-ui, sans-serif; line-height: 1.2; }
h1 { font-size: 2rem; margin: 0 0 .25rem; }
h2 { font-size: 1.35rem; margin: 2.5rem 0 .75rem; padding-top: .75rem; border-top: 2px solid var(--line); }
h3 { font-size: 1.05rem; margin: 1.5rem 0 .4rem; }
p { margin: .5rem 0; }
code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .85em; }
a { color: #14568f; }
.dim { color: var(--dim); font-size: .85rem; }
.lede { font-size: 1.05rem; color: var(--dim); margin-bottom: 1rem; }
.meta { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: .75rem 1rem; margin: 1rem 0 1.5rem; }
.meta dl { display: grid; grid-template-columns: 11rem 1fr; gap: .2rem 1rem; margin: 0; font-size: .9rem; }
.meta dt { color: var(--dim); }
.meta dd { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: .75rem 0 1.5rem; font-size: .9rem; }
th, td { border: 1px solid var(--line); padding: .4rem .55rem; text-align: left; vertical-align: top; }
thead th { background: var(--panel); font-weight: 600; }
.summary td.n { text-align: right; font-variant-numeric: tabular-nums; width: 7rem; }
.summary .zero { color: var(--dim); }
.summary .grand th, .summary .grand td { font-weight: 700; background: var(--panel); }
.rows td.id { white-space: nowrap; width: 3.5rem; font-weight: 600; }
.rows td.status { width: 8rem; }
.rows td.evidence { width: 22rem; font-size: .8rem; }
.rows .note { color: var(--dim); font-size: .85rem; margin-top: .35rem; }
.rows .diffs { font-size: .8rem; margin-top: .3rem; }
.tname { color: var(--dim); }
.no-test { color: var(--bad); font-weight: 600; }
.pill { display: inline-block; padding: .08rem .45rem; border-radius: 999px; font-size: .78rem; font-weight: 600;
  border: 1px solid currentColor; white-space: nowrap; }
.pill.done { color: var(--done); }
.pill.partial { color: var(--partial); }
.pill.deferred { color: var(--deferred); }
.pill.intentional-difference { color: var(--intent); }
.diff { border-left: 3px solid var(--intent); padding-left: .9rem; margin: 1.25rem 0; }
.gaps td.owner { width: 12rem; font-size: .82rem; color: var(--dim); }
.gaps tr.fixed td.text b { color: var(--dim); }
.pair { margin: 2rem 0; }
.pair.failed { border-left: 3px solid var(--bad); padding-left: .9rem; }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.shot { margin: 0; }
.shot img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; display: block; }
.shot figcaption { font-size: .78rem; color: var(--dim); margin-top: .3rem; word-break: break-all; }
.shot .url { font-size: .75rem; }
.shot.none { background: var(--panel); border: 1px dashed var(--line); border-radius: 6px; padding: 1rem; display: flex; align-items: center; }
.shot .missing { background: var(--panel); border: 1px dashed var(--bad); border-radius: 6px; padding: 2rem; text-align: center; color: var(--bad); }
.ok { color: var(--done); font-weight: 600; }
.bad { color: var(--bad); font-weight: 700; }
.tag { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; border: 1px solid var(--line);
  border-radius: 999px; padding: .1rem .45rem; color: var(--dim); vertical-align: middle; }
.tag.bad { color: var(--bad); border-color: var(--bad); }
ul.plain { padding-left: 1.1rem; }
ul.plain li { margin: .35rem 0; }
.sign { border: 2px solid var(--ink); border-radius: 8px; padding: 1rem 1.25rem; margin-top: 1rem; }
.sign table { margin: .5rem 0; }
.sign .line { display: inline-block; min-width: 16rem; border-bottom: 1px solid var(--ink); }
@media (max-width: 700px) { .shots { grid-template-columns: 1fr; } .meta dl { grid-template-columns: 1fr; } }
@media print {
  @page { size: Letter; margin: .6in; }
  body { max-width: none; font-size: 10pt; padding: 0; }
  a { color: inherit; text-decoration: none; }
  h2 { break-after: avoid; }
  tr, .pair, .diff, .sign { break-inside: avoid; }
  .shot img { max-height: 3.2in; object-fit: contain; }
}
`;

/**
 * @param {{phases: {key: string, label: string, idRange: string, source: string, rows: object[]}[],
 *          shots: object, meta: object}} data
 */
export function renderPage(data) {
  const { phases, shots, meta } = data;
  const all = phases.flatMap((p) => p.rows);
  const counts = countsByStatus(all);
  const pairs = shots?.states ?? [];
  const compared = pairs.filter((s) => !s.atlasOnly);
  const failedPairs = pairs.filter((s) => !s.ok);
  const openGaps = GAPS.filter((g) => !g.fixedIn);
  const fixedGaps = GAPS.filter((g) => g.fixedIn);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atlas parity — the page Ben signs</title>
<style>${CSS}</style>
</head>
<body>
<h1>Marine Sensitivity Atlas — parity sign-off</h1>
<p class="lede">Every line of the atlas-4 (scores), atlas-5 (species) and atlas-7 (report) parity
checklists, with its status, what asserts it, and — for ${compared.length} states — the old Shiny app
and the Atlas side by side at the same view. <b>atlas-9's cutover is gated on this page.</b></p>

<div class="meta">
<dl>
  <dt>Atlas version</dt><dd>${esc(meta.version)} · generated against commit <code data-volatile="sha">${esc(meta.sha)}</code> (the commit that ADDS this page is its child)</dd>
  <dt>Generated</dt><dd><span data-volatile="generated">${esc(meta.generated)}</span></dd>
  <dt>Release compared</dt><dd><b>v7</b> — today's <code>latest.txt</code>, the only release both hosts serve publicly</dd>
  <dt>Shiny host</dt><dd><code>${esc(meta.shinyBase ?? "https://app.marinesensitivity.org/v7")}</code></dd>
  <dt>Atlas host</dt><dd><code>${esc(meta.atlasBase ?? "https://marinesensitivity.org/atlas")}</code></dd>
  <dt>Screenshots</dt><dd>${pairs.length} states · ${compared.length} Shiny-vs-Atlas pairs · ${pairs.length - compared.length} atlas-only · <b>${failedPairs.length} failed</b>${shots?.generated ? ` · taken <span data-volatile="shots-generated">${esc(shots.generated)}</span>` : ""}, chromium ${esc(shots?.viewport?.width ?? 1280)}×${esc(shots?.viewport?.height ?? 800)}</dd>
  <dt>Checklist sources</dt><dd>${phases.map((p) => `<code>${esc(p.source)}</code>`).join("<br>")}</dd>
</dl>
</div>

<p>Both lists below — <a href="#intentional">intentional differences</a> and
<a href="#gaps">known gaps</a> — are written so that <b>every</b> way the Atlas differs from the two
Shiny apps and the Quarto report appears in one of them. A difference that was decided is
intentional; a difference that is simply not built yet, or not yet gated, is a gap with an owner.
Screenshots in this page are captured at <code>?theme=dark</code> on the Atlas where the Shiny app's
own default is dark, so the pairs differ in content rather than in palette.</p>

<h2 id="summary">Summary</h2>
${summaryTable(phases)}
<p class="dim">${counts.done} of ${all.length} lines are done with a named test; ${counts.partial} are
partial (the note on each says which part is not); ${counts["intentional-difference"]} differ on
purpose; ${counts.deferred} are not built. Nothing here counts a line as done on the strength of a
test that does not exist: the generator re-reads every file named in the Evidence column and fails if
the test title is not in it.</p>

<h2 id="not-compared">What this page does NOT show</h2>
<ul class="plain">
${NOT_COMPARED.map((t) => `<li>${inline(t)}</li>`).join("\n")}
</ul>

<h2 id="intentional">Intentional differences</h2>
<p>${INTENTIONAL.length} of them. Each names what differs, why (the decision or the documented bug),
and where the Atlas behaviour is asserted.</p>
${intentionalList()}

<h2 id="gaps">Known gaps</h2>
<p>${openGaps.length} open differences that were <em>not</em> chosen: things deferred, not yet gated, or
blocked on data the releases do not publish. None of them is hidden below the line — they are listed
here so the signature covers what is missing as well as what is done. ${fixedGaps.length} more
(${fixedGaps.map((g) => esc(g.id)).join(", ")}) were found here and have SINCE been fixed — kept in the
table below, marked "Fixed in &lt;version&gt;", rather than deleted, so the record of what was wrong
does not disappear with the fix.</p>
${gapsList()}

<h2 id="shots">Screenshot pairs</h2>
<p>${compared.length} paired states and ${pairs.length - compared.length} atlas-only states, all on
v7, chromium ${esc(shots?.viewport?.width ?? 1280)}×${esc(shots?.viewport?.height ?? 800)},
regenerated by <code>node scripts/shots.mjs</code>. A capture that did not render is marked
<b>FAILED</b> here rather than shipped as though the comparison had happened.</p>
${pairs.map(shotFigure).join("\n")}

${phases
  .map(
    (p) => `<h2 id="${esc(p.key)}">${esc(p.label)} — full checklist (${p.rows.length} lines)</h2>
<p class="dim">Source: <code>${esc(p.source)}</code> (read-only; this table is generated from it, not
retyped). Evidence links go to <code>${esc(GH)}</code>.</p>
${rowTable(p.rows)}`,
  )
  .join("\n")}

<h2 id="sign">Sign-off</h2>
<div class="sign">
<p>I have reviewed the checklist lines, the intentional-differences list and the known-gaps list
above, and I accept them as the basis for retiring the Shiny apps (atlas-9 cutover).</p>
<table>
<thead><tr><th>phase</th><th>accepted</th><th>comments</th></tr></thead>
<tbody>
${phases
  .map(
    (p) =>
      `<tr><td>${esc(p.label)}</td><td style="width:6rem;text-align:center">☐</td><td style="height:2.2rem"></td></tr>`,
  )
  .join("\n")}
<tr><td>Intentional differences (${INTENTIONAL.length})</td><td style="text-align:center">☐</td><td></td></tr>
<tr><td>Known gaps (${GAPS.length})</td><td style="text-align:center">☐</td><td></td></tr>
</tbody></table>
<p style="margin-top:1.25rem">Reviewed by <span class="line">&nbsp;</span> &nbsp; on <span class="line" style="min-width:10rem">&nbsp;</span></p>
</div>

<p class="dim" style="margin-top:2rem">Generated by <code>node scripts/parity-page/build.mjs</code>
from <code>docs/parity/checklists/*.md</code> (verbatim slices of the plan files),
<code>scripts/parity-page/status.mjs</code> and <code>docs/parity/shots/shots.json</code>. Regenerate
after any change to the checklists, the statuses or the screenshots — and re-run
<code>npx vitest run tests/parity-page</code>, which holds the generator to its own rules.</p>
</body>
</html>
`;
}
