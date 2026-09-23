// A PERMANENT red case for `docs/parity.html`'s consistency rule (atlas-8 step 5 / Deliverable 2).
//
// The one thing this page must never do is call a checklist line "done" on the strength of a test
// that does not exist. This fixture is exactly that mistake, frozen: `S-01` claims `done` while its
// evidence says "no test". `tests/parity-page/checklist.test.ts` asserts that `checkConsistency()`
// flags it — if that assertion ever goes green, the check has stopped checking.
//
// Shaped to match `tests/fixtures/parity-page/sample-checklist.md`'s first two rows.

/**
 * Typed with the generator's own exported shape, so this fixture is checked against the real
 * contract (`status` is the four-value union, not a bare string) instead of drifting from it.
 *
 * @type {Record<string, import("../../../scripts/parity-page/status.mjs").StatusEntry>}
 */
export const FAULTY_STATUS = {
  "S-01": {
    match: "Study area: FULL / AK presets",
    status: "done",
    evidence: [{ file: "no test", name: "" }],
    note: "the seeded fault: done, with nothing asserting it",
  },
  "S-02": {
    match: "Spatial units: Raster cells",
    status: "partial",
    evidence: [{ file: "no test", name: "" }],
    note: "partial + 'no test' is HONEST, not a fault — only `done` may not say 'no test'",
  },
  "S-03": {
    match: "One PMTiles source + outline per unit",
    status: "done",
    evidence: [
      { file: "tests/map/zones.test.ts", name: "programarea: white, 1 px, opacity 1, solid" },
    ],
  },
  "S-04": {
    match: "Zone branch: ALL zones of the unit",
    status: "deferred",
    evidence: [{ file: "no test", name: "" }],
  },
};

/**
 * The same table with the fault repaired — the control case, so the test proves the rule fires on
 * the fault rather than on anything about this fixture.
 *
 * @type {Record<string, import("../../../scripts/parity-page/status.mjs").StatusEntry>}
 */
export const FIXED_STATUS = {
  ...FAULTY_STATUS,
  "S-01": {
    ...FAULTY_STATUS["S-01"],
    evidence: [{ file: "tests/map/interaction.test.ts", name: "flyToStudyArea" }],
  },
};
