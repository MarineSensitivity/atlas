// round 2, Q4: proves the two build-time flags this round wired in are actually reaching the
// PUBLISHED build. There is no way to run `.github/workflows/pages.yml` here, so this scans the
// file directly -- the same approach `tests/report/windowOpenSync.wiring.test.ts` and
// `tests/raster/ramps.wiring.test.ts` use for their own "is X really wired" gates. A build that
// silently drops either var ships a feedback control that can never send (endpoint.ts falls back
// to "no endpoint configured", src/lib/feedback/endpoint.ts) or a preview-host Atlas link pointed
// at a route atlas-9 has not deployed yet (src/lib/release/previewLink.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const PAGES_YML = readFileSync(join(ROOT, ".github/workflows/pages.yml"), "utf8");

/** the ONE `npx vite build` step whose `dist/` the `publish` job ships -- see the second
 * `describe` below for the assertion that there is no second one. Returns just that step's own
 * text (up to the next `- run:`/`- uses:`/`- name:` step marker at the same indent), so a match
 * against, say, `VITE_SEAL` can't accidentally be satisfied by some unrelated later step. */
function viteBuildStepBlock(): string {
  const idx = PAGES_YML.indexOf("- run: npx vite build");
  if (idx === -1) throw new Error("pages.yml: no `npx vite build` step found");
  const rest = PAGES_YML.slice(idx);
  const nextStepOffset = rest.slice(1).search(/\n {6}- (run|uses|name):/);
  return nextStepOffset === -1 ? rest : rest.slice(0, nextStepOffset + 1);
}

describe("pages.yml: the published build carries every VITE_* Pages variable (round 2, Q4)", () => {
  const block = viteBuildStepBlock();

  it("passes VITE_FEEDBACK_URL from the repository variable (docs/feedback.md step 5)", () => {
    expect(block).toMatch(/VITE_FEEDBACK_URL:\s*\$\{\{\s*vars\.VITE_FEEDBACK_URL\s*\}\}/);
  });

  it("passes VITE_PREVIEW_ATLAS_ROUTE from the repository variable (previewLink.ts gate)", () => {
    expect(block).toMatch(
      /VITE_PREVIEW_ATLAS_ROUTE:\s*\$\{\{\s*vars\.VITE_PREVIEW_ATLAS_ROUTE\s*\}\}/,
    );
  });

  it("still carries the existing VITE_SEAL/VITE_AGENCY lines (plan D10) -- proves this is the SAME build step, not a second one added elsewhere", () => {
    expect(block).toMatch(/VITE_SEAL:\s*"1"/);
    expect(block).toMatch(/VITE_AGENCY:\s*MMA/);
  });
});

describe("pages.yml: publish ships the checks job's OWN artifact, never a second build", () => {
  it("the publish job downloads the `dist` artifact and depends on [checks] rather than building again", () => {
    const publishBlock = PAGES_YML.slice(PAGES_YML.indexOf("\n  publish:"));
    expect(publishBlock).toMatch(/needs:\s*\[checks\]/);
    expect(publishBlock).not.toMatch(/vite build/);
    expect(publishBlock).toMatch(/download-artifact/);
  });
});
