<script lang="ts">
  // R5 (docs/usability.md §7): the wave-in-hexagon mark, replacing the "wave in a circle" that
  // read as a generic weather icon at 28px (usability screenshot: scores-default-1280-dark.jpg
  // top-left). Path data is the R5 candidate (docs/design/candidates/mark-wave-hex.svg /
  // docs/design/mockups/r2/brand.html's `#mark-wavehex` symbol), traced from the SAME wave motif
  // `server/branding/make_branding.py` draws for every other product mark (that generator is the
  // source of truth for the brand's wave shape; this component only re-shapes its clip to a
  // pointy-top hexagon instead of a disc, per the R5 decision -- it is not hand-invented here).
  //
  // Inline (not an <img src=...>) so its fill/stroke read live CSS custom properties -- ONE
  // definition serves both themes, unlike the old two-file mst-mark.svg/mst-mark-dark.svg pair.
  // Decorative in both places it is used (the top bar sits next to an <h1> that already names the
  // app; the report header sits next to its own title) -- aria-hidden, no accessible name of its
  // own, matching the old `<img alt="">` it replaces.
  interface Props {
    /** CSS px, both width and height (viewBox is square). */
    size?: number;
    class?: string;
  }

  let { size = 28, class: klass = "" }: Props = $props();
</script>

<svg
  class="wavehex {klass}"
  viewBox="0 0 64 64"
  width={size}
  height={size}
  aria-hidden="true"
  focusable="false"
>
  <path class="wavehex-bg" d="M32 3 57.1 17.5v29L32 61 6.9 46.5v-29Z" />
  <path class="wavehex-wave" d="M6.9 40c6-7 13-7 19-1s14 7 21 0 8-4 10.2-2.5v10L32 61 6.9 46.5Z" />
  <path class="wavehex-crest" d="M10 30.5c5-6 11-6 16.5-1s13 6 19.5-.5 7-3.5 9-2.5" />
  <path class="wavehex-ring" d="M32 3 57.1 17.5v29L32 61 6.9 46.5v-29Z" />
</svg>

<style>
  .wavehex {
    display: block;
    flex: none;
  }

  /* the hexagon plate: navy in both themes (guide p. 7's own dark lockup colour). */
  .wavehex-bg {
    fill: var(--mma-navy);
  }

  /* the swell: brand gold in both themes. */
  .wavehex-wave {
    fill: var(--mma-gold);
  }

  /* the crest line: white in both themes -- --surface-seal-plate is already documented as "white
     in both themes" (tokens.css's own @contrast note), so this reads it rather than a literal. */
  .wavehex-crest {
    fill: none;
    stroke: var(--surface-seal-plate);
    stroke-width: 3.5;
    stroke-linecap: round;
  }

  /* the ring: --border-accent (R5 y1) -- gold on navy (separates the navy hexagon from a dark
     top bar), navy on paper (separates it from a white/cream one). The SAME token that carries an
     active control's state boundary now also carries the mark's own -- one ring, two jobs. */
  .wavehex-ring {
    fill: none;
    stroke: var(--border-accent);
    stroke-width: 3.5;
    stroke-linejoin: round;
  }
</style>
