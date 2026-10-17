// src/core/game/testing/engine-contract.test.ts
import { engineContractProblems } from './engine-contract';

import type { EngineContractInput } from './engine-contract';
import type { GameEngine } from '@/core/game/game-engine';
import type { GameInput } from '@/core/game/game-input';

/** Toy game: tap a column to add 1 to it; three full columns (value 2) win, 9 taps lose. */
type Tally = { readonly cols: readonly number[]; readonly taps: number };
type Add = { readonly kind: 'add'; readonly col: number };
type Added = { readonly kind: 'column-added'; readonly col: number };
type Target = { readonly regionId: string; readonly col: number; readonly row: number };
type Intent =
  | { readonly kind: 'tap'; readonly target: Target; readonly selected: Target | null }
  | { readonly kind: 'swipe'; readonly direction: 'left' | 'right' };

const isRecord = (json: unknown): json is Readonly<Record<string, unknown>> =>
  typeof json === 'object' && json !== null && !Array.isArray(json);
const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const isAdd = (json: unknown): json is Add =>
  isRecord(json) && json['kind'] === 'add' && isWhole(json['col']);
const isTally = (json: unknown): json is Tally =>
  isRecord(json) &&
  isWhole(json['taps']) &&
  Array.isArray(json['cols']) &&
  json['cols'].every(isWhole);

const ENGINE: GameEngine<Tally, Add, Added> = {
  create: (seed) => ({ cols: [seed % 2, 0, 0], taps: 0 }),
  listMoves: (state) =>
    state.cols.every((value) => value >= 2) || state.taps >= 9
      ? []
      : state.cols.flatMap((value, col): Add[] => (value < 2 ? [{ kind: 'add', col }] : [])),
  applyMove: (state, move) => ({
    state: {
      cols: state.cols.map((value, col) => (col === move.col ? value + 1 : value)),
      taps: state.taps + 1,
    },
    events: [{ kind: 'column-added', col: move.col }],
  }),
  outcome: (state) => {
    if (state.cols.every((value) => value >= 2)) return { kind: 'won', score: 9 - state.taps };
    return state.taps >= 9
      ? { kind: 'lost', reasonKey: 'tally.lose.out-of-taps' }
      : { kind: 'playing' };
  },
};

const INPUT: GameInput<Tally, Add, Intent> = {
  panMode: 'none',
  selectRegions: [],
  intentToMove: (state, intent) =>
    intent.kind === 'tap' && (state.cols[intent.target.col] ?? 2) < 2
      ? { kind: 'add', col: intent.target.col }
      : null,
};

const tapOn = (regionId: string, col: number): Intent => ({
  kind: 'tap',
  target: { regionId, col, row: 0 },
  selected: null,
});
const TAPS = [0, 1, 2].map((col) => tapOn('board', col));
/** A picker strip whose taps select; a board tap then adds to the selected column. */
const PICKS = [0, 1, 2].map((col) => tapOn('picker', col));
const PICKING: GameInput<Tally, Add, Intent> = {
  ...INPUT,
  selectRegions: ['picker'],
  intentToMove: (state, intent) =>
    intent.kind === 'tap' && intent.selected !== null && intent.target.regionId === 'board'
      ? INPUT.intentToMove(state, { ...intent, target: intent.selected })
      : null,
};

function specWith(engine: GameEngine<Tally, Add, Added>): EngineContractInput<Tally, Add, Added> {
  return {
    gameId: 'tally',
    engine,
    persistence: {
      parseState: (json) => (isTally(json) ? json : null),
      parseMove: (json) => (isAdd(json) ? json : null),
    },
    starts: [1, 2, 3].map((seed) => ({ seed, difficulty: 0 })),
    maxMoves: 20,
  };
}

function withInput(
  input: GameInput<Tally, Add, Intent>,
  intents: readonly Intent[] = TAPS,
): EngineContractInput<Tally, Add, Added, Intent> {
  return { ...specWith(ENGINE), input, intents: () => intents };
}

