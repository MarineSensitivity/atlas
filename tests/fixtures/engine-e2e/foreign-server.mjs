// atlas-2 Step 3: a plain Node static file server standing in for "a cross-origin repository (the
// bucket)" (docs/engine.md's cross-origin measurement). Started/stopped directly inside
// e2e/cross-origin.spec.ts -- not through Playwright's `webServer` -- because the test needs
// per-run control over whether the server sends CORS headers at all (the whole point of the
// measurement: does a `custom_extension_repository` fetch survive a foreign origin that does, and
// does not, opt in via `Access-Control-Allow-Origin`?).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

/**
 * @param {{ port: number, dir: string, cors: boolean }} opts
 * @returns {Promise<{ close(): Promise<void> }>}
 */
export function startForeignServer({ port, dir, cors }) {
  const server = createServer(async (req, res) => {
    if (cors) res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://foreign.test").pathname);
      const filePath = path.join(dir, urlPath);
      if (!filePath.startsWith(path.resolve(dir))) throw new Error("path escapes dir");
      const st = await stat(filePath);
      if (!st.isFile()) throw new Error("not a file");
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": "application/wasm" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () =>
      resolve({ close: () => new Promise((r) => server.close(() => r())) }),
    );
  });
}
