// geo/upload/messages.ts — the whole refusal catalogue, in one file so the panel can render it and
// one test can assert the rules it has to obey (atlas-6 Deliverable 4, `design:ux-copy`).
//
// THE COPY RULE. Every refusal says three things: WHAT happened (concretely, with the number or the
// name that decided it), WHY (the reason, not the rule number), and the FIX the person can actually
// carry out. None of them says "invalid file", "bad file", "malformed" or "error": those tell a
// person nothing they can act on, and the subplan's review checklist calls that out by name.
// `tests/geo/upload/messages.test.ts` drives EVERY builder here and fails on any banned word, so a
// message added later cannot quietly reintroduce one.
import type { Refusal } from "./types";

/** rounded to one decimal, in MB, the way a file manager shows it. */
export function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const R = (rule: string, what: string, why: string, fix: string): Refusal => ({
  rule,
  what,
  why,
  fix,
});

// ---- rule 1: size, before anything is parsed or extracted --------------------------------------

export const fileTooLarge = (fileName: string, bytes: number, limit: number): Refusal =>
  R(
    "fileTooLarge",
    `${fileName} is ${mb(bytes)}, and this app reads files up to ${mb(limit)}.`,
    "Everything happens in your browser tab — a file this size would freeze it before a single shape appeared on the map.",
    "Export just the area you want to score, or simplify the outline in your GIS, and drop the smaller file.",
  );

export const zipUncompressedTooLarge = (
  fileName: string,
  declaredBytes: number,
  limit: number,
): Refusal =>
  R(
    "zipUncompressedTooLarge",
    `${fileName} packs ${mb(declaredBytes)} of files inside it, and this app unpacks up to ${mb(limit)}.`,
    "The size is read from the zip's own index before anything is unpacked, so a small download that expands enormously is stopped here rather than in your browser's memory.",
    "Zip up just the .shp, .shx, .dbf and .prj of the layer you want, and drop that.",
  );

export const zipTooManyEntries = (fileName: string, count: number, limit: number): Refusal =>
  R(
    "zipTooManyEntries",
    `${fileName} contains ${count} files, and this app opens zips of up to ${limit}.`,
    "A shapefile is four to seven files; a zip with hundreds is an archive of many layers, and there is no way to tell which one you meant.",
    "Zip one layer on its own — the .shp with its .shx, .dbf and .prj beside it — and drop that.",
  );

export const zipUnreadable = (fileName: string, detail: string): Refusal =>
  R(
    "zipUnreadable",
    `${fileName} ends with a zip index this app could not read (${detail}).`,
    "Every zip carries a table of contents at the end; without it there is no way to know what is inside before unpacking it, and unpacking something unmeasured is the one thing this app will not do.",
    "Re-zip the shapefile with your operating system's own “compress” command, or export the layer as GeoJSON instead.",
  );

// ---- rule 2: format and parse ------------------------------------------------------------------

export const unknownFormat = (fileName: string, evidence: string): Refusal =>
  R(
    "unknownFormat",
    `${fileName} is not one of the formats this app reads (${evidence}).`,
    "Places are read from GeoJSON, a zipped shapefile, KML, GPX, FlatGeobuf, pasted WKT, or a GeoPackage — the file's first bytes match none of those.",
    "Export the layer as GeoJSON, or zip the shapefile (.shp, .shx, .dbf and .prj together) and drop that.",
  );

export const parseFailed = (fileName: string, format: string, detail: string): Refusal =>
  R(
    "parseFailed",
    `${fileName} was read as ${format} and stopped part way through: ${detail}.`,
    "The first bytes say the format, but the contents do not follow it all the way — usually a partial download or an export that was interrupted.",
    "Download or export the file again and drop the fresh copy; if it keeps stopping, export the same layer as GeoJSON.",
  );

export const noFeatures = (fileName: string): Refusal =>
  R(
    "noFeatures",
    `${fileName} read cleanly and contains no shapes.`,
    "The file is a valid, empty layer — a filter or a selection that matched nothing when it was exported.",
    "Re-export with the features selected, and check the layer is not empty in your GIS first.",
  );

// ---- rule 3: polygons only ---------------------------------------------------------------------

export const notPolygon = (fileName: string, found: string): Refusal =>
  R(
    "notPolygon",
    `${fileName} contains ${found}, and a place has to be an area.`,
    "Scores are averaged over the cells a place covers, and a point or a line covers none — this app will not invent a width for them by buffering, because the number that came back would be the buffer's, not yours.",
    "Draw the area you mean with the polygon tool, or buffer the line in your GIS by a distance you choose and export the result.",
  );

