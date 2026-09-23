import { describe, expect, it } from "vitest";
import { assembleStandaloneHtml } from "../../src/report/exportHtml";

describe("assembleStandaloneHtml", () => {
  it("inlines the css and body verbatim, with an escaped title", () => {
    const html = assembleStandaloneHtml({
      title: "GAA & GAB",
      css: "body{color:red}",
      bodyHtml: "<main>hi</main>",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>GAA &amp; GAB</title>");
    expect(html).toContain("<style>body{color:red}</style>");
    expect(html).toContain("<main>hi</main>");
  });

  it("is a single self-contained document: no <link> or external <script>", () => {
    const html = assembleStandaloneHtml({ title: "t", css: "", bodyHtml: "<p>x</p>" });
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b/);
  });
});
