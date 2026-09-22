// parsers/xml.ts — the one DOM dependency KML and GPX share, behind an injectable seam.
//
// `@tmcw/togeojson` walks a DOM, and the browser already has one, so the app's default is the
// platform's `DOMParser` and nothing is bundled for it. Node has no `DOMParser` at all, and this
// repo's testing pyramid runs unit tests under plain node — so the parser takes the DOM factory as
// an argument instead of reaching for a global, and the tests pass `@xmldom/xmldom` (a
// devDependency; it never reaches `dist/`). That keeps "does a real KML file parse to the cells we
// expect" a fast, hermetic unit test rather than a browser spec.
export type XmlParse = (text: string) => Document;

/** the browser's own parser; throws where there is none, so a caller must inject one. */
export const domXmlParse: XmlParse = (text: string) => {
  if (typeof DOMParser === "undefined") {
    throw new Error("no XML parser in this environment (pass deps.xmlParse)");
  }
  return new DOMParser().parseFromString(text, "text/xml");
};

/**
 * Parse and reject the error document browsers hand back instead of throwing.
 *
 * `DOMParser` never throws on broken XML: it returns a document whose root is `<parsererror>`, and
 * togeojson would then quietly find no placemarks in it — a truncated download would read as "this
 * file contains no shapes" rather than as what it is.
 */
export function parseXmlStrict(text: string, parse: XmlParse): Document {
  const doc = parse(text);
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(err.textContent?.trim().split("\n")[0] || "the XML stops part way");
  if (!doc.documentElement) throw new Error("the XML has no root element");
  return doc;
}
