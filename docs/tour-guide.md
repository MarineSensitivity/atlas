# Regenerating the Atlas user-guide screenshots

`scripts/tour-guide.mjs` produces the images and manifest the docs repo's Atlas guide page uses.

```sh
npm run tour:guide -- --out /path/to/docs/figures/atlas-guide
# or: node scripts/tour-guide.mjs [--base https://marinesensitivity.org/atlas/] [--out <dir>]
#       [--theme dark|light] [--viewport 1280x800] [--ver v7] [--species 54247] [--no-hero]
```

- **Default base is the live site**, so the guide shows what users get. Point `--base` at a local
  `npm run preview` (`http://localhost:4386/atlas/`, never 4331) to check an unreleased build; the script then
  compares the popover on screen with this checkout's `src/shell/tour.ts`, so a live build older or newer than
  the checkout fails with a "popover text differs" message instead of documenting the wrong thing.
- **It drives the real tour**: `?tour=on`, then the popover's own Next button. Titles, texts, selectors and
  step ids come from `src/shell/tour.ts`; add or reword a step there and re-run, nothing else to edit. The
  species tour needs a species on screen, `--species` (default `54247`, the v7 Humpback Whale).
- **Outputs** in `--out`: `atlas-scores-01.png` ... `atlas-species-05.png`, `steps.json`
  (`image` = `/figures/atlas-guide/<file>`; `atlas_version` / `release` / `captured` = the build the page reported, the release it showed and the date, read from the page itself; `url` = a deep link that reproduces the step, with `ui=` for a
  rail tool), `hero-scores.png` (panel collapsed), `hero-scores-default.png`, `hero-species.png`
  (1600x1000).
- **Failure is loud**: the run exits non-zero naming the lens and step if the popover never shows the step's
  title, the anchor is not visible, driver.js highlights nothing, or the map does not settle (camera moving,
  tiles loading, a "Loading..." message or spinner on screen). Look at every PNG before committing them: the
  gate proves the page was ready, not that the picture is a good one.
