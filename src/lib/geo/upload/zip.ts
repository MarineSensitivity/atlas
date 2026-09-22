// geo/upload/zip.ts — read a zip's CENTRAL DIRECTORY (its table of contents) without unpacking a
// single byte, so the size rules of atlas-6 Deliverable 4 can be applied BEFORE extraction.
//
// WHY WE DO NOT ASK shpjs. `shpjs` unzips inside itself, so by the time it could tell us how big
// the contents are, the contents are already in memory — which is exactly what a zip bomb wants. A
// zip states every entry's uncompressed size in its own index, at the END of the file, and that
// index is what this module reads: 200 entries and 50 MB are checked against numbers the archive
// declares about itself, before `shpjs` is even imported.
//
// It is a deliberately small reader: enough to list entries and to pull ONE small entry out (the
// `.prj`, whose text decides whether a shapefile is projected). Everything else is left to `shpjs`.

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** the end-of-central-directory record is 22 bytes plus a comment of at most 65,535. */
const EOCD_MAX_SEARCH = 22 + 0xffff;
/** a zip64 field parks 0xFFFFFFFF in the 32-bit slot; we refuse rather than half-read it. */
const ZIP64_SENTINEL = 0xffffffff;

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate; anything else this reader will not extract. */
  method: number;
  compressedSize: number;
  /** what the archive DECLARES it expands to — the number the bomb guard is written against. */
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/**
 * Every entry the archive lists, in central-directory order.
 *
 * Throws {@link ZipFormatError} when there is no end-of-central-directory record, or when the
 * archive is zip64 (a 4 GB+ member, far past every limit here anyway): a file we cannot MEASURE is
 * never a file we unpack.
 */
export function readZipCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  const from = Math.max(0, bytes.length - EOCD_MAX_SEARCH);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= from; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("no end-of-central-directory record");

  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === ZIP64_SENTINEL || cdSize === ZIP64_SENTINEL || count === 0xffff) {
    throw new ZipFormatError("a zip64 archive, which this app does not unpack");
  }
  if (cdOffset + cdSize > bytes.length) throw new ZipFormatError("a truncated central directory");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== CD_SIG) {
      throw new ZipFormatError(`no directory entry where entry ${i + 1} of ${count} should be`);
    }
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    if (uncompressedSize === ZIP64_SENTINEL || compressedSize === ZIP64_SENTINEL) {
      throw new ZipFormatError("a zip64 member, whose real size is not in the directory");
    }
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** what the archive says about itself: how many members, and how much they expand to. */
export function zipTotals(entries: readonly ZipEntry[]): {
  entryCount: number;
  uncompressedBytes: number;
} {
  let uncompressedBytes = 0;
  for (const e of entries) uncompressedBytes += e.uncompressedSize;
  return { entryCount: entries.length, uncompressedBytes };
}

/**
 * One entry's bytes. Used for the `.prj` only — small, and read AFTER the totals were checked.
 *
 * `DecompressionStream("deflate-raw")` is a platform API in every browser this app supports and in
 * Node 20+, so there is no inflate implementation (or dependency) here.
 */
export async function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const dv = view(bytes);
  const off = entry.localHeaderOffset;
  if (off + 30 > bytes.length || dv.getUint32(off, true) !== LOCAL_SIG) {
    throw new ZipFormatError(`no local header for ${entry.name}`);
  }
  const nameLen = dv.getUint16(off + 26, true);
  const extraLen = dv.getUint16(off + 28, true);
  const start = off + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method !== 8) throw new ZipFormatError(`compression method ${entry.method}`);

  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
    total += (value as Uint8Array).length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
