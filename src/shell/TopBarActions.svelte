<script lang="ts">
  // R2 (docs/usability.md §7, owner decision 2026-09-24): "About this release" leaves the on-map
  // bottom-left card (Shell.svelte's old `about-region`) for an (i) popover-dialog at the top
  // bar's right end; "Feedback" (the old "Report a problem" link) moves into the top bar beside
  // it. On the phone, both -- plus Share/Report/Help, which are already `topbar-desktop-only` and
  // so otherwise unreachable there (usability M14) -- live under one ⋯ overflow menu.
  //
  // A NEW component, not more inline markup in Shell.svelte, per this round's instructions: two
  // OTHER rounds (U5, U6) touch the rail and the top bar's Report/Help/theme controls in parallel,
  // so this file owns only what R2 adds and Shell.svelte changes by one mount line. Kept in
  // `src/shell/` (not `src/lib/ui/`) because it is shell chrome wired to shell-only state (the
  // release registry, the existing Share/Report/Help handlers) -- not a reusable, standalone
  // widget the way `src/lib/ui/*` components are.
  //
  // Feedback stays behind ONE function boundary (`onFeedbackClick`, Shell.svelte's existing
  // handler): U3 (round 2) replaced its implementation with `openFeedback()` (the screenshot
  // dialog, superseding the old webhook POST) -- Shell.svelte's mount line changed to pass that
  // function under the SAME prop name, and `handleFeedback` below gained one `preventDefault()`
  // (matching U3's own "Report a problem" anchor) so a click opens ONLY the dialog, never also
  // navigating the tab to the GitHub fallback link in the background -- everything else here is
  // unchanged, exactly the "this file never has to change for that" promise.
  //
  // R2, round 2 (owner finding on live 0.10.36 at 390x844): once the welcome modal is dismissed,
  // the guided tour was reachable ONLY through the desktop (?) Help menu (`topbar-desktop-only`),
  // so a phone visitor had no way to start it at all. The ⋯ menu now carries the SAME "Take a
  // tour" action Shell.svelte's Help menu uses (`onTakeTour`, its `onHelpTakeTour` passed through
  // verbatim -- this file never imports `./tourRuntime`/driver.js itself, keeping that dynamic
  // import's lazy-loading boundary exactly where U6 put it) beside "Docs" (`helpDocsHref`, now its
  // own item rather than one "Help" item covering both). "Send feedback" is renamed to "Feedback"
  // (owner decision R2) to match the desktop control's own label one-for-one.
  //
  // tests/shell/shell-invariants.test.ts scans this file (alongside Shell.svelte) for its
  // data-control/data-tour anchors and the same "no src/lib/release, no history.pushState"
  // invariants -- this file reads only plain props, never `src/lib/release` or `window.__early`
  // directly, so the shell's one early-fetch boundary stays intact.
  import { onMount, tick } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import Modal from "../lib/ui/Modal.svelte";
  import { agencyDisplayName, SEAL_MIN_PX, shouldShowSeal } from "../lib/ui/sealVisibility";
  import { nextRovingIndex } from "../lib/ui/roving";
  import { uid } from "../lib/ui/uid";

  const DEFAULT_SEAL_URL = "https://marinesensitivity.org/branding/mma-seal.svg";

  interface Props {
    earlyVersion: string | null;
    /** `accessOf(versions, earlyVersion) !== "public"` -- computed by Shell.svelte (which already
     * holds `versions` off `window.__early`), never re-derived here from `src/lib/release`. */
    restricted: boolean;
    releaseStatus?: string | null;
    releaseDate?: string | null;
    appVersion: string;
    feedbackHref: string;
    onFeedbackClick: (e: MouseEvent) => void;
    onShare: () => void;
    onReportTop: () => void;
    /** the Help menu's own "Docs" destination (Shell.svelte's `docsHref`) -- the phone ⋯ menu's
     * "Docs" item opens this directly rather than toggling Shell.svelte's Help disclosure, which
     * is `topbar-desktop-only` and so invisible at the width the ⋯ menu itself only exists at. */
    helpDocsHref: string;
    /** starts the SAME guided tour the desktop Help menu's "Take a tour" item starts
     * (Shell.svelte's `onHelpTakeTour`, passed through verbatim) -- the phone ⋯ menu's own
     * "Take a tour" item. */
    onTakeTour: () => void;
    /** P5 fix round 2 (coordinator finding, 390px eyes-on evidence): the desktop theme toggle
     * (Shell.svelte's own button) is now `topbar-desktop-only` -- its own width was what pushed
     * the theme button itself, and everything after it, past the phone viewport's right edge once
     * the P1 search button was added beside it. `resolvedTheme` mirrors Shell.svelte's own
     * `$derived` (never re-resolved here from `sel`/`prefersDark`); `onToggleTheme` is its
     * `toggleTheme`, passed through verbatim, same convention as `onTakeTour` above. */
    resolvedTheme: "navy" | "paper";
    onToggleTheme: () => void;
    sealFlag?: string;
    agency?: string;
    sealUrl?: string;
  }

  let {
    earlyVersion,
    restricted,
    releaseStatus = null,
    releaseDate = null,
    appVersion,
    feedbackHref,
    onFeedbackClick,
    onShare,
    onReportTop,
    helpDocsHref,
    onTakeTour,
    resolvedTheme,
    onToggleTheme,
    sealFlag = import.meta.env.VITE_SEAL,
    agency = import.meta.env.VITE_AGENCY,
    sealUrl = import.meta.env.VITE_SEAL_URL || DEFAULT_SEAL_URL,
  }: Props = $props();

  let sealFailed = $state(false);
  const showSeal = $derived(shouldShowSeal(sealFlag, agency) && !sealFailed);
  const agencyName = $derived(agencyDisplayName(agency));

  // --- About popover-dialog -----------------------------------------------------------------
  let aboutOpen = $state(false);

  // --- Send feedback: a real <a>, not only a button (Deliverable 4's original zero-JS rationale,
  // carried over from the old on-map link -- `feedbackHref` still works with JS disabled/failed).
  // U3 (round 2): `onFeedbackClick` is now Shell.svelte's `openFeedback` (the dialog, not a plain
  // navigation) -- `preventDefault()` first, same as U3's own "Report a problem" anchor, so a
  // normal click opens ONLY the dialog and never also navigates the tab to the GitHub fallback
  // link in the background.
  function handleFeedback(e: MouseEvent) {
    e.preventDefault();
    onFeedbackClick(e);
  }

  // --- phone ⋯ overflow menu: role="menu"/"menuitem", roving tabindex (the same `roving.ts` the
  // rail uses), Esc closes and returns focus to the trigger, a click outside also closes. --------
  let moreOpen = $state(false);
  let moreTriggerEl: HTMLButtonElement | undefined;
  let moreMenuEl: HTMLDivElement | undefined = $state();
  let moreRovingIndex = $state(0);
  const moreMenuId = uid("more-menu");

  interface MoreItem {
    label: string;
    icon: "share" | "report" | "feedback" | "info" | "help" | "tour" | "themeSun" | "themeMoon";
    run: (e: MouseEvent) => void;
    href?: string;
  }
  // R2, round 2: "Help" split into its two destinations ("Take a tour" / "Docs") so the tour is
  // actually reachable on the phone -- see this file's header comment. Order: Share, Report,
  // Feedback, About this release, Take a tour, Docs, Theme -- e2e/shell.chrome.spec.ts asserts
  // this exact item-name list. "Theme" (P5 fix round 2) is last, mirroring its own rightmost
  // position in the desktop topbar.
  const moreItems = $derived<MoreItem[]>([
    { label: "Share", icon: "share", run: () => onShare() },
    { label: "Report", icon: "report", run: () => onReportTop() },
    { label: "Feedback", icon: "feedback", run: handleFeedback, href: feedbackHref },
    { label: "About this release", icon: "info", run: () => (aboutOpen = true) },
    // `run` (not `href`): starts the tour directly, same as the desktop Help menu's own button --
    // never a link, so no `<a>`/no-op split like Docs below.
    // P7 (Opus eyes-on assessment, 2026-09-24): this used to reuse the "help" (?) glyph, so "Take
    // a tour" and "Docs" (below) were visually identical rows in this menu -- its own `icon` name
    // (icon-map.json's `mdiCompassOutline`, added by this fix via
    // `scripts/build-icon-paths.mjs`), distinct from Docs' "help" glyph just below.
    { label: "Take a tour", icon: "tour", run: () => onTakeTour() },
    // a real <a>, same as Feedback above -- opens the SAME docs link the desktop Help menu's own
    // "Docs" item does (Shell.svelte's `docsHref`), rather than toggling that disclosure itself
    // (invisible at the width this ⋯ menu only exists at -- see helpDocsHref's own doc comment).
    // `run` is a no-op: the `<a href target="_blank">` below does the whole job on its own.
    { label: "Docs", icon: "help", run: () => {}, href: helpDocsHref },
    // P5 fix round 2: the SAME vocabulary/icon-swap as the desktop button (this file's own
    // `resolvedTheme` doc comment) -- "the DESTINATION theme", never "navy"/"paper".
    {
      label: resolvedTheme === "navy" ? "Switch to light theme" : "Switch to dark theme",
      icon: resolvedTheme === "navy" ? "themeSun" : "themeMoon",
      run: () => onToggleTheme(),
    },
  ]);

  async function openMore() {
    moreOpen = true;
    moreRovingIndex = 0;
    await tick();
    moreMenuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }

  function closeMore() {
    if (!moreOpen) return;
    moreOpen = false;
    moreTriggerEl?.focus();
  }

  function onMoreItemClick(item: MoreItem, e: MouseEvent) {
    closeMore();
    item.run(e);
  }

  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMore();
      return;
    }
    const items = moreMenuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const current = [...items].indexOf(document.activeElement as HTMLElement);
    const next = nextRovingIndex(current === -1 ? 0 : current, items.length, event.key, "vertical");
    if (next === null) return;
    event.preventDefault();
    moreRovingIndex = next;
    items[next]?.focus();
  }

  function onDocumentPointerdown(event: PointerEvent) {
    if (!moreOpen) return;
    const target = event.target as Node;
    if (moreMenuEl?.contains(target) || moreTriggerEl?.contains(target)) return;
    moreOpen = false; // dismissed by clicking elsewhere -- focus was already elsewhere
  }

  onMount(() => {
    document.addEventListener("pointerdown", onDocumentPointerdown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerdown);
  });
