// atlas-3: the three static mockups are plain files under docs/, but they load tokens.css and the
// motif masks by relative path, and a CSS mask never resolves under file://. So both the screenshot
// run and the axe run serve the repo root over http on 4371-4379 — no framework, no dev server.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".js": "text/javascript; charset=utf-8",
};

// The MMA seal is READ-ONLY brand material in another repo and 897 KB with embedded rasters: it is
// never copied into this repo, never bundled, and never in the critical path (D10 + guide p. 4). The
// About-card mockup borrows it through this one review-only alias, so the screenshots show the real
// seal at its real proportions. If the file is not present the <img> falls back to its alt text.
export const SEAL_ALIAS = "/seal/mma-seal.svg";
const SEAL_SOURCE =
  "/Users/bbest/Github/MarineSensitivity/MarineSensitivity.github.io/branding/MMA logo.svg";

/**
 * @param {number} port
 * @param {string} rootDir
 * @returns {Promise<{ port: number, origin: string, close: () => Promise<void> }>}
 */
export function serveStatic(port = 4371, rootDir = ".") {
  const root = resolve(rootDir);
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    if (`/${rel.replace(/^[/\\]+/, "")}` === SEAL_ALIAS) {
      try {
        await stat(SEAL_SOURCE);
        res.writeHead(200, { "content-type": "image/svg+xml" });
        createReadStream(SEAL_SOURCE).pipe(res);
      } catch {
        res.writeHead(404).end("the seal source is not available on this machine");
      }
      return;
    }
    const file = join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const s = await stat(file);
      if (s.isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () =>
      ok({
        port,
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    );
  });
}

/** The review matrix: three mockups × two themes, at the two viewports verify.mjs uses. */
export const MOCKUPS = [
  { name: "scores-desktop", file: "scores-desktop.html", width: 1280, height: 800 },
  { name: "species-desktop", file: "species-desktop.html", width: 1280, height: 800 },
  { name: "phone-sheet-half", file: "phone-sheet-half.html", width: 390, height: 844 },
];

export const THEMES = ["navy", "paper"];

export const mockupUrl = (origin, file, theme) =>
  `${origin}/docs/design/mockups/${file}?theme=${theme}`;

/**
 * Round 2 (U0 usability, docs/usability.md): the R1–R5 decision mockups. One page, `r2/shell.html`,
 * renders every option from its query string; `r2/brand.html` is the R5 mark + palette sheet.
 * `shot` is the JPEG name under docs/usability/ (scripts/mockup-shots-r2.mjs); the axe run
 * (`node scripts/axe-mockups.mjs --set=r2`) iterates the same list.
 */
const R1 = "r2/shell.html?chrome=proposed&rail=stack&layers=stack&notes=r1";
export const R2_MOCKUPS = [
  {
    shot: "mock-r1-dock-right-1280-dark",
    file: `${R1}&panel=dock&dock=right`,
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r1-dock-full-1280-dark",
    file: `${R1}&panel=dock&dock=full&tool=table`,
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r1-float-1280-dark",
    file: `${R1}&panel=float`,
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r1-dock-390-dark",
    file: `${R1}&panel=dock`,
    width: 390,
    height: 844,
    theme: "navy",
  },
  {
    shot: "mock-r1-float-390-dark",
    file: `${R1}&panel=float`,
    width: 390,
    height: 844,
    theme: "navy",
  },
  {
    shot: "mock-r2-about-1280-dark",
    file: "r2/shell.html?chrome=proposed&rail=stack&layers=stack&open=about&notes=r2",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r2-feedback-1280-dark",
    file: "r2/shell.html?chrome=proposed&rail=stack&layers=stack&open=feedback&notes=r2",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r3-split-1280-dark",
    file: "r2/shell.html?chrome=proposed&rail=stack&layers=split&notes=r3",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r3-tabs-1280-dark",
    file: "r2/shell.html?chrome=proposed&rail=stack&layers=tabs&notes=r3",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r3-stack-1280-dark",
    file: "r2/shell.html?chrome=proposed&rail=stack&layers=stack&notes=r3",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r4-hex-1280-dark",
    file: "r2/shell.html?chrome=proposed&rail=hex&layers=stack&notes=r4",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r4-stack-1280-dark",
    file: "r2/shell.html?chrome=proposed&rail=stack&layers=stack&notes=r4",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-r4-top-1280-light",
    file: "r2/shell.html?chrome=proposed&rail=top&layers=stack&notes=r4",
    width: 1280,
    height: 800,
    theme: "paper",
  },
  {
    shot: "mock-r5-brand-1280-dark",
    file: "r2/brand.html",
    width: 1280,
    height: 900,
    theme: "navy",
  },
  {
    shot: "mock-r5-brand-1280-light",
    file: "r2/brand.html",
    width: 1280,
    height: 900,
    theme: "paper",
  },
  {
    shot: "mock-proposed-1280-dark",
    file: "r2/shell.html?panel=dock&dock=right&rail=stack&chrome=proposed&layers=stack&mark=wavehex&notes=proposed",
    width: 1280,
    height: 800,
    theme: "navy",
  },
  {
    shot: "mock-proposed-1280-light",
    file: "r2/shell.html?panel=dock&dock=right&rail=stack&chrome=proposed&layers=stack&mark=wavehex&tokens=y1&notes=proposed",
    width: 1280,
    height: 800,
    theme: "paper",
  },
  {
    shot: "mock-proposed-390-dark",
    file: "r2/shell.html?panel=dock&rail=stack&chrome=proposed&layers=stack&mark=wavehex&notes=proposed",
    width: 390,
    height: 844,
    theme: "navy",
  },
];

/** an R2 entry's URL: its own query string plus the theme (the page's pre-paint script reads it). */
export const r2MockupUrl = (origin, entry) =>
  `${origin}/docs/design/mockups/${entry.file}${entry.file.includes("?") ? "&" : "?"}theme=${entry.theme}`;
