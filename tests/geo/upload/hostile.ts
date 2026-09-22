// tests/geo/upload/hostile.ts — the inputs no GIS would ever write, generated in memory so nothing
// dangerous is committed to the repository.
//
// The zip bomb in particular: what makes it a bomb is the DECLARED uncompressed size in its central
// directory, not any real payload, so a hand-built archive whose directory claims 60 MB (and whose
// members are a few bytes of deflated zeros) tests exactly the rule — the sizes are read before
// extraction — without shipping 60 MB, and without shipping anything that expands if someone
// double-clicks it. Every generator here is deterministic.
import { deflateRawSync } from "node:zlib";

const enc = new TextEncoder();

interface Member {
  name: string;
  /** what the directory will CLAIM this member expands to. */
  declaredUncompressed: number;
  data: Uint8Array;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A real, well-formed zip whose members' uncompressed sizes are whatever we say they are.
 *
 * `declaredUncompressed` is written into both the local header and the central directory; no
 * unpacker is ever asked to honour it here, because the whole point is that atlas refuses the file
 * on that number alone.
 */
export function buildZip(members: Member[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const m of members) {
    const name = enc.encode(m.name);
    const deflated = new Uint8Array(deflateRawSync(m.data));
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true); // deflate
    lv.setUint32(14, crc32(m.data), true);
    lv.setUint32(18, deflated.length, true);
    lv.setUint32(22, m.declaredUncompressed, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(m.data), true);
    cv.setUint32(20, deflated.length, true);
    cv.setUint32(24, m.declaredUncompressed, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    chunks.push(local, deflated);
    directory.push(cd);
    offset += local.length + deflated.length;
  }

  const cdBytes = concat(directory);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, members.length, true);
  ev.setUint16(10, members.length, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, offset, true);
  return concat([...chunks, cdBytes, eocd]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** one tiny member whose directory entry claims 60 MB — the classic zip bomb, in 300 bytes. */
export const zipBomb = (): Uint8Array =>
  buildZip([
    { name: "bomb.shp", declaredUncompressed: 60 * 1024 * 1024, data: enc.encode("0".repeat(64)) },
  ]);

/** 300 members, each trivial: over the 200-entry rule and under every size rule. */
export const zipWith300Entries = (): Uint8Array =>
  buildZip(
    Array.from({ length: 300 }, (_, i) => ({
      name: `layer_${String(i).padStart(3, "0")}.shp`,
      declaredUncompressed: 8,
      data: enc.encode("00000000"),
    })),
  );

// ---- geometry, as GeoJSON text ---------------------------------------------------------------------

const fc = (geometry: unknown, properties: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties, geometry }],
  });

/** the classic bow-tie: edge 0 (bottom) crosses edge 2 (the diagonal back). */
export const bowTie = (): string =>
  fc({
    type: "Polygon",
    coordinates: [
      [
        [-93, 26],
        [-91, 26],
        [-93, 28],
        [-91, 28],
        [-93, 26],
      ],
    ],
  });

export const pointOnly = (): string => fc({ type: "Point", coordinates: [-91, 27] });

export const lineOnly = (): string =>
  fc({
    type: "LineString",
    coordinates: [
      [-93, 26],
      [-91, 28],
    ],
  });

/** the XSS probe: the name must come back as these exact 28 characters, not escaped. */
export const HTML_NAME = "<img src=x onerror=alert(1)>";
export const htmlNamedPolygon = (): string =>
  fc(
    {
      type: "Polygon",
      coordinates: [
        [
          [-93.5, 26.5],
          [-93.5, 29.5],
          [-88.5, 29.5],
          [-88.5, 26.5],
          [-93.5, 26.5],
        ],
      ],
    },
    { name: HTML_NAME },
  );

/**
 * The Aleutian rectangle, WRAPPED: one ring that jumps 178 -> -177. Byte-for-byte the vertex order
 * `rect_ring(178, 51, -177, 53)` writes in tests/fixtures/upload/generate_fixtures.R, so this is
 * the same geometry the five committed fixtures carry — in the spelling `unwrapRing()` exists for.
 */
export const aleutianWrapped = (): string =>
  fc({
    type: "Polygon",
    coordinates: [
      [
        [178, 51],
        [178, 53],
        [-177, 53],
        [-177, 51],
        [178, 51],
      ],
    ],
  });

/**
 * The SAME rectangle, cut at the antimeridian the way RFC 7946 says to: two parts, one ending
 * exactly at +180 and one starting exactly at -180. `unwrapRing()` cannot repair this (every edge
 * in both halves is already short) — `seam.ts` does, and the two must normalize to one identical
 * ring.
 */
export const aleutianSplit = (): string =>
  fc({
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [178, 51],
          [178, 53],
          [180, 53],
          [180, 51],
          [178, 51],
        ],
      ],
      [
        [
          [-180, 51],
          [-180, 53],
          [-177, 53],
          [-177, 51],
          [-180, 51],
        ],
      ],
    ],
  });

/** a square with a square hole, to prove holes survive and keep the opposite winding. */
export const squareWithHole = (): string =>
  fc({
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
        [-92, 27],
        [-91, 27],
        [-91, 28],
        [-92, 28],
        [-92, 27],
      ],
    ],
  });
