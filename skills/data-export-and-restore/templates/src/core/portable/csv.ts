// src/core/portable/csv.ts: RFC 4180 CSV text with the formula-injection guard, for exports a spreadsheet opens.

/**
 * A cell. Text comes from users and is guarded; numbers and booleans come from code and are written
 * canonically (a number can never be a formula, so -5 stays a number). null is an empty field.
 */
export type CsvCell = string | number | boolean | null;

/**
 * A spreadsheet runs a cell that starts with one of these as a formula (=HYPERLINK(...), +cmd,
 * -2+3, @SUM(...)); tab and carriage return are leaders in some importers too (OWASP, CSV Injection).
 */
export const CSV_FORMULA_LEADERS: readonly string[] = ['=', '+', '-', '@', '\t', '\r'];

/** UTF-8 byte order mark: spreadsheet apps that guess a legacy encoding read it as UTF-8. */
export const UTF8_BOM = '\uFEFF';

const NEEDS_QUOTES = /[",\r\n]/;

/** Guard 1 (safety): text that starts with a formula leader gets a leading apostrophe. */
function neutralized(text: string): string {
  return CSV_FORMULA_LEADERS.some((leader) => text.startsWith(leader)) ? `'${text}` : text;
}

/** Guard 2 (correctness): RFC 4180 quoting; an embedded quote is doubled; spaces are kept. */
function quoted(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One field. Text is neutralized first, then quoted (in that order: the apostrophe must be inside
 * the quotes). The empty string is written as "" so a reader can tell it from null (an empty field).
 */
export function encodeCsvField(cell: CsvCell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) throw new RangeError(`not a CSV number: ${String(cell)}`);
    return String(cell);
  }
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (cell === '') return '""';
  return quoted(neutralized(cell));
}

export type CsvOptions = {
  /** Start with UTF8_BOM. Default true: the audience of a CSV export is a spreadsheet app. */
  readonly bom?: boolean;
};

/**
 * The whole file: a header row, then one record per row, each ended by CRLF (RFC 4180). A row
 * whose length differs from the header's throws a RangeError: a shifted column is silent data loss.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: CsvOptions = {},
): string {
  const lines = [header.map(encodeCsvField).join(',')];
  rows.forEach((row, index) => {
    if (row.length !== header.length) {
      throw new RangeError(
        `row ${String(index)} has ${String(row.length)} cells, the header ${String(header.length)}`,
      );
    }
    lines.push(row.map(encodeCsvField).join(','));
  });
  return `${options.bom === false ? '' : UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
