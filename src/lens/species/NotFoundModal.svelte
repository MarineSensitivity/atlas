<script lang="ts">
  // §4 / §5.5 modal 4 ("Model not found") — the two explanations a dead `mdl_key`/`mdl_seq` link
  // gets (`notFoundReasons()`, data/resolve.ts): the key is gone, search for the species instead,
  // or (for a taxon with no US-EEZ model at all) it never had one to begin with.
  import Modal from "../../lib/ui/Modal.svelte";

  interface Props {
    open: boolean;
    reasons: string[];
    onclose: () => void;
  }

  let { open, reasons, onclose }: Props = $props();
</script>

<Modal {open} title="Model not found" {onclose}>
  {#each reasons as r, i (i)}
    <p>{r}</p>
  {/each}
</Modal>
