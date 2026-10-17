// src/games/sliding-puzzle/rules/sliding-puzzle-rules.ts
// The sliding puzzle (the public-domain 15-puzzle) rules, pure and deterministic: a tile beside the
// gap may slide into it. listMoves is the one source of truth for what is legal; it is empty once
// the puzzle is solved.

export type SlidingPuzzleState = {
  readonly size: number;
  /** Row-major tile numbers; 0 is the gap. */
  readonly tiles: readonly number[];
};

export type SlidingPuzzleMove = { readonly kind: 'slide-tile'; readonly from: number };

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function isSolved(state: SlidingPuzzleState): boolean {
  return state.tiles.every((tile, index) => tile === (index + 1) % state.tiles.length);
}

/** Every tile beside the gap, or nothing once solved. */
export function listMoves(state: SlidingPuzzleState): readonly SlidingPuzzleMove[] {
  const gap = state.tiles.indexOf(0);
  if (gap === -1 || isSolved(state)) return [];
  const col = gap % state.size;
  const row = Math.floor(gap / state.size);
  return NEIGHBOURS.map(([dx, dy]) => [col + dx, row + dy] as const)
    .filter(([c, r]) => c >= 0 && r >= 0 && c < state.size && r < state.size)
    .map(([c, r]) => ({ kind: 'slide-tile' as const, from: r * state.size + c }));
}
