// U0 walk 3b: the Report flow END TO END. Route A: the Places panel's footer "Report" over three
// places (drawn, coordinates, uploaded -- the ones walk-places made, restored from their link).
// Route B: Table -> Zones -> tick two Program Areas -> "Report on selected". On route B the
// downloads are accepted and opened: the DOCX unzipped and read for its numbers, the ZIP listed,
// the HTML opened OFFLINE.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { ENGINES, createLog, dismissWelcome, load, openContext, settle, shot } from "./lib.mjs";

const DL = ".tmp/usability/dl";
mkdirSync(DL, { recursive: true });
const log = createLog("report");
const PLACES =
  "?unit=programarea&map=-92,27.5,4.6&proj=mercator#pl=g1.Drawn%2520place%25201.EAMBAQSPyQrguwMA3xLwFQAA4BI%7Eg1.bounding%2520box.EAMBAQSP5Qng1APADAAAwAy_DAA%7Eg1.upload-test.EAMBAQTP-w7guASwCQAA6AevCQA";

/** wait for report.html to say it is done (its status line), bounded; returns ms or null. */
async function reportDone(rep, timeout = 120_000) {
  const t0 = Date.now();
  try {
    await rep.waitForFunction(() => /Done —/.test(document.body.innerText), null, { timeout });
    return Date.now() - t0;
  } catch {
    return null;
  }
}
const grabReport = (rep) =>
  rep.evaluate(() => {
    const t = document.body.innerText;
    const pick = (re) => t.match(re)?.[0]?.replace(/\n/g, " / ").slice(0, 700) ?? null;
    return {
      status: pick(/(Done|Starting|Computing|Loading)[^\n]*/),
      map: pick(/Map: [^\n]*/),
      table: pick(/Mean component and overall scores per area\.[\s\S]{0,500}/),
      species: pick(/Summary of Species[\s\S]{0,600}/),
      permalink: pick(/https:\/\/marinesensitivity\.org\/atlas\/report\.html[^\n]*/),
      imgs: [...document.images].map(
        (i) =>
          `${(i.alt || i.src).slice(0, 50)} ${i.naturalWidth}x${i.naturalHeight} shown@${Math.round(i.getBoundingClientRect().width)}px`,
      ),
      fonts: getComputedStyle(document.querySelector("h1") ?? document.body).fontFamily,
    };
  });

