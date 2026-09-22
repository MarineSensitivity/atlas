// The validators in shards.ts/picker.ts are hand-written (this code is on the lens' first-paint
// path and must stay small), so this file ties them to msens' OWN schemas, which are the truth:
// `tests/fixtures/species/schema/*.json` are byte copies of
// msens/inst/schema/app_{taxon,alias,taxa}.schema.json.
//
// For every `required` property the schema declares, at every level, it deletes that property from a
// REAL fixture and asserts the validator rejects the result. Add a required field in msens and copy
// the schema across, and this file goes red until the validator checks it too.
import { describe, expect, it } from "vitest";
import {
  SHARD_ID_RE,
  VER_RE,
  parseAliasShard,
  parseTaxonShard,
} from "../../../src/lens/species/data/shards";
import { parseTaxaIndex } from "../../../src/lens/species/data/picker";
import { readFixture } from "./fixtures";

type Json = Record<string, unknown>;

const taxonSchema = readFixture("schema/app_taxon.schema.json") as Json;
const aliasSchema = readFixture("schema/app_alias.schema.json") as Json;
const taxaSchema = readFixture("schema/app_taxa.schema.json") as Json;

function at(root: Json, path: string[]): Json {
  let node: Json = root;
  for (const p of path) node = node[p] as Json;
  return node;
}

function required(root: Json, path: string[]): string[] {
  const node = at(root, path);
  const req = node.required;
  if (!Array.isArray(req) || req.length === 0)
    throw new Error(`schema ${path.join(".")}: no 'required' array`);
  return req as string[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("app_taxon.schema.json: every required property is enforced", () => {
  const P = ["properties", "taxa", "additionalProperties"];
  const cases: [label: string, drop: (o: Json) => void][] = [];
  for (const key of required(taxonSchema, [])) {
    cases.push([`envelope.${key}`, (o) => delete o[key]]);
  }
  for (const key of required(taxonSchema, P)) {
    cases.push([
      `taxon.${key}`,
      (o) => {
        const taxa = o.taxa as Json;
        delete (taxa[Object.keys(taxa)[0]] as Json)[key];
      },
    ]);
  }
  for (const key of required(taxonSchema, [...P, "properties", "inputs", "items"])) {
    cases.push([
      `input.${key}`,
      (o) => {
        const taxa = o.taxa as Json;
        const card = taxa[Object.keys(taxa)[0]] as Json;
        delete (card.inputs as Json[])[0][key];
      },
    ]);
  }
  for (const key of required(taxonSchema, [
    ...P,
    "properties",
    "inputs",
    "items",
    "properties",
    "assets",
    "items",
  ])) {
    cases.push([
      `asset.${key}`,
      (o) => {
        const taxa = o.taxa as Json;
        const card = taxa[Object.keys(taxa)[0]] as Json;
        delete ((card.inputs as Json[])[0].assets as Json[])[0][key];
      },
    ]);
  }

  it("the fixture it starts from is valid", () => {
    expect(typeof parseTaxonShard(readFixture("v9/taxon/f9.json"))).not.toBe("string");
  });

  for (const [label, drop] of cases) {
    it(`rejects a shard missing ${label}`, () => {
      const broken = clone(readFixture("v9/taxon/f9.json")) as Json;
      drop(broken);
      expect(typeof parseTaxonShard(broken)).toBe("string");
    });
  }
});

describe("app_alias.schema.json: every required property is enforced", () => {
  it("the fixture it starts from is valid", () => {
    expect(typeof parseAliasShard(readFixture("v9/alias/f9.json"))).not.toBe("string");
  });

  for (const key of required(aliasSchema, [])) {
    it(`rejects an alias shard missing ${key}`, () => {
      const broken = clone(readFixture("v9/alias/f9.json")) as Json;
      delete broken[key];
      expect(typeof parseAliasShard(broken)).toBe("string");
    });
  }

  it("rejects an entry that is not a 2-item string array", () => {
    const broken = clone(readFixture("v9/alias/f9.json")) as Json;
    (broken.alias as Json)["ax|137209"] = ["only-one"];
    expect(typeof parseAliasShard(broken)).toBe("string");
  });
});

describe("app_taxa.schema.json: every required property is enforced", () => {
  it("the fixture it starts from is valid", () => {
    expect(typeof parseTaxaIndex(readFixture("v9/taxa.json"))).not.toBe("string");
  });

  for (const key of required(taxaSchema, [])) {
    it(`rejects an index missing ${key}`, () => {
      const broken = clone(readFixture("v9/taxa.json")) as Json;
      delete broken[key];
      expect(typeof parseTaxaIndex(broken)).toBe("string");
    });
  }

  it("rejects a parallel array shorter than n (a short 'flags' would mark the tail non-US)", () => {
    const broken = clone(readFixture("v9/taxa.json")) as Json;
    (broken.flags as number[]).pop();
    expect(typeof parseTaxaIndex(broken)).toBe("string");
  });
});

describe("the literal patterns match msens", () => {
  it("VER_RE is the schema's own 'ver' pattern", () => {
    const fromSchema = at(taxonSchema, ["properties", "ver"]).pattern as string;
    expect(VER_RE.source).toBe(fromSchema);
    expect(at(aliasSchema, ["properties", "ver"]).pattern).toBe(fromSchema);
    expect(at(taxaSchema, ["properties", "ver"]).pattern).toBe(fromSchema);
  });

  it("SHARD_ID_RE is the schema's own 'shard' pattern", () => {
    expect(SHARD_ID_RE.source).toBe(at(taxonSchema, ["properties", "shard"]).pattern);
  });
});
