// `pdf-parse` ships no type declarations of its own (fix round 1, item 2: the `page.pdf()` +
// pdf-parse gate). A minimal shim for the one call this suite makes.
declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }
  function pdfParse(data: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
