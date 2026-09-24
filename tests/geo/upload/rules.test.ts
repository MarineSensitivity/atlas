// Every rule of atlas-6 Deliverable 4, one test with one fixture each — never one broad
// end-to-end assertion, which would hide WHICH rule broke (CLAUDE.md, testing pyramid 1).
//
// The rules, in the order the deliverable states them and the order this file walks:
//   1 size (file, and a zip's declared contents)  2 parse  3 polygons only  4 coordinates finite,
//   in range, not projected  5 <= 50 k vertices  6 rings closed / wound / holes kept
//   7 self-intersection  8 the antimeridian  9 one place per feature or one union  10 study area
//   (the caller's hook).
import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  MAX_PLACES,
  MAX_VERTICES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  checkSize,
  detectNameProperty,
  normalizeParsed,
  normalizeUpload,
  plainText,
  rewind,
  type NormalizeResult,
} from "../../../src/lib/geo/upload/normalize";
import { ringArea2, type AreaGeometry } from "../../../src/lib/geo/types";
import { fixtureBytes, textBytes, xmlParse } from "./support";
import * as h from "./hostile";

const refusalOf = (r: NormalizeResult): { rule: string; what: string } => {
  if (r.ok) throw new Error("expected a refusal, got places");
  return r.refusal;
};
const placesOf = (r: NormalizeResult) => {
  if (!r.ok) throw new Error(`expected places, got ${r.refusal.rule}: ${r.refusal.what}`);
  return r.places;
};

const geo = (text: string, name = "case.geojson", options = {}) =>
  normalizeUpload({ name, bytes: textBytes(text) }, options, { xmlParse });

const fc = (geometry: unknown, properties: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties, geometry }],
  });

const box = (x0: number, y0: number, x1: number, y1: number) =>
  fc({
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
        [x0, y0],
      ],
    ],
  });

// ---- rule 1: size, checked BEFORE extraction ---------------------------------------------------

describe("rule 1 · size", () => {
  it("refuses a file over 10 MB by its byte length", () => {
    const r = checkSize("huge.geojson", new Uint8Array(MAX_FILE_BYTES + 1));
    expect(r?.rule).toBe("fileTooLarge");
    expect(r?.what).toContain("10.0 MB");
  });

  it("lets a file exactly at the limit through", () => {
    expect(checkSize("edge.geojson", new Uint8Array(MAX_FILE_BYTES))).toBeNull();
  });

  it("refuses a zip whose OWN INDEX declares 60 MB — before a byte is unpacked", async () => {
    const r = refusalOf(await normalizeUpload({ name: "bomb.zip", bytes: h.zipBomb() }));
    expect(r.rule).toBe("zipUncompressedTooLarge");
    expect(r.what).toContain("60.0 MB");
    expect(MAX_ZIP_UNCOMPRESSED_BYTES).toBe(50 * 1024 * 1024);
  });

  it("refuses a 300-entry zip", async () => {
    const r = refusalOf(await normalizeUpload({ name: "many.zip", bytes: h.zipWith300Entries() }));
    expect(r.rule).toBe("zipTooManyEntries");
    expect(r.what).toContain("300");
    expect(MAX_ZIP_ENTRIES).toBe(200);
  });

  it("refuses a zip whose index cannot be read at all", () => {
    expect(checkSize("torn.zip", fixtureBytes("gulf_rectangle.zip").slice(0, 200))?.rule).toBe(
      "zipUnreadable",
    );
  });

  it("says nothing about a non-zip: the zip rules are zip rules", () => {
    expect(checkSize("place.geojson", textBytes(box(-93, 26, -91, 28)))).toBeNull();
  });
});

// ---- rule 2: parse ------------------------------------------------------------------------------