export const noGeometry = (fileName: string, index: number): Refusal =>
  R(
    "noGeometry",
    `Feature ${index + 1} of ${fileName} carries attributes but no shape.`,
    "A row with an empty geometry column covers no cells, so it has no scores to show.",
    "Remove the empty rows in your GIS, or export with “only selected features”, and drop the file again.",
  );

export const gpxTrackNotClosed = (fileName: string): Refusal =>
  R(
    "gpxTrackNotClosed",
    `${fileName} is a GPX track that does not return to where it started.`,
    "GPX records routes and tracks, never areas, so the only track that can describe a place is one whose last point is its first — and closing it here would mean inventing the edge you did not walk.",
    "Close the loop in your GPS software so the last point repeats the first, or export the area as GeoJSON or KML instead.",
  );

// ---- rule 4: coordinates finite, in range, and not projected -----------------------------------

export const coordinatesNotFinite = (fileName: string, where: string): Refusal =>
  R(
    "coordinatesNotFinite",
    `${fileName} has a coordinate that is not a number (${where}).`,
    "A missing or non-numeric coordinate has no place on the map, and carrying it through would put the whole outline somewhere arbitrary.",
    "Open the layer in your GIS, delete or repair the vertices with empty coordinates, and export it again.",
  );

export const coordinatesOutOfRange = (fileName: string, where: string): Refusal =>
  R(
    "coordinatesOutOfRange",
    `${fileName} says it is in longitude/latitude degrees but contains ${where}.`,
    "Latitude stops at 90, and no longitude is more than a full turn from the prime meridian, so this value is not the degrees the file claims — the coordinates and the coordinate system disagree with each other.",
    "Re-export the layer as WGS84 / EPSG:4326, and check the layer's declared coordinate system matches the numbers in it.",
  );

export const projectedCoordinates = (fileName: string, where: string): Refusal =>
  R(
    "projectedCoordinates",
    `${fileName} carries no coordinate system and its coordinates look like projected metres (${where}).`,
    "Degrees stop at 180 and 90, so these are metres from some projection's origin — and with no coordinate system written down there is nothing to convert them with. Read as degrees they would land in the wrong ocean and still return a score, which is the one outcome worth refusing.",
    "Re-export as WGS84 / EPSG:4326, or include the .prj file in the zip so the projection travels with the shapefile.",
  );

export const projectedCrs = (fileName: string, crs: string): Refusal =>
  R(
    "projectedCrs",
    `${fileName} is in ${crs}, a projected coordinate system, and this app reads longitude/latitude.`,
    "The file says so itself in its header, and this app does not carry the projection library needed to convert it — guessing from the numbers instead is how a California polygon ends up scored in the Arctic.",
    "Re-project the layer to WGS84 / EPSG:4326 in your GIS and export it again; a zipped shapefile with its .prj is converted for you.",
  );

// ---- rule 5: vertex budget ---------------------------------------------------------------------

export const tooManyVertices = (fileName: string, count: number, limit: number): Refusal =>
  R(
    "tooManyVertices",
    `${fileName} has ${count.toLocaleString("en-US")} vertices, and a place is scored up to ${limit.toLocaleString("en-US")}.`,
    "Every vertex is carried in the link that reproduces this view, and an outline this detailed changes no score at this app's 0.05° cell size — it only makes the link unshareable.",
    "Simplify the outline to about 0.001° in your GIS (QGIS: Vector › Geometry Tools › Simplify) and export it again.",
  );

// ---- rule 6: rings ------------------------------------------------------------------------------

export const ringTooShort = (fileName: string, index: number, count: number): Refusal =>
  R(
    "ringTooShort",
    `Ring ${index + 1} of ${fileName} has only ${count} distinct corners, and an area needs at least three.`,
    "Two corners describe a line with no inside, so there is no area to measure cells against.",
    "Check that ring in your GIS — it is usually a leftover from an edit — delete it, and export the layer again.",
  );

// ---- rule 7: self-intersection -------------------------------------------------------------------

export const selfIntersection = (
  fileName: string,
  a: { ring: number; vertex: number },
  b: { ring: number; vertex: number },
  at: readonly [number, number],
): Refusal =>
  R(
    "selfIntersection",
    `The outline in ${fileName} crosses itself at ${at[0].toFixed(5)}, ${at[1].toFixed(5)} — the edge leaving vertex ${a.vertex + 1} of ring ${a.ring + 1} cuts the edge leaving vertex ${b.vertex + 1} of ring ${b.ring + 1}.`,
    "Where an outline crosses itself there is no single answer to which side is inside, so the covered area — and every score computed from it — would depend on which rule happened to be applied.",
    "Run Fix Geometries in QGIS (Vector › Geometry Tools) or ST_MakeValid in PostGIS on the layer, then export and drop it again; the coordinates above are where to look.",
  );

