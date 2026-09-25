<script lang="ts">
  // V3 (P round, 2026-09-24): Ben's report -- titiler-v8 and the API were down for an hour and the
  // live atlas kept rendering a perfectly normal map with NO raster and NO word to the user. This is
  // the visible half of src/lib/health/*: a banner naming the failing service, what it breaks, and
  // a Retry.
  //
  // P round 2 fix (CI run 36070452831): this used to be `position: fixed` at the VIEWPORT's top
  // edge, which painted over `.topbar` and swallowed every click meant for a topbar control
  // underneath it (feedback, the lens switch, ⋯, Help > Docs, theme) -- every hermetic e2e spec
  // that clicked one timed out the moment the data-origin probe misread a fixture's ordinary
  // app/boot.json 404 as "down" (see probe.ts's own P round 2 comment). Now `position: absolute`,
  // rendered by Shell.svelte as the FIRST child of `.stage` (below `.topbar` entirely -- they are
  // separate CSS Grid rows in `.app`, shell.css -- and above the map, which may be overlapped): a
  // real `.stage`-scoped overlay, never a viewport-wide one. Still never in NORMAL flow (brief: "no
  // layout shift of the map controls") -- the rail/panel/legend are all `position: absolute` inside
  // `.stage` already (shell.css: ".rail-region { position: absolute; ... }"), so inserting this
  // banner into `.stage`'s own flow would resize it and move every one of them; a z-index BELOW
  // theirs (see the style block) keeps the rail/panel/sheet/tab bar the top, clickable layer
  // wherever their boxes and this banner's top strip happen to overlap.
  //
  // Dismissible but RE-APPEARING (brief): dismissing only silences the CURRENT result. The banner
  // reappears the moment a later probe reports a NEWER "down" result for the same service --
  // `checkedAt` (fresh on every probe, including the Retry-triggered one) is compared against the
  // dismiss timestamp, never a one-shot "seen" flag.
  import { bannerMessage, type ActiveBanner } from "../health/registry";
  import Icon from "./Icon.svelte";

  interface Props {
    banner: ActiveBanner | null;
    onretry: () => void;
  }

  let { banner, onretry }: Props = $props();

  let dismissedAt = $state<Partial<Record<string, number>>>({});

  const visible = $derived(
    banner !== null &&
      (dismissedAt[banner.def.id] === undefined ||
        banner.result.checkedAt > dismissedAt[banner.def.id]!),
  );
  const text = $derived(banner ? bannerMessage(banner.def, banner.result) : "");

  function dismiss() {
    if (banner) dismissedAt = { ...dismissedAt, [banner.def.id]: Date.now() };
  }
</script>

{#if visible && banner}
  <div class="health-banner" role="status" data-testid="health-banner">
    <Icon name="alert" size={18} class="health-banner-icon" />
    <span class="health-banner-text">{text}</span>
    <div class="health-banner-actions">
      <button type="button" class="health-banner-retry" onclick={onretry}>Retry</button>
      <button type="button" class="health-banner-dismiss" aria-label="Dismiss" onclick={dismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  </div>
{/if}

<style>
  .health-banner {
    /* `absolute`, not `fixed`: this is now rendered INSIDE `.stage` (Shell.svelte), which is
       `position: relative` (shell.css) -- so `top/left/right: 0` resolve against `.stage`'s own
       box, never the viewport, and this can no longer paint over `.topbar` (a separate CSS Grid
       row entirely). */
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    /* ABOVE every floating shell region `.stage` positions near its top edge (the map's own
       overlays at 1-2, the legend at 5, the rail at 15, the panel at 16, the legend-chip at 17) --
       first tried BELOW them (so those controls would win any overlap), which broke this banner's
       OWN Retry button instead: `#panel-region` (z-index 16, docked top-right with only a
       `var(--space-3)` gap) sat on top of it and silently ate the click
       (e2e/shell.health-banner.spec.ts's "Retry ... clears the banner" test, caught on firefox).
       A banner reporting a real outage has to be the thing you can actually act on, so it now
       outranks that chrome instead -- still BELOW a maximized panel (40) or an open `<dialog>`
       (native top-layer regardless of z-index), which stay the more urgent surface. */
    z-index: 18;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: var(--text-sm);
    border-bottom: 1px solid var(--border-control);
    box-shadow: var(--elev-2);
  }

  .health-banner :global(.health-banner-icon) {
    flex: none;
    /* the repo's own documented pairing (tokens.css): --text-danger against --surface-raised,
       the exact two colors this banner uses -- never a new ad hoc warning color. */
    color: var(--text-danger);
  }

  .health-banner-text {
    flex: 1 1 auto;
    min-width: 0;
  }

  .health-banner-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }

  .health-banner-retry {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .health-banner-retry:hover {
    background: var(--fill-control);
  }

  .health-banner-retry:focus-visible,
  .health-banner-dismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .health-banner-dismiss {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .health-banner-dismiss:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  @media (max-width: 899px) {
    .health-banner {
      font-size: var(--text-xs);
    }
  }
</style>