describe("rule 2 · parse", () => {
  it("a format nothing here reads is named, not called invalid", async () => {
    const r = refusalOf(await normalizeUpload({ name: "notes.txt", bytes: textBytes("hello") }));
    expect(r.rule).toBe("unknownFormat");
    expect(r.what).toContain("notes.txt");
  });

  it("a truncated file of a known format says where it stopped", async () => {
    const r = refusalOf(await geo('{"type":"FeatureCollection","features":[', "torn.geojson"));
    expect(r.rule).toBe("parseFailed");
    expect(r.what).toContain("GeoJSON");
  });

  it("a valid but empty layer is not a parse failure", async () => {
    const r = refusalOf(await geo('{"type":"FeatureCollection","features":[]}'));
    expect(r.rule).toBe("noFeatures");
  });
});

// ---- rule 3: polygons only ----------------------------------------------------------------------

describe("rule 3 · polygons only, never buffered", () => {
  it("refuses a point and names it", async () => {
    const r = refusalOf(await geo(h.pointOnly()));
    expect(r.rule).toBe("notPolygon");
    expect(r.what).toContain("a Point");
  });

  it("refuses a line, and the refusal explains why it is not buffered", async () => {
    const r = refusalOf(await geo(h.lineOnly()));
    expect(r.rule).toBe("notPolygon");
    expect(refusalOf(await geo(h.lineOnly())).what).toContain("LineString");
  });

  it("refuses the 40k-vertex coastline for being a line, not for its size", async () => {
    // 40,000 vertices is UNDER the 50 k cap: the fixture proves the rules fire in the stated order.
    const r = refusalOf(
      await normalizeUpload({
        name: "coastline_40k.fgb",
        bytes: fixtureBytes("coastline_40k.fgb"),
      }),
    );
    expect(r.rule).toBe("notPolygon");
  });

  it("refuses a feature with no geometry at all", async () => {
    const r = refusalOf(await geo(fc(null)));
    expect(r.rule).toBe("noGeometry");
  });

  it("accepts a GeometryCollection of areas, and refuses a mixed one", async () => {
    const both = fc({
      type: "GeometryCollection",
      geometries: [
        JSON.parse(box(-93, 26, -92, 27)).features[0].geometry,
        JSON.parse(box(-91, 26, -90, 27)).features[0].geometry,
      ],
    });
    expect(placesOf(await geo(both))[0].geometry.type).toBe("MultiPolygon");
    const mixed = fc({
      type: "GeometryCollection",
      geometries: [
        JSON.parse(box(-93, 26, -92, 27)).features[0].geometry,
        { type: "Point", coordinates: [-91, 27] },
      ],
    });
    expect(refusalOf(await geo(mixed)).rule).toBe("notPolygon");
  });

  it("a GPX track that closes is an area; one that does not is refused by name", async () => {
    const closed = await normalizeUpload(
      { name: "gulf_rectangle.gpx", bytes: fixtureBytes("gulf_rectangle.gpx") },
      {},
      { xmlParse },
    );
    expect(placesOf(closed)[0].geometry.type).toBe("Polygon");
    const open = await normalizeUpload(
      { name: "open_track.gpx", bytes: fixtureBytes("open_track.gpx") },
      {},
      { xmlParse },
    );
    expect(refusalOf(open).rule).toBe("gpxTrackNotClosed");
  });
});

// ---- rule 4: coordinates ------------------------------------------------------------------------

