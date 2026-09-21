// atlas-2 Step 4: the budget + eviction order, and the session-start digest reconcile. Both are
// pure, so both are pinned here one rule at a time rather than only through the browser gate.
import { describe, expect, it } from "vitest";
import {
  MAX_STORE_BYTES,
  bootBuiltAt,
  expectedDigestFromBoot,
  noDigestKey,
  planEviction,
  planReconcile,
  sessionToken,
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

  // atlas-2 phase review, ruling 5: OTHER releases go before this release's own tiles, and a
  // RESTRICTED other release goes before any public one regardless of recency.
  it("evicts a COLD other release before a HOT tile of the current one", () => {
    const plan = planEviction({
      budgetBytes: 25 * MB,
      incomingBytes: 10 * MB,
      tables: [{ name: tile(1), bytes: 10 * MB, lastUsedMs: 9_000 }], // used a moment ago
      otherFiles: [
        { file: "v7.s1.dv1.4.3.duckdb", ver: "v7", bytes: 20 * MB, lastUsedMs: 1 }, // ancient
      ],
    });
    expect(plan.deleteFiles).toEqual(["v7.s1.dv1.4.3.duckdb"]);
    expect(plan.dropTables, "the hot current-release tile survives").toEqual([]);
  });

  it("falls through to the current release's cold tiles once the other releases are gone", () => {
    const plan = planEviction({
      budgetBytes: 15 * MB,
      incomingBytes: 10 * MB,
      tables: [{ name: tile(1), bytes: 10 * MB, lastUsedMs: 500 }],
      otherFiles: [
        { file: "v7.s1.dv1.4.3.duckdb", ver: "v7", bytes: 20 * MB, lastUsedMs: 10 },
        { file: "v8.s1.dv1.4.3.duckdb", ver: "v8", bytes: 20 * MB, lastUsedMs: 20 },
      ],
    });
    expect(plan.deleteFiles).toEqual(["v7.s1.dv1.4.3.duckdb", "v8.s1.dv1.4.3.duckdb"]);
    expect(plan.dropTables).toEqual([tile(1)]);
    expect(plan.freedBytes).toBe(50 * MB);
  });

  it("a RESTRICTED other release goes first even when it is the most recently used", () => {
    const plan = planEviction({
      budgetBytes: 10 * MB,
      incomingBytes: 10 * MB,
      tables: [],
      otherFiles: [
        { file: "v7.s1.dv1.4.3.duckdb", ver: "v7", bytes: 10 * MB, lastUsedMs: 1 }, // public, ancient
        {
          file: "v9.s1.dv1.4.3.duckdb",
          ver: "v9",
          bytes: 10 * MB,
          lastUsedMs: 9_999, // used seconds ago …
          restricted: true, // … but unreleased: it goes first (plan D6)
        },
      ],
    });
    expect(plan.deleteFiles).toEqual(["v9.s1.dv1.4.3.duckdb", "v7.s1.dv1.4.3.duckdb"]);
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

// atlas-2 phase review, ruling 4: objects `boot.tables` publishes no digest for used to be keyed
// on the release LABEL alone, i.e. cached in OPFS forever — a corrected re-publish of v9 was served
// stale indefinitely. They are now keyed on `boot.built_at` + the object's path, and a boot with no
// `built_at` fails closed (a per-session token, so nothing persisted is ever reused).
describe("noDigestKey (the fallback for objects boot publishes no digest for)", () => {
  const BUILT = { built_at: "2026-09-21T10:00:00Z" };

  it("is stable for the same built_at and path", () => {
    expect(noDigestKey(BUILT, "v9/tables/model.parquet")).toBe(
      noDigestKey(BUILT, "v9/tables/model.parquet"),
    );
  });

  it("CHANGES when built_at changes — the whole point (seeded fault: a path-only fallback)", () => {
    const a = noDigestKey({ built_at: "A" }, "v9/tables/model.parquet");
    const b = noDigestKey({ built_at: "B" }, "v9/tables/model.parquet");
    expect(a).not.toBe(b);
    // and neither is just the path: that IS the fault this replaced
    expect(a).not.toBe("v9/tables/model.parquet");
  });

  it("differs per object, so one rebuild does not conflate two files", () => {
    expect(noDigestKey(BUILT, "v9/serve/cell_model/tile=1/data_0.parquet")).not.toBe(
      noDigestKey(BUILT, "v9/serve/cell_model/tile=2/data_0.parquet"),
    );
  });

  it("no built_at -> fail closed: the key carries the per-session token, not the path", () => {
    const k = noDigestKey({}, "v9/tables/model.parquet");
    expect(k).toContain(sessionToken());
    expect(k).not.toBe("v9/tables/model.parquet");
    // stable WITHIN the session (one page load registers the object once, no thrashing) …
    expect(k).toBe(noDigestKey({}, "v9/tables/model.parquet"));
    // … but a row persisted by any earlier session cannot match it, so it is re-materialized.
    expect(
      planReconcile(
        [
          {
            name: "v9/tables/model.parquet",
            digest: "nocache:older.session:v9/tables/model.parquet",
            bytes: 1,
            lastUsedMs: 1,
          },
        ],
        (n) => noDigestKey({}, n),
      ),
    ).toEqual(["v9/tables/model.parquet"]);
  });

  it("a non-string or empty built_at is treated as absent", () => {
    expect(bootBuiltAt({ built_at: "" })).toBeNull();
    expect(bootBuiltAt({ built_at: 12345 })).toBeNull();
    expect(bootBuiltAt(undefined)).toBeNull();
    expect(bootBuiltAt({ built_at: "x" })).toBe("x");
    expect(noDigestKey({ built_at: 12345 }, "p")).toContain(sessionToken());
  });
});

describe("planReconcile + expectedDigestFromBoot", () => {
  const boot = {
    built_at: "2026-09-21T10:00:00Z",
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

  // ruling 4: these used to answer `undefined` ("no opinion"), so the reconcile left them alone
  // forever and a corrected re-publish was served stale from OPFS indefinitely. They are now
  // keyed on built_at + path, identically to `analysis/sources.ts`'s own `digestOf`.
  it("keys every no-digest object of THIS release on built_at + path", () => {
    for (const name of [
      "v9/tables/model.parquet",
      "v9/serve/cell_model/tile=7/data_0.parquet",
      "v9/app/taxonomy.parquet", // absent from this boot's tables
    ]) {
      expect(expected(name)).toBe(noDigestKey(boot, name));
    }
    // a row written under the PREVIOUS build is dropped …
    expect(
      planReconcile(
        rows([
          { name: "v9/tables/model.parquet", digest: "built_at:OLDER:v9/tables/model.parquet" },
          {
            name: "v9/serve/cell_model/tile=7/data_0.parquet",
            digest: "built_at:OLDER:v9/serve/cell_model/tile=7/data_0.parquet",
          },
        ]),
        expected,
      ),
    ).toEqual(["v9/tables/model.parquet", "v9/serve/cell_model/tile=7/data_0.parquet"]);
    // … and one written under THIS build survives.
    expect(
      planReconcile(
        rows([
          {
            name: "v9/tables/model.parquet",
            digest: noDigestKey(boot, "v9/tables/model.parquet"),
          },
        ]),
        expected,
      ),
    ).toEqual([]);
  });

  it("a cell tile falls back to built_at + path when boot publishes no cell digest", () => {
    const noCell = expectedDigestFromBoot("v9", { built_at: "B1", tables: {} });
    const name = "v9/app/cell/tile=3/data_0.parquet";
    expect(noCell(name)).toBe(noDigestKey({ built_at: "B1", tables: {} }, name));
  });

  it("does not mistake another release's cached table for this one", () => {
    expect(expected("v7/app/taxon.parquet")).toBeUndefined();
    expect(
      planReconcile(rows([{ name: "v7/app/taxon.parquet", digest: "old" }]), expected),
    ).toEqual([]);
  });

  it("a missing or malformed boot FAILS CLOSED: nothing of this release is served from cache", () => {
    // no boot at all means no published digest and no built_at, so every name of this release is
    // keyed on the per-session token and every persisted row is dropped. The old behaviour —
    // `undefined`, i.e. "leave it alone" — is exactly the "cached forever" bug ruling 4 fixed.
    const none = expectedDigestFromBoot("v9", undefined);
    expect(none("v9/app/taxon.parquet")).toContain(sessionToken());
    expect(planReconcile(rows([{ name: "v9/app/taxon.parquet", digest: "x" }]), none)).toEqual([
      "v9/app/taxon.parquet",
    ]);
    // another release's rows are still not this boot's business
    expect(none("v7/app/taxon.parquet")).toBeUndefined();
  });
});
