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
  ".js": "text/javascript; charset=utf-8",
};

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