describe("rule 4 · finite, in range, and not projected", () => {
  it("refuses a null coordinate and says which vertex", async () => {
    const broken = fc({
      type: "Polygon",
      coordinates: [
        [
          [-93, 26],
          [null, 27],
          [-91, 28],
          [-93, 26],
        ],
      ],
    });
    const r = refusalOf(await geo(broken));
    expect(r.rule).toBe("coordinatesNotFinite");
    expect(r.what).toContain("vertex 2");
  });

  it("refuses projected metres in a file that declares NO coordinate system", async () => {
    // the whole reason this gate exists: shpjs returns these metres SILENTLY (S4, console `[]`)
    const r = refusalOf(
      await normalizeUpload({
        name: "utm_zone_noprj.zip",
        bytes: fixtureBytes("utm_zone_noprj.zip"),
      }),
    );
    expect(r.rule).toBe("projectedCoordinates");
    expect(r.what).toContain("4,320,000");
  });

  it("refuses pasted WKT in metres for the same reason (WKT carries no CRS at all)", async () => {
    const r = refusalOf(
      await normalizeUpload({ name: "utm_zone.wkt", bytes: fixtureBytes("utm_zone.wkt") }),
    );
    expect(r.rule).toBe("projectedCoordinates");
  });

  it("a DECLARED projected CRS is authoritative, even when the numbers look like degrees", () => {
    // FlatGeobuf's header carries EPSG:32610 correctly and the reader never reprojects (S4)
    const r = refusalOf(
      normalizeParsed({
        format: "flatgeobuf",
        fileName: "small.fgb",
        crs: { raw: "EPSG:32610", kind: "projected", reprojected: false },
        features: [
          {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [1, 2],
                  [1, 3],
                  [2, 3],
                  [1, 2],
                ],
              ],
            },
            properties: {},
          },
        ],
      }),
    );
    expect(r.rule).toBe("projectedCrs");
    expect(r.what).toContain("EPSG:32610");
  });

  it("a shapefile WITH a .prj is reprojected by shpjs and passes", async () => {
    const places = placesOf(
      await normalizeUpload({ name: "utm_zone.zip", bytes: fixtureBytes("utm_zone.zip") }),
    );
    expect(places[0].bbox[1]).toBeGreaterThan(38);
    expect(places[0].bbox[3]).toBeLessThan(40);
  });

  it("a latitude past 90 in a file that says it is WGS84 is out of range, not projected", () => {
    const r = refusalOf(
      normalizeParsed({
        format: "kml",
        fileName: "odd.kml",
        crs: { raw: "EPSG:4326", kind: "geographic", reprojected: false },
        features: [
          {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [1, 2],
                  [1, 95],
                  [2, 3],
                  [1, 2],
                ],
              ],
            },
            properties: {},
          },
        ],
      }),
    );
    expect(r.rule).toBe("coordinatesOutOfRange");
  });

  it("accepts a file written ALREADY unwrapped past 180 (170 to 200)", async () => {
    // usa05 IS a 0-360 grid and unwrapRing() carries a Bering place out to 183, so a longitude past
    // 180 is ordinary here: the magnitude test's longitude threshold is a whole turn, not half of one
    expect(placesOf(await geo(box(170, 50, 200, 52)))[0].bbox).toEqual([170, 50, 200, 52]);
  });

  it("still refuses a longitude past a whole turn in a file that declares WGS84", async () => {
    const r = refusalOf(
      await geo(
        JSON.stringify({
          type: "FeatureCollection",
          crs: { type: "name", properties: { name: "EPSG:4326" } },
          features: JSON.parse(box(400, 10, 402, 12)).features,
        }),
      ),
    );
    expect(r.rule).toBe("coordinatesOutOfRange");
  });
});

// ---- rule 5: vertices ---------------------------------------------------------------------------

describe("rule 5 · at most 50 k vertices", () => {
  // a convex polygon, so the ONLY thing this case can fail on is the vertex count
  const ring = (n: number) => {
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return [-91 + Math.cos(a), 27 + 0.5 * Math.sin(a)];
    });
    return [...pts, pts[0]];
  };

  it("refuses more than the cap and states both numbers", async () => {
    const r = refusalOf(await geo(fc({ type: "Polygon", coordinates: [ring(MAX_VERTICES + 5)] })));
    expect(r.rule).toBe("tooManyVertices");
    expect(r.what).toContain("50,000");
  });

  it("accepts a place just under it", async () => {
    expect(placesOf(await geo(fc({ type: "Polygon", coordinates: [ring(1000)] })))).toHaveLength(1);
  });
});

