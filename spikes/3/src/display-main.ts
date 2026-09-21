// atlas-0 S3 spike harness page (display.html) -- window.__spike3Display, driven by Playwright.
import { runDisplayComparison, runInteriorGate } from "./display";
import { CASES } from "./cases";

declare global {
  interface Window {
    __spike3Display: {
      run(zooms: number[], boundsShiftCells?: number): ReturnType<typeof runDisplayComparison>;
      interiorGate(z: number, boundsShiftCells?: number): ReturnType<typeof runInteriorGate>;
    };
  }
}

window.__spike3Display = {
  run(zooms: number[], boundsShiftCells = 0) {
    return runDisplayComparison(CASES.click.lonMin, CASES.click.latMin, zooms, boundsShiftCells);
  },
  interiorGate(z: number, boundsShiftCells = 0) {
    return runInteriorGate(CASES.click.lonMin, CASES.click.latMin, z, boundsShiftCells);
  },
};
