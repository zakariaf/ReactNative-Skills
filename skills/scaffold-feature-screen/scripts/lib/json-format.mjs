// json-format.mjs: prints JSON the way Prettier prints a repo's JSON contracts and catalogs
// (printWidth 100, two-space indent), so a file the scaffold edits passes `prettier --check`
// unchanged. Objects that hold anything are always expanded (Prettier keeps an object expanded
// when its source had a line break after "{", which every hand-written contract has); an array
// stays on one line when it holds only primitives and fits, otherwise one item per line. Zero
// dependencies.

const PRINT_WIDTH = 100;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isFlat(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return true;
}

function printValue(value, indent, prefixWidth) {
  if (Array.isArray(value)) return printArray(value, indent, prefixWidth);
  if (isPlainObject(value)) return printObject(value, indent);
  return JSON.stringify(value);
}

function printObject(value, indent) {
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const inner = `${indent}  `;
  const lines = keys.map((key) => {
    const head = `${inner}${JSON.stringify(key)}: `;
    return `${head}${printValue(value[key], inner, head.length)}`;
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

function printArray(value, indent, prefixWidth) {
  if (value.length === 0) return '[]';
  if (value.every(isFlat)) {
    const oneLine = `[${value.map((item) => printValue(item, indent, 0)).join(', ')}]`;
    // The closing comma of the enclosing entry counts toward the width, as in Prettier.
    if (prefixWidth + oneLine.length + 1 <= PRINT_WIDTH) return oneLine;
  }
  const inner = `${indent}  `;
  return `[\n${value.map((item) => `${inner}${printValue(item, inner, inner.length)}`).join(',\n')}\n${indent}]`;
}

/** The JSON text of `value` in Prettier's layout, with a final newline. */
export function formatJson(value) {
  return `${printValue(value, '', 0)}\n`;
}
