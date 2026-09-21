#!/usr/bin/env node
// Usage: node scripts/check-dist-session.mjs [distDir=dist]
import { distHasSessionJson } from "./check-dist-session-core.mjs";

const distDir = process.argv[2] ?? "dist";

if (distHasSessionJson(distDir)) {
  process.stderr.write(
    `check-dist-session: FAIL — "${distDir}/session.json" exists. That file must only ever be answered ` +
      `by the preview host's Caddy (plan D6); its presence in the public build would switch the app into ` +
      `preview mode for everyone.\n`,
  );
  process.exit(1);
}

process.stdout.write(`check-dist-session: PASS — no session.json in "${distDir}"\n`);
