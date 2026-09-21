// atlas-2 Step 4: the budget + eviction order, and the session-start digest reconcile. Both are
// pure, so both are pinned here one rule at a time rather than only through the browser gate.
import { describe, expect, it } from "vitest";
import {
  MAX_STORE_BYTES,
  expectedDigestFromBoot,
  planEviction,
  planReconcile,
  storeBudgetBytes,
  type MetaRow,
} from "../../src/lib/engine/store/policy";

const MB = 1024 * 1024;
const tile = (n: number) => `v9/serve/cell_model/tile=${n}/data_0.parquet`;

describe("storeBudgetBytes", () => {
  it("is min(300 MB, 20% of quota)", () => {
    expect(storeBudgetBytes(10_000 * MB)).toBe(MAX_STORE_BYTES); // 20% = 2 GB, capped at 300 MB
    expect(storeBudgetBytes(500 * MB)).toBe(100 * MB);
    expect(MAX_STORE_BYTES).toBe(300 * MB);
  });

  it("falls back to the 300 MB cap when the quota is unknown, but honours a literal 0", () => {
    expect(storeBudgetBytes(undefined)).toBe(MAX_STORE_BYTES);
    expect(storeBudgetBytes(NaN)).toBe(MAX_STORE_BYTES);
    expect(storeBudgetBytes(0)).toBe(0);
  });
});

describe("planEviction", () => {
  it("does nothing while everything fits", () => {
    const plan = planEviction({
      budgetBytes: 100 * MB,
      incomingBytes: 5 * MB,
      tables: [{ name: tile(1), bytes: 10 * MB, lastUsedMs: 1 }],
      otherFiles: [],
    });
    expect(plan).toEqual({ dropTables: [], deleteFiles: [], freedBytes: 0, overBudget: false });
  });

  it("evicts LEAST-RECENTLY-USED tiles first, in last_used order", () => {
    const plan = planEviction({
      budgetBytes: 30 * MB,
      incomingBytes: 10 * MB,
      tables: [
        { name: tile(1), bytes: 10 * MB, lastUsedMs: 300 }, // newest
        { name: tile(2), bytes: 10 * MB, lastUsedMs: 100 }, // oldest
        { name: tile(3), bytes: 10 * MB, lastUsedMs: 200 },
      ],
      otherFiles: [],
    });
    expect(plan.dropTables).toEqual([tile(2)]);
    expect(plan.overBudget).toBe(false);
  });

  it("never evicts a non-tile table, even when it is the oldest thing there", () => {
    const plan = planEviction({
      budgetBytes: 15 * MB,
      incomingBytes: 0,
      tables: [
        { name: "v9/app/taxon.parquet", bytes: 10 * MB, lastUsedMs: 1 },
        { name: tile(9), bytes: 10 * MB, lastUsedMs: 999 },
      ],
      otherFiles: [],
    });
    expect(plan.dropTables).toEqual([tile(9)]);
  });

  it("then evicts whole stale versions, LRU first, once every tile is gone", () => {
    const plan = planEviction({
      budgetBytes: 20 * MB,
      incomingBytes: 10 * MB,
      tables: [{ name: tile(1), bytes: 10 * MB, lastUsedMs: 500 }],
      otherFiles: [
        { file: "v7.s1.dv1.4.3.duckdb", ver: "v7", bytes: 20 * MB, lastUsedMs: 10 },
        { file: "v8.s1.dv1.4.3.duckdb", ver: "v8", bytes: 20 * MB, lastUsedMs: 20 },
      ],
    });
    expect(plan.dropTables).toEqual([tile(1)]); // tiles first, per the plan's wording
    expect(plan.deleteFiles).toEqual(["v7.s1.dv1.4.3.duckdb", "v8.s1.dv1.4.3.duckdb"]);
    expect(plan.freedBytes).toBe(50 * MB);
  });

  it("counts other versions against the SAME budget (the budget is across versions)", () => {
    const fits = planEviction({
      budgetBytes: 50 * MB,
      incomingBytes: 10 * MB,
      tables: [],
      otherFiles: [],
    });
    expect(fits.deleteFiles).toEqual([]);
    const doesNot = planEviction({
      budgetBytes: 50 * MB,
      incomingBytes: 10 * MB,
      tables: [],
      otherFiles: [{ file: "v7.s1.dv1.4.3.duckdb", ver: "v7", bytes: 45 * MB, lastUsedMs: 1 }],
    });
    expect(doesNot.deleteFiles).toEqual(["v7.s1.dv1.4.3.duckdb"]);
  });

  it("reports overBudget rather than failing when nothing evictable is left", () => {
    const plan = planEviction({
      budgetBytes: 1 * MB,
      incomingBytes: 10 * MB,
      tables: [{ name: "v9/app/taxon.parquet", bytes: 5 * MB, lastUsedMs: 1 }],
      otherFiles: [],
    });
    expect(plan.overBudget).toBe(true);
    expect(plan.dropTables).toEqual([]);
  });

  it("is deterministic when two tiles share a last_used", () => {
    const input = {
      budgetBytes: 10 * MB,
      incomingBytes: 10 * MB,
      tables: [
        { name: tile(2), bytes: 5 * MB, lastUsedMs: 7 },
        { name: tile(1), bytes: 5 * MB, lastUsedMs: 7 },
      ],
      otherFiles: [],
    };
    expect(planEviction(input).dropTables).toEqual(planEviction(input).dropTables);
    expect(planEviction(input).dropTables[0]).toBe(tile(1));
  });
});

