import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";

// atlas-0 Step 4, S2 ("first paint without WASM"). Shell + MapLibre + the v7 zones PMTiles + one
// score COG through titiler, fed only by the real v7/manifest.json (zones pmtiles url, score cog
// url, rescale, colormap) -- boot.json (public/boot.json) is a hand-built STUB of that plus
// zone_metric.parquet values pasted as JSON (boot.json itself doesn't exist until atlas-1). No
// DuckDB-WASM anywhere in this module's normal path -- that's the whole point of the gate.

// register the pmtiles:// protocol once (atlas-refs "calcofi explore review.md" §5:
// maplibregl.addProtocol("pmtiles", new Protocol().tile)).
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

const TITILER = "https://titiler-v8.marinesensitivity.org";

interface ProgramArea {
  key: string;
  score: number;
}
interface FlowerComponent {
  metric_key: string;
  label: string;
  value: number;
}
interface Boot {
  ver: string;
  zones: { zone_set_key: string; fld: string; n: number; pmtiles: string };
  score: {
    metric_key: string;
    subregion_key: string;
    cog: string;
    rescale_min: number;
    rescale_max: number;
    colormap: string;
  };
  programAreas: ProgramArea[];
  flower: { zone_key: string; components: FlowerComponent[] };
  oceanProbePoints: { lon: number; lat: number; label: string }[];
}

// window.__s2: read by e2e/s2.spike.spec.ts and scripts/measure.mjs. `marks` are
// performance.now() timestamps (ms since navigation start, same clock as the Performance API's
// paint entries) for the milestones this spike measures (plan Step 4: "Record FCP / map-first-frame
// on a cold profile").
declare global {
  interface Window {
    __s2: {
      seed: string | null;
      marks: Record<string, number>;
      boot?: Boot;
      map?: maplibregl.Map;
    };
  }
}
window.__s2 = { seed: new URLSearchParams(location.search).get("seed"), marks: {} };
function mark(name: string): void {
  window.__s2.marks[name] = performance.now();
}
mark("scriptStart");

// --- seeded fault (a) (plan Step 4 Review checklist): "a variant that statically imports (or
// fetches) a duckdb-named asset before first frame must make the spec FAIL." The import below is
// static and unconditional -- always part of this module's import graph, exactly like a real
// accidentally-static duckdb import would be -- but the eager *fetch* (the thing
// e2e/s2.spike.spec.ts's network-request assertion actually catches) only fires under
// ?seed=duckdb-fetch, so the default/normal path never touches the network for it.
import duckdbFaultAssetUrl from "./duckdb-marker.bin?url";
if (window.__s2.seed === "duckdb-fetch") {
  // before first frame: fired synchronously at module load, well before createMap() below runs.
  void fetch(duckdbFaultAssetUrl);
}

const BLANK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

function composeStyle(boot: Boot): StyleSpecification {
  const cogUrl = encodeURIComponent(boot.score.cog);
  const scoreTile =
    `${TITILER}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?url=${cogUrl}` +
    `&rescale=${boot.score.rescale_min},${boot.score.rescale_max}&colormap_name=${boot.score.colormap}`;
  return {
    version: 8,
    sources: {
      score: { type: "raster", tiles: [scoreTile], tileSize: 256 },
      zones: { type: "vector", url: `pmtiles://${boot.zones.pmtiles}` },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b2436" } },
      { id: "score", type: "raster", source: "score" },
      {
        id: "zones-line",
        type: "line",
        source: "zones",
        // the pmtiles archive's vector_layers metadata names this layer "programarea" (checked
        // with the `pmtiles` JS SDK against the published archive, tippecanoe -l programarea).
        "source-layer": "programarea",
        paint: { "line-color": "#e8f1f2", "line-width": 1 },
      },
    ],
  };
}

