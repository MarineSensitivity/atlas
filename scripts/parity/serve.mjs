#!/usr/bin/env node
// scripts/parity/serve.mjs -- a static server over the local mirror, on port 4441.
//
// The `app/` objects are not on S3 yet, so the browser half of the parity gate
// (`tests/fixtures/parity-e2e/`) fetches them from here instead. The layout IS the bucket's
// (`{ver}/app/…`, `{ver}/serve/…`, `{ver}/tables/…`), the base URL is a parameter on both sides,
// and CORS is answered `*` the way the bucket answers it -- so when the push happens the only thing
// that changes is the string.
//
// Read-only: GET and HEAD, nothing else, and every path is resolved and then checked to still be
// inside the mirror (a symlinked mirror is exactly where `..` would otherwise escape).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ensureMirror } from "./mirror.mjs";

const TYPES = {
  ".json": "application/json",
  ".parquet": "application/vnd.apache.parquet",
  ".txt": "text/plain; charset=utf-8",
};

export function startServer({ root, port = 4441 }) {
  const base = fs.realpathSync(root);
  const server = http.createServer((req, res) => {
    const send = (code, body = "") => {
      res.writeHead(code, {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405);

    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    let file;
    try {
      file = fs.realpathSync(path.join(base, rel));
    } catch {
      return send(404, "not found");
    }
    if (file !== base && !file.startsWith(`${base}${path.sep}`)) {
      // a symlink that points out of the mirror: the mirror's OWN top-level links do exactly that
      // on purpose, so compare against their resolved targets rather than refusing outright
      const allowed = topLevelTargets(base);
      if (!allowed.some((a) => file === a || file.startsWith(`${a}${path.sep}`)))
        return send(403, "outside the mirror");
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return send(404, "not found");
    }
    if (!stat.isFile()) return send(404, "not a file");

    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "content-length": stat.size,
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/** the resolved targets of the mirror's own symlinks -- the only places outside it that may serve. */
function topLevelTargets(base) {
  const out = [];
  for (const ver of fs.readdirSync(base)) {
    for (const sub of ["app", "serve", "tables", "serve/cell_model"]) {
      try {
        out.push(fs.realpathSync(path.join(base, ver, sub)));
      } catch {
        /* not present for this version */
      }
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const vers = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const root = ensureMirror(vers.length ? vers : ["v9", "v7"]);
  const port = Number(process.env.PARITY_PORT ?? 4441);
  await startServer({ root, port });
  console.log(`parity data server: http://127.0.0.1:${port}/  (${root})`);
}
