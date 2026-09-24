// geo/upload/engineRuntime.ts — the ONE real GeoPackageRuntime this app builds (Q2). Asserted here
// with a stub `EngineLike` (no real DuckDB/worker), exactly the discipline `engineRuntime.ts`'s own
// header states: the adapter is structural, so a plain object stands in for a real `Engine`.
import { describe, expect, it, vi } from "vitest";
import { geoPackageRuntime, type EngineLike } from "../../../src/lib/geo/upload/engineRuntime";

function fakeEngine(): EngineLike & {
  registerFile: ReturnType<typeof vi.fn>;
  dropFile: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
} {
  // cast away the generic signature, same reason engine.test.ts's own fakeHandle() does: a
  // vi.fn() mock cannot itself stay generic over <T>, but the object structurally satisfies
  // EngineLike for every T a test actually asks for.
  const exec = vi.fn(async () => [{ n: 1 }]) as unknown as EngineLike["exec"] &
    ReturnType<typeof vi.fn>;
  return {
    registerFile: vi.fn(async () => {}),
    dropFile: vi.fn(async () => {}),
    exec,
  };
}

describe("geoPackageRuntime() — the real GeoPackageRuntime adapter", () => {
  it("registerFile delegates to the resolved engine's own registerFile", async () => {
    const engine = fakeEngine();
    const rt = geoPackageRuntime(async () => engine);
    const bytes = new Uint8Array([1, 2, 3]);
    await rt.registerFile("upload_place.gpkg", bytes);
    expect(engine.registerFile).toHaveBeenCalledExactlyOnceWith("upload_place.gpkg", bytes);
  });

  it("query delegates to the resolved engine's own exec, and returns its rows", async () => {
    const engine = fakeEngine();
    const rt = geoPackageRuntime(async () => engine);
    const rows = await rt.query("SELECT 1;");
    expect(engine.exec).toHaveBeenCalledExactlyOnceWith("SELECT 1;");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("dropFile delegates to the resolved engine's own dropFile", async () => {
    const engine = fakeEngine();
    const rt = geoPackageRuntime(async () => engine);
    await rt.dropFile?.("upload_place.gpkg");
    expect(engine.dropFile).toHaveBeenCalledExactlyOnceWith("upload_place.gpkg");
  });

  it("getEngine is called lazily -- never before the FIRST registerFile/query/dropFile call", async () => {
    const engine = fakeEngine();
    const getEngine = vi.fn(async () => engine);
    geoPackageRuntime(getEngine); // building the runtime alone must not resolve the engine
    expect(getEngine).not.toHaveBeenCalled();

    const rt = geoPackageRuntime(getEngine);
    await rt.registerFile("f", new Uint8Array());
    expect(getEngine).toHaveBeenCalledTimes(1);
  });

  it("a getEngine rejection (e.g. no release resolved) propagates as the query/registerFile rejection", async () => {
    const boom = new Error("no release resolved");
    const rt = geoPackageRuntime(async () => {
      throw boom;
    });
    await expect(rt.registerFile("f", new Uint8Array())).rejects.toBe(boom);
    await expect(rt.query("SELECT 1;")).rejects.toBe(boom);
  });
});
