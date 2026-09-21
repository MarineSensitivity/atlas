// Drift guard: index.html's inline early-fetch script is a hand-kept plain-JS copy of
// src/lib/release/{version,session}.ts (it has to run before any bundle parses, so it cannot
// `import` them). Nothing stops the two from silently diverging — so this test extracts the
// ACTUAL script text from the built source file, runs it for real in a node:vm sandbox with a
// stubbed location/fetch, and drives it through the same cases as version.test.ts and
// session.test.ts. A change to either copy that isn't mirrored in the other must fail here.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { VERSION_RE } from "../../src/lib/release/version";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function extractEarlyFetchScript(html: string): string {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes("VERSION_RE"));
  if (!found) throw new Error("no inline script containing VERSION_RE found");
  return found;
}

function extractInlineVersionRe(script: string): RegExp {
  const m = /var VERSION_RE\s*=\s*(\/(?:\\.|[^\\/])*\/[a-z]*)\s*;/.exec(script);
  if (!m) throw new Error("VERSION_RE literal not found in inline script");
  // m[1] is a regex literal captured from our own index.html, not external input.
  return eval(m[1]);
}

interface MockRoute {
  reject?: boolean;
  ok?: boolean;
  status?: number;
  textBody?: string;
  jsonBody?: unknown;
  jsonThrows?: boolean;
}

function makeFetch(routes: Record<string, MockRoute>) {
  return async (url: string) => {
    const r = routes[url] ?? { ok: false, status: 404 };
    if (r.reject) throw new Error("network error");
    return {
      ok: r.ok ?? true,
      status: r.status ?? (r.ok ? 200 : 404),
      text: async () => r.textBody ?? "",
      json: async () => {
        if (r.jsonThrows) throw new Error("bad json");
        return r.jsonBody;
      },
    };
  };
}

interface Early {
  version: Promise<string | null>;
  versions: Promise<unknown>;
  session: Promise<{ preview: boolean }>;
  manifest: Promise<unknown>;
  boot: Promise<unknown>;
}

function runEarlyFetch(
  script: string,
  opts: { pathname: string; search: string; routes?: Record<string, MockRoute> },
): Early {
  const sandbox: { window?: unknown; location: unknown; fetch: unknown; URLSearchParams: unknown } =
    {
      location: { pathname: opts.pathname, search: opts.search },
      fetch: makeFetch(opts.routes ?? {}),
      URLSearchParams,
    };
  sandbox.window = sandbox;
  const ctx = createContext(sandbox);
  runInContext(script, ctx);
  return (sandbox.window as { __early: Early }).__early;
}

const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const script = extractEarlyFetchScript(html);

describe("index.html's inline VERSION_RE literal", () => {
  it("equals src/lib/release/version.ts's VERSION_RE.source exactly", () => {
    expect(extractInlineVersionRe(script).source).toBe(VERSION_RE.source);
  });
});

describe("report.html has no early-fetch script to drift", () => {
  it("does not define VERSION_RE (nothing to keep in sync)", () => {
    const reportHtml = readFileSync(resolve(ROOT, "report.html"), "utf8");
    expect(reportHtml).not.toContain("VERSION_RE");
  });
});

describe("inline early-fetch script: version resolution (mirrors tests/release/version.test.ts)", () => {
  it("path beats query beats latest.txt", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/v9/atlas/",
      search: "?ver=v3",
      routes: { "latest.txt": { ok: true, textBody: "v6" } },
    });
    await expect(early.version).resolves.toBe("v9");
  });

  it("query beats latest.txt when the path has no version", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "?ver=v3",
      routes: { "latest.txt": { ok: true, textBody: "v6" } },
    });
    await expect(early.version).resolves.toBe("v3");
  });

  it("falls back to latest.txt when neither path nor query name a version", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "latest.txt": { ok: true, textBody: "v7" } },
    });
    await expect(early.version).resolves.toBe("v7");
  });

  it("a malformed path/query value falls through rather than being accepted (v9ab: the [a-z]? vs [a-z]* case)", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/v9ab/atlas/",
      search: "?ver=v9ab",
      routes: { "latest.txt": { ok: true, textBody: "v7" } },
    });
    await expect(early.version).resolves.toBe("v7");
  });

  it("a malformed latest.txt body resolves to null, never propagated as a version", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "latest.txt": { ok: true, textBody: "not-a-version" } },
    });
    await expect(early.version).resolves.toBeNull();
  });

  it("latest.txt unreachable (network error) resolves to null, not a throw", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "latest.txt": { reject: true } },
    });
    await expect(early.version).resolves.toBeNull();
  });
});

describe("inline early-fetch script: session/preview mode (mirrors tests/release/session.test.ts)", () => {
  it("a 404 is public", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "session.json": { ok: false, status: 404 } },
    });
    await expect(early.session).resolves.toEqual({ preview: false });
  });

  it("a network error is public", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "session.json": { reject: true } },
    });
    await expect(early.session).resolves.toEqual({ preview: false });
  });

  it("a 200 without preview:true is public", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "session.json": { ok: true, jsonBody: { preview: false } } },
    });
    await expect(early.session).resolves.toEqual({ preview: false });
  });

  it("a 200 with an empty body is public", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "session.json": { ok: true, jsonBody: {} } },
    });
    await expect(early.session).resolves.toEqual({ preview: false });
  });

  it("only a 200 with preview:true is preview", async () => {
    const early = runEarlyFetch(script, {
      pathname: "/atlas/",
      search: "",
      routes: { "session.json": { ok: true, jsonBody: { preview: true } } },
    });
    await expect(early.session).resolves.toEqual({ preview: true });
  });
});
