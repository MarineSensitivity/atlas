// Normalizing `pdf-parse`'s extracted text so a prose assertion survives a DIFFERENT LINE BREAK.
//
// 0.10.14: `e2e/report.spec.ts`'s running-footer gate asserts that the Sources section's last
// sentence survives into the PDF intact (the regression it guards is a page-3 overprint that used
// to CORRUPT or DROP that text). The assertion was a raw `text.toContain(sentence)`, which is not
// a claim about the PDF at all — it is a claim about where the renderer happened to wrap the line,
// because `pdf-parse` joins each rendered line with `\n`. ubuntu-latest has different fonts than
// macOS, so it wraps that paragraph in different places and the substring stopped matching
// (run 35819393922, the only chromium red).
//
// This module makes the assertion line-break-proof WITHOUT weakening it: every word must still be
// present, in order, in the extracted text. Two rules, and only two:
//
//   1. every run of whitespace (the `\n` between rendered lines included) collapses to one space;
//   2. a space that directly follows a hyphen is removed, because a soft wrap at an existing
//      hyphen ("extinction-" / "risk") extracts as `extinction-\nrisk`, which rule 1 alone would
//      turn into `extinction- risk`.
//
// Rule 2 cannot fabricate text: it only ever JOINS across a hyphen the source string already
// contains. A dropped word, a transposed clause or an overprinted line still fails the assertion.

/** collapse rendered-line breaks so a prose substring matches regardless of where it wrapped. */
export function normalizePdfText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/-\s/g, "-").trim();
}
