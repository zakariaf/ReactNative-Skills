// test/goldens/golden-text.test.ts
import { goldenText, headerLine, renderGrid } from './golden-text';

describe('headerLine', () => {
  it('writes each field as key and value in the given order', () => {
    expect(headerLine({ today: '2026-10-03', open: 3, isPremium: false })).toBe(
      'today 2026-10-03 open 3 isPremium false',
    );
  });

  it('returns an empty line for no fields', () => {
    expect(headerLine({})).toBe('');
  });
});

describe('goldenText', () => {
  it('puts the header first and one line per entry after it', () => {
    expect(goldenText('today 2026-10-03', ['overdue: -', 'today: t2'])).toBe(
      'today 2026-10-03\noverdue: -\ntoday: t2',
    );
  });
});

describe('renderGrid', () => {
  it('draws one text row per grid row with one glyph per cell', () => {
    expect(renderGrid([0, 1, 1, 0, 0, 1], 3, (cell) => (cell === 0 ? '.' : '#'))).toBe('.##\n..#');
  });

  it('keeps a short last row', () => {
    expect(renderGrid([true, false, true], 2, (isDone) => (isDone ? '#' : '.'))).toBe('#.\n#');
  });

  it('returns an empty string for no cells', () => {
    expect(renderGrid([], 4, String)).toBe('');
  });

  it('throws for a column count that is not a positive integer', () => {
    expect(() => renderGrid([1], 0, String)).toThrow(RangeError);
    expect(() => renderGrid([1], 1.5, String)).toThrow('cols must be a positive integer, got 1.5');
  });
});