const browser = await ENGINES.chromium.launch();
try {
  const { page, ctx } = await openContext(browser, { width: 1280, height: 800 });
  await load(page, PLACES);
  await dismissWelcome(page);
  await settle(page);

  // --- route A: Places -> footer Report --------------------------------------------------------
  await page.getByRole("button", { name: "Places", exact: true }).first().click();
  await page.waitForTimeout(4000);
  const footerReport = page.locator(".places-footer").getByRole("button", { name: /report/i });
  const panelScroll = await page.evaluate(() => {
    const b = document.querySelector("#panel-body-shell");
    return b && { clientH: b.clientHeight, scrollH: b.scrollHeight };
  });
  const boxBefore = await footerReport.boundingBox();
  log.note("route-a-footer", { boxBefore, panelScroll, viewportH: 800 });
  await footerReport.scrollIntoViewIfNeeded();
  const [repA] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 30_000 }),
    footerReport.click(),
  ]);
  await repA.setViewportSize({ width: 1280, height: 800 });
  const doneA = await reportDone(repA);
  log.note("route-a-report", {
    url: repA.url().slice(0, 400),
    doneMs: doneA,
    ...(await grabReport(repA)),
  });
  await shot(repA, "report-places-1280-light");

  // --- route B: Table -> Zones -> tick two -> Report on selected --------------------------------
  await page.getByRole("button", { name: "Table", exact: true }).first().click();
  await page.waitForTimeout(3000);
  await page
    .locator("#panel-region")
    .getByRole("button", { name: "Zones", exact: true })
    .first()
    .click();
  await page.waitForTimeout(3000);
  const boxes = page.locator("#panel-region tbody input[type=checkbox]");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const zoneRows = await page.evaluate(() =>
    [...document.querySelectorAll("#panel-region tbody tr")]
      .slice(0, 2)
      .map((r) => r.innerText.replace(/\s+/g, " ").slice(0, 200)),
  );
  const [repB] = await Promise.all([
    ctx.waitForEvent("page", { timeout: 30_000 }),
    page
      .locator("#panel-region")
      .getByRole("button", { name: /report on selected/i })
      .click(),
  ]);
  await repB.setViewportSize({ width: 1280, height: 800 });
  const doneB = await reportDone(repB);
  const gotB = await grabReport(repB);
  log.note("route-b-report", { zoneRows, url: repB.url().slice(0, 300), doneMs: doneB, ...gotB });
  await shot(repB, "report-zones-1280-light");
  const full = await shot(repB, "report-zones-full-1280-light", { fullPage: true, quality: 55 });
  // ~5,000 px tall: halve it so the doc's screenshot budget holds (macOS `sips`)
  if (full) execFileSync("sips", ["--resampleWidth", "640", full], { stdio: "ignore" });
  await repB.emulateMedia({ media: "print" });
  await repB.waitForTimeout(1500);
  await repB
    .pdf({ path: `${DL}/report-zones.pdf`, format: "Letter" })
    .catch((e) => log.note("pdf", { err: String(e) }));
  const pdfPages = execFileSync("sh", [
    "-c",
    `strings ${DL}/report-zones.pdf | grep -c '/Type /Page$' || true`,
  ])
    .toString()
    .trim();
  log.note("print-pdf", { pdfPages });
  await repB.emulateMedia({ media: "screen" });

  const saved = {};
  for (const [label, re] of [
    ["html", /download html/i],
    ["zip", /data package/i],
    ["docx", /word document/i],
  ]) {
    try {
      const [dl] = await Promise.all([
        repB.waitForEvent("download", { timeout: 60_000 }),
        repB.getByRole("button", { name: re }).click(),
      ]);
      const to = `${DL}/zones-${dl.suggestedFilename()}`;
      await dl.saveAs(to);
      saved[label] = to;
    } catch (e) {
      saved[label] = `FAILED: ${String(e).slice(0, 200)}`;
    }
  }
  log.note("exports", saved);
  const printCalls = await repB.evaluate(() => {
    let n = 0;
    const orig = window.print;
    window.print = () => (n += 1);
    [...document.querySelectorAll("button")]
      .find((b) => /^print$/i.test(b.textContent.trim()))
      ?.click();
    window.print = orig;
    return n;
  });
  log.note("print-button", { printCalls });

  if (saved.docx && !saved.docx.startsWith("FAILED")) {
    execFileSync("rm", ["-rf", `${DL}/docx`]);
    execFileSync("unzip", ["-o", "-q", saved.docx, "-d", `${DL}/docx`]);
    const xml = readFileSync(`${DL}/docx/word/document.xml`, "utf8");
    const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const media = execFileSync("ls", [`${DL}/docx/word/media`])
      .toString()
      .split("\n")
      .filter(Boolean);
    const tableIdx = text.indexOf("Table of Scores");
    log.note("docx", {
      chars: text.length,
      tableOfScores: text.slice(tableIdx, tableIdx + 700),
      media,
      hasSeal: /seal/i.test(execFileSync("ls", ["-R", `${DL}/docx`]).toString()),
    });
  }
  if (saved.zip && !saved.zip.startsWith("FAILED")) {
    log.note("zip", { list: execFileSync("unzip", ["-l", saved.zip]).toString().slice(0, 1500) });
    const scoresCsv = execFileSync("sh", [
      "-c",
      `unzip -p '${saved.zip}' 'scores_*.csv' | head -5`,
    ]).toString();
    log.note("zip-scores", { scoresCsv });
  }
  if (saved.html && !saved.html.startsWith("FAILED")) {
    copyFileSync(saved.html, `${DL}/offline.html`);
    const off = await browser.newContext({ offline: true, viewport: { width: 1280, height: 800 } });
    const op = await off.newPage();
    const failures = [];
    op.on("requestfailed", (r) => failures.push(r.url().slice(0, 120)));
    await op.goto(`file://${process.cwd()}/${DL}/offline.html`);
    await op.waitForTimeout(3000);
    const offImgs = await op.evaluate(() =>
      [...document.images].map(
        (i) => `${(i.alt || i.src).slice(0, 50)} ${i.naturalWidth}x${i.naturalHeight}`,
      ),
    );
    log.note("html-offline", {
      offImgs,
      failures: failures.slice(0, 10),
      bytes: readFileSync(saved.html).length,
      title: await op.title(),
    });
    await shot(op, "report-offline-1280-light");
    await off.close();
  }
} finally {
  log.save();
  await browser.close();
}
