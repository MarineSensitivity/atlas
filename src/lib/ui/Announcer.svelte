<script lang="ts">
  // atlas-3 step 4 fix round 1 (SC 4.1.3): the ONE polite live region for the whole page. Mount
  // exactly one instance near the app root (src/gallery/App.svelte here; the real shell's
  // index.html/src/main.ts when that lands -- see this step's report). Every other component
  // calls announce() from src/lib/ui/announcer.ts instead of rendering a region of its own.
  import { onMount } from "svelte";
  import { getLastAnnouncerMessage, subscribeAnnouncer } from "./announcer";

  let message = $state(getLastAnnouncerMessage());

  onMount(() => subscribeAnnouncer((text) => (message = text)));
</script>

<div class="announcer" role="status" aria-live="polite">{message}</div>

<style>
  .announcer {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