describe("planReconcile + expectedDigestFromBoot", () => {
  const boot = {
    tables: {
      taxon: { digest: "T2" },
      zone_taxon: { digest: "Z1" },
      cell: { digest: "C2" },
    },
  };
  const expected = expectedDigestFromBoot("v9", boot);

  const rows = (over: Partial<MetaRow>[]): MetaRow[] =>
    over.map((o) => ({ name: "", digest: "", bytes: 1, lastUsedMs: 1, ...o }) as MetaRow);

  it("drops exactly the table whose published digest changed", () => {
    const drop = planReconcile(
      rows([
        { name: "v9/app/taxon.parquet", digest: "T1" }, // stale
        { name: "v9/app/zone_taxon.parquet", digest: "Z1" }, // current
      ]),
      expected,
    );
    expect(drop).toEqual(["v9/app/taxon.parquet"]);
  });

  it("invalidates every cell tile of the release when boot.tables.cell.digest moves", () => {
    const drop = planReconcile(
      rows([
        { name: "v9/app/cell/tile=1/data_0.parquet", digest: "C1:1" },
        { name: "v9/app/cell/tile=2/data_0.parquet", digest: "C2:2" },
      ]),
      expected,
    );
    expect(drop).toEqual(["v9/app/cell/tile=1/data_0.parquet"]);
  });

  it("leaves alone every name boot publishes no digest for", () => {
    expect(expected("v9/tables/model.parquet")).toBeUndefined();
    expect(expected("v9/serve/cell_model/tile=7/data_0.parquet")).toBeUndefined();
    expect(expected("v9/app/taxonomy.parquet")).toBeUndefined(); // absent from this boot
    expect(
      planReconcile(
        rows([
          { name: "v9/tables/model.parquet", digest: "anything" },
          { name: "v9/serve/cell_model/tile=7/data_0.parquet", digest: "anything" },
        ]),
        expected,
      ),
    ).toEqual([]);
  });

  it("does not mistake another release's cached table for this one", () => {
    expect(expected("v7/app/taxon.parquet")).toBeUndefined();
    expect(
      planReconcile(rows([{ name: "v7/app/taxon.parquet", digest: "old" }]), expected),
    ).toEqual([]);
  });

  it("tolerates a missing or malformed boot", () => {
    const none = expectedDigestFromBoot("v9", undefined);
    expect(none("v9/app/taxon.parquet")).toBeUndefined();
    expect(planReconcile(rows([{ name: "v9/app/taxon.parquet", digest: "x" }]), none)).toEqual([]);
  });
});
