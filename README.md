# atlas

The MarineSensitivity Atlas at https://marinesensitivity.org/atlas/ (reviewer previews at
https://preview.marinesensitivity.org/{ver}/atlas/).

Its code lives in [oceanmetrics/atlas](https://github.com/oceanmetrics/atlas) as the
`marinesensitivity` instance (`instances/marinesensitivity/`); this repository only publishes it.
`.github/workflows/pages.yml` builds oceanmetrics/atlas at the tag in `PIN` with that repository's
reusable `build-instance.yml` and publishes the result to `gh-pages` (branch-based Pages, the same
branch the preview host's sidecar pulls).

## What is here

| file                          | what it is                                                              |
| ----------------------------- | ----------------------------------------------------------------------- |
| `PIN`                         | the oceanmetrics/atlas tag the site is built from (`v0.5.0`)            |
| `.github/workflows/pages.yml` | the one workflow: a pin check, then the reusable build and the publish  |
| `feedback/`                   | the screenshots the in-app "Send feedback" commits (linked from issues) |
| `CHANGELOG.md`                | this repository's versions (0.11.0 on is the thin repo)                 |
| `LICENSE`                     | MIT                                                                     |

## How it builds

- **On a push to `main`** (or Actions -> Pages -> Run workflow on `main`) the `pin` job checks that
  `PIN`, the `uses: ...@<tag>` line and the `ref: <tag>` input in `pages.yml` name one tag and that
  the `VITE_GA_ID` variable is set, then `build-instance.yml` checks out oceanmetrics/atlas at that
  tag, runs the instance's unit tests, builds with `VITE_INSTANCE=marinesensitivity`, holds the dist
  to the instance's size budget and dist checks, and publishes it to `gh-pages` with this
  repository's own `GITHUB_TOKEN` (no cross-org secret). The `gh-pages` commit message names the
  oceanmetrics/atlas commit built.
- **On a pull request** the same build runs without publishing.
- Commits that touch only `feedback/` or Markdown do not build.

## Repository variables

Settings -> Secrets and variables -> Actions -> Variables. All public (they ship in the bundle).

| variable                   | what it is                                                       |
| -------------------------- | ---------------------------------------------------------------- |
| `VITE_FEEDBACK_URL`        | the feedback Apps Script `/exec` URL                             |
| `VITE_LOG_URL`             | the Sheet-log beacon URL                                         |
| `VITE_PREVIEW_ATLAS_ROUTE` | `1` once the preview host serves `/{ver}/atlas/`                 |
| `VITE_GA_ID`               | the GA4 measurement id, `G-9HW6L751XG`; the run fails when unset |

`VITE_SEAL: "1"` (the MMA seal) is set in `pages.yml` itself.

## Moving the pin

A new oceanmetrics/atlas release (`vX.Y.Z`, tagged there after its gate) reaches marinesensitivity.org
only when this repository moves to it: change the tag in `PIN`, in the `uses: ...@vX.Y.Z` line and in
`ref: vX.Y.Z`, in one commit (a pull request builds it first). The `pin` job refuses a run where the
three disagree. Going back is the same edit to the older tag.

## Feedback

The in-app "Send feedback" files issues in this repository and commits each screenshot to `main`
under `feedback/`; the issues link those files on `main`, so `feedback/` stays.

## History and rollback

The standalone atlas (Svelte source, tests, docs and CI, to 0.10.93) is the tag `v0.10.93` and the
branch `archive/0.10.93` (`57d53be`).

To go back to it:

- **Revert the thin-repo merge** on `main` (`git revert -m 1 <merge>`): the old `pages.yml` returns
  and its push rebuilds and republishes the 0.10.93 site; or
- **Restore the tree** from the archive: `git checkout archive/0.10.93 -- .` on a branch from
  `main`, commit, merge; or
- **Republish the last 0.10.93 build** without a rebuild: reset `gh-pages` to its commit
  `edf16b2` ("deploy: 57d53be...") and force-push it (Pages serves whatever `gh-pages` holds).
