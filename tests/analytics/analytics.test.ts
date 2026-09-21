import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnalytics,
  GA_MEASUREMENT_ID,
  type Analytics,
  type KeyValueStore,
} from "../../src/lib/analytics/analytics";
import type { Transport } from "../../src/lib/analytics/transport";
import type { LocationLike } from "../../src/lib/analytics/pageLocation";

function fakeTransport() {
  const sent: { url: string; body: string }[] = [];
  const transport: Transport = { send: (url, body) => void sent.push({ url, body }) };
  return { transport, sent };
}

function fakeGtag() {
  const calls: unknown[][] = [];
  return { gtag: (...args: unknown[]) => void calls.push(args), calls };
}

function fakeStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

const LOC: LocationLike = {
  origin: "https://marinesensitivity.org",
  pathname: "/atlas/",
  search: "?ver=v9",
};

let live: Analytics[] = [];
function register(a: Analytics): Analytics {
  live.push(a);
  return a;
}

afterEach(() => {
  for (const a of live) a.destroy();
  live = [];
  vi.useRealTimers();
});

describe("createAnalytics — no network call ever, in any test here (transport is always injected)", () => {
  it("sends nothing through the injected transport for a plain open_about event without a logUrl", () => {
    const { transport, sent } = fakeTransport();
    const { gtag } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "abc123",
        preview: false,
        transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: fakeStore(),
        sessionStore: fakeStore(),
      }),
    );
    a.track("open_about", {});
    a.flush();
    expect(sent).toEqual([]); // seeded fault: the beacon firing when VITE_LOG_URL is unset
  });

  it("seeded fault: the beacon never fires when logUrl is unset, even past the batch size", () => {
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
        // logUrl intentionally omitted
      }),
    );
    for (let i = 0; i < 25; i++) a.track("zoom_to_layer", {});
    a.flush();
    expect(sent).toEqual([]);
  });

  it("queues and flushes a Sheet-log row once logUrl is set, batched at 10 events", () => {
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
        now: () => 0,
      }),
    );
    for (let i = 0; i < 9; i++) a.track("zoom_to_layer", {});
    expect(sent).toEqual([]); // under the batch size, no flush yet
    a.track("zoom_to_layer", {}); // 10th event triggers an automatic flush
    expect(sent).toHaveLength(1);
    const rows = JSON.parse(sent[0].body).rows;
    expect(rows).toHaveLength(10);
    expect(rows[0].event).toBe("zoom_to_layer");
  });

  it("flushes on the 15s interval even under the batch size (fake timers)", () => {
    vi.useFakeTimers();
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("open_about", {});
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(15000);
    expect(sent).toHaveLength(1);
  });
});

describe("createAnalytics — navigator.webdriver exclusion (seeded fault)", () => {
  it("seeded fault: a webdriver session logs NOTHING to either leg, not even the GA4 config call", () => {
    const { transport, sent } = fakeTransport();
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag,
        isWebdriver: () => true, // Playwright/CI
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("select_species", {
      mdl_key: "ms_merge|WORMS:137209",
      scientific_name: "Dermochelys coriacea",
    });
    a.flush();
    expect(calls).toEqual([]); // no gtag("js", ...) / gtag("config", ...) / gtag("event", ...) at all
    expect(sent).toEqual([]);
  });

  it("a non-webdriver session DOES call gtag('config', ...) with atlas's content_group", () => {
    const { gtag, calls } = fakeGtag();
    register(
      createAnalytics({
        appVersion: "deadbee",
        preview: false,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    const configCall = calls.find((c) => c[0] === "config");
    expect(configCall).toBeDefined();
    expect(configCall?.[1]).toBe(GA_MEASUREMENT_ID);
    expect(configCall?.[2]).toMatchObject({
      content_group: "atlas",
      app_name: "atlas",
      app_version: "deadbee",
    });
  });

  it("preview: true flips content_group to 'atlas-preview'", () => {
    const { gtag, calls } = fakeGtag();
    register(
      createAnalytics({
        appVersion: "v1",
        preview: true,
        transport: fakeTransport().transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    const configCall = calls.find((c) => c[0] === "config");
    expect(configCall?.[2]).toMatchObject({ content_group: "atlas-preview" });
  });
});

describe("createAnalytics — pl/t never reach a payload via track() (end to end, seeded fault)", () => {
  it("strips a 'pl' param passed to an open place-event bag before it reaches GA4 or the beacon", () => {
    const { transport, sent } = fakeTransport();
    const { gtag, calls } = fakeGtag();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag,
        isWebdriver: () => false,
        location: () => LOC,
        clientStore: null,
        sessionStore: null,
      }),
    );
    // "count" (not "n_places") deliberately: a substring check for the stripped key name below would
    // false-positive on a param name like "n_places", which itself contains the letters "pl".
    a.track("place_share", { pl: "z.pa.1,2,3", t: "My Sensitive Report", count: 1 });
    a.flush();

    const eventCall = calls.find((c) => c[0] === "event");
    expect(eventCall).toBeDefined();
    const gaParams = eventCall?.[2] as Record<string, unknown>;
    expect(gaParams).not.toHaveProperty("pl");
    expect(gaParams).not.toHaveProperty("t");
    expect(JSON.stringify(gaParams)).not.toContain('"pl"');
    expect(JSON.stringify(gaParams)).not.toContain("z.pa.1");
    expect(JSON.stringify(gaParams)).not.toContain("My Sensitive Report");

    expect(sent).toHaveLength(1);
    const row = JSON.parse(sent[0].body).rows[0];
    expect(row.params).not.toContain('"pl"');
    expect(row.params).not.toContain("z.pa.1");
    expect(row.params).not.toContain("My Sensitive Report");
  });
});

describe("createAnalytics — the queued row's page never carries the hash", () => {
  it("uses buildPagePath(location) for the Sheet log's page column", () => {
    const { transport, sent } = fakeTransport();
    const a = register(
      createAnalytics({
        appVersion: "v1",
        preview: false,
        logUrl: "https://log.example.test/exec",
        transport,
        gtag: fakeGtag().gtag,
        isWebdriver: () => false,
        location: () => ({ ...LOC, search: "?ver=v9&secret=xyz" }),
        clientStore: null,
        sessionStore: null,
      }),
    );
    a.track("open_about", {});
    a.flush();
    const row = JSON.parse(sent[0].body).rows[0];
    expect(row.page).toBe("/atlas/?ver=v9");
    expect(row.page).not.toContain("secret");
  });
});
