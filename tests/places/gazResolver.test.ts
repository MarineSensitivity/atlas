// the cache + de-duplication behind `p.` tokens (places/gazResolver.ts): one fetch per id however
// often the list names it, a failure keeps the entry (the token stays in the link) and reports ONCE,
// and only retry() fetches a failed id again.
import { describe, expect, it } from "vitest";
import { createGazResolver } from "../../src/places/gazResolver";
import type { GazResolved } from "../../src/lib/gazetteer/resolve";

const GEOM: GazResolved["geometry"] = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};
const ok = (id: string): GazResolved => ({ id, name: `name of ${id}`, geometry: GEOM });

describe("createGazResolver", () => {
  it("fetches each id once, however many times it is asked for", async () => {
    const asked: string[] = [];
    const r = createGazResolver({
      resolve: async (id) => {
        asked.push(id);
        return ok(id);
      },
    });
    await Promise.all([r.ensure(["A:1", "B:2", "A:1"]), r.ensure(["A:1"])]);
    await r.ensure(["A:1", "B:2"]);
    expect(asked.sort()).toEqual(["A:1", "B:2"]);
    expect(r.geometry("A:1")).toBe(GEOM);
    expect(r.get("B:2")).toEqual({ status: "ok", resolved: ok("B:2") });
  });

  it("is 'loading' while in flight, and reports every state change", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let changes = 0;
    const r = createGazResolver({
      resolve: async (id) => {
        await gate;
        return ok(id);
      },
      onChange: () => changes++,
    });
    const p = r.ensure(["A:1"]);
    expect(r.get("A:1")).toEqual({ status: "loading" });
    expect(r.geometry("A:1")).toBeUndefined();
    release();
    await p;
    expect(r.get("A:1")?.status).toBe("ok");
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it("a failure is kept (not retried implicitly) and reported exactly once", async () => {
    let calls = 0;
    const errors: string[] = [];
    const r = createGazResolver({
      resolve: async () => {
        calls++;
        throw new Error("gazetteer down");
      },
      onError: (id, m) => errors.push(`${id}: ${m}`),
    });
    await r.ensure(["A:1"]);
    await r.ensure(["A:1"]);
    await r.ensure(["A:1"]);
    expect(calls).toBe(1);
    expect(errors).toEqual(["A:1: gazetteer down"]);
    expect(r.get("A:1")).toEqual({ status: "error", message: "gazetteer down" });
    expect(r.geometry("A:1")).toBeUndefined();
  });

  it("retry() refetches a failed id and can succeed; on a good id it does nothing", async () => {
    let up = false;
    let calls = 0;
    const r = createGazResolver({
      resolve: async (id) => {
        calls++;
        if (!up) throw new Error("down");
        return ok(id);
      },
    });
    await r.ensure(["A:1"]);
    up = true;
    await r.retry("A:1");
    expect(r.get("A:1")?.status).toBe("ok");
    await r.retry("A:1");
    expect(calls).toBe(2);
  });

  it("one id failing does not stop the others", async () => {
    const r = createGazResolver({
      resolve: async (id) => {
        if (id === "BAD:1") throw new Error("nope");
        return ok(id);
      },
    });
    await r.ensure(["BAD:1", "A:1"]);
    expect(r.get("BAD:1")?.status).toBe("error");
    expect(r.get("A:1")?.status).toBe("ok");
  });
});
