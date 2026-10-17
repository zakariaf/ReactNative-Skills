// src/ui/use-balanced-wrap.test.ts
// The layout events come from the platform; the search itself is pure and tested here, with the
// line widths an iPhone (3x) reported for real headings.
import { advance, firstSearch, isStale, nextSearch } from './use-balanced-wrap';

describe('balanced wrap search (CSS text-wrap: balance)', () => {
  it('leaves one-line text alone', () => {
    expect(firstSearch('k', 316, [200])).toMatchObject({ pad: 0, isDone: true });
  });

  it('probes half-way between the average line and the full width', () => {
    // 305 + 56 = 361 over two lines: average 180.5, probe floor(248.25) = 248 -> pad 316 - 248 = 68.
    expect(firstSearch('k', 316, [305, 56])).toMatchObject({ lines: 2, pad: 68, isDone: false });
  });

  it('narrows while the line count holds, always below the widest kept line', () => {
    let search = firstSearch('k', 316, [305, 56]);
    search = nextSearch(search, 316, [200, 161]); // 248 kept 2 lines, widest 200
    expect(search).toMatchObject({ hi: 248, widest: 200, pad: 316 - 199, isDone: false });
  });

  it('goes back to the narrowest kept width after a probe adds a line, then probes between', () => {
    // iOS sends no text layout when the lines come out unchanged, so the search never probes
    // straight from a failed layout: it returns to the last width known to keep the count first.
    let search = firstSearch('k', 316, [305, 56]);
    search = nextSearch(search, 316, [240, 121]); // 248 kept, probe floor((180.5 + 248) / 2) = 214
    search = nextSearch(search, 316, [150, 120, 91]); // 214 added a line
    expect(search).toMatchObject({ lo: 214, hi: 248, pad: 68, isReturning: true, isDone: false });
    search = nextSearch(search, 316, [240, 121]); // back at 248: probe floor((214 + 248) / 2) = 231
    expect(search).toMatchObject({ isReturning: false, isDone: false, pad: 316 - 231 });
  });

  it('stops when no width between lo and the widest kept line is left', () => {
    let search = firstSearch('k', 316, [305, 56]);
    search = nextSearch(search, 316, [200, 161]); // 248 kept, widest 200: probe 199
    search = nextSearch(search, 316, [150, 120, 91]); // 199 added a line: 200 is the answer
    expect(search).toMatchObject({ lo: 199, hi: 248, pad: 68, isDone: true });
  });

  it('balances a three-line right-to-left summary (the last word of line two moves down)', () => {
    // Greedy lines of a 3-line text: the second line keeps its last word only above 262 pt.
    const layoutAt = (room: number): number[] => {
      if (room >= 262) return [255, 262, 180];
      return room >= 255 ? [255, 238, 214] : [230, 240, 200, 60];
    };
    let search = firstSearch('k', 305, [300, 270, 60]);
    for (let step = 0; step < 20 && !search.isDone; step += 1) {
      search = nextSearch(search, 305, layoutAt(305 - search.pad));
    }
    expect(305 - search.pad).toBeGreaterThanOrEqual(255);
    expect(305 - search.pad).toBeLessThan(262);
  });

  it('balances a three-line summary to the same breaks as the web (device widths at 258 pt)', () => {
    // Device measurements of "Your tasks stay on this phone, and the app collects no data." at 258 pt.
    const layoutAt = (room: number): number[] =>
      room >= 192 ? [Math.min(room, 197.3), 173.7, 143.7] : [107.4, 160.6, 174.4, 72.4];
    let search = firstSearch('k', 258, [235.6, 233.1, 46.1]);
    for (let step = 0; step < 10 && !search.isDone; step += 1) {
      search = nextSearch(search, 258, layoutAt(258 - search.pad));
    }
    expect(search.isDone).toBe(true);
    expect(layoutAt(258 - search.pad)).toHaveLength(3);
    expect(258 - search.pad).toBeLessThan(215);
  });
});

describe('advance (layout events in either order)', () => {
  it('starts the search once both the width and the full-width lines are known', () => {
    const linesFirst = advance({ text: 't', width: 0, lineWidths: [305, 56], search: null });
    expect(linesFirst.search).toBeNull();
    const thenWidth = advance({ ...linesFirst, width: 316 });
    expect(thenWidth.search).toMatchObject({ lines: 2, isDone: false });
  });

  it('moves the search on with each later text layout and stops when done', () => {
    let measure = advance({ text: 't', width: 316, lineWidths: [305, 56], search: null });
    for (let step = 0; step < 10; step += 1) {
      const tried = 316 - (measure.search?.pad ?? 0);
      measure = advance({ ...measure, lineWidths: tried >= 205 ? [200, 160] : [150, 120, 90] });
    }
    expect(measure.search?.isDone).toBe(true);
  });
});

describe('isStale (a late text layout from a wider pad)', () => {
  const probing = advance({ text: 't', width: 316, lineWidths: [305, 56], search: null });
  const room = 316 - (probing.search?.pad ?? 0);

  it('drops a layout with a line wider than the room the current pad leaves', () => {
    expect(isStale(probing, [305, 56])).toBe(true);
  });

  it('keeps a layout whose lines fit the current room (it wraps the same)', () => {
    expect(isStale(probing, [room - 10, room - 40])).toBe(false);
  });

  it('keeps every layout before the width is known', () => {
    expect(isStale({ ...probing, width: 0 }, [900])).toBe(false);
  });
});
