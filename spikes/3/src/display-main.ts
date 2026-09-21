// atlas-0 S3 spike harness page (display.html) -- window.__spike3Display, driven by Playwright.
import { runDisplayComparison } from "./display";
import { CASES } from "./cases";

declare global {
  interface Window {
    __spike3Display: {
      run(zooms: number[]): ReturnType<typeof runDisplayComparison>;
    };
  }
}

window.__spike3Display = {
  run(zooms: number[]) {
    return runDisplayComparison(CASES.click.lonMin, CASES.click.latMin, zooms);
  },
};
