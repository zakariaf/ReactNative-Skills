// json-text.mjs: JSON written the way Prettier formats it with the canonical config (printWidth 100,
// 2 spaces), so a file the generator writes passes `prettier --check` without a format step.
// Objects are always expanded (Prettier keeps an object expanded when its first key starts a new
// line); an array of plain values stays on one line when that line fits, else one value per line.
// Not an entry point.

const PRINT_WIDTH = 100;
const INDENT = '  ';

const isPlain = (value) => value === null || typeof value !== 'object';

function format(value, depth, prefixLength) {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  if (isPlain(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPlain)) {
      const flat = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      // The line holds the prefix (indent + key), the array and a trailing comma at most.
      if (prefixLength + flat.length + 1 <= PRINT_WIDTH) return flat;
    }
    return `[\n${value.map((item) => `${inner}${format(item, depth + 1, inner.length)}`).join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([key, item]) => {
    const head = `${inner}${JSON.stringify(key)}: `;
    return `${head}${format(item, depth + 1, head.length)}`;
  });
  return `{\n${lines.join(',\n')}\n${pad}}`;
}

/** The JSON text of a value, Prettier-formatted, with a final newline. */
export function jsonText(value) {
  return `${format(value, 0, 0)}\n`;
}

/** A flat catalog with its keys sorted (JavaScript default sort), as text. */
export function catalogText(catalog) {
  const sorted = Object.fromEntries(Object.keys(catalog).sort().map((key) => [key, catalog[key]]));
  return jsonText(sorted);
}