// ---- rule 6: rings ------------------------------------------------------------------------------

describe("rule 6 · rings closed, RFC 7946 winding, holes kept", () => {
  it("closes a ring the file left open", async () => {
    const open = fc({
      type: "Polygon",
      coordinates: [
        [
          [-93, 26],
          [-91, 26],
          [-91, 28],
        ],
      ],
    });
    const g = placesOf(await geo(open))[0].geometry as AreaGeometry & { type: "Polygon" };
    expect(g.coordinates[0][0]).toEqual(g.coordinates[0][g.coordinates[0].length - 1]);
    expect(g.coordinates[0]).toHaveLength(4);
  });

  it("turns a CLOCKWISE exterior ring counterclockwise", async () => {
    // every rectangle in generate_fixtures.R is written CW on purpose
    const g = placesOf(await geo(box(-93, 26, -91, 28)))[0].geometry as AreaGeometry & {
      type: "Polygon";
    };
    expect(ringArea2(g.coordinates[0])).toBeGreaterThan(0);
  });

  it("keeps a hole, and gives it the OPPOSITE winding", async () => {
    const g = placesOf(await geo(h.squareWithHole()))[0].geometry as AreaGeometry & {
      type: "Polygon";
    };
    expect(g.coordinates).toHaveLength(2);
    expect(ringArea2(g.coordinates[0])).toBeGreaterThan(0);
    expect(ringArea2(g.coordinates[1])).toBeLessThan(0);
  });

  it("rewind() is idempotent: normalizing a normalized geometry changes nothing", async () => {
    const g = placesOf(await geo(h.squareWithHole()))[0].geometry;
    expect(rewind(g)).toEqual(g);
  });

  it("refuses a ring with only two distinct corners", async () => {
    const r = refusalOf(
      await geo(
        fc({
          type: "Polygon",
          coordinates: [
            [
              [-93, 26],
              [-91, 28],
              [-93, 26],
            ],
          ],
        }),
      ),
    );
    expect(r.rule).toBe("ringTooShort");
  });
});

// ---- rule 7: self-intersection -------------------------------------------------------------------

describe("rule 7 · self-intersection", () => {
  it("refuses a bow-tie and reports the crossing's coordinates and vertex indices", async () => {
    const r = refusalOf(await geo(h.bowTie(), "bowtie.geojson"));
    expect(r.rule).toBe("selfIntersection");
    expect(r.what).toContain("-92.00000, 27.00000");
    expect(r.what).toMatch(/vertex \d+ of ring 1/);
  });

  it("does NOT refuse a clean outline with a repeated vertex (a touch is not a crossing)", async () => {
    const touching = fc({
      type: "Polygon",
      coordinates: [
        [
          [-93, 26],
          [-92, 27],
          [-91, 26],
          [-91, 28],
          [-92, 27],
          [-93, 28],
          [-93, 26],
        ],
      ],
    });
    expect(placesOf(await geo(touching))).toHaveLength(1);
  });

  it("catches a hole that cuts through its own outer ring", async () => {
    const cut = fc({
      type: "Polygon",
      coordinates: [
        [
          [-93, 26],
          [-93, 29],
          [-90, 29],
          [-90, 26],
          [-93, 26],
        ],
        [
          [-91, 27],
          [-89, 27],
          [-89, 28],
          [-91, 28],
          [-91, 27],
        ],
      ],
    });
    const r = refusalOf(await geo(cut));
    expect(r.rule).toBe("selfIntersection");
    expect(r.what).toContain("ring 2");
  });

  it("stays fast on a big clean outline (the grid index, not all pairs)", async () => {
    const n = 20000;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return [-91 + Math.cos(a), 27 + Math.sin(a)];
    });
    const t0 = performance.now();
    expect(
      placesOf(await geo(fc({ type: "Polygon", coordinates: [[...pts, pts[0]]] }))),
    ).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(10000);
  });
});

// ---- rule 8: the antimeridian ---------------------------------------------------------------------

