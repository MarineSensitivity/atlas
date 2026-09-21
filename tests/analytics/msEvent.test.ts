import { describe, expect, it } from "vitest";
import { GA_MAX_EVENT_CHARS, LOG_HEADER, msEvent } from "../../src/lib/analytics/msEvent";

describe("msEvent (port of msens::ms_event(), analytics.R:75-131)", () => {
  it("normalizes the event name: lowercase, non-alphanumerics -> '_'", () => {
    expect(msEvent("Select Species", {}).event).toBe("select_species");
  });

  it("collapses repeated underscores and trims leading/trailing ones", () => {
    expect(msEvent("  weird--event!!name  ", {}).event).toBe("weird_event_name");
  });

  it("prefixes a non-letter-leading name with 'e_'", () => {
    expect(msEvent("1_download", {}).event).toBe("e_1_download");
  });

  it(`truncates the event name to ${GA_MAX_EVENT_CHARS} characters`, () => {
    const long = "a".repeat(50);
    const name = msEvent(long, {}).event;
    expect(name).toHaveLength(GA_MAX_EVENT_CHARS);
    expect(name).toBe("a".repeat(GA_MAX_EVENT_CHARS));
  });

  it("drops null/undefined/empty-string params", () => {
    const { params } = msEvent("select_layer", {
      layer: "chl",
      subregion: null,
      unit: undefined,
      extra: "",
    });
    expect(params).toEqual({ layer: "chl" });
  });

  it("drops NaN params (R's is.na(NaN) is TRUE)", () => {
    const { params, metrics } = msEvent("select_layer", { layer: "chl", weight: NaN });
    expect(params).toEqual({ layer: "chl" });
    expect(metrics).toEqual({});
  });

  it("drops an empty array and an array of only empty/null values", () => {
    const { params } = msEvent("select_layer", { a: [], b: [null, undefined, ""] });
    expect(params).toEqual({});
  });

  it("joins a multi-value array param with ', '", () => {
    const { params } = msEvent("report_submit", { area_kinds: ["cell", "zone", "place"] });
    expect(params.area_kinds).toBe("cell, zone, place");
  });

  it("hoists n_rows/ms/status/error out of params into metrics, numeric where documented", () => {
    const { params, metrics } = msEvent("download_species_csv", {
      n_rows: 42,
      ms: 123.456,
      status: "ok",
      error: null,
      area: "GEO",
    });
    expect(params).toEqual({ area: "GEO" });
    expect(metrics).toEqual({ n_rows: 42, ms: 123.5, status: "ok" });
  });

  it("keeps a boolean/falsy-but-not-empty param (0, false are not dropped)", () => {
    const { params } = msEvent("toggle_us_only", { enabled: false, n: 0 });
    expect(params).toEqual({ enabled: "false", n: "0" });
  });

  it("defaults to an empty params bag when no raw params are given", () => {
    expect(msEvent("open_about")).toEqual({ event: "open_about", params: {}, metrics: {} });
  });
});

describe("LOG_HEADER (ms_log_header() parity, analytics.R:66-69)", () => {
  it("matches the R column order exactly", () => {
    expect(LOG_HEADER).toEqual([
      "timestamp",
      "ip",
      "session",
      "event",
      "params",
      "n_rows",
      "ms",
      "status",
      "error",
      "app_version",
      "app",
      "client_id",
      "session_id",
      "page",
      "referrer",
      "user_agent",
    ]);
  });
});
