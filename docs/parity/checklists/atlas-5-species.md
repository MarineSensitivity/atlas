## Parity checklist (each line is an e2e assertion; § = section of the reference)

**Picker (§5.4)**
- [ ] Options grouped by `sp_cat`, label `"{sp_cat}: {scientific}{ (common)}"`, value = merged key;
      "Only species in US waters" (default on) swaps the US and the all lists **keeping the selection**;
      default species *Dermochelys coriacea* among US-valid taxa, else the first.
- [ ] Client-side search over ~22 k rows (normalized, diacritics folded; scientific and common) with a
      virtualized list; `search_species` logged with the 900 ms debounce, ≥ 3 chars, no repeats.

**Title + layer bar (§7.1–7.2)**
- [ ] Selectable scientific (italic) and common names, each with a copy button that falls back to
      `execCommand('copy')` when `writeText` rejects (unfocused document), flashing ✓ / ✗ for 1.2 s.
- [ ] Bar is green (`is-merged`) or orange (`is-input`); merged text `Merged Model (maximum of {n} inputs)`
      with `n` from the shard's normalized edges; input text `Viewing input: {name}` + `show Merged Model`.
- [ ] One pill per input in `dataset.sort_order`; an input with no published surface is a
      struck-through, dashed, disabled pill titled "{label} feeds the merged model, but {ver} publishes
      no surface for it — nothing to draw". Phone: pills fold behind `{N} layers ▾`.
- [ ] Representation toggle only when an input has two: **Original / Interpolated**, relabelled
      **Delivered / As ingested** when `dataset.on_grid`, with the four tooltips of §7.2.

**Map (§6)**
- [ ] Outlines select: Program Areas (white) / Ecoregions (black, default) / None; Program-Area labels;
      Program-Area hover tooltip; globe (default) ↔ mercator; globe minimap; fullscreen, navigation,
      scale, Nominatim geocoder, layers control listing what exists; "Zoom to layer".
- [ ] COG branch: titiler tiles with the asset's own `colormap` and `rescale` (**AquaX delivered =
      0–1000**, everything else 1–100), opacity 0.8, nearest, under the ecoregion outline; continuous
      legend 1…100 from `ramps.ts`.
- [ ] PMTiles branch: fill `#3388ff` at 0.5, `source-layer` from the asset, filter
      `["==", ["get","mdl_key"], key]`, categorical legend "range (presence)". Prefer the S3 copy when
      `capabilities.pmtiles_s3`, else `file.marinesensitivity.org` (both answer CORS + Range).
- [ ] `merged.type = null` → the notice "No surface published for this taxon in {ver}" (what production
      shows today for the ~192 residual taxa: the `/msens` SQL factory is off by default). No SQL tiles.
- [ ] Camera: fit to `merged.bbox` **unwrapped** (xmax may exceed 180); for an input, its own bbox
      unless it spans ≥ 350° (then the merged bbox, then the ecoregion extent). **Refit only when the
      species changes**, never on a layer or representation switch.
- [ ] Switching layers removes source and layer together (the stale-merged-surface bug, §11.8).

**Click (§6.5)**
- [ ] `cellFromLonLat` with the release's grid (**fixes** the hard-coded `7200/3600` that is wrong for
      v1–v7); COG layers sample `/cog/point/{lng},{lat}?url=` behind `ValueSource`; ranges report
      "presence only"; no value → grey pin + "no value here".
- [ ] Popup opens on the first click: name, cell id, lon/lat, `round(val, 3)`; background = the ramp
      color at `round(clamp((val-1)/99)·10)+1`, text black or white by luminance 0.5.

**Species card (§7.3)**
- [ ] Common name, Category, ESA Listing `{code} ({SOURCE})`, IUCN RedList, WoRMS link (worms
      authority only), `MMPA: Protected (20)`, `MBTA: Protected (10)`; **Values** tree (`Merged Model`
      `(IUCN masked)` when an `rng_iucn` input exists → `(maximum of):` inputs with their `value_info`);
      **Mask** section (`(required)` on `rng_iucn`); the layer on screen in bold; inputs without a
      surface as plain text + "(no published surface)". Clicking an entry switches the layer.

**Deep links, title, chrome (§4, §5.5, §6.2)**
- [ ] `?mdl_key=` (merged or raw input) and `?mdl_seq=` resolve to `(sp, in)`; a non-US target turns
      `us` off; an unknown key opens "Model not found" with its two explanations; the URL is rewritten to
      `sp` (+ `in`, `rep`). `deeplink_mdl_key{resolution}` logged.
- [ ] No merged-surface flash before a deep-linked input draws (the "jigger", §11.12).
- [ ] Document title `"{sci} distribution ({cat}[: {common}]; {key}) from {layer} | Marine Sensitivity"`.
- [ ] Welcome modal, release picker, tour (the old five steps), theme toggle, the ten analytics events.

**OBIS occurrences (§6.4), behind `capabilities`/service availability**
- [ ] Port `obis_h3t_sql()` and `obis_h3t_url()` (pure string builders) and the `h3tiles://` protocol
      handler from `marinebon/obisindicators`; breaks = 5 steps between `p02` and `p98` from
      `/h3t/stats`; viridis-5 fill at 0.6; legend bottom-left; WoRMS AphiaID required, with the two notices.
      The toggle hides itself when `h3t.marinesensitivity.org` does not answer within 3 s.

**New, cheap, and consistent with a static app**
- [ ] Share (copy link) and "Download this layer" (the public COG / PMTiles URL) in the card.
- [ ] With a place active, its outline stays on the map across the lens switch.
