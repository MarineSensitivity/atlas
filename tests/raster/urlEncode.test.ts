import { describe, expect, it } from "vitest";
import { encodeUrlReserved } from "../../src/lib/raster/urlEncode";

describe("encodeUrlReserved (twin of R's URLencode(x, reserved = TRUE))", () => {
  it("matches the documented worked example (parity species app.md §2.4)", () => {
    expect(encodeUrlReserved("ms_merge|WORMS:137209")).toBe("ms_merge%7CWORMS%3A137209");
  });

  it("percent-encodes a COG URL's scheme, colon and slashes", () => {
    const url =
      "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/global05/a3a8eb5ab4bec53b.tif";
    const enc = encodeUrlReserved(url);
    expect(enc).not.toContain("://");
    expect(enc).not.toContain("/");
    expect(enc).toContain("https%3A%2F%2F");
  });

  it("leaves unreserved characters (letters, digits, - _ . ~) untouched", () => {
    expect(encodeUrlReserved("abc-XYZ_123.~")).toBe("abc-XYZ_123.~");
  });

  it("escapes ! * ' ( ) — RFC 3986 reserved sub-delims that bare encodeURIComponent leaves bare", () => {
    expect(encodeURIComponent("!*'()")).toBe("!*'()"); // the JS gotcha this module exists to avoid
    expect(encodeUrlReserved("!*'()")).toBe("%21%2A%27%28%29");
  });

  it("uses uppercase hex digits", () => {
    expect(encodeUrlReserved(":")).toBe("%3A");
    expect(encodeUrlReserved("|")).toBe("%7C");
  });
});
