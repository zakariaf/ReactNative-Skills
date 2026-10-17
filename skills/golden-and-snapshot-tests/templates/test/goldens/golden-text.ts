// test/goldens/golden-text.ts
// Turns output into readable golden text: one header line with the inputs and headline numbers,
// then short lines or an ASCII grid. A data golden snapshots a string built with these helpers,
// never an object tree or a rendered component, so its diff reads like what the user sees.

/** One header line, `key value key value ...` in the order given: `today 2026-10-03 done 1`. */
export function headerLine(fields: Readonly<Record<string, string | number | boolean>>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(' ');
}

/** The header line, then each line as given, joined into the one string a golden snapshots. */
export function goldenText(header: string, lines: readonly string[]): string {
  return [header, ...lines].join('\n');
}

/**
 * Cells as text rows of `cols` glyphs each (a week strip, a month heatmap, a board). `glyphOf`
 * maps a cell to exactly one character; document the legend where you call it ('#' done, '.' open).
 */
export function renderGrid<T>(
  cells: readonly T[],
  cols: number,
  glyphOf: (cell: T) => string,
): string {
  if (!Number.isInteger(cols) || cols <= 0) {
    throw new RangeError(`cols must be a positive integer, got ${String(cols)}`);
  }
  const rows: string[] = [];
  for (let start = 0; start < cells.length; start += cols) {
    rows.push(
      cells
        .slice(start, start + cols)
        .map(glyphOf)
        .join(''),
    );
  }
  return rows.join('\n');
}
