// src/core/game-balance/bot-policies.test.ts
import { seedRng } from '@/core/rng/sfc32';

import { greedyPolicy, lookaheadPolicy } from './bot-policies';

import type { SearchRules } from './bot-policies';

type Node = 'start' | 'bait' | 'trap' | 'detour' | 'goal';

/** A tiny graph game: the bait looks best but leads only into the trap; the detour wins. */
const EDGES: Readonly<Record<Node, readonly Node[]>> = {
  start: ['bait', 'detour'],
  bait: ['trap'],
  trap: [],
  detour: ['goal'],
  goal: [],
};
const LOOKS: Readonly<Record<Node, number>> = { start: 0, bait: 5, trap: 0, detour: 1, goal: 2 };

const GRAPH: SearchRules<Node, Node, never> = {
  listMoves: (state) => EDGES[state],
  applyMove: (_state, move) => ({ state: move, events: [] }),
  outcome: (state) => {
    if (state === 'goal') return { kind: 'won', score: 1 };
    return state === 'trap' ? { kind: 'lost', reasonKey: 'graph.trap' } : { kind: 'playing' };
  },
};
const looks = (state: Node): number => LOOKS[state];

describe('greedyPolicy', () => {
  it('takes the move whose next state looks best', () => {
    const choice = greedyPolicy(GRAPH, looks)('start', EDGES.start, seedRng(1));
    expect(choice.move).toBe('bait');
  });

  it('breaks ties with its own seeded RNG, the same way every time', () => {
    const flat = greedyPolicy(GRAPH, () => 0);
    const picks = Array.from(
      { length: 40 },
      (_, seed) => flat('start', EDGES.start, seedRng(seed)).move,
    );
    expect(new Set(picks)).toStrictEqual(new Set(['bait', 'detour']));
    expect(flat('start', EDGES.start, seedRng(3))).toStrictEqual(
      flat('start', EDGES.start, seedRng(3)),
    );
  });

  it('prefers any position to a lost one', () => {
    expect(greedyPolicy(GRAPH, () => 0)('bait', ['trap', 'start'] as const, seedRng(1)).move).toBe(
      'start',
    );
  });
});

describe('a bot without legal moves', () => {
  it('refuses to pick instead of inventing a move', () => {
    expect(() => greedyPolicy(GRAPH, looks)('trap', [], seedRng(1))).toThrow(
      'bot called without legal moves',
    );
  });
});

describe('lookaheadPolicy', () => {
  it('values a playing state that offers no moves as it stands', () => {
    const stuck: SearchRules<number, number, never> = {
      listMoves: (state) => (state === 0 ? [1, 2] : []),
      applyMove: (_state, move) => ({ state: move, events: [] }),
      outcome: () => ({ kind: 'playing' }),
    };
    const smart = lookaheadPolicy(stuck, (state) => state, { depth: 2, beam: 2 });
    expect(smart(0, [1, 2], seedRng(1)).move).toBe(2);
  });

  it('sees past the bait to the winning detour', () => {
    const smart = lookaheadPolicy(GRAPH, looks, { depth: 2, beam: 4 });
    expect(smart('start', EDGES.start, seedRng(1)).move).toBe('detour');
  });

  it('behaves like greedy at depth 1', () => {
    const shallow = lookaheadPolicy(GRAPH, looks, { depth: 1, beam: 4 });
    expect(shallow('start', EDGES.start, seedRng(1)).move).toBe('bait');
  });

  it('searches only the beam of best-looking moves', () => {
    const narrow = lookaheadPolicy(GRAPH, looks, { depth: 2, beam: 1 });
    expect(narrow('start', EDGES.start, seedRng(1)).move).toBe('bait');
  });
});
