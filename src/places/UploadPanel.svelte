<script lang="ts">
  // atlas-6 step 3, Deliverable 4's UI half: drop a file anywhere on the map, or use the picker.
  // All parsing/validation lives in src/lib/geo/upload/ (Opus's, atlas-2/atlas-6 parsing half) --
  // this component only calls it, lazily, and renders what comes back. Every refusal renders
  // VERBATIM (what/why/fix), never "invalid file" (design:ux-copy).
  import { onDestroy } from "svelte";
  import type { Refusal } from "../lib/geo/upload/types";
  import type { NormalizedPlace, NormalizeOptions } from "../lib/geo/upload/normalize";
  import type { GeoPackageConsentRequest } from "../lib/geo/upload/parsers/geopackage";
  import type { MapHandle } from "../lib/map/map";
  import type { DataEngineContext } from "./dataEngine";
  import { noopTrack, placeUploadParams, type Track } from "./analytics";

  interface Props {
    mapHandle: MapHandle | undefined;
    /** `undefined` when no release is resolved yet -- the study-area check is then SKIPPED, same
     * as an absent `NormalizeOptions.studyArea` (normalize.ts's own documented behaviour). */
    dataEngine: (() => Promise<DataEngineContext>) | undefined;
    onAdd: (places: NormalizedPlace[]) => void;
    /** Deliverable 7: counts and buckets only -- see analytics.ts's own header. */
    track?: Track;
  }

  let { mapHandle, dataEngine, onAdd, track = noopTrack }: Props = $props();

  let refusal = $state<Refusal | null>(null);
  let busy = $state(false);
  let multiPrompt = $state<{ names: string[] } | null>(null);
  let pending: { name: string; bytes: Uint8Array } | null = null;
  let lastMeta: { format: string; bytes: number } = { format: "unknown", bytes: 0 };

  const MAX_FILE_MB = 10; // geo/upload/normalize.ts's own MAX_FILE_BYTES, restated for the drop hint

  /** the GeoPackage consent prompt (Deliverable 4): names the size and the third-party host before
   * anything is fetched. `runtime` stays `null` (no DuckDB `spatial` wiring in this phase, a
   * documented limitation — see docs/upload.md's own GeoPackage section) so this consent, even
   * when accepted, still ends in `geopackageNoRuntime`'s "convert to GeoJSON" fallback refusal;
   * the prompt is written now so wiring a real runtime later needs no UI change. */
  async function askGeoPackageConsent(request: GeoPackageConsentRequest): Promise<boolean> {
    const mb = (request.bytes / (1024 * 1024)).toFixed(1);
    return window.confirm(
      `Reading a GeoPackage needs a one-time ${mb} MB download from ${request.host}, a third-party ` +
        `host this app does not otherwise contact. Continue?`,
    );
  }

  async function normalize(input: { name: string; bytes: Uint8Array }, options: NormalizeOptions) {
    const mod = await import("../lib/geo/upload/normalize");
    return mod.normalizeUpload(input, options, {
      geoPackage: { consent: askGeoPackageConsent, runtime: null },
    });
  }

  function trackOutcome(nFeatures: number, outcome: "ok" | "refused") {
    track("place_upload", placeUploadParams({ ...lastMeta, nFeatures, outcome }));
  }

  // `onAdd` (Places.svelte's `addEnteredPlaces`) already announces success once the place is
  // actually added to `#pl=` — this only announces the FAILURE paths that end here instead.
  async function finalize(places: NormalizedPlace[]) {
    if (!dataEngine) {
      onAdd(places);
      trackOutcome(places.length, "ok");
      return;
    }
    try {
      const ctx = await dataEngine();
      const { checkTouchesStudyArea } = await import("./studyArea");
      const outside = await checkTouchesStudyArea(ctx, places);
      if (outside) {
        refusal = outside;
        trackOutcome(places.length, "refused");
        return;
      }
      onAdd(places);
      trackOutcome(places.length, "ok");
    } catch {
      // the release grid/engine failing to boot must never block adding an otherwise-valid place
      // (D7b's clip is a refinement on top of a geometrically valid upload, not a precondition).
      onAdd(places);
      trackOutcome(places.length, "ok");
    }
  }

  async function handleFile(file: File) {
    busy = true;
    refusal = null;
    multiPrompt = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      pending = { name: file.name, bytes };
      const { detectFormat } = await import("../lib/geo/upload/detect");
      lastMeta = {
        format: detectFormat(file.name, bytes).format ?? "unknown",
        bytes: bytes.length,
      };
      const result = await normalize({ name: file.name, bytes }, { multiFeature: "perFeature" });
      if (!result.ok) {
        refusal = result.refusal;
        trackOutcome(0, "refused");
        return;
      }
      if (result.places.length > 1) {
        multiPrompt = { names: result.places.map((p) => p.name) };
        return;
      }
      await finalize(result.places);
    } finally {
      busy = false;
    }
  }

  async function chooseMultiFeature(mode: "perFeature" | "union") {
    if (!pending) return;
    busy = true;
    try {
      const result = await normalize(pending, { multiFeature: mode });
      multiPrompt = null;
      if (!result.ok) {
        refusal = result.refusal;
        trackOutcome(0, "refused");
        return;
      }
      await finalize(result.places);
    } finally {
      busy = false;
    }
  }

  function onInputChange(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ""; // the SAME file can be dropped/picked again after a refusal
    if (file) void handleFile(file);
  }

  function onDropZone(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  // "drop a file anywhere on the map" (Deliverable 4) -- the map's own container, reached the same
  // sanctioned way pick mode reaches `on`/`off` (docs/map.md), never through composeStyle: a native
  // drop target is DOM wiring, not a style input.
  let mapContainer: HTMLElement | undefined;
  $effect(() => {
    const el = mapHandle?.map.getContainer();
    if (!el || el === mapContainer) return;
    mapContainer?.removeEventListener("drop", onDropZone);
    mapContainer?.removeEventListener("dragover", onDragOver);
    mapContainer = el;
    el.addEventListener("drop", onDropZone);
    el.addEventListener("dragover", onDragOver);
  });
  onDestroy(() => {
    mapContainer?.removeEventListener("drop", onDropZone);
    mapContainer?.removeEventListener("dragover", onDragOver);
  });

  function dismissRefusal() {
    refusal = null;
  }
</script>

<section class="upload" aria-label="Upload a place">
  <label class="dropzone" ondrop={onDropZone} ondragover={onDragOver}>
    <input type="file" onchange={onInputChange} disabled={busy} />
    <span>
      {busy ? "Reading…" : "Drop a file here, on the map, or choose one"} — GeoJSON, zipped shapefile,
      KML, GPX, FlatGeobuf, WKT or GeoPackage, up to {MAX_FILE_MB} MB.
    </span>
  </label>

  {#if refusal}
    <div class="refusal" role="alert">
      <p><strong>{refusal.what}</strong></p>
      <p>{refusal.why}</p>
      <p>{refusal.fix}</p>
      <button type="button" onclick={dismissRefusal}>Dismiss</button>
    </div>
  {/if}

  {#if multiPrompt}
    <div class="multi-prompt" role="group" aria-label="Multiple shapes found">
      <p>
        This file has {multiPrompt.names.length} shapes ({multiPrompt.names
          .slice(0, 3)
          .join(", ")}{multiPrompt.names.length > 3 ? ", …" : ""}). Keep them as separate places, or
        merge into one?
      </p>
      <div class="multi-actions">
        <button type="button" onclick={() => chooseMultiFeature("perFeature")}>
          {multiPrompt.names.length} separate places
        </button>
        <button type="button" onclick={() => chooseMultiFeature("union")}>One merged place</button>
      </div>
    </div>
  {/if}
</section>

<style>
  .upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .dropzone {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--space-4);
    border: 1px dashed var(--border-control);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .dropzone input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  /* fix list #3 (SC 2.4.7): the transparent input stretched over this label is a legitimate
     pattern -- the input itself is what actually receives focus, but with no rule of its own
     `.dropzone` painted IDENTICALLY focused and unfocused, so a keyboard user tabbing through
     this panel simply lost the caret for one stop. The only other `:focus-within` rule in `src/`
     today is shell.css's search field. */
  .dropzone:focus-within {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .refusal,
  .multi-prompt {
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    font-size: var(--text-sm);
  }

  .refusal p,
  .multi-prompt p {
    margin: 0 0 var(--space-1);
  }

  .refusal button,
  .multi-actions button {
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    cursor: pointer;
  }

  .multi-actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