describe("rule 8 · 180 degrees, through unwrapRing() and the seam join only", () => {
  it("a wrapped ring becomes one continuous frame with a 5-degree bbox, not 355", async () => {
    const p = placesOf(await geo(h.aleutianWrapped(), "wrapped.geojson"))[0];
    expect(p.bbox).toEqual([178, 51, 183, 53]);
  });

  it("RFC 7946 halves touching +/-180 are joined into one ring", async () => {
    const p = placesOf(await geo(h.aleutianSplit(), "split.geojson"))[0];
    expect(p.geometry.type).toBe("Polygon");
    expect(p.bbox).toEqual([178, 51, 183, 53]);
  });

  it("leaves an ordinary mid-Pacific place alone (the rule fires on the cut, nothing else)", async () => {
    expect(placesOf(await geo(box(-170, 20, -160, 25)))[0].bbox).toEqual([-170, 20, -160, 25]);
  });
});

// ---- rule 9: many features -------------------------------------------------------------------------

describe("rule 9 · one place per feature, or one union", () => {
  const many = (n: number) =>
    JSON.stringify({
      type: "FeatureCollection",
      features: Array.from({ length: n }, (_, i) => ({
        type: "Feature",
        properties: { label: `zone ${i + 1}` },
        geometry: JSON.parse(box(-93 + i * 0.1, 26, -92.95 + i * 0.1, 27)).features[0].geometry,
      })),
    });

  it("makes one place per feature and takes the name from the chosen property", async () => {
    const places = placesOf(await geo(many(3), "zones.geojson", { nameProperty: "label" }));
    expect(places.map((p) => p.name)).toEqual(["zone 1", "zone 2", "zone 3"]);
    expect(places.map((p) => p.sourceIndex)).toEqual([0, 1, 2]);
  });

  it("falls back to the file name, numbered, when the property is missing", async () => {
    const places = placesOf(await geo(many(2), "zones.geojson", { nameProperty: "absent" }));
    expect(places.map((p) => p.name)).toEqual(["zones 1", "zones 2"]);
  });

  it("refuses more than 20, rather than silently keeping the first 20", async () => {
    const r = refusalOf(await geo(many(21), "zones.geojson", { nameProperty: "label" }));
    expect(r.rule).toBe("tooManyFeatures");
    expect(r.what).toContain("21");
    expect(MAX_PLACES).toBe(20);
  });

  it("union makes ONE place of any number of features", async () => {
    const places = placesOf(await geo(many(30), "zones.geojson", { multiFeature: "union" }));
    expect(places).toHaveLength(1);
    expect(places[0].geometry.type).toBe("MultiPolygon");
    expect(places[0].sourceIndex).toBe(-1);
  });
});

// ---- feature name attribute: auto-detected when not specified (Q2 fix) ------------------------------
//
// docs/upload.md documented `nameProperty: "NAME", // chosen by the person from the file's property
// list` as a naming option, but the ONE caller (UploadPanel.svelte) never passed it -- every upload
// was named from the file, numbered, regardless of what the file itself said about its own
// features. `detectNameProperty()` (normalize.ts) is the fix: when the option is left out
// altogether, it auto-picks the first of name/title/label (case-insensitive) the FIRST feature
// carries a non-empty value for.