// ---- rule 8: the antimeridian --------------------------------------------------------------------

export const spanTooWide = (fileName: string): Refusal =>
  R(
    "spanTooWide",
    `The outline in ${fileName} still jumps more than 180° of longitude after being joined across the antimeridian.`,
    "A shape written in the usual −180…180 range that genuinely spans more than half the globe cannot be told apart from one that crosses the date line, so there is no reading of it that is certainly the one you drew.",
    "Split it into two places either side of the date line, or export it with longitudes running continuously past 180 (for example 170 to 200).",
  );

// ---- rule 9: many features ------------------------------------------------------------------------

export const tooManyFeatures = (fileName: string, count: number, limit: number): Refusal =>
  R(
    "tooManyFeatures",
    `${fileName} holds ${count} shapes, and a session compares up to ${limit} places.`,
    "Above that the panel, the link and the report all stop being readable, and the comparison they exist for stops being one.",
    `Choose “one place for the whole file” to score them together, or filter the layer down to ${limit} features and export it again.`,
  );

// ---- GeoPackage: the consented, best-effort path (S4 rule 2) ----------------------------------------

export const geopackageDeclined = (fileName: string): Refusal =>
  R(
    "geopackageDeclined",
    `${fileName} was not opened, because the one-time download it needs was declined.`,
    "GeoPackage is the one format this app cannot read on its own: it needs a 22 MB reader fetched from extensions.duckdb.org, a third party nothing else here contacts.",
    "Convert the layer to GeoJSON or FlatGeobuf in your GIS and drop that — it needs no download and reads instantly — or drop the GeoPackage again and accept.",
  );

export const geopackageUnavailable = (fileName: string, detail: string): Refusal =>
  R(
    "geopackageUnavailable",
    `The GeoPackage reader for ${fileName} could not be fetched from extensions.duckdb.org (${detail}).`,
    "That host is often blocked by an ad blocker, a corporate network or DNS filtering; the reader is 22 MB and is not carried inside this app, so without the fetch there is nothing to read the file with.",
    "Convert the layer to GeoJSON or FlatGeobuf and drop that instead — it needs no download — or retry on a network that allows extensions.duckdb.org.",
  );

export const geopackageNoRuntime = (fileName: string): Refusal =>
  R(
    "geopackageNoRuntime",
    `${fileName} needs the data engine, which is not running in this tab yet.`,
    "GeoPackage is read through the same DuckDB engine the scores come from, and it has not finished starting.",
    "Wait for the map's numbers to appear and drop the file again, or convert the layer to GeoJSON and drop that.",
  );

/**
 * Every builder above, called with placeholder arguments — the list `messages.test.ts` walks and
 * the panel can render as its refusal catalogue. Kept here rather than in the test so a new message
 * is covered by adding it in ONE place, next to itself.
 */
export function allRefusalSamples(): Refusal[] {
  return [
    fileTooLarge("place.geojson", 12 * 1024 * 1024, 10 * 1024 * 1024),
    zipUncompressedTooLarge("layers.zip", 60 * 1024 * 1024, 50 * 1024 * 1024),
    zipTooManyEntries("layers.zip", 300, 200),
    zipUnreadable("layers.zip", "no end-of-central-directory record"),
    unknownFormat("notes.txt", "starts with plain text"),
    parseFailed("place.geojson", "GeoJSON", "unexpected end of input"),
    noFeatures("place.geojson"),
    notPolygon("place.geojson", "a Point"),
    noGeometry("place.geojson", 0),
    gpxTrackNotClosed("track.gpx"),
    coordinatesNotFinite("place.geojson", "a null in feature 1"),
    coordinatesOutOfRange("place.geojson", "a latitude of 4300000"),
    projectedCoordinates("utm_zone_noprj.zip", "x up to 520000"),
    projectedCrs("utm_zone.fgb", "EPSG:32610"),
    tooManyVertices("coast.geojson", 80000, 50000),
    ringTooShort("place.geojson", 0, 2),
    selfIntersection("bowtie.geojson", { ring: 0, vertex: 0 }, { ring: 0, vertex: 2 }, [-90, 27]),
    spanTooWide("world.geojson"),
    tooManyFeatures("counties.geojson", 58, 20),
    geopackageDeclined("place.gpkg"),
    geopackageUnavailable("place.gpkg", "Failed to execute 'send' on 'XMLHttpRequest'"),
    geopackageNoRuntime("place.gpkg"),
  ];
}
