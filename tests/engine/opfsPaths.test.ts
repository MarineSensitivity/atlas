// atlas-2 Step 4: the file-naming and table-naming rules. Every one of these is a rule the OPFS
// tier's correctness rests on and none of them needs a browser.
import { describe, expect, it } from "vitest";
import {
  OPFS_DIR,
  isTile,
  opfsDbFileName,
  opfsDbPath,
  opfsLockName,
  parseOpfsDbFileName,
  staleSiblings,
  tableIdentifier,
  tableKind,
  walFileName,
} from "../../src/lib/engine/store/opfsPaths";

const V9 = { ver: "v9", schema: "1", duckdb: "v1.4.3" };

describe("opfs db file name", () => {
  it("is exactly {ver}.s{schema}.d{duckdb}.duckdb", () => {
    expect(opfsDbFileName(V9)).toBe("v9.s1.dv1.4.3.duckdb");
  });

  it("round-trips through parse, including a lettered release label", () => {
    const f = opfsDbFileName({ ver: "v7b", schema: "2", duckdb: "v1.4.3" });
    expect(f).toBe("v7b.s2.dv1.4.3.duckdb");
    expect(parseOpfsDbFileName(f)).toEqual({ ver: "v7b", schema: "2", duckdb: "v1.4.3" });
  });

  it("refuses a ver that could escape the atlas/ directory", () => {
    expect(() => opfsDbFileName({ ...V9, ver: "../v9" })).toThrow(/invalid ver/);
    expect(() => opfsDbFileName({ ...V9, ver: "v9/x" })).toThrow(/invalid ver/);
    expect(() => opfsDbFileName({ ...V9, schema: "a/b" })).toThrow(/invalid schema/);
    expect(() => opfsDbFileName({ ...V9, duckdb: "a b" })).toThrow(/invalid duckdb/);
  });

  it("does not parse a foreign file, nor its own .wal side file", () => {
    expect(parseOpfsDbFileName("something-else.duckdb")).toBeNull();
    expect(parseOpfsDbFileName("v9.s1.dv1.4.3.duckdb.wal")).toBeNull();
    expect(walFileName("v9.s1.dv1.4.3.duckdb")).toBe("v9.s1.dv1.4.3.duckdb.wal");
  });

  it("builds the opfs:// path under one fixed directory", () => {
    expect(OPFS_DIR).toBe("atlas");
    expect(opfsDbPath("v9.s1.dv1.4.3.duckdb")).toBe("opfs://atlas/v9.s1.dv1.4.3.duckdb");
  });

  it("keys the Web Lock on the release, so two releases never contend", () => {
    expect(opfsLockName("v9")).toBe("atlas-opfs-v9");
    expect(opfsLockName("v7b")).not.toBe(opfsLockName("v9"));
  });
});

describe("staleSiblings", () => {
  const current = "v9.s2.dv1.4.3.duckdb";

  it("lists same-release files with a different schema or duckdb suffix", () => {
    expect(
      staleSiblings(["v9.s1.dv1.4.3.duckdb", "v9.s2.dv1.4.2.duckdb", current], current).sort(),
    ).toEqual(["v9.s1.dv1.4.3.duckdb", "v9.s2.dv1.4.2.duckdb"]);
  });

  it("never lists the current file, another release, or a foreign file", () => {
    expect(
      staleSiblings([current, "v7b.s1.dv1.4.3.duckdb", "notes.txt", "x.duckdb"], current),
    ).toEqual([]);
  });
});

describe("tableIdentifier", () => {
  it("turns an object path into a valid, stable SQL identifier", () => {
    const id = tableIdentifier("v9/app/taxon.parquet");
    expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect(id).toBe(tableIdentifier("v9/app/taxon.parquet"));
    expect(id).toContain("v9_app_taxon_parquet");
  });

  it("does not collide when two names share a long prefix (the squashed part is truncated)", () => {
    const a = tableIdentifier("v9/serve/cell_model/tile=1012/data_0.parquet");
    const b = tableIdentifier("v9/serve/cell_model/tile=1013/data_0.parquet");
    expect(a).not.toBe(b);
  });

  it("separates two releases' copies of the same object", () => {
    expect(tableIdentifier("v9/app/taxon.parquet")).not.toBe(
      tableIdentifier("v7/app/taxon.parquet"),
    );
  });
});

describe("tableKind", () => {
  it("classifies the two tile shapes analysis/sources.ts registers", () => {
    expect(tableKind("v9/app/cell/tile=1012/data_0.parquet")).toBe("cell_tile");
    expect(tableKind("v9/serve/cell_model/tile=1012/data_0.parquet")).toBe("cell_model_tile");
  });

  it("treats every small whole-object table as non-evictable", () => {
    for (const n of [
      "v9/app/taxon.parquet",
      "v9/app/zone_taxon.parquet",
      "v9/app/taxonomy.parquet",
      "v9/tables/model.parquet",
    ]) {
      expect(tableKind(n)).toBe("table");
      expect(isTile(n)).toBe(false);
    }
  });
});