describe('engineContractProblems', () => {
  describe('the engine alone (the rules-only test)', () => {
    it('finds nothing wrong with a pure, deterministic engine', () => {
      expect(engineContractProblems(specWith(ENGINE))).toStrictEqual([]);
    });

    it('reports an applyMove that changes its input', () => {
      const mutating: typeof ENGINE = {
        ...ENGINE,
        applyMove: (state, move) => {
          const result = ENGINE.applyMove(state, move);
          Reflect.set(state, 'taps', state.taps + 100);
          return result;
        },
      };
      expect(engineContractProblems(specWith(mutating))[0]).toContain('changed its input state');
    });

    it('reports state that JSON cannot carry', () => {
      const lossy: typeof ENGINE = {
        ...ENGINE,
        create: (seed) => ({ ...ENGINE.create(seed, 0), taps: Number.NaN }),
      };
      expect(engineContractProblems(specWith(lossy))[0]).toContain('state.taps is NaN');
    });

    it('reports a lose reason outside the game catalog', () => {
      const early: typeof ENGINE = {
        ...ENGINE,
        listMoves: (state) => (state.taps >= 2 ? [] : ENGINE.listMoves(state)),
        outcome: (state) =>
          state.taps >= 2 ? { kind: 'lost', reasonKey: 'out-of-taps' } : ENGINE.outcome(state),
      };
      expect(engineContractProblems(specWith(early))[0]).toContain('is not a tally.* catalog key');
    });

    it('reports listMoves offering moves after the game ended', () => {
      const lingering: typeof ENGINE = { ...ENGINE, listMoves: () => [{ kind: 'add', col: 0 }] };
      expect(engineContractProblems(specWith(lingering)).join('\n')).toContain(
        'moves while outcome is lost',
      );
    });

    it('reports a win score that is not a whole number', () => {
      const fractional: typeof ENGINE = {
        ...ENGINE,
        outcome: (state) => {
          const result = ENGINE.outcome(state);
          return result.kind === 'won' ? { kind: 'won', score: 0.5 } : result;
        },
      };
      expect(engineContractProblems(specWith(fractional)).join('\n')).toContain(
        'is not a whole number',
      );
    });

    it('reports parsers that do not return saved states and moves unchanged', () => {
      const lossy = { parseState: () => null, parseMove: () => null };
      const problems = engineContractProblems({ ...specWith(ENGINE), persistence: lossy });
      expect(problems.join('\n')).toContain('parseState does not return a saved state unchanged');
      expect(problems.join('\n')).toContain('parseMove does not return');
    });

    it('reports parsers that accept damaged saved data (a cast)', () => {
      const casting = {
        parseState: (json: unknown) => (isRecord(json) ? (json as Tally) : null),
        parseMove: (json: unknown) => (isRecord(json) ? (json as Add) : null),
      };
      const problems = engineContractProblems({ ...specWith(ENGINE), persistence: casting });
      expect(problems.join('\n')).toContain('parseState accepts damaged data ({})');
      expect(problems.join('\n')).toContain('parseMove accepts damaged data ({})');
    });

    it('reports an event without a kebab-case kind', () => {
      const notKebab = ['Column', 'Added'].join('');
      const shouting: typeof ENGINE = {
        ...ENGINE,
        applyMove: (state, move) => ({
          ...ENGINE.applyMove(state, move),
          events: [{ kind: notKebab, col: move.col } as unknown as Added],
        }),
      };
      expect(engineContractProblems(specWith(shouting))[0]).toContain('has no kebab-case kind');
    });

    it('reports a create that starts a finished game', () => {
      const solved: typeof ENGINE = { ...ENGINE, create: () => ({ cols: [2, 2, 2], taps: 0 }) };
      expect(engineContractProblems(specWith(solved)).join('\n')).toContain(
        'create starts a game that is already won',
      );
    });

    it('reports create and replays that differ between two runs', () => {
      let calls = 0;
      const drifting: typeof ENGINE = {
        ...ENGINE,
        create: (seed) => {
          calls += 1;
          return { cols: [seed % 2, 0, 0], taps: calls % 2 };
        },
      };
      const problems = engineContractProblems(specWith(drifting)).join('\n');
      expect(problems).toContain('create gives two different states');
      expect(problems).toContain('replaying the same moves');
    });

    it('reports an endless run that can be won, and accepts one that only ever ends lost', () => {
      const endless = { kind: 'endless', difficulty: 100 } as const;
      const winnable = engineContractProblems({ ...specWith(ENGINE), endless });
      expect(winnable.join('\n')).toContain('difficulty 100: the endless run was won (score');
      const survival: typeof ENGINE = {
        ...ENGINE,
        create: (seed, difficulty) => ({
          cols: [seed % 2, 0, 0],
          taps: difficulty === 100 ? 5 : 0,
        }),
      };
      expect(engineContractProblems({ ...specWith(survival), endless })).toStrictEqual([]);
    });

    it('checks the state the last allowed move produced, not only the states before it', () => {
      const lastMove = { ...specWith(ENGINE), starts: [{ seed: 1, difficulty: 0 }], maxMoves: 5 };
      const endless = { kind: 'endless', difficulty: 100 } as const;
      expect(engineContractProblems({ ...lastMove, endless })).toStrictEqual([
        'seed 1 difficulty 100: the endless run was won (score 4); an endless run only ever ends lost',
      ]);
      const lingering: typeof ENGINE = {
        ...ENGINE,
        listMoves: (state) =>
          ENGINE.outcome(state).kind === 'won'
            ? [{ kind: 'add', col: 0 }]
            : ENGINE.listMoves(state),
      };
      expect(engineContractProblems({ ...lastMove, engine: lingering })).toStrictEqual([
        'seed 1 difficulty 0: listMoves has 1 moves while outcome is won',
      ]);
    });
  });

  describe('with the input members (the module test)', () => {
    it('finds nothing wrong with taps that only make listed moves', () => {
      expect(engineContractProblems(withInput(INPUT))).toStrictEqual([]);
    });

    it('reports a move from intentToMove that listMoves does not list', () => {
      const sloppy: typeof INPUT = { ...INPUT, intentToMove: () => ({ kind: 'add', col: 7 }) };
      expect(engineContractProblems(withInput(sloppy))[0]).toContain(
        'which listMoves does not list',
      );
    });

    it('reports a panMode outside the four modes', () => {
      const tilting = { ...INPUT, panMode: 'tilt' } as unknown as typeof INPUT;
      expect(engineContractProblems(withInput(tilting))[0]).toContain(
        "panMode 'tilt' is not 'none', 'swipe', 'drag' or 'aim'",
      );
    });

    it('reports an intent that the pan mode never lets the surface send', () => {
      const swiped: typeof INPUT = {
        ...INPUT,
        intentToMove: (state, intent) =>
          intent.kind === 'swipe' ? (ENGINE.listMoves(state)[0] ?? null) : null,
      };
      const swipe: Intent = { kind: 'swipe', direction: 'left' };
      expect(engineContractProblems(withInput(swiped, [swipe]))[0]).toContain(
        "accepts a swipe intent, but with panMode 'none' the surface never sends one (panMode 'swipe')",
      );
      const swiping: typeof INPUT = { ...swiped, panMode: 'swipe' };
      expect(engineContractProblems(withInput(swiping, [swipe]))).toStrictEqual([]);
    });

    it('reports selectRegions that is not a list of region ids', () => {
      const broken = { ...INPUT, selectRegions: 'picker' } as unknown as typeof INPUT;
      expect(engineContractProblems(withInput(broken))[0]).toContain(
        'selectRegions picker is not a list of region ids',
      );
    });

    it('accepts taps that select first and act on the next tap, the selection being UI state', () => {
      expect(engineContractProblems(withInput(PICKING, [...PICKS, ...TAPS]))).toStrictEqual([]);
    });

    it('reports a tap inside a select region that makes a move instead of selecting', () => {
      const eager: typeof INPUT = { ...INPUT, selectRegions: ['board'] };
      expect(engineContractProblems(withInput(eager))[0]).toContain(
        'but a tap in a select region only selects (return null)',
      );
    });

    it('reports a move made from a tap with a selection that listMoves does not list', () => {
      const sloppy: typeof INPUT = {
        ...PICKING,
        intentToMove: (_state, intent) =>
          intent.kind === 'tap' && intent.selected !== null ? { kind: 'add', col: 9 } : null,
      };
      const problems = engineContractProblems(withInput(sloppy, [...PICKS, ...TAPS]));
      expect(problems[0]).toContain('"selected":{"regionId":"picker","col":0,"row":0}');
      expect(problems[0]).toContain('which listMoves does not list');
    });
  });
});
