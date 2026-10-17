// test/games/tally-game.ts
// A complete, tiny GameModule the game host's tests (and game-session-host's checker) run against:
// count up by 1 or 2 to hit the target exactly; going past it loses. Undo unlimited, a solver hint,
// one rescue (step back to target - 1), two counters, three levels (par 2, 3, 3), a daily and an
// endless mode, and a two-step tutorial. Taps: board column 0 adds 1, column 1 adds 2; a tap in the
// 'tray' region selects an amount first (tap-then-tap), and the next board tap adds the selected
// amount.
import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { GameEngine, Outcome } from '@/core/game/game-engine';
import type { GameModule } from '@/core/game/game-module';
import type { GameRules } from '@/core/game/game-rules';
import type { LevelsSpec } from '@/core/game/levels';
import type { TutorialSpec } from '@/services/game-host/hosted-game';

export type TallyState = { readonly count: number; readonly target: number };
export type TallyMove = { readonly kind: 'add'; readonly amount: 1 | 2 };
export type TallyEvent =
  | { readonly kind: 'count-added'; readonly amount: number }
  | { readonly kind: 'count-reset'; readonly to: number };
export type TallyIntent =
  | { readonly kind: 'tap'; readonly target: CanvasTarget; readonly selected: CanvasTarget | null }
  | { readonly kind: 'drag-end'; readonly from: CanvasTarget; readonly to: CanvasTarget | null };

const ADDED = 'count-added';
const ADD_ONE: TallyMove = { kind: 'add', amount: 1 };
const ADD_TWO: TallyMove = { kind: 'add', amount: 2 };

function outcome(state: TallyState): Outcome {
  if (state.count === state.target) return { kind: 'won', score: state.target * 10 };
  return state.count > state.target
    ? { kind: 'lost', reasonKey: 'tally.lose.overshot' }
    : { kind: 'playing' };
}

const ENGINE: GameEngine<TallyState, TallyMove, TallyEvent> = {
  create: (_seed, difficulty) => ({ count: 0, target: 3 + Math.min(Math.max(difficulty, 0), 100) }),
  listMoves: (state) => (outcome(state).kind === 'playing' ? [ADD_ONE, ADD_TWO] : []),
  applyMove: (state, move) => {
    if (outcome(state).kind !== 'playing') throw new RangeError('the run is over');
    return {
      state: { ...state, count: state.count + move.amount },
      events: [{ kind: ADDED, amount: move.amount }],
    };
  },
  outcome,
};

function intentToMove(state: TallyState, intent: TallyIntent): TallyMove | null {
  if (intent.kind !== 'tap' || intent.target.regionId !== 'board') return null;
  if (outcome(state).kind !== 'playing') return null;
  const column = intent.selected?.col ?? intent.target.col;
  return column === 0 ? ADD_ONE : ADD_TWO;
}

const RULES: GameRules<TallyState, TallyMove, TallyEvent> = {
  hud: (state) => ({
    score: state.count,
    goal: { id: 'tally.goal', values: { target: state.target } },
  }),
  undo: { kind: 'unlimited' },
  hints: {
    kind: 'solver',
    suggest: (state) => (state.target - state.count >= 2 ? ADD_TWO : ADD_ONE),
  },
  continueRun: {
    kind: 'once',
    descriptionId: 'tally.continue.step-back',
    apply: (lost) => ({
      state: { ...lost, count: lost.target - 1 },
      events: [{ kind: 'count-reset', to: lost.target - 1 }],
    }),
  },
};

const LEVELS: LevelsSpec<TallyState, TallyMove> = {
  difficultyFor: (level) => level,
  packs: [
    { id: 'first', nameId: 'tally.pack.first', firstLevel: 1, levelCount: 3, starsToUnlock: 0 },
  ],
  table: [1, 2, 3].map((level) => ({
    level,
    seed: level,
    difficulty: level,
    stars: { kind: 'par', par: Math.floor((4 + level) / 2) },
  })),
  solver: null,
  daily: { kind: 'daily', difficulty: 2, salt: 5 },
  endless: { kind: 'endless', difficulty: 100 },
};

const isRecord = (json: unknown): json is Readonly<Record<string, unknown>> =>
  typeof json === 'object' && json !== null;

export const TALLY_GAME: GameModule<TallyState, TallyMove, TallyEvent, TallyIntent> = {
  identity: { id: 'tally', nameId: 'tally.name' },
  engine: ENGINE,
  input: { panMode: 'none', selectRegions: ['tray'], intentToMove },
  rules: RULES,
  persistence: {
    stateVersion: 1,
    parseState: (json) =>
      isRecord(json) && typeof json['count'] === 'number' && typeof json['target'] === 'number'
        ? { count: json['count'], target: json['target'] }
        : null,
    parseMove: (json) =>
      isRecord(json) && json['kind'] === 'add' && (json['amount'] === 1 || json['amount'] === 2)
        ? { kind: 'add', amount: json['amount'] }
        : null,
    migrateState: () => null,
    savePolicy: { kind: 'after-every-move' },
  },
  stats: {
    counters: [
      {
        id: 'adds',
        labelId: 'tally.stats.adds',
        aggregate: 'sum',
        measure: (events) => events.filter((event) => event.kind === ADDED).length,
      },
      {
        id: 'biggest-add',
        labelId: 'tally.stats.biggest',
        aggregate: 'max',
        measure: (events) =>
          Math.max(0, ...events.map((event) => (event.kind === ADDED ? event.amount : 0))),
      },
    ],
  },
  testing: {
    bot: (_state, moves, rng) => ({ move: moves[0] ?? ADD_ONE, rng }),
    examples: {
      start: () => ENGINE.create(1, 0),
      middle: () => ({ count: 1, target: 4 }),
      win: () => ({ count: 4, target: 4 }),
      lose: () => ({ count: 5, target: 4 }),
    },
  },
  levels: LEVELS,
};

/** The tutorial: from 0 towards 3, step 1 must add 2, step 2 takes any move, then free play. */
export const TALLY_TUTORIAL: TutorialSpec<TallyState, TallyMove> = {
  start: () => ({ count: 0, target: 3 }),
  steps: [
    { messageId: 'tally.tutorial.add-two', expect: { kind: 'move', move: ADD_TWO } },
    { messageId: 'tally.tutorial.finish', expect: { kind: 'any-move' } },
  ],
};

/** A board tap at column `col` (0 adds 1, 1 adds 2), or a tray tap selecting that amount. */
export function tallyTap(col: 0 | 1, regionId: 'board' | 'tray' = 'board'): TallyIntent {
  return { kind: 'tap', target: { regionId, col, row: 0 }, selected: null };
}
