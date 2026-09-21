// plan D6 / atlas-0 CI: dist/ must never contain a session.json. That file existing same-origin is
// the ONLY thing that switches the app into preview mode (src/lib/release/session.ts); it must be
// answered exclusively by the preview host's Caddy, never shipped as part of the public build.
import { existsSync } from "node:fs";
import { join } from "node:path";

/** @param {(path: string) => boolean} exists injected for testability */
export function distHasSessionJson(distDir, exists = existsSync) {
  return exists(join(distDir, "session.json"));
}