</script>

<a
  class="tool topbar-desktop-only"
  data-tour="feedback"
  data-control="feedback"
  href={feedbackHref}
  target="_blank"
  rel="noopener"
  onclick={handleFeedback}
>
  <Icon name="feedback" size={18} />Feedback
</a>

<button
  type="button"
  class="tool topbar-desktop-only"
  data-tour="about"
  data-control="about"
  aria-label="About this release"
  aria-haspopup="dialog"
  onclick={() => (aboutOpen = true)}
>
  <Icon name="info" size={18} />
</button>

<button
  type="button"
  class="tool topbar-phone-only"
  data-tour="more"
  data-control="more-menu"
  aria-label="More: Share, Report, Feedback, About, Take a tour, Docs, Theme"
  aria-haspopup="menu"
  aria-expanded={moreOpen}
  bind:this={moreTriggerEl}
  onclick={() => (moreOpen ? closeMore() : openMore())}
>
  <Icon name="more" size={18} />
</button>

<!-- always rendered (never {#if moreOpen}), toggled with `hidden` -- `aria-controls` on the ⋯
     trigger above must reference an element that actually EXISTS in the DOM at all times (SC
     4.1.2); axe's `aria-valid-attr-value` rule flags exactly the {#if}-gated version (measured:
     "Unable to determine if aria-controls referenced ID exists... while using aria-haspopup").
     Same fix as Popover.svelte/Accordion.svelte's own identical rule. -->
<div
  class="more-menu"
  id={moreMenuId}
  role="menu"
  aria-label="More"
  tabindex="-1"
  hidden={!moreOpen}
  bind:this={moreMenuEl}
  onkeydown={onMenuKeydown}
>
  {#each moreItems as item, i (item.label)}
    {#if item.href}
      <a
        class="more-item"
        role="menuitem"
        tabindex={i === moreRovingIndex ? 0 : -1}
        href={item.href}
        target="_blank"
        rel="noopener"
        onclick={(e) => onMoreItemClick(item, e)}
      >
        <Icon name={item.icon} size={16} /><span>{item.label}</span>
      </a>
    {:else}
      <button
        type="button"
        class="more-item"
        role="menuitem"
        tabindex={i === moreRovingIndex ? 0 : -1}
        onclick={(e) => onMoreItemClick(item, e)}
      >
        <Icon name={item.icon} size={16} /><span>{item.label}</span>
      </button>
    {/if}
  {/each}
</div>

<Modal open={aboutOpen} title="About this release" onclose={() => (aboutOpen = false)}>
  <dl class="meta">
    <dt>Release</dt>
    <dd>
      <b>{earlyVersion ?? "—"}</b>{#if releaseStatus && releaseStatus !== "released"}
        · {releaseStatus}{/if}{#if releaseDate}
        · {releaseDate}{/if}
    </dd>
    <dt>App</dt>
    <dd>Atlas {appVersion}</dd>
  </dl>
  {#if restricted}
    <p class="restricted-note">
      This is a pre-release under review, not the public release -- see the version chip to switch.
    </p>
  {/if}
  <div class="pop-links">
    <a href="https://marinesensitivity.org/docs/" target="_blank" rel="noopener">Documentation</a>
    <a
      href="https://github.com/MarineSensitivity/atlas/blob/main/CHANGELOG.md"
      target="_blank"
      rel="noopener">What changed</a
    >
    <a href="https://github.com/MarineSensitivity/atlas" target="_blank" rel="noopener">GitHub</a>
  </div>
  {#if showSeal}
    <div class="seal-row">
      <span class="seal-plate">
        <img
          src={sealUrl}
          alt="Seal of the {agencyName}"
          width={SEAL_MIN_PX}
          height={SEAL_MIN_PX}
          loading="lazy"
          onerror={() => (sealFailed = true)}
        />
      </span>
      <span>Prepared for the <b>{agencyName}</b>.</span>
    </div>
  {/if}
</Modal>

<style>
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-3);
  }
  .meta dt {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .meta dd {
    margin: 0;
  }

  .restricted-note {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .pop-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .seal-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  /* the seal at >= 72 px, unmodified, on a plain plate whose padding IS the clear space (a
     quarter of the seal's own height, guide p. 4) -- D10, the same rule About.svelte's own seal
     follows. */
  .seal-plate {
    flex: none;
    display: block;
    box-sizing: content-box;
    padding: 18px;
    background: var(--surface-seal-plate);
    border-radius: var(--radius-card);
  }
  .seal-plate img {
    display: block;
  }

  /* an explicit `[hidden]` override: this element sets its OWN `display` (flex, for the column
     layout below), and an author style with higher specificity than the plain `.more-menu` rule
     is needed to win over it -- the UA stylesheet's `[hidden] { display: none }` is lowest
     priority regardless of specificity, so without this the menu would stay visible (`display:
     flex`) even while `hidden` -- see this component's own header comment for why it is always
     rendered, never `{#if moreOpen}`, and toggled with `hidden` instead. */
  .more-menu[hidden] {
    display: none;
  }

  .more-menu {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: var(--space-2);
    z-index: 25;
    display: flex;
    flex-direction: column;
    min-width: 220px;
    padding: var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    box-shadow: var(--elev-3);
  }

  .more-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: none;
    text-align: left;
    cursor: pointer;
  }
  .more-item:hover {
    background: var(--fill-control);
  }
  .more-item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
