// atlas-2 Step 4: the ONE selection function, unit-tested per branch with injected fakes (the
// plan's own wording). Every path that can end in "memory" gets its own named case, so a
// regression tells you WHICH branch broke rather than "OPFS stopped working".
import { describe, expect, it, vi } from "vitest";
import {
  acquireLock,
  isFallbackReason,
  selectStore,
  type StoreReason,
} from "../../src/lib/engine/store/select";
import {
  KEEP_DATA_KEY,
  keepDataOnDevice,
  setKeepDataOnDevice,
} from "../../src/lib/engine/store/keepData";
import {
  fakeLocks,
  fakeOpfsRoot,
  fakeStorage,
  rejectingOpfsRoot,
  throwingStorage,
  tick,
} from "./opfsFakes";

const base = () => ({
  ver: "v9",
  locks: fakeLocks(),
  hasOpfs: () => true,
  probeOpfs: fakeOpfsRoot().root,
  storage: fakeStorage(),
});

describe("selectStore", () => {
  it("picks opfs and HOLDS the lock when everything is available", async () => {
    const locks = fakeLocks();
    const d = await selectStore({ ...base(), locks });
    expect(d.kind).toBe("opfs");
    expect(d.reason).toBe("ok");
    expect(locks.held.has("atlas-opfs-v9")).toBe(true);
    d.lock!.release();
    await tick();
    expect(locks.held.has("atlas-opfs-v9")).toBe(false);
  });

  it("setting off -> memory, and nothing is even probed", async () => {
    const probeOpfs = vi.fn(fakeOpfsRoot().root);
    const locks = fakeLocks();
    const d = await selectStore({ ...base(), locks, probeOpfs, keepData: false });
    expect(d).toMatchObject({ kind: "memory", reason: "setting-off", lock: null });
    expect(probeOpfs).not.toHaveBeenCalled();
    expect(locks.held.size).toBe(0);
  });

  it("no Web Locks API -> memory", async () => {
    const d = await selectStore({ ...base(), locks: null });
    expect(d).toMatchObject({ kind: "memory", reason: "no-locks-api" });
  });

  it("no OPFS API -> memory", async () => {
    const d = await selectStore({ ...base(), hasOpfs: () => false });
    expect(d).toMatchObject({ kind: "memory", reason: "no-opfs-api" });
  });

  it("another tab holds the lock -> memory, and the OPFS file is never touched", async () => {
    const probeOpfs = vi.fn(fakeOpfsRoot().root);
    const d = await selectStore({ ...base(), locks: fakeLocks(["atlas-opfs-v9"]), probeOpfs });
    expect(d).toMatchObject({ kind: "memory", reason: "lock-held", lock: null });
    expect(probeOpfs).not.toHaveBeenCalled();
  });

  it("a tab on a DIFFERENT release is not blocked by v9's lock", async () => {
    const d = await selectStore({ ...base(), ver: "v7b", locks: fakeLocks(["atlas-opfs-v9"]) });
    expect(d.kind).toBe("opfs");
    expect(d.lock!.name).toBe("atlas-opfs-v7b");
    d.lock!.release();
  });

  it("the OPFS probe rejecting (the WebKit shape) -> memory, and the lock is handed back", async () => {
    const locks = fakeLocks();
    const d = await selectStore({ ...base(), locks, probeOpfs: rejectingOpfsRoot() });
    expect(d).toMatchObject({ kind: "memory", reason: "opfs-unavailable", lock: null });
    await tick();
    expect(locks.held.size, "a failed probe must not wedge the lock for the next tab").toBe(0);
  });

  it("only a genuine OPFS failure counts as an opfs_fallback reason", () => {
    const fallback: StoreReason[] = ["no-locks-api", "no-opfs-api", "opfs-unavailable"];
    const normal: StoreReason[] = ["ok", "setting-off", "lock-held"];
    for (const r of fallback) expect(isFallbackReason(r), r).toBe(true);
    for (const r of normal) expect(isFallbackReason(r), r).toBe(false);
  });
});

describe("acquireLock (docs/spikes/S1.md rules 3 and 4)", () => {
  it("uses ifAvailable, so a contended request answers null instead of queueing", async () => {
    const locks = fakeLocks(["atlas-opfs-v9"]);
    await expect(acquireLock(locks, "atlas-opfs-v9")).resolves.toBeNull();
    expect(locks.sawPlainRequest, "a plain locks.request is a measured hang, never used").toBe(
      false,
    );
  });

  it("holds the lock past the grant: a second acquire is refused until release()", async () => {
    const locks = fakeLocks();
    const first = await acquireLock(locks, "atlas-opfs-v9");
    expect(first).not.toBeNull();
    await expect(acquireLock(locks, "atlas-opfs-v9")).resolves.toBeNull();
    first!.release();
    await tick();
    const second = await acquireLock(locks, "atlas-opfs-v9");
    expect(second).not.toBeNull();
    second!.release();
  });

  it("release() is idempotent", async () => {
    const locks = fakeLocks();
    const l = (await acquireLock(locks, "n"))!;
    l.release();
    l.release();
    await tick();
    expect(locks.held.size).toBe(0);
  });
});

describe("keep data on this device", () => {
  it("defaults ON, including with no storage at all", () => {
    expect(keepDataOnDevice(fakeStorage())).toBe(true);
    expect(keepDataOnDevice(null)).toBe(true);
    expect(keepDataOnDevice(throwingStorage())).toBe(true);
  });

  it("only an explicit opt-out turns it off, and turning it back on removes the key", () => {
    const s = fakeStorage();
    setKeepDataOnDevice(false, s);
    expect(s.map.get(KEEP_DATA_KEY)).toBe("0");
    expect(keepDataOnDevice(s)).toBe(false);
    setKeepDataOnDevice(true, s);
    expect(s.map.has(KEEP_DATA_KEY)).toBe(false);
    expect(keepDataOnDevice(s)).toBe(true);
  });

  it("a storage that throws never throws out of the setter", () => {
    expect(() => setKeepDataOnDevice(false, throwingStorage())).not.toThrow();
  });
});
