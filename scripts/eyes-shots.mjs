// scripts/eyes-shots.mjs -- eyes-on screenshots of a LOCAL preview build: the states a person looks at,
// phone (390x844 @2x) + desktop (1280x800), dark theme. Part of every merge since 2026-09-24 (Ben found
// seven obvious phone bugs on a tree every automated gate had passed).
//   npm run build && npx vite preview --port 4386 --strictPort &
//   ATLAS_URL=http://localhost:4386 OUT=.tmp/eyes [ONLY=map,layers] node scripts/eyes-shots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const BASE = process.env.ATLAS_URL ?? "http://localhost:4380/atlas";
const OUT = process.env.OUT ?? ".tmp/eyes";
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = {
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function go(page, search) {
  await page.goto(`${BASE}/${search}`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForTimeout(4000);
}
async function explore(page) {
  const b = page.getByRole("button", { name: /^explore$/i }).first();
  try {
    await b.waitFor({ state: "visible", timeout: 8000 });
    await b.click();
    await page.waitForTimeout(500);
  } catch {
    /* no welcome modal on this load (deep link or already dismissed) */
  }
}
async function tool(page, name) {
  await page.getByRole("button", { name, exact: true }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(3000);
}
async function sheet(page, name) {
  const b = page.getByRole("button", { name, exact: true }).first();
  if (await b.count()) {
    await b.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
}
async function tapScoredCell(page, vp) {
  // a point in the Gulf of Alaska / California Current after the padded first view; try a few
  const pts =
    vp === "phone"
      ? [
          [150, 470],
          [120, 330],
          [90, 300],
        ]
      : [
          [335, 400],
          [490, 585],
          [600, 520],
        ];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(2500);
  }
}
async function shot(page, vp, name) {
  const p = `${OUT}/${vp}-${name}.png`;
  await page.screenshot({ path: p, timeout: 30_000 });
  log("shot", p);
}
const STATES = [
  {
    id: "welcome",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await shot(p, vp, "01-welcome");
    },
  },
  {
    id: "map",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await shot(p, vp, "02-map");
    },
  },
  {
    id: "layers",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tool(p, "Layers");
      await shot(p, vp, "03-layers-half");
      await sheet(p, "Full height");
      await shot(p, vp, "04-layers-full");
    },
  },
  {
    id: "legend",
    run: async (p, vp) => {
      if (vp !== "phone") return;
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      const c = p.locator(".legend-chip").first();
      if (await c.count()) {
        await c.click();
        await p.waitForTimeout(800);
        await shot(p, vp, "05-legend-modal");
      } else log("no legend chip");
    },
  },
  {
    id: "flower",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tapScoredCell(p, vp);
      await tool(p, "Flower plot");
      await shot(p, vp, "06-flower-half");
      const petal = p.locator("svg path[role=button], svg [data-component], svg path").nth(3);
      await petal.click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(600);
      await shot(p, vp, "07-flower-petal");
      await sheet(p, "Full height");
      await shot(p, vp, "08-flower-full");
    },
  },
  {
    id: "table",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tapScoredCell(p, vp);
      await tool(p, "Table");
      await shot(p, vp, "09-table-half");
      await sheet(p, "Full height");
      await p.waitForTimeout(1500);
      await shot(p, vp, "10-table-full");
    },
  },
  {
    id: "places",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      await tool(p, "Places");
      await shot(p, vp, "11-places");
      await sheet(p, "Full height");
      await shot(p, vp, "12-places-full");
    },
  },
  {
    id: "report",
    run: async (p, vp) => {
      await go(p, "?ver=v7&theme=dark#pl=z.pa.GAA&t=Gulf%20of%20Alaska%20Program%20Area");
      await explore(p);
      await tool(p, "Report");
      await sheet(p, "Full height");
      await p.waitForTimeout(6000);
      await shot(p, vp, "13-report-top");
      await p.mouse.wheel(0, 1400);
      await p.waitForTimeout(800);
      await shot(p, vp, "14-report-scrolled");
      await p.mouse.wheel(0, 1400);
      await p.waitForTimeout(800);
      await shot(p, vp, "15-report-scrolled2");
    },
  },
  {
    id: "more",
    run: async (p, vp) => {
      if (vp !== "phone") return;
      await go(p, "?ver=v7&theme=dark");
      await explore(p);
      const b = p.getByRole("button", { name: "More" }).first();
      if (await b.count()) {
        await b.click();
        await p.waitForTimeout(600);
        await shot(p, vp, "16-more-menu");
      }
    },
  },
  {
    id: "species",
    run: async (p, vp) => {
      await go(p, "?ver=v7&lens=species&theme=dark");
      await explore(p);
      await shot(p, vp, "17-species");
      await go(p, "?ver=v7&lens=species&mdl_seq=54383&theme=dark");
      await explore(p);
      await p.waitForTimeout(6000);
      await shot(p, vp, "18-species-model");
    },
  },
];
const browser = await chromium.launch();
for (const [vp, opts] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ ...opts, colorScheme: "dark" });
  for (const st of STATES) {
    if (only.length && !only.includes(st.id)) continue;
    const page = await ctx.newPage();
    try {
      await st.run(page, vp);
    } catch (e) {
      log("FAIL", vp, st.id, String(e).split("\n")[0]);
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
log("done");
