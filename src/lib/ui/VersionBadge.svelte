<script lang="ts">
  import { onMount } from "svelte";

  // reads window.__early (index.html's inline early-fetch script) to show which release and mode
  // (public/preview) the shell is showing. this is the one bit of the shell that JS enhances — the
  // rest of the page (topbar, rail, panel skeleton) already paints from static HTML + inlined CSS
  // before this component ever mounts.
  interface Early {
    version: Promise<string | null>;
    session: Promise<{ preview: boolean }>;
  }

  let label = $state("");
  let preview = $state(false);

  onMount(() => {
    const early = (window as unknown as { __early?: Early }).__early;
    if (!early) return;

    Promise.all([
      early.version.catch(() => null),
      early.session.catch(() => ({ preview: false })),
    ]).then(([version, session]) => {
      label = version ?? "";
      preview = !!session?.preview;
    });
  });
</script>

{#if label}
  <span class="ms-version">{label}</span>
{/if}
{#if preview}
  <!-- R2/U1 fix (owner decision): at <= 380px (the same breakpoint the brand mark hides at) the
       full "PREVIEW" text no longer fits the 320px topbar alongside a v9 preview session's wider
       chip (verify.mjs: 17 species-lens phoneNarrow states off-screen). Never hidden and never
       dropped from the accessibility tree -- both forms are always in the DOM, `aria-label` fixes
       the accessible name regardless of which is visually shown (shell.css's own media query
       swaps `display`, never `{#if}`, so this is a pure CSS reflow with no extra JS/state), and
       `title` gives a sighted mouse user the same full word on hover for the compact form. -->
  <span class="ms-preview-badge" aria-label="Preview release" title="Preview release">
    <span class="ms-preview-badge-full" aria-hidden="true">PREVIEW</span>
    <span class="ms-preview-badge-short" aria-hidden="true">PRE</span>
  </span>
{/if}
