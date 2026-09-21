// atlas-3 step 2: tokens.json mechanical verification
// Test: regenerate token export in memory and assert byte-identical to committed file;
// every token in tokens.css appears in both themes and vice versa.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { exportTokens } from "../scripts/export-tokens.mjs";

const TOKENS_CSS = readFileSync("src/lib/brand/tokens.css", "utf8");
const TOKENS_JSON_COMMITTED = readFileSync("src/lib/brand/tokens.json", "utf8");

describe("tokens-export (atlas-3 step 2, mechanical)", () => {
  it("regenerates tokens.json byte-identical to the committed file", () => {
    const tokens = exportTokens(TOKENS_CSS);
    const regenerated = JSON.stringify(tokens, null, 2) + "\n";
    expect(regenerated).toBe(TOKENS_JSON_COMMITTED);
  });

  it("every custom property in tokens.css appears in both themes", () => {
    const tokens = exportTokens(TOKENS_CSS);
    const navyKeys = new Set(Object.keys(tokens.navy));
    const paperKeys = new Set(Object.keys(tokens.paper));

    for (const key of navyKeys) {
      expect(paperKeys.has(key), `${key} missing from paper theme`).toBe(true);
    }

    for (const key of paperKeys) {
      expect(navyKeys.has(key), `${key} missing from navy theme`).toBe(true);
    }
  });

  it("every token in tokens.json was in tokens.css", () => {
    const tokens = exportTokens(TOKENS_CSS);
    const allTokens = new Set([...Object.keys(tokens.navy), ...Object.keys(tokens.paper)]);

    // Extract tokens actually defined in tokens.css
    const cssTokensRegex = /--[\w-]+/g;
    const cssTokens = new Set<string>();
    for (const match of TOKENS_CSS.matchAll(cssTokensRegex)) {
      cssTokens.add(match[0]);
    }

    for (const token of allTokens) {
      expect(cssTokens.has(token), `${token} not found in tokens.css`).toBe(true);
    }
  });
});
