import { expect, test } from "@playwright/test";
import { blockAppBundle, hexToRgb, routeBucket, routeSealFixture, routeSession } from "./hermetic";

// atlas-3 step 3 fix round 1: "no theme flash" CANNOT FAIL as written elsewhere in this repo --
// every OTHER shell spec goes through a full hydration, and Shell.svelte's own `$effect` sets
// `document.documentElement.dataset.theme` reactively a few ms after mount, which papers over a
// broken (or entirely REMOVED) pre-paint script within one frame. Confirmed: with index.html's
// `document.documentElement.dataset.theme = theme;` line replaced by `void theme;`, every other
// chromium spec in this repo stays green, because none of them ever inspect the page before
// hydration settles. This file blocks the app bundle (`blockAppBundle`, so Shell.svelte's effect
// never runs at all) and inspects the SKELETON ALONE -- the only way to actually observe what the
// pre-paint script did or did not do before any JS-driven correction exists.
//
// tests/shell/theme-preboot.test.ts already proves the SCRIPT's own logic agrees with
// `resolveTheme()` (node:vm, the same case-table technique tests/release/inline-early-fetch.test.ts
// uses) -- this is the real-browser half: does the ACTUAL page, in an ACTUAL engine, with
// `prefers-color-scheme` actually emulated, end up with the right `data-theme` and the right
// PAINTED background before any bundle could have fixed it.

const NAVY_BG = hexToRgb("#0b1635"); // --surface-map, navy
const PAPER_BG = hexToRgb("#eaeef3"); // --surface-map, paper

interface Case {
  search: string;
  colorScheme: "dark" | "light";
  expectTheme: "navy" | "paper";
}

const CASES: Case[] = [
  { search: "", colorScheme: "dark", expectTheme: "navy" },
  { search: "", colorScheme: "light", expectTheme: "paper" },
  { search: "?theme=light", colorScheme: "dark", expectTheme: "paper" },
  { search: "?theme=dark", colorScheme: "light", expectTheme: "navy" },
  { search: "?theme=garbage", colorScheme: "dark", expectTheme: "navy" },
  { search: "?theme=garbage", colorScheme: "light", expectTheme: "paper" },
];

for (const c of CASES) {
  test(`no flash, app bundle blocked: "${c.search || "(no param)"}" + prefers-color-scheme:${c.colorScheme} -> ${c.expectTheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: c.colorScheme });
    await routeBucket(page);
    await routeSession(page, null);
    await routeSealFixture(page);
    await blockAppBundle(page); // the ONLY way to see the skeleton before any $effect can fix it

    await page.goto(`/${c.search}`);

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe(c.expectTheme);

    // the computed background must ALREADY be the resolved theme's --surface-map -- not just the
    // attribute being correct, but the CSS rule it selects actually having taken effect by the
    // time this is inspectable (i.e. before any paint a user could see).
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(c.expectTheme === "navy" ? NAVY_BG : PAPER_BG);
  });
}
