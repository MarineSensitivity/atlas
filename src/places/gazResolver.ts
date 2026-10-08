// places/gazResolver.ts -- the cache + in-flight de-duplication behind `p.` place_id tokens: which
// gazetteer ids have been fetched, are being fetched, or failed. A plain object (no runes, no
// network of its own: `resolve` is injected) so the rules are unit-testable; placesMap.svelte.ts
// wraps it in a reactive version counter, and Report.svelte uses it directly.
//
// Failure is GRACEFUL by construction: an entry in the `error` state keeps the id (the token stays
// in `#pl=`, so the link still carries it and a later load can succeed) and `onError` fires ONCE
// per failed attempt so the user is told, never once per re-render. `retry()` is the only way an
// errored id is fetched again.
import type { GazResolved } from "../lib/gazetteer/resolve";

export type GazEntry =
  | { status: "loading" }
  | { status: "ok"; resolved: GazResolved }
  | { status: "error"; message: string };

export interface GazResolverDeps {
  resolve: (id: string) => Promise<GazResolved>;
  /** fired after every state change (loading -> ok/error), for a reactive wrapper to bump. */
  onChange?: () => void;
  /** fired once per failed attempt with the user-facing sentence. */
  onError?: (id: string, message: string) => void;
}

export interface GazResolver {
  /** start fetching every id not already loading/loaded/failed; returns when all have settled. */
  ensure(ids: readonly string[]): Promise<void>;
  get(id: string): GazEntry | undefined;
  /** the resolved analysis geometry, or `undefined` while loading / after a failure. */
  geometry(id: string): GazResolved["geometry"] | undefined;
  /** forget a failed id and fetch it again. */
  retry(id: string): Promise<void>;
}

export function createGazResolver(deps: GazResolverDeps): GazResolver {
  const entries = new Map<string, GazEntry>();
  const inflight = new Map<string, Promise<void>>();

  function start(id: string): Promise<void> {
    entries.set(id, { status: "loading" });
    deps.onChange?.();
    const p = deps
      .resolve(id)
      .then((resolved) => {
        entries.set(id, { status: "ok", resolved });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        entries.set(id, { status: "error", message });
        deps.onError?.(id, message);
      })
      .finally(() => {
        inflight.delete(id);
        deps.onChange?.();
      });
    inflight.set(id, p);
    return p;
  }

  return {
    async ensure(ids) {
      const pending: Promise<void>[] = [];
      for (const id of new Set(ids)) {
        const have = entries.get(id);
        if (have) {
          const running = inflight.get(id);
          if (running) pending.push(running);
          continue;
        }
        pending.push(start(id));
      }
      await Promise.all(pending);
    },
    get: (id) => entries.get(id),
    geometry(id) {
      const e = entries.get(id);
      return e?.status === "ok" ? e.resolved.geometry : undefined;
    },
    async retry(id) {
      if (entries.get(id)?.status !== "error") return;
      entries.delete(id);
      await start(id);
    },
  };
}
