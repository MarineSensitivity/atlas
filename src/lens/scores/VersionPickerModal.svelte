<script lang="ts">
  // atlas-4 step 3 — the release picker (parity doc §5.5 modal 1) + D15's "under review" notice,
  // consolidated into one modal (a documented simplification over the ported app's three separate
  // dialogs — see the atlas-4 report). A restricted release is offered ONLY as a link to the
  // preview host's `/{ver}/atlas/` path (never `?ver=` on Pages, D15); a public one is an ordinary
  // `?ver=` link (a real navigation, matching the ported app's own version switch).
  import Modal from "../../lib/ui/Modal.svelte";
  import { accessOf, type VersionRow } from "../../lib/release/access";
  import { previewLinkFor, type PreviewLinkLoc } from "../../lib/release/previewLink";

  interface Props {
    open: boolean;
    onclose: () => void;
    versions: VersionRow[] | null;
    denied: { ver: string; reason: string } | null;
    currentVer: string | null;
    loc: PreviewLinkLoc;
  }

  let { open, onclose, versions, denied, currentVer, loc }: Props = $props();

  const DENIAL_TEXT: Record<string, string> = {
    restricted: "is a pre-release under review and is not shown on this host.",
    "unknown-version": "is not a version this host recognizes.",
    "registry-unreadable": "could not be resolved (the version registry did not load).",
  };
</script>

<Modal {open} title="Data release" {onclose}>
  {#if denied}
    <p class="denied-notice">
      <strong>{denied.ver}</strong>
      {DENIAL_TEXT[denied.reason] ?? "is not available on this host."}
      {#if denied.reason === "restricted"}
        <a href={previewLinkFor(denied.ver, loc)}>Continue on the preview host</a>.
      {/if}
    </p>
  {/if}

  <p class="intro">This app renders one published release of the marine-atlas at a time.</p>

  {#if !versions}
    <p class="note">The version list could not be loaded.</p>
  {:else}
    <ul class="version-list">
      {#each versions as row (row.ver)}
        {@const access = accessOf(versions, row.ver ?? null)}
        <li class:current={row.ver === currentVer}>
          <span class="ver">{row.ver}</span>
          {#if row.status && row.status !== "released"}
            <span class="badge">{row.status}</span>
          {/if}
          {#if access !== "public"}
            <span class="badge badge--restricted">restricted</span>
            <a href={previewLinkFor(row.ver ?? "", loc)}>Continue on the preview host</a>
          {:else if row.ver === currentVer}
            <span class="badge">current</span>
          {:else}
            <a href={`?ver=${row.ver}`}>Switch</a>
          {/if}
          {#if row.released}<span class="date">{row.released}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .intro {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
  }

  .denied-notice {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
  }

  .note {
    margin: 0;
    color: var(--text-secondary);
  }

  .version-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .version-list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-bottom: 1px solid var(--divider);
  }

  .version-list li.current {
    font-weight: 700;
  }

  .ver {
    min-width: 3ch;
  }

  .badge {
    font-size: var(--text-xs);
    padding: 0 var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
  }

  .badge--restricted {
    color: var(--text-danger);
    border-color: var(--text-danger);
  }

  .date {
    margin-left: auto;
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
</style>
