// atlas-2 Step 4 (Opus half): the only module that talks to the OPFS directory API directly --
// listing, sizing and deleting `atlas/*.duckdb` files. DuckDB opens and writes the file contents
// itself (inside its worker); everything the APP needs to do to those files as FILES happens here.
//
// Every handle type is declared STRUCTURALLY rather than imported from `lib.dom`, for three
// reasons: a plain object is then a complete test double (the whole stale-sweep / purge / sizing
// story is unit-testable under Node with no browser); `values()`/`keys()` on
// `FileSystemDirectoryHandle` are not uniformly typed across TS lib versions; and the narrow
// surface makes it obvious that this app never writes a byte through these handles -- it only
// lists, measures and REMOVES.
//
// `docs/spikes/S1.md` rule 5: feature-detect by ATTEMPTING, never by sniffing `navigator.storage`
// (which exists in the WebKit worker and still rejects). So every function here is expected to be
// called inside a `try` whose `catch` is the in-memory fallback.

import { OPFS_DIR, parseOpfsDbFileName, walFileName } from "./opfsPaths";

export interface FileHandleLike {
  getFile(): Promise<{ size: number }>;
}

export interface DirHandleLike {
  keys?(): AsyncIterable<string>;
  entries?(): AsyncIterable<[string, unknown]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** how the OPFS root is reached; injected so a test can supply a fake tree or a rejecting probe. */
export type OpfsRootProvider = () => Promise<DirHandleLike>;

/** the real one. Deliberately NOT guarded by a `typeof` check here -- the caller's `try` is the
 * guard (S1 rule 5), and a `navigator.storage` that exists but rejects must reach that `catch`. */
export function defaultOpfsRoot(): Promise<DirHandleLike> {
  return navigator.storage.getDirectory() as unknown as Promise<DirHandleLike>;
}

/** cheap, synchronous "is there even an API to attempt?" -- the branch BEFORE the attempt, so a
 * browser with no OPFS at all never pays for a rejected promise. Never sufficient on its own. */
export function hasOpfsApi(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function" &&
      typeof FileSystemFileHandle !== "undefined"
    );
  } catch {
    return false;
  }
}

/** the app's own directory. `create` defaults to false for read-only uses (a purge must not create
 * the directory it is about to find empty). */
export async function atlasDir(
  root: OpfsRootProvider = defaultOpfsRoot,
  create = false,
): Promise<DirHandleLike | null> {
  const r = await root();
  try {
    return await r.getDirectoryHandle(OPFS_DIR, { create });
  } catch (err) {
    if (!create && isNotFound(err)) return null;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "NotFoundError";
}

async function dirKeys(dir: DirHandleLike): Promise<string[]> {
  const out: string[] = [];
  if (typeof dir.keys === "function") {
    for await (const k of dir.keys()) out.push(k);
    return out;
  }
  if (typeof dir.entries === "function") {
    for await (const [k] of dir.entries()) out.push(k);
    return out;
  }
  throw new Error("atlasDir(): directory handle exposes neither keys() nor entries()");
}

export interface StoredDbFile {
  file: string;
  ver: string;
  bytes: number;
}

/**
 * Every `{ver}.s{schema}.d{duckdb}.duckdb` in `atlas/`, with its real size. `.wal` side files and
 * anything else this app did not write are skipped (they are never listed as files in their own
 * right -- a `.wal` is deleted only alongside its database). A file whose size cannot be read is
 * reported as 0 bytes rather than failing the whole listing: an unsizable file is still a file that
 * can be deleted, and the budget erring low is safer than a boot that throws.
 */
export async function listDbFiles(dir: DirHandleLike): Promise<StoredDbFile[]> {
  const out: StoredDbFile[] = [];
  for (const name of await dirKeys(dir)) {
    const parts = parseOpfsDbFileName(name);
    if (!parts) continue;
    out.push({ file: name, ver: parts.ver, bytes: await dbFileBytes(dir, name) });
  }
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return out;
}

/** current size of one db file, or 0 when it is not there / not readable. */
export async function dbFileBytes(dir: DirHandleLike, file: string): Promise<number> {
  try {
    const h = await dir.getFileHandle(file);
    return (await h.getFile()).size;
  } catch {
    return 0;
  }
}

/**
 * Delete one db file AND its write-ahead log. duckdb-wasm's `prepareDBFileHandle` prepares both
 * `<path>` and `<path>.wal` (verified in the pinned 1.32.0 worker source), so deleting only the
 * database leaves a WAL that a later open would try to replay against a database that no longer
 * exists -- a "self-heal" that heals nothing. A missing entry on either side is not an error (the
 * WAL usually does not exist after a clean CHECKPOINT; that is the normal case, not a failure).
 * Returns true if the db file itself was removed.
 */
export async function deleteDbFile(
  dir: DirHandleLike,
  file: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const removed = await removeWithRetry(dir, file, opts);
  await removeWithRetry(dir, walFileName(file), opts).catch(() => false);
  return removed;
}

/**
 * `removeEntry` on a file whose sync access handle is still open rejects with
 * `NoModificationAllowedError` (or an engine-specific equivalent) -- and that is the NORMAL state
 * for a few milliseconds after `db.terminate()` / `worker.terminate()`, because the handle is
 * closed inside the worker's own realm, asynchronously, after the main thread has already moved on.
 * Measured on the self-heal path: the first attempt failed and the file survived, so a corrupted
 * file "self-healed" into a corrupted file that was still there.
 *
 * So: retry a few times with a short delay. Still bounded, still non-fatal -- a file that refuses
 * to go is left for the next boot's stale sweep rather than turned into an error the user sees.
 */
async function removeWithRetry(
  dir: DirHandleLike,
  name: string,
  { attempts = 5, delayMs = 60 }: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await dir.removeEntry(name);
      return true;
    } catch (err) {
      if (isNotFound(err)) return false; // already gone: the goal, reached by someone else
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  return false;
}
