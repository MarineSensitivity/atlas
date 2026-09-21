// atlas-2 Step 4: a `test` whose `context` is a real PERSISTENT browser context (its own
// `userDataDir` on disk), not Playwright's default ephemeral one.
//
// Why it matters for this gate specifically: OPFS is per-origin storage inside a browser profile.
// The default context keeps it alive across `page.reload()` within one test, which is all
// `spikes/1` needed -- but a persistent profile is what the SHIPPING situation actually is, and it
// is the only way a spec can honestly claim "the reload read the file the previous session wrote"
// rather than "the reload read the buffer the same in-memory profile still had". Each test gets its
// OWN directory, so specs stay independent and a leftover OPFS file can never leak between them.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  firefox,
  test as base,
  webkit,
  type BrowserContext,
  type BrowserType,
} from "@playwright/test";

const LAUNCHERS: Record<string, BrowserType> = { chromium, firefox, webkit };

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({ browserName, baseURL, headless }, use) => {
    const dir = mkdtempSync(join(tmpdir(), `atlas-opfs-${browserName}-`));
    const context = await LAUNCHERS[browserName].launchPersistentContext(dir, {
      baseURL,
      headless,
    });
    try {
      await use(context);
    } finally {
      await context.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export { expect } from "@playwright/test";

/** `extensions.duckdb.org` is blocked for EVERY spec in this gate: the self-hosted mirror under
 * `public/duckdb-ext/` is what must serve `parquet`, and a spec that quietly reached the CDN would
 * not be testing the shipping configuration (CLAUDE.md's DuckDB wiring rule). */
export async function blockExtensionCdn(context: BrowserContext): Promise<void> {
  await context.route("**/extensions.duckdb.org/**", (route) => route.abort());
}

/** the release bucket. Blocking it is how "reload with S3 BLOCKED" and "a corrupted file still
 * answers" are proven to read from OPFS rather than the network. */
export const S3_GLOB = "**/s3.us-east-1.amazonaws.com/**";
