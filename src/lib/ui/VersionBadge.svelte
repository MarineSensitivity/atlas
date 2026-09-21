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
  <span class="ms-preview-badge">PREVIEW</span>
{/if}
