// "Only the chosen name survives from the file's properties; nothing from a file is ever inserted
// as HTML" (atlas-6 Deliverable 4), and the subplan's hostile-input gate: "a feature named
// `<img src=x onerror=…>` renders as text".
//
// THE ASSERTION IS BYTE-IDENTITY, AND THAT IS THE POINT. The defence against a name like this is
// that the panel binds it as TEXT (Svelte's `{name}`), never as HTML — so the normalizer must hand
// back the characters the file contained and nothing else. Escaping here would be a second
// encoding: bound as text it renders VISIBLY as `&lt;img src=x onerror=alert(1)&gt;`, which is a
// bug of its own, and bound as HTML it would be no safer. So the name is plain text, unescaped, and
// this file is the gate that keeps it that way in both directions.
import { describe, expect, it } from "vitest";
import { normalizeUpload, plainText } from "../../../src/lib/geo/upload/normalize";
import { HTML_NAME, htmlNamedPolygon } from "./hostile";
import { textBytes } from "./support";

const nameFrom = async (text: string, nameProperty: string | null) => {
  const r = await normalizeUpload(
    { name: "danger.geojson", bytes: textBytes(text) },
    { nameProperty },
  );
  if (!r.ok) throw new Error(r.refusal.rule);
  return r.places[0].name;
};

describe("a name out of an untrusted file", () => {
  it("comes back byte-identical, NOT escaped", async () => {
    const got = await nameFrom(htmlNamedPolygon(), "name");
    expect(got).toBe(HTML_NAME);
    expect(got).toBe("<img src=x onerror=alert(1)>");
    expect([...got].map((c) => c.charCodeAt(0))).toEqual(
      [...HTML_NAME].map((c) => c.charCodeAt(0)),
    );
    // the two ways this could silently go wrong
    expect(got).not.toContain("&lt;");
    expect(got).not.toContain("&amp;");
  });

  it("is a string, never markup the panel could be tempted to insert", async () => {
    expect(typeof (await nameFrom(htmlNamedPolygon(), "name"))).toBe("string");
  });

  it("survives a round trip through JSON unchanged (the link, the report, the download)", async () => {
    const got = await nameFrom(htmlNamedPolygon(), "name");
    expect(JSON.parse(JSON.stringify({ n: got })).n).toBe(HTML_NAME);
  });

  it("strips control characters, which are neither text nor markup", () => {
    expect(plainText("a\u0000b\u001fc")).toBe("a b c");
    expect(plainText("a\u007fb")).toBe("a b");
  });

  it("leaves every other character alone, including quotes, angle brackets and emoji", () => {
    for (const s of ['he said "hi"', "<b>", "a & b", "'; DROP TABLE places;--", "Bahía 🐋"]) {
      expect(plainText(s)).toBe(s);
    }
  });

  it("caps at 60 characters without cutting mid-escape or leaving trailing space", () => {
    const long = `${"a".repeat(59)}   tail`;
    expect(plainText(long)).toBe("a".repeat(59));
  });
});
