/**
 * Export custom properties from tokens.css per theme as a deterministic JSON file.
 * Resolves var() references and outputs sorted keys with stable formatting.
 *
 * Usage:
 *   node scripts/export-tokens.mjs
 *
 * Outputs:
 *   src/lib/brand/tokens.json
 *
 * The test `tests/brand-tokens.test.ts` regenerates this in memory and asserts
 * it is byte-identical to the committed file, ensuring a token change without
 * re-export fails the build.
 */

import { readFileSync, writeFileSync } from "node:fs";

const TOKENS_CSS = "src/lib/brand/tokens.css";
const OUTPUT_FILE = "src/lib/brand/tokens.json";

/**
 * Parse CSS to extract custom properties and their values.
 * Returns a map of property names to their values within a given selector block.
 */
function parseCSSBlock(css, selectorRegex) {
  const matches = css.match(new RegExp(selectorRegex + "\\s*\\{([^}]*)", "s"));
  if (!matches) return new Map();

  const props = new Map();
  const blockContent = matches[1];
  const propRegex = /--[\w-]+\s*:\s*([^;]*?)\s*;/g;

  let match;
  while ((match = propRegex.exec(blockContent)) !== null) {
    const propName = match[0].split(":")[0].trim();
    const propValue = match[1].trim();
    props.set(propName, propValue);
  }

  return props;
}

/**
 * Resolve var() references by recursively looking up custom properties.
 * Handles fallback values: var(--prop, fallback)
 */
function resolveValue(value, props) {
  const varRegex = /var\(--[\w-]+(?:,\s*[^)]*?)?\)/g;

  return value.replace(varRegex, (varCall) => {
    const match = varCall.match(/var\((--[\w-]+)(?:,\s*([^)]*))?/);
    if (!match) return varCall;

    const [, propName, fallback] = match;
    const resolvedValue = props.get(propName);

    if (resolvedValue) {
      return resolveValue(resolvedValue, props);
    }

    return fallback ? fallback.trim() : varCall;
  });
}

/**
 * Export tokens per theme by merging :root with theme-specific rules.
 * Exported so tests can regenerate in memory.
 */
export function exportTokens(css) {
  // Parse :root (shared) properties
  const sharedProps = parseCSSBlock(css, ":root(?!\\[)");

  // Parse navy theme (includes :root and :root[data-theme="navy"])
  const navyPropsOverride = parseCSSBlock(css, ':root\\[?data-theme="navy"\\]?');
  const navyProps = new Map([...sharedProps, ...navyPropsOverride]);

  // Parse paper theme
  const paperPropsOverride = parseCSSBlock(css, ':root\\[data-theme="paper"\\]');
  const paperProps = new Map([...sharedProps, ...paperPropsOverride]);

  // Resolve all var() references for each theme
  const resolveTheme = (props) => {
    const resolved = new Map();
    for (const [name, value] of props) {
      resolved.set(name, resolveValue(value, props));
    }
    return resolved;
  };

  const navyResolved = resolveTheme(navyProps);
  const paperResolved = resolveTheme(paperProps);

  // Convert to sorted objects
  const sortedTheme = (props) => {
    const obj = {};
    for (const [name, value] of [...props.entries()].sort()) {
      obj[name] = value;
    }
    return obj;
  };

  return {
    navy: sortedTheme(navyResolved),
    paper: sortedTheme(paperResolved),
  };
}

/**
 * Main export logic - runs only when script is executed directly
 */
function main() {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const tokens = exportTokens(css);

  // Pretty-print with 2-space indent for stable formatting
  const json = JSON.stringify(tokens, null, 2) + "\n";

  writeFileSync(OUTPUT_FILE, json, "utf8");
  console.log(`✓ exported tokens to ${OUTPUT_FILE}`);
}

// Run only when executed directly, not when imported
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
