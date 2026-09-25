<script lang="ts">
  // §7.1: selectable scientific (italic) and common names, each with a copy button. `writeText`
  // rejects `NotAllowedError` whenever the document is unfocused (§11.7) — ALWAYS keep the
  // `execCommand('copy')` fallback, and flash a check/cross for 1.2 s either way.
  import Icon from "../../lib/ui/Icon.svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import type { WideRangeZoom } from "./state.svelte";

  interface Props {
    sci: string;
    common: string | null;
    /** R3-A1: `null` hides the toggle entirely — this model was never narrowed (a compact range,
     * or no study area to narrow against), so there is only one meaningful framing. */
    wideRange?: WideRangeZoom;
    onSetZoomTarget?: (target: "us" | "whole") => void;
  }

  let { sci, common, wideRange = null, onSetZoomTarget }: Props = $props();
  let flash = $state<{ which: "sci" | "common"; ok: boolean } | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function fallbackCopy(text: string): boolean {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }

  async function attemptCopy(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return fallbackCopy(text);
    } catch {
      // §11.7: `writeText` rejects `NotAllowedError` whenever the document is unfocused — the
      // fallback is what keeps the button doing SOMETHING instead of failing silently.
      return fallbackCopy(text);
    }
  }

  async function copy(which: "sci" | "common", text: string) {
    const ok = await attemptCopy(text);
    clearTimeout(timer);
    flash = { which, ok };
    timer = setTimeout(() => (flash = null), 1200);
  }
</script>

<div class="sp-title">
  <span class="sci" data-testid="species-title-sci">{sci}</span>
  <button
    type="button"
    class="sp-copy"
    title="copy scientific name"
    aria-label="Copy scientific name"
    onclick={() => copy("sci", sci)}
  >
    {#if flash?.which === "sci"}
      <Icon name={flash.ok ? "check" : "close"} size={14} />
    {:else}
      <Icon name="copy" size={14} />
    {/if}
  </button>
  {#if common}
    <span class="sep">·</span>
    <span class="cmn" data-testid="species-title-common">{common}</span>
    <button
      type="button"
      class="sp-copy"
      title="copy common name"
      aria-label="Copy common name"
      onclick={() => copy("common", common)}
    >
      {#if flash?.which === "common"}
        <Icon name={flash.ok ? "check" : "close"} size={14} />
      {:else}
        <Icon name="copy" size={14} />
      {/if}
    </button>
  {/if}
</div>
{#if wideRange}
  <!-- R3-A1: a wide-range model (e.g. the leatherback — nesting near Oceania, foraging to Alaska)
       frames its IN-US portion by default; this is the escape hatch back to the whole range. -->
  <div class="zoom-target">
    <Segmented
      ariaLabel="Zoom to"
      value={wideRange.value}
      options={[
        { value: "us", label: "US waters" },
        { value: "whole", label: "Whole range" },
      ]}
      onchange={(v) => onSetZoomTarget?.(v as "us" | "whole")}
    />
  </div>
{/if}

<style>
  .zoom-target {
    margin-top: var(--space-1);
  }

  /* a compact instance of the shared Segmented look (W4: "the fit prop from W1 is not available to
     you — use your own compact style") — smaller than the top-bar Scores|Species switch, which
     otherwise dominates this narrow panel column. */
  .zoom-target :global(.seg button) {
    height: 24px;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
  }
  .sp-title {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
    /* selectize's own item swallows a click on selectable text elsewhere in the old app (§7.1) —
       kept here because it costs nothing and a name is exactly the kind of text a reader selects. */
    user-select: text;
  }

  .sci {
    font-style: italic;
    font-weight: 700;
  }

  .sep {
    color: var(--text-secondary);
  }

  .sp-copy {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .sp-copy:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .sp-copy:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
