// src/ui/use-balanced-wrap.ts
// Display text (titles, headings, dialog titles) wraps balanced, like CSS `text-wrap: balance`: a
// heading that needs two lines gets two lines of nearly equal length (the narrowest width that keeps
// its line count), where React Native fills the first line greedily and leaves one word alone on the
// last. After a layout this hook searches that width from the Text's own line measurements and
// applies it as a pad at the text's end, so the element keeps its full width.
import { useState } from 'react';

import type { TextAlignToken } from '@/theme/use-text-style';
import type { LayoutChangeEvent, TextLayoutEvent, TextStyle } from 'react-native';

const MAX_STEPS = 10;

type Search = {
  /** The text and width the search belongs to: a new text or width starts again. */
  readonly key: string;
  /** Lines at the full width (the count to keep). */
  readonly lines: number;
  /** The widest width known to need more lines (at first the average line) and the narrowest known to keep the count. */
  readonly lo: number;
  readonly hi: number;
  /** The widest line of the layout at hi. */
  readonly widest: number;
  readonly steps: number;
  readonly pad: number;
  /** The pad went back to hi after a probe added a line; the next layout is hi's again. */
  readonly isReturning: boolean;
  readonly isDone: boolean;
};

export type BalancedWrap = {
  readonly style: TextStyle | null;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly onTextLayout?: (event: TextLayoutEvent) => void;
};

/**
 * The next width to try: half-way between lo and hi, and always narrower than the widest line of
 * the layout at hi. React Native sends no text layout when the lines come out the same as the last
 * ones it sent, so every probe must change the layout from the last one, or the search would wait
 * forever on a width it never measured.
 */
function probeOf(lo: number, hi: number, widest: number): number {
  return Math.floor(Math.min((lo + hi) / 2, widest - 0.5));
}

/** Probe on from the layout at hi, or stop there. */
function probeFrom(search: Search, width: number): Search {
  const probe = probeOf(search.lo, search.hi, search.widest);
  if (search.steps >= MAX_STEPS || probe <= search.lo) {
    return { ...search, pad: Math.max(0, width - search.hi), isReturning: false, isDone: true };
  }
  return { ...search, pad: Math.max(0, width - probe), isReturning: false };
}

/**
 * One step of the search after a text layout. A probe that keeps the count narrows on from it. A
 * probe that adds a line sends the pad back to hi first (a wider probe straight after it could lay
 * out the same lines again and send no event), then probes between the two.
 */
export function nextSearch(search: Search, width: number, lineWidths: readonly number[]): Search {
  const steps = search.steps + 1;
  const widest = Math.max(...lineWidths);
  if (search.isReturning) return probeFrom({ ...search, steps, widest }, width);
  const tried = width - search.pad;
  if (lineWidths.length > search.lines) {
    const failed = { ...search, steps, lo: tried };
    if (steps >= MAX_STEPS || probeOf(tried, search.hi, search.widest) <= tried) {
      return { ...failed, pad: Math.max(0, width - search.hi), isDone: true };
    }
    return { ...failed, pad: Math.max(0, width - search.hi), isReturning: true };
  }
  return probeFrom({ ...search, steps, hi: tried, widest }, width);
}

/** The first probe after a layout at the full width. */
export function firstSearch(key: string, width: number, lineWidths: readonly number[]): Search {
  const lines = lineWidths.length;
  const widest = Math.max(0, ...lineWidths);
  const start = {
    key,
    lines,
    lo: width,
    hi: width,
    widest,
    steps: 0,
    pad: 0,
    isReturning: false,
    isDone: true,
  };
  if (lines < 2) return start;
  const lo = lineWidths.reduce((sum, line) => sum + line, 0) / lines;
  const probe = probeOf(lo, width, widest);
  if (probe <= lo) return start;
  return { ...start, lo, pad: Math.max(0, width - probe), isDone: false };
}

function padStyle(pad: number, align: TextAlignToken): TextStyle | null {
  if (pad === 0) return null;
  if (align === 'center') return { paddingHorizontal: pad / 2 };
  return align === 'end' ? { paddingStart: pad } : { paddingEnd: pad };
}

export type Measure = {
  readonly text: string;
  readonly width: number;
  /** Line widths of the last text layout, and whether it was at the full width (pad 0). */
  readonly lineWidths: readonly number[] | null;
  readonly search: Search | null;
};

/**
 * The next state after a measurement: the first layout at the full width starts the search, each
 * later layout moves it on. onLayout and onTextLayout arrive in either order, so both call it.
 */
export function advance(measure: Measure): Measure {
  const { width, lineWidths, search } = measure;
  if (width === 0 || lineWidths === null || search?.isDone === true) return measure;
  const key = `${String(width)}|${measure.text}`;
  if (search?.key !== key) return { ...measure, search: firstSearch(key, width, lineWidths) };
  return { ...measure, search: nextSearch(search, width, lineWidths) };
}

/** Slack for sub-point rounding between the line widths and the laid-out width. */
const LINE_SLACK = 0.5;

/**
 * A text layout can arrive late, from a wider pad than the one now applied (iOS can report one
 * layout twice). A line wider than the room the current pad leaves proves the layout is not for
 * this pad; one that fits wraps the same at this pad (greedy wrapping), so it counts.
 */
export function isStale(measure: Measure, lineWidths: readonly number[]): boolean {
  if (measure.width === 0) return false;
  const room = measure.width - (measure.search?.pad ?? 0);
  return lineWidths.some((line) => line > room + LINE_SLACK);
}

const EMPTY: Measure = { text: '', width: 0, lineWidths: null, search: null };

/** The stored measure for this text (a new text starts from nothing). */
function forText(stored: Measure, text: string): Measure {
  return stored.text === text ? stored : { ...EMPTY, text };
}

export function useBalancedWrap(
  isEnabled: boolean,
  text: string,
  align: TextAlignToken,
): BalancedWrap {
  const [stored, setMeasure] = useState<Measure>(EMPTY);
  if (!isEnabled) return { style: null };
  const measure = forText(stored, text);
  // Both events can arrive before a re-render: update from the latest state, never a stale closure.
  return {
    style: padStyle(measure.search?.pad ?? 0, align),
    onLayout: (event) => {
      const width = event.nativeEvent.layout.width;
      setMeasure((previous) => {
        const current = forText(previous, text);
        if (Math.abs(width - current.width) <= 0.5) return previous;
        // A new width starts over from the full-width line layout.
        const lineWidths = current.search === null ? current.lineWidths : null;
        return advance({ ...current, width, search: null, lineWidths });
      });
    },
    onTextLayout: (event) => {
      const lineWidths = event.nativeEvent.lines.map((line) => line.width);
      setMeasure((previous) => {
        const current = forText(previous, text);
        return isStale(current, lineWidths) ? previous : advance({ ...current, lineWidths });
      });
    },
  };
}
