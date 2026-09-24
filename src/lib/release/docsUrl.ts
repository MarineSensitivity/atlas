// docsUrl.ts -- P10: where the Atlas's Help > Docs link should point.
//
// Ben opened Help > Docs on the live v7 app and landed on the documentation book's PREFACE, not
// the Atlas guide he was looking for -- the link was a plain `https://marinesensitivity.org/docs/
// {ver}/` (Shell.svelte's own `docsHref`, unchanged since U6). `docs/apps/atlas.qmd` now exists
// (docs repo, merged 49bc28b) and the book's CI publishes it per release as `apps/atlas.html`
// inside that release's own book directory -- quarto books preserve a chapter source's
// subdirectory in the rendered output 1:1, so `apps/atlas.qmd` -> `_book/apps/atlas.html`
// (`docs/.github/workflows/quarto-publish.yaml`'s `build` job; verified against `docs/_quarto.yml`,
// which lists `apps/atlas.qmd` under "Applications (Current)").
//
// The three destinations mirror `docs/libs/versioned.R`'s own `doc_docs_url()` (that file's own
// "NEVER fall back to another version's numbers" rule, applied here to a LINK instead of a figure):
//  - public:     https://marinesensitivity.org/docs/{ver}/apps/atlas.html -- GitHub Pages, staged
//    by quarto-publish.yaml's `publish` job.
//  - restricted: {previewBase}/docs/{ver}/apps/atlas.html -- the signed-in preview host. The
//    `publish` job NEVER stages a restricted release's book onto the public `gh-pages` branch at
//    all (it goes to `gh-pages-preview` instead, the sibling `publish-preview` job), so a public
//    link for v7b/v8/v9 would 404. Same shape as msens's `preview_docs_url()` (`R/ver_token.R`) +
//    `product_urls()`'s `docs` entry for a restricted release, with the chapter path appended.
//  - unknown (no `ver`, or no registry row to say public/restricted): the book's ROOT, never a
//    guessed `{ver}/apps/atlas.html` a build may not have published.
//
// Pure: no fetch, no DOM. `Shell.svelte` duplicates this by hand rather than importing it
// (tests/shell/shell-invariants.test.ts's source-scan guard: the shell never imports
// src/lib/release -- see that file's `releaseRestricted` for the same rule already applied to
// access.ts). This file is the single TESTED definition (tests/release/docsUrl.test.ts); the e2e
// assertion on the real rendered href (e2e/shell.chrome.spec.ts) is what proves Shell.svelte's
// hand-duplicate still agrees with it.
import { PREVIEW_HOST } from "./previewLink";
import type { AccessLevel } from "./access";

/** the book's root -- also the "we don't know" fallback. */
export const DOCS_ROOT = "https://marinesensitivity.org/docs/";

/** the Atlas chapter's path within a release's own book directory. */
export const ATLAS_CHAPTER_PATH = "apps/atlas.html";

/**
 * URL of `ver`'s Atlas chapter, or the book root when `ver`/`access` is not known.
 *
 * @param ver the resolved release label (e.g. `window.__early.version`), or null/undefined before
 *   it resolves.
 * @param access `"public"` | `"restricted"` | `"unknown"` -- from the SAME `versions.json` row a
 *   caller already has (`access.ts#accessOf`, or Shell.svelte's own hand-duplicated lookup).
 * @param previewBase the signed-in preview host; overridable for tests, defaults to `PREVIEW_HOST`.
 */
export function atlasDocsUrl(
  ver: string | null | undefined,
  access: AccessLevel,
  previewBase: string = PREVIEW_HOST,
): string {
  if (!ver || access === "unknown") return DOCS_ROOT;
  if (access === "restricted") return `${previewBase}/docs/${ver}/${ATLAS_CHAPTER_PATH}`;
  return `${DOCS_ROOT}${ver}/${ATLAS_CHAPTER_PATH}`;
}
