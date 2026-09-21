import { describe, expect, it } from "vitest";
import { RAW_ALLOWLIST, ident, lit, renderSql } from "../../src/lib/engine/sql";

describe("lit()", () => {
  it("quotes strings, doubling embedded quotes", () => {
    expect(lit("hello")).toBe("'hello'");
    expect(lit("O'Brien")).toBe("'O''Brien'");
  });

  it("passes numbers through as bare literals", () => {
    expect(lit(42)).toBe("42");
    expect(lit(-3.5)).toBe("-3.5");
    expect(lit(0)).toBe("0");
  });

  it("rejects non-finite numbers (no SQL literal spelling)", () => {
    expect(() => lit(NaN)).toThrow(/finite/);
    expect(() => lit(Infinity)).toThrow(/finite/);
  });

  it("renders booleans as TRUE/FALSE", () => {
    expect(lit(true)).toBe("TRUE");
    expect(lit(false)).toBe("FALSE");
  });

  it("renders null as NULL", () => {
    expect(lit(null)).toBe("NULL");
  });

  it("renders an array as a parenthesized, comma-joined list (an IN-list)", () => {
    expect(lit([1, 2, 3])).toBe("(1, 2, 3)");
    expect(lit(["a", "b"])).toBe("('a', 'b')");
    expect(lit([])).toBe("()");
  });

  // the injection-safety gate: a string that LOOKS like a second statement must round-trip as one
  // inert, single-quoted literal, never break out of the string.
  it("neutralizes a DROP TABLE injection string as inert quoted data", () => {
    const injected = "'; DROP TABLE t; --";
    expect(lit(injected)).toBe("'''; DROP TABLE t; --'");
    // sanity: the escaped form has no UNQUOTED single quote left that could terminate the literal
    // early (every ' is immediately followed by another ', or is the opening/closing quote).
    const body = lit(injected).slice(1, -1); // strip the outer quotes
    expect(body.match(/'/g)?.length).toBe(2); // exactly the one doubled pair
  });
});

describe("ident()", () => {
  it("accepts a plain snake_case/camelCase identifier and double-quotes it", () => {
    expect(ident("cell_id")).toBe('"cell_id"');
    expect(ident("id_field")).toBe('"id_field"');
    expect(ident("_leading")).toBe('"_leading"');
  });

  it("rejects anything that isn't [A-Za-z_][A-Za-z0-9_]*", () => {
    expect(() => ident("cell-id")).toThrow(/not a valid SQL identifier/);
    expect(() => ident("1cell")).toThrow(/not a valid SQL identifier/);
    expect(() => ident("cell id")).toThrow(/not a valid SQL identifier/);
    expect(() => ident("cell;DROP TABLE t;--")).toThrow(/not a valid SQL identifier/);
    expect(() => ident("")).toThrow(/not a valid SQL identifier/);
  });
});

describe("renderSql()", () => {
  it("substitutes {{name}} placeholders through lit() by default", () => {
    const sql = renderSql("SELECT * FROM t WHERE id = {{id}} AND label = {{label}}", {
      id: 7,
      label: "coral",
    });
    expect(sql).toBe("SELECT * FROM t WHERE id = 7 AND label = 'coral'");
  });

  it("substitutes the same placeholder wherever it repeats", () => {
    const sql = renderSql("SELECT {{x}}, {{x}}", { x: 1 });
    expect(sql).toBe("SELECT 1, 1");
  });

  it("throws on an unknown placeholder (present in the template, absent from values/raw)", () => {
    expect(() => renderSql("SELECT {{missing}}", {})).toThrow(
      /unknown placeholder \{\{missing\}\}/,
    );
  });

  it("throws on an unfilled placeholder (declared, value undefined)", () => {
    expect(() => renderSql("SELECT {{x}}", { x: undefined })).toThrow(
      /unfilled placeholder \{\{x\}\}/,
    );
  });

  it("fills an allow-listed RAW key verbatim, unescaped", () => {
    const sql = renderSql("SELECT * FROM {{from}}", {}, { raw: { from: "read_parquet('taxon')" } });
    expect(sql).toBe("SELECT * FROM read_parquet('taxon')");
  });

  // seeded fault: an unlisted RAW key must throw, regardless of whether the template even
  // references it -- the fixed allow-list is the whole point of the RAW escape hatch.
  it("throws immediately on a RAW key that is not in the fixed allow-list", () => {
    expect(() => renderSql("SELECT 1", {}, { raw: { notAllowed: "1; DROP TABLE t; --" } })).toThrow(
      /raw key "notAllowed" is not in the fixed RAW allow-list/,
    );
  });

  it("still throws on an unlisted RAW key even when the template never uses {{name}} for it", () => {
    expect(() => renderSql("SELECT 1", {}, { raw: { evil: "2" } })).toThrow(
      /not in the fixed RAW allow-list/,
    );
  });

  it("RAW_ALLOWLIST is exactly the documented, fixed set", () => {
    expect([...RAW_ALLOWLIST].sort()).toEqual(["cols", "from", "predicate"]);
  });

  // seeded fault (paired with the e2e injection-round-trip spec): a value passed through the
  // ORDINARY (non-RAW) params path is ALWAYS lit()'d -- an injection-shaped string cannot be
  // interpolated "raw" by accident just by being suspicious-looking.
  it("an ordinary param is lit()'d even when it looks like an injection attempt", () => {
    const injected = "'; DROP TABLE t; --";
    const sql = renderSql("SELECT {{val}} AS v", { val: injected });
    expect(sql).toBe(`SELECT ${lit(injected)} AS v`);
    expect(sql).not.toContain("DROP TABLE t;\n"); // no unquoted statement boundary introduced
  });

  it("renders an array param as an IN-list", () => {
    const sql = renderSql("SELECT * FROM t WHERE id IN {{ids}}", { ids: [1, 2, 3] });
    expect(sql).toBe("SELECT * FROM t WHERE id IN (1, 2, 3)");
  });
});
