// atlas-2 Step 4 (Opus half): THE one function that decides memory vs opfs, plus the Web Lock
// holder it decides with. Nothing else in the app may branch on "do we have OPFS" -- every caller
// asks `selectStore()` and is handed a decision with a reason.
//
// The lock rules are `docs/spikes/S1.md` 3 and 4, both MEASURED, both the kind of bug that does not
// look like a bug:
//  - `navigator.locks.request(name, { ifAvailable: true }, cb)`: a plain `locks.request` does not
//    return "busy", it QUEUES -- measured at 6001-6024 ms (i.e. the full test timeout, never
//    resolving) on chromium, firefox AND webkit while another tab held the lock. The second tab
//    would simply never paint.
//  - the lock is held for the WHOLE LIFETIME of the OPFS handle, not just for the open. Releasing
//    it when the open resolves lets a second tab into the same file; that was a real bug in S1's
//    own first round.
// Releasing on an abrupt tab close is the Web Locks API's own guarantee (S1 measured it: after
// `page.close()` with no graceful release, a fresh tab acquired the lock and read the real file).

import { hasOpfsApi, type OpfsRootProvider, defaultOpfsRoot } from "./opfsFs";
import { opfsLockName } from "./opfsPaths";
import { keepDataOnDevice, type StorageLike } from "./keepData";

/** a held Web Lock. `release()` is idempotent and resolves the lock callback, which is what
 * actually hands the lock back. */
export interface HeldLock {
  name: string;
  release(): void;
}

/** the slice of `navigator.locks` used here -- structural so a fake LockManager (including one that
 * deliberately OMITS `ifAvailable` support, the seeded fault) satisfies it. */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown | null) => Promise<unknown>,
  ): Promise<unknown>;
}

export function defaultLocks(): LockManagerLike | null {
  try {
    return typeof navigator !== "undefined" && navigator.locks
      ? (navigator.locks as unknown as LockManagerLike)
      : null;
  } catch {
    return null;
  }
}

/**
 * Try to take `name` WITHOUT waiting. Resolves as soon as the grant decision is known:
 * `null` when someone else holds it, a {@link HeldLock} when this tab got it -- and in the latter
 * case the lock callback stays pending (holding the lock) until `release()` is called or this
 * tab/page goes away.
 *
 * A `request()` that rejects outright (no LockManager, an exotic failure) resolves `null`: not
 * getting the lock is never an error here, it is the ordinary second-tab path.
 */
export function acquireLock(locks: LockManagerLike, name: string): Promise<HeldLock | null> {
  return new Promise<HeldLock | null>((resolveOuter) => {
    let settled = false;
    const settle = (v: HeldLock | null) => {
      if (settled) return;
      settled = true;
      resolveOuter(v);
    };
    locks
      .request(name, { ifAvailable: true }, async (lock) => {
        if (lock === null || lock === undefined) {
          settle(null);
          return;
        }
        // hold it: this callback's promise is the lock's lifetime.
        await new Promise<void>((resolveHeld) => {
          let released = false;
          settle({
            name,
            release() {
              if (released) return;
              released = true;
              resolveHeld();
            },
          });
        });
      })
      .catch(() => settle(null));
  });
}

export type StoreKind = "memory" | "opfs";

/**
 * Why a decision came out the way it did. Only the three `*-error`/`unavailable` reasons are
 * genuine OPFS FAILURES and therefore emit `opfs_fallback`; `setting-off` and `lock-held` are
 * ordinary, expected, user-invisible paths (the second tab is supposed to run in memory).
 */
export type StoreReason =
  "ok" | "setting-off" | "no-locks-api" | "no-opfs-api" | "opfs-unavailable" | "lock-held";

export interface StoreDecision {
  kind: StoreKind;
  reason: StoreReason;
  /** held only when `kind === "opfs"`; the caller must release it when it closes the handle. */
  lock: HeldLock | null;
}

/** `true` for the reasons that are an OPFS failure rather than a normal branch -- the ones that
 * must emit `opfs_fallback{reason}`. */
export function isFallbackReason(reason: StoreReason): boolean {
  return reason === "no-locks-api" || reason === "no-opfs-api" || reason === "opfs-unavailable";
}

export interface SelectStoreEnv {
  ver: string;
  /** defaults to the persisted "keep data on this device" setting. */
  keepData?: boolean;
  storage?: StorageLike | null;
  locks?: LockManagerLike | null;
  hasOpfs?: () => boolean;
  /** the ATTEMPT (S1 rule 5): a resolved handle means OPFS works here, a rejection means it does
   * not -- whatever `navigator.storage` claims. */
  probeOpfs?: OpfsRootProvider;
}

/**
 * The single decision point. Branch order is deliberate:
 * 1. **the setting** -- off means memory, and the caller additionally deletes what is already
 *    stored; no API is touched at all, so "off" costs nothing;
 * 2. **the APIs exist** -- cheap synchronous checks before any promise;
 * 3. **the lock** -- taken BEFORE OPFS is probed, so a tab that will run in memory anyway never
 *    goes near the file (the gate asserts a second tab "never touches the OPFS file");
 * 4. **the OPFS attempt** -- and if it fails, the lock just taken is released again, so the next
 *    tab is free to try (it will likely fail the same way, but nothing is wedged).
 */
export async function selectStore(env: SelectStoreEnv): Promise<StoreDecision> {
  const keep = env.keepData ?? keepDataOnDevice(env.storage ?? undefined);
  if (!keep) return { kind: "memory", reason: "setting-off", lock: null };

  const locks = env.locks === undefined ? defaultLocks() : env.locks;
  if (!locks) return { kind: "memory", reason: "no-locks-api", lock: null };

  const detect = env.hasOpfs ?? hasOpfsApi;
  if (!detect()) return { kind: "memory", reason: "no-opfs-api", lock: null };

  const lock = await acquireLock(locks, opfsLockName(env.ver));
  if (!lock) return { kind: "memory", reason: "lock-held", lock: null };

  const probe = env.probeOpfs ?? defaultOpfsRoot;
  try {
    await probe();
  } catch {
    lock.release();
    return { kind: "memory", reason: "opfs-unavailable", lock: null };
  }
  return { kind: "opfs", reason: "ok", lock };
}
