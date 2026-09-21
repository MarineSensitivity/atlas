// entry for report.html. The real report data model and print pipeline are atlas-7; this only
// marks the page as hydrated so the Playwright smoke spec (and later scripts/verify.mjs) can tell
// the bundle actually ran, with zero console output either way.
document.getElementById("report-root")?.setAttribute("data-hydrated", "true");
