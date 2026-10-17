// src/core/portable/csv.test.ts
import { parseCsv } from '@test/portable/parse-csv';

import { CSV_FORMULA_LEADERS, encodeCsvField, toCsv, UTF8_BOM } from './csv';

describe('encodeCsvField', () => {
  it.each(CSV_FORMULA_LEADERS)('neutralizes text that starts with %j', (leader) => {
    expect(encodeCsvField(`${leader}1+1`).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('neutralizes before quoting, so the apostrophe sits inside the quotes', () => {
    expect(encodeCsvField('=HYPERLINK("http://x","go")')).toBe(
      '"\'=HYPERLINK(""http://x"",""go"")"',
    );
  });

  it('quotes a comma, a quote, CR or LF, doubles quotes, and keeps spaces', () => {
    expect(encodeCsvField('a,b"c\nd')).toBe('"a,b""c\nd"');
    expect(encodeCsvField('  padded  ')).toBe('  padded  ');
  });

  it('writes numbers and booleans canonically: a negative number is a number, not a formula', () => {
    expect([encodeCsvField(-5), encodeCsvField(12.5), encodeCsvField(true)]).toStrictEqual([
      '-5',
      '12.5',
      'true',
    ]);
    expect(() => encodeCsvField(Number.NaN)).toThrow(RangeError);
  });

  it('keeps null (an empty field) apart from the empty string ("")', () => {
    expect([encodeCsvField(null), encodeCsvField('')]).toStrictEqual(['', '""']);
  });
});

describe('toCsv', () => {
  const hostile = [
    'Call the plumber about the kitchen\'s tap, "today"',
    "=cmd|' /C calc'!A0",
    'line one\r\nline two',
    '\u200Fشراء الحليب\u200F 📊',
    '   ',
  ];

  it('survives a strict RFC 4180 reader with hostile text', () => {
    const csv = toCsv(
      ['title', 'done'],
      hostile.map((title) => [title, false]),
    );
    const [header, ...rows] = parseCsv(csv);
    expect(header).toStrictEqual(['title', 'done']);
    expect(rows.map((row) => row[0])).toStrictEqual(
      hostile.map((title) => (title.startsWith('=') ? `'${title}` : title)),
    );
  });

  it('starts with a BOM by default, ends every record with CRLF, and drops the BOM on request', () => {
    const csv = toCsv(['a'], [[1]]);
    expect(csv).toBe(`${UTF8_BOM}a\r\n1\r\n`);
    expect(toCsv(['a'], [[1]], { bom: false })).toBe('a\r\n1\r\n');
  });

  it('refuses a row with a different number of cells than the header', () => {
    expect(() => toCsv(['a', 'b'], [['only one']])).toThrow('row 0 has 1 cells, the header 2');
  });
});