describe("feature name attribute: auto-detected when nameProperty is not specified (Q2 fix)", () => {
  const geomA = () => JSON.parse(box(-93, 26, -91, 28)).features[0].geometry;

  it("picks up a 'name' property with no nameProperty option at all", async () => {
    const places = placesOf(await geo(fc(geomA(), { name: "Point Arena Box" }), "f.geojson"));
    expect(places[0].name).toBe("Point Arena Box");
  });

  it("matches case-insensitively -- KML's own <name>, and a shapefile's NAME field, both count", async () => {
    const places = placesOf(await geo(fc(geomA(), { NAME: "Upper Case" }), "f.geojson"));
    expect(places[0].name).toBe("Upper Case");
  });

  it("prefers name over title over label, in that priority order", async () => {
    const allThree = placesOf(
      await geo(fc(geomA(), { label: "L", title: "T", name: "N" }), "f.geojson"),
    );
    expect(allThree[0].name).toBe("N");
    const titleOnly = placesOf(await geo(fc(geomA(), { label: "L", title: "T" }), "f.geojson"));
    expect(titleOnly[0].name).toBe("T");
  });

  it("falls through to the file-derived name when none of the candidate keys are present", async () => {
    const places = placesOf(await geo(fc(geomA(), { id: 1 }), "my_place.geojson"));
    expect(places[0].name).toBe("my_place");
  });

  it("falls through when the candidate key's own value is empty", async () => {
    const places = placesOf(await geo(fc(geomA(), { name: "   " }), "my_place.geojson"));
    expect(places[0].name).toBe("my_place");
  });

  it("an explicit nameProperty: null forces the file name even when a name property exists", async () => {
    const places = placesOf(
      await geo(fc(geomA(), { name: "Ignored" }), "my_place.geojson", { nameProperty: null }),
    );
    expect(places[0].name).toBe("my_place");
  });

  it("an explicit nameProperty still wins over auto-detection", async () => {
    const places = placesOf(
      await geo(fc(geomA(), { name: "Auto", label: "Explicit" }), "f.geojson", {
        nameProperty: "label",
      }),
    );
    expect(places[0].name).toBe("Explicit");
  });

  // detectNameProperty() directly -- the function the tests above exercise end to end.
  it("detectNameProperty(): returns the KEY (not the value), and null on no candidate/no properties", () => {
    expect(detectNameProperty({ NAME: "x" })).toBe("NAME");
    expect(detectNameProperty({ id: 1 })).toBeNull();
    expect(detectNameProperty({})).toBeNull();
    expect(detectNameProperty(undefined)).toBeNull();
    expect(detectNameProperty({ name: "" })).toBeNull(); // empty value: not a usable candidate
    expect(detectNameProperty({ name: 42 })).toBe("name"); // coerced by plainText, same as nameOf()
  });
});

// ---- rule 10: the study area is the CALLER's -------------------------------------------------------

describe("rule 10 · the study-area check is a hook, not an implementation", () => {
  it("is not applied when the caller supplies none", async () => {
    expect(placesOf(await geo(box(20, 40, 21, 41)))).toHaveLength(1); // the Mediterranean
  });

  it("is applied to the finished places when the caller does supply one", async () => {
    const outside = { rule: "outsideStudyArea", what: "w", why: "y", fix: "f" };
    let seen = 0;
    const r = await geo(box(20, 40, 21, 41), "med.geojson", {
      studyArea: (places: { name: string }[]) => {
        seen = places.length;
        return outside;
      },
    });
    expect(seen).toBe(1);
    expect(refusalOf(r)).toEqual(outside);
  });
});

// ---- names --------------------------------------------------------------------------------------

describe("only the chosen name survives, and it is plain text", () => {
  it("drops every other property", async () => {
    const places = placesOf(
      await geo(
        fc(JSON.parse(box(-93, 26, -91, 28)).features[0].geometry, {
          label: "Kept",
          secret: "dropped",
        }),
        "f.geojson",
        { nameProperty: "label" },
      ),
    );
    expect(Object.keys(places[0])).toEqual(["name", "geometry", "bbox", "vertices", "sourceIndex"]);
    expect(JSON.stringify(places[0])).not.toContain("dropped");
  });

  it("caps a name at 60 characters and collapses whitespace runs", () => {
    expect(plainText("  a\n\n  b  ")).toBe("a b");
    expect(plainText("x".repeat(80))).toHaveLength(60);
  });

  it("coerces a numeric property rather than dropping it", () => {
    expect(plainText(42)).toBe("42");
  });
});
