import { describe, expect, it } from "vitest";
import { buildMapSvg, escapeXml } from "../../src/lib/download/svgWrapper";

const BASE = {
  pngDataUrl: "data:image/png;base64,AAAA",
  mapWidth: 400,
  mapHeight: 300,
  footerHeight: 46,
  footer: {
    title: "Sensitivity",
    unit: "score",
    ver: "v9",
    url: "https://x/atlas/?lyr=sensitivity",
  },
  backgroundColor: "#0a1a2f",
  footerBg: "#12233d",
  footerFg: "#f2f5f9",
  footerMuted: "#9fb0c3",
  footerBorder: "#2b3f5c",
};

describe("escapeXml", () => {
  it("escapes the five XML-significant characters", () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe(
      "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeXml("Odobenus rosmarus")).toBe("Odobenus rosmarus");
  });
});

describe("buildMapSvg", () => {
  it("sizes the document to mapHeight + footerHeight", () => {
    const svg = buildMapSvg(BASE);
    expect(svg).toContain('width="400" height="346"');
    expect(svg).toContain('viewBox="0 0 400 346"');
  });

  it("embeds the PNG as a data-URL <image>", () => {
    const svg = buildMapSvg(BASE);
    expect(svg).toContain(`href="${BASE.pngDataUrl}"`);
  });

  it("carries the footer text, escaped", () => {
    const svg = buildMapSvg({
      ...BASE,
      footer: { ...BASE.footer, title: `Species "A" & B` },
    });
    expect(svg).toContain("Species &quot;A&quot; &amp; B");
    expect(svg).not.toContain('Species "A" & B ·'); // the raw (unescaped) text must not appear
  });

  it("draws no legend when legendStops is omitted/empty", () => {
    const svg = buildMapSvg(BASE);
    expect(svg).not.toContain("linearGradient");
  });

  it("draws a gradient legend with endpoint labels when stops are given", () => {
    const svg = buildMapSvg({
      ...BASE,
      legendStops: [
        { color: "#000000", value: 0 },
        { color: "#ffffff", value: 100 },
      ],
      formatValue: (v) => String(v),
    });
    expect(svg).toContain("linearGradient");
    expect(svg).toContain(">0<");
    expect(svg).toContain(">100<");
  });

  it("is a well-formed single root <svg>...</svg> document", () => {
    const svg = buildMapSvg(BASE);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<svg /g)?.length).toBe(1);
  });
});
