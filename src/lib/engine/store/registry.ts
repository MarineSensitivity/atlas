// atlas-2 Step 4 (Opus half): the CROSS-VERSION registry -- who owns how many bytes of OPFS, and
// when each release's file was last used.
//
// Why it exists separately from `_meta`: `_meta` lives INSIDE one release's db file and can only be
// read by the tab that holds that file's lock. The budget, though, is "`min(300 MB, 20% of quota)`
// ACROSS versions" (plan atlas-2 `store/`), so the tab holding v9 has to know what v7's file costs
// and when anyone last used it -- without opening v7 (one handle per file, `docs/spikes/S1.md`
// rule 6). A small `localStorage` map is the only place that fact can live.
//
// It is a CACHE OF A FACT, never the fact itself: the OPFS directory listing is authoritative. A
// file present on disk but missing from the registry is adopted with `lastUsedMs: 0` (i.e. "oldest",
// evict me first); a registry entry with no file on disk is dropped. So a cleared `localStorage`, a
// registry written by an older build, or a browser that evicted OPFS behind the app's back all
// degrade to "slightly wrong LRU order", never to "wrong bytes" or a crash.

import { parseOpfsDbFileName } from "./opfsPaths";
import type { StorageLike } from "./keepData";

export const REGISTRY_KEY = "atlas:opfs:registry";

export interface RegistryEntry {
  file: string;
  ver: string;
  bytes: number;
  lastUsedMs: number;
}

/** Parse the stored JSON defensively: anything malformed (not JSON, not an object, a row with the
 * wrong shape, a file name this app did not write) is discarded row by row, never thrown. */
export function readRegistry(storage: StorageLike | null): Map<string, RegistryEntry> {
  const out = new Map<string, RegistryEntry>();
  if (!storage) return out;
  let raw: string | null;
  try {
    raw = storage.getItem(REGISTRY_KEY);
  } catch {
    return out; // a storage that throws on access (blocked site data) has no registry to read
  }
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [file, value] of Object.entries(parsed as Record<string, unknown>)) {
    const parts = parseOpfsDbFileName(file);
    if (!parts) continue;
    if (!value || typeof value !== "object") continue;
    const v = value as { bytes?: unknown; lastUsedMs?: unknown };
    const bytes = typeof v.bytes === "number" && Number.isFinite(v.bytes) ? v.bytes : 0;
    const lastUsedMs =
      typeof v.lastUsedMs === "number" && Number.isFinite(v.lastUsedMs) ? v.lastUsedMs : 0;
    out.set(file, { file, ver: parts.ver, bytes: Math.max(0, bytes), lastUsedMs });
  }
  return out;
}

export function writeRegistry(
  storage: StorageLike | null,
  entries: ReadonlyMap<string, RegistryEntry>,
): void {
  if (!storage) return;
  const obj: Record<string, { bytes: number; lastUsedMs: number }> = {};
  for (const e of entries.values()) obj[e.file] = { bytes: e.bytes, lastUsedMs: e.lastUsedMs };
  try {
    storage.setItem(REGISTRY_KEY, JSON.stringify(obj));
  } catch {
    // a full or blocked localStorage costs a worse LRU order next session, nothing more
  }
}

/**
 * Reconcile a stored registry against the OPFS directory's actual contents.
 * - a file on disk with no entry -> adopted at `lastUsedMs: 0` (evict first: nothing is known about
 *   it, and pessimism is the safe direction for a cache);
 * - an entry with no file on disk -> removed;
 * - both -> the disk's `bytes` win (it is the real size), the registry's `lastUsedMs` is kept.
 */
export function reconcileRegistry(
  stored: ReadonlyMap<string, RegistryEntry>,
  onDisk: readonly { file: string; bytes: number }[],
): Map<string, RegistryEntry> {
  const out = new Map<string, RegistryEntry>();
  for (const { file, bytes } of onDisk) {
    const parts = parseOpfsDbFileName(file);
    if (!parts) continue;
    const prev = stored.get(file);
    out.set(file, { file, ver: parts.ver, bytes, lastUsedMs: prev?.lastUsedMs ?? 0 });
  }
  return out;
}

/** mark one file as used now (and record its current size). */
export function touchRegistry(
  entries: Map<string, RegistryEntry>,
  file: string,
  bytes: number,
  nowMs: number,
): Map<string, RegistryEntry> {
  const parts = parseOpfsDbFileName(file);
  if (!parts) return entries;
  entries.set(file, { file, ver: parts.ver, bytes, lastUsedMs: nowMs });
  return entries;
}

/** every registry entry EXCEPT the currently open file -- exactly the `otherFiles` the eviction
 * planner takes. */
export function otherVersionFiles(
  entries: ReadonlyMap<string, RegistryEntry>,
  currentFile: string,
): RegistryEntry[] {
  return [...entries.values()].filter((e) => e.file !== currentFile);
}
