// atlas-2 Step 4 (Opus half): the user setting "keep data on this device" -- a plain exported
// function plus its storage key, deliberately with NO UI in this phase (the plan: "as a plain
// exported function + storage key, no UI"). A settings panel in a later phase imports these two
// symbols; nothing else in `src/lib` reads `localStorage` for this.
//
// Default ON (plan atlas-2 `store/`). OFF means two things, and both are the caller's job to honour
// -- `selectStore()` refuses OPFS, and `openTableStoreBackend()` deletes whatever is already there,
// so turning the setting off is not merely "stop caching from now on" but "there is no cache".

/** the one localStorage key. Namespaced `atlas:` like every other key this app owns. */
export const KEEP_DATA_KEY = "atlas:keepData";

/** the minimum of the `Storage` interface this module uses -- structural, so a plain object is a
 * valid test double and so a `localStorage` that THROWS on access (Safari private mode, a
 * storage-partitioned iframe, an origin with site data blocked) can be modelled. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage` when there is one, otherwise `null`. Merely TOUCHING `window.localStorage` throws
 * in some blocked-storage configurations, so even the lookup is inside the `try`. */
export function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Is on-device persistence allowed? **Default true**: an absent key, an unreadable storage, or any
 * value other than the exact string `"0"` all mean "on". Only an explicit opt-out turns it off, so a
 * cleared profile or a storage exception can never silently disable the tier -- and can never
 * silently ENABLE it either, because the caller still has to succeed at opening OPFS.
 */
export function keepDataOnDevice(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(KEEP_DATA_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Write the setting. Turning it ON removes the key rather than writing `"1"` (the default IS on, so
 * the absence of the key is the honest representation of it and one less value to keep in sync).
 * A storage that throws is swallowed: the setting is a preference, not a transaction.
 *
 * Turning it OFF does not itself delete anything -- `openTableStoreBackend({ purgeWhenOff: true })`
 * (the default) does that on the next boot, and a settings UI should additionally call
 * `purgeAllStoredData()` immediately so the user's "off" is honoured now, not next page load.
 */
export function setKeepDataOnDevice(
  on: boolean,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (on) storage.removeItem(KEEP_DATA_KEY);
    else storage.setItem(KEEP_DATA_KEY, "0");
  } catch {
    // a preference that cannot be saved is a preference that stays at its default -- never an error
  }
}
