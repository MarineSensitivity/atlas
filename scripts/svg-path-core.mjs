// atlas-3: a tiny SVG path-data parser, used to prove a bespoke glyph is a real path and that the
// copy quoted in docs/design/spec.md is byte-identical to the committed .svg. The Step 2 icon-map
// generator imports @mdi/js by NAME and must never transcribe path data by hand (an earlier attempt
// typed 16 "MDI" paths from memory and 0 of 16 matched) — this only covers the glyphs we draw.

const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const TOKEN_RE = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/**
 * Parse SVG path data into commands, throwing on anything a renderer would reject.
 * @param {string} d
 * @returns {{ command: string, args: number[] }[]}
 */
export function parsePathD(d) {
  if (typeof d !== "string" || d.trim() === "") throw new Error("empty path data");
  const tokens = [];
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m; (m = TOKEN_RE.exec(d));) {
    const gap = d.slice(cursor, m.index);
    if (/[^\s,]/.test(gap))
      throw new Error(`unexpected character(s) ${JSON.stringify(gap)} in path`);
    cursor = m.index + m[0].length;
    tokens.push(m[1] ? { type: "cmd", value: m[1] } : { type: "num", value: Number(m[2]) });
  }
  const trailing = d.slice(cursor);
  if (/[^\s,]/.test(trailing)) throw new Error(`unexpected trailing ${JSON.stringify(trailing)}`);
  if (!tokens.length || tokens[0].type !== "cmd" || tokens[0].value.toLowerCase() !== "m") {
    throw new Error("path data must start with a moveto (M or m)");
  }

  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i++];
    if (t.type !== "cmd") throw new Error(`expected a command, found the number ${t.value}`);
    const letter = t.value;
    const arity = ARGS[letter.toLowerCase()];
    if (arity === 0) {
      out.push({ command: letter, args: [] });
      continue;
    }
    // a command may be followed by several argument sets ("implicit repeat"), as SVG allows
    do {
      const args = [];
      for (let k = 0; k < arity; k++) {
        const n = tokens[i++];
        if (!n || n.type !== "num") {
          throw new Error(`"${letter}" needs ${arity} number(s); got ${args.length}`);
        }
        args.push(n.value);
      }
      out.push({ command: letter, args });
    } while (tokens[i]?.type === "num");
  }
  return out;
}

/** Pull the single `d` attribute out of a one-path glyph SVG. */
export function glyphPathFromSvg(svg) {
  const all = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  if (all.length !== 1)
    throw new Error(`expected exactly one path in the glyph, found ${all.length}`);
  return all[0];
}

/**
 * Pull a glyph's path out of the spec, from the fenced block that follows `<!-- glyph:<name> -->`.
 * @param {string} markdown @param {string} name
 */
export function glyphPathFromSpec(markdown, name) {
  const re = new RegExp(`<!--\\s*glyph:${name}\\s*-->\\s*\`\`\`[^\\n]*\\n([\\s\\S]*?)\`\`\``);
  const m = markdown.match(re);
  if (!m) throw new Error(`docs/design/spec.md has no <!-- glyph:${name} --> block`);
  return m[1].trim();
}
