// U0 probe: report.html's `#pl=` parser against the SAME drawn place written three ways. The
// Places panel's footer "Report" (src/places/Places.svelte onReport) writes the token as it sits in
// `sel.pl` -- the place NAME percent-encoded once ("Drawn%20place%201"); the per-row "Open in
// report" link goes through URLSearchParams and encodes it twice. On 0.10.21 only the second form
// renders: every drawn or coordinate-entered place (their default names have spaces) vanishes from
// a footer report. See docs/usability.md, finding B1.
import { ENGINES, createLog, openContext } from "./lib.mjs";

const log = createLog("report-hash");
const BASE = "https://marinesensitivity.org/atlas/report.html?ver=v7#pl=";
const CASES = {
  footerForm: "g1.Drawn%20place%201.EAMBAQSPyQrguwMA3xLwFQAA4BI",
  rowLinkForm: "g1.Drawn%2520place%25201.EAMBAQSPyQrguwMA3xLwFQAA4BI",
  nameWithoutSpace: "g1.Drawnplace.EAMBAQSPyQrguwMA3xLwFQAA4BI",
};
const browser = await ENGINES.chromium.launch();
try {
  for (const [name, token] of Object.entries(CASES)) {
    const { page, ctx } = await openContext(browser, { width: 1280, height: 800 });
    await page.goto(BASE + token);
    await page
      .waitForFunction(() => /Done —/.test(document.body.innerText), null, { timeout: 90_000 })
      .catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    log.note(name, {
      status: text.match(/Done[^\n]*/)?.[0] ?? null,
      map: text.match(/Map: [^\n]*/)?.[0] ?? null,
    });
    await ctx.close();
  }
} finally {
  log.save();
  await browser.close();
}
