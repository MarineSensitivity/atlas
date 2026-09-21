<script lang="ts">
  import Toast from "../../lib/ui/Toast.svelte";

  let toast: ReturnType<typeof Toast> | undefined;
  let count = 0;

  function announce() {
    count += 1;
    toast?.push(`Species table loaded, ${1234 + count} rows`);
  }
</script>

<button type="button" class="btn" onclick={announce}>Announce a result</button>
<p class="muted">
  One polite live region (<code>role="status" aria-live="polite"</code>); each message
  auto-dismisses after 5s or via its own close button.
</p>

<Toast bind:this={toast} />

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .muted {
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
