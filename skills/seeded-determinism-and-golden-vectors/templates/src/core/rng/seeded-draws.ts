// src/core/rng/seeded-draws.ts
// Draws from lists with the seeded RNG, threading the state. Each function documents exactly how
// many nextInt draws it consumes and in which order: the order is part of every generator's output.
import { nextInt } from './sfc32';

import type { RngState } from './sfc32';

/** A drawn value and the state to use for the next draw. */
export type Drawn<T> = { readonly value: T; readonly state: RngState };

function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`index ${String(index)} outside 0..${String(items.length - 1)}`);
  }
  return item;
}

/** One item, uniformly: exactly one nextInt(items.length) draw. Throws on an empty list. */
export function drawOne<T>(items: readonly T[], state: RngState): Drawn<T> {
  if (items.length === 0) throw new RangeError('drawOne needs at least one item');
  const draw = nextInt(state, items.length);
  return { value: itemAt(items, draw.value), state: draw.state };
}

/**
 * A shuffled copy (Durstenfeld's Fisher-Yates from the end): for i = n-1 down to 1, j = nextInt(i + 1),
 * swap i and j. Consumes exactly n - 1 draws; the input is not changed.
 */
export function shuffle<T>(items: readonly T[], state: RngState): Drawn<readonly T[]> {
  const out = [...items];
  let current = state;
  for (let i = out.length - 1; i >= 1; i -= 1) {
    const draw = nextInt(current, i + 1);
    const picked = itemAt(out, draw.value);
    out[draw.value] = itemAt(out, i);
    out[i] = picked;
    current = draw.state;
  }
  return { value: out, state: current };
}

/**
 * `count` distinct items in draw order (a partial Fisher-Yates from the front): for i = 0 … count-1,
 * j = i + nextInt(n - i), swap i and j, then take the first `count`. Consumes exactly `count` draws,
 * including the last nextInt(1) when count equals n.
 */
export function drawSample<T>(
  items: readonly T[],
  count: number,
  state: RngState,
): Drawn<readonly T[]> {
  if (!Number.isInteger(count) || count < 0 || count > items.length) {
    throw new RangeError(`drawSample count ${String(count)} outside 0..${String(items.length)}`);
  }
  const out = [...items];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const draw = nextInt(current, out.length - i);
    const picked = itemAt(out, i + draw.value);
    out[i + draw.value] = itemAt(out, i);
    out[i] = picked;
    current = draw.state;
  }
  return { value: out.slice(0, count), state: current };
}
