// test/portable/parse-csv.ts: a strict RFC 4180 reader for tests, so CSV exports are proven by parsing, never by eye.

/** A parsed field: the text, or null for an empty unquoted field (what encodeCsvField writes for null). */
export type ParsedField = string | null;

/**
 * Parses CSV text with CRLF record separators (a leading BOM is skipped). Throws a SyntaxError on
 * anything RFC 4180 does not allow: a bare LF or CR between records, a quote inside an unquoted
 * field, text after a closing quote, an unterminated quote, or a missing final CRLF.
 */
function bodyOf(input: string): string {
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input;
  if (text !== '' && !text.endsWith('\r\n')) throw new SyntaxError('missing the final CRLF');
  return text;
}

export function parseCsv(input: string): readonly (readonly ParsedField[])[] {
  const text = bodyOf(input);
  const rows: ParsedField[][] = [];
  let row: ParsedField[] = [];
  let field = '';
  let isQuoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field === '' && !isQuoted ? null : field);
    field = '';
    isQuoted = false;
  };
  const readQuoted = (): void => {
    const start = index;
    isQuoted = true;
    index += 1;
    for (;;) {
      const close = text.indexOf('"', index);
      if (close === -1) throw new SyntaxError(`unterminated quoted field at ${String(start)}`);
      field += text.slice(index, close);
      index = close + 1;
      if (text.charAt(index) !== '"') break;
      field += '"';
      index += 1;
    }
    const next = text.charAt(index);
    if (next !== ',' && next !== '\r')
      throw new SyntaxError(`text after a quote at ${String(index)}`);
  };

  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '"' && field === '') {
      readQuoted();
    } else if (char === ',') {
      endField();
      index += 1;
    } else if (char === '\r' && text.charAt(index + 1) === '\n') {
      endField();
      rows.push(row);
      row = [];
      index += 2;
    } else if ('"\r\n'.includes(char)) {
      throw new SyntaxError(
        `bare ${JSON.stringify(char)} in an unquoted field at ${String(index)}`,
      );
    } else {
      field += char;
      index += 1;
    }
  }
  return rows;
}
