/**
 * Minimal, dependency-free YAML frontmatter reader.
 *
 * Deliberately tiny: pi's own agent and skill files use flat `key: value`
 * frontmatter only. Block scalars (`|`, `>`) are detected and reported so the
 * caller can warn rather than silently produce a wrong value.
 */

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

export function parseFrontmatter(text) {
  const match = FENCE.exec(text);
  if (!match) return { data: {}, body: text, blockScalars: [] };

  const data = {};
  const blockScalars = [];

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "    ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    // Only accept top-level keys (no indentation) so nested YAML is skipped.
    if (/^\s/.test(line)) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!key) continue;

    if (value === "|" || value === ">" || /^[|>][-+0-9]*$/.test(value)) {
      blockScalars.push(key);
      continue;
    }

    // Strip a single layer of matching quotes.
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
        if (first === '"') value = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }

    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (/^-?\d+$/.test(value)) value = Number(value);

    data[key] = value;
  }

  return { data, body: text.slice(match[0].length), blockScalars };
}

/** Normalise whitespace to a single line, matching pi's `oneLine()` behaviour. */
export function oneLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Parse a `tools: a,b,c` style list into an array. */
export function parseCsv(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