function renderProgramAreaTable(rows: ProgramArea[]): void {
  const tbody = document.querySelector<HTMLTableSectionElement>("#program-area-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const tdKey = document.createElement("td");
    tdKey.textContent = row.key;
    const tdScore = document.createElement("td");
    tdScore.textContent = row.score.toFixed(1);
    tr.append(tdKey, tdScore);
    tbody.appendChild(tr);
  }
}

// a small radar/"flower" chart: one petal per score component, real ecoregion-rescaled [0,100]
// values from boot.json (sourced from zone_metric.parquet -- see public/boot.json's _comment).
// petal count is whatever the zone actually has (7 or 8: not every program area has turtle data).
function renderFlower(flower: Boot["flower"]): void {
  const zoneLabel = document.querySelector("#flower-zone");
  if (zoneLabel) zoneLabel.textContent = flower.zone_key;
  const svg = document.querySelector<SVGSVGElement>("#flower");
  if (!svg) return;
  const cx = 110;
  const cy = 110;
  const rMax = 90;
  const n = flower.components.length;
  const points: string[] = [];
  let petalsHtml = "";
  flower.components.forEach((c, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (Math.max(0, Math.min(100, c.value)) / 100) * rMax;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    petalsHtml += `<circle class="petal" data-label="${c.label}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#7fd1ae" />`;
  });
  svg.innerHTML =
    `<circle cx="${cx}" cy="${cy}" r="${rMax}" fill="none" stroke="rgba(255,255,255,0.2)" />` +
    `<polygon points="${points.join(" ")}" fill="rgba(127,209,174,0.35)" stroke="#7fd1ae" stroke-width="2" />` +
    petalsHtml;
}

async function boot(): Promise<void> {
  const res = await fetch("boot.json");
  const bootData: Boot = await res.json();
  window.__s2.boot = bootData;
  mark("bootFetched");

  renderProgramAreaTable(bootData.programAreas);
  renderFlower(bootData.flower);

  // seeded fault (b) (plan Step 4 Review checklist): "an unpainted canvas (style with no layers)
  // must make the pixel probe FAIL." ?seed=blank-style skips the composed style entirely.
  const composed = window.__s2.seed === "blank-style" ? BLANK_STYLE : composeStyle(bootData);

  const map = new maplibregl.Map({
    container: "map",
    style: BLANK_STYLE,
    center: [-96, 38],
    zoom: 3,
    attributionControl: false,
    // required so a readPixels() call from OUTSIDE the render loop (Playwright's page.evaluate,
    // or html-to-image-style capture) can read back the last-drawn frame at all -- a canvas
    // without this clears its backbuffer once it's presented (atlas-refs "calcofi explore
    // review.md" §5: "preserveDrawingBuffer: true ... is required so ... capture can read back the
    // WebGL canvas"). NOTE this key moved under canvasContextAttributes in maplibre-gl 5.x/6.x --
    // a bare top-level preserveDrawingBuffer (the CalCOFI-era / pre-v3 shape) is silently ignored
    // by the types, which is exactly what a readPixels probe run from Playwright will surface as
    // an always-(0,0,0,0) canvas even though the map visibly renders (found by running this
    // harness -- see RESULTS.md).
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  window.__s2.map = map;
  // found by running this harness (see RESULTS.md): the raster ("score") source's tile loading
  // was flaky under headless Chromium+swiftshader -- sometimes never fired a single tile request.
  // An explicit resize() right after construction (forces MapLibre to re-measure the (possibly
  // not-yet-laid-out) container and re-evaluate which tiles the current viewport needs) made it
  // reliable across repeated runs.
  map.resize();

  // atlas-refs "calcofi explore review.md" §5 / §11 lesson 3: compose the WHOLE style as one
  // object and apply it with setStyle({diff:true}); never addLayer() piecemeal after load.
  map.setStyle(composed, { diff: true });

  map.once("render", () => mark("firstRender"));
  map.once("idle", () => mark("idle"));
}

void boot();
