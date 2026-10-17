// src/games/lights-out/lights-out-game.ts
// A small Lights Out for the checker's fixtures, with game-rules-engine's state and move shapes
// ({ cols, rows, cells, moves, maxMoves }, { kind: 'toggle', col, row }): pressing a cell toggles it
// and its four neighbours; all dark wins; using up the move budget loses. Hints, one rescue, no levels.
import type { GameModule } from '@/core/game/game-module';

type State = {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly number[];
  readonly moves: number;
  readonly maxMoves: number;
};
type Move = { readonly kind: 'toggle'; readonly col: number; readonly row: number };
type Event = { readonly kind: 'cells-toggled'; readonly cells: readonly number[] };
type Intent = { readonly kind: 'tap'; readonly target: { readonly regionId: string; readonly col: number; readonly row: number } };

/** A 3x3 board lit by pressing both corners (rows: x x . / x . x / . x x). */
const START: State = { cols: 3, rows: 3, cells: [1, 1, 0, 1, 0, 1, 0, 1, 1], moves: 0, maxMoves: 4 };

const isWon = (state: State): boolean => state.cells.every((cell) => cell === 0);
const outcome = (state: State) => {
  if (isWon(state)) return { kind: 'won', score: state.maxMoves - state.moves } as const;
  return state.moves >= state.maxMoves ? ({ kind: 'lost', reasonKey: 'lights-out.lose.out-of-moves' } as const) : ({ kind: 'playing' } as const);
};
const neighbourhood = (state: State, move: Move): number[] =>
  [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1]]
    .map(([dc, dr]) => [move.col + dc, move.row + dr])
    .filter(([col, row]) => col >= 0 && row >= 0 && col < state.cols && row < state.rows)
    .map(([col, row]) => row * state.cols + col);
const allMoves = (state: State): Move[] =>
  state.cells.map((_cell, index) => ({ kind: 'toggle', col: index % state.cols, row: Math.floor(index / state.cols) }));

export const LIGHTS_OUT_GAME: GameModule<State, Move, Event, Intent> = {
  identity: { id: 'lights-out', nameId: 'lights-out.name' },
  engine: {
    create: () => START,
    listMoves: (state) => (outcome(state).kind === 'playing' ? allMoves(state) : []),
    applyMove: (state, move) => {
      const cells = neighbourhood(state, move);
      const next = state.cells.map((cell, index) => (cells.includes(index) ? 1 - cell : cell));
      return { state: { ...state, cells: next, moves: state.moves + 1 }, events: [{ kind: 'cells-toggled', cells }] };
    },
    outcome,
  },
  input: { panMode: 'none', selectRegions: [], intentToMove: (_state, intent) => ({ kind: 'toggle', col: intent.target.col, row: intent.target.row }) },
  rules: {
    hud: (state) => ({ score: state.moves, goal: { id: 'lights-out.hud.moves', values: { left: state.maxMoves - state.moves } } }),
    undo: { kind: 'unlimited' },
    hints: { kind: 'solver', suggest: () => ({ kind: 'toggle', col: 0, row: 0 }) },
    continueRun: {
      kind: 'once',
      descriptionId: 'lights-out.continue.more-moves',
      apply: (lost) => ({ state: { ...lost, maxMoves: lost.maxMoves + 2 }, events: [] }),
    },
  },
  persistence: {
    stateVersion: 1,
    parseState: () => null,
    parseMove: () => null,
    migrateState: () => null,
    savePolicy: { kind: 'after-every-move' },
  },
  stats: { counters: [] },
  testing: {
    bot: (_state, moves, rng) => ({ move: moves[0] ?? { kind: 'toggle', col: 0, row: 0 }, rng }),
    examples: {
      start: () => START,
      middle: () => ({ ...START, cells: [0, 0, 1, 0, 0, 1, 0, 1, 1], moves: 1 }),
      win: () => ({ ...START, cells: START.cells.map(() => 0), moves: 2 }),
      lose: () => ({ ...START, moves: START.maxMoves }),
    },
  },
  levels: null,
};
