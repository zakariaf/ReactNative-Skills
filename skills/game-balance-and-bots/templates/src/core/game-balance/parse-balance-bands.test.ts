// src/core/game-balance/parse-balance-bands.test.ts
import { parseBands } from './parse-balance-bands';

const VALID = {
  gameId: 'demo',
  status: 'proposed',
  approvedOn: null,
  seedsPerCell: 100,
  maxMoves: 400,
  grid: { random: [0, 1], greedy: [0, 1] },
  bands: [
    { policy: 'greedy', difficulty: 0, metric: 'winRate', min: 0.6, max: 0.9, why: 'early wins' },
  ],
  curve: { policy: 'greedy', metric: 'winRate', direction: 'down', minStep: 0.05 },
  skillGap: {
    difficulty: 1,
    metric: 'winRate',
    order: ['random', 'greedy'],
    better: 'higher',
    minStep: 0.1,
  },
  firstPayoff: { policy: 'greedy', difficulty: 0, withinMoves: 3, minShare: 0.9 },
  twist: null,
  notes: 'why these numbers',
};

describe('parseBands', () => {
  it('returns a valid bands file typed', () => {
    expect(parseBands(VALID).grid).toStrictEqual({ random: [0, 1], greedy: [0, 1] });
  });

  it('lists every problem of a broken bands file in one error', () => {
    const broken = {
      ...VALID,
      status: 'final',
      seedsPerCell: 20,
      bands: [{ policy: 'greedy', difficulty: 0, metric: 'fun', min: 0, max: 1, why: '' }],
      curve: undefined,
    };
    expect(() => parseBands(broken)).toThrow(
      'balance bands: bands file.status is missing or invalid; bands file.seedsPerCell is missing or invalid; bands[0].metric is missing or invalid; bands[0].why is missing or invalid; curve is missing',
    );
  });

  it('accepts an endless block at the endless difficulty, kept out of the grid', () => {
    const endless = {
      policy: 'greedy',
      difficulty: 100,
      bands: [{ metric: 'medianMoves', min: 20, max: 80, why: 'a run outlasts a level' }],
    };
    expect(parseBands({ ...VALID, endless }).endless).toStrictEqual(endless);
    expect(parseBands({ ...VALID, endless: null }).endless).toBeNull();
  });

  it('rejects the endless difficulty in the grid and a broken endless block', () => {
    const broken = {
      ...VALID,
      grid: { random: [0, 1], greedy: [0, 1, 100] },
      endless: {
        policy: 'greedy',
        difficulty: 99,
        bands: [{ metric: 'winRate', min: 0, max: 0, why: 'x' }],
      },
    };
    expect(() => parseBands(broken)).toThrow(
      'grid.greedy must list level difficulties 0..99 (the endless run has its own block); endless.difficulty must be 100 (ENDLESS_DIFFICULTY); endless.bands[0].metric is missing or invalid',
    );
    expect(() => parseBands({ ...VALID, endless: 'yes' })).toThrow(
      'endless must be an object or null',
    );
    expect(() =>
      parseBands({ ...VALID, endless: { policy: 'greedy', difficulty: 100, bands: [7] } }),
    ).toThrow('endless.bands[0] is not an object');
    expect(() => parseBands({ ...VALID, endless: { difficulty: 100 } })).toThrow(
      'endless.policy is missing or invalid; endless.bands must list at least one band',
    );
  });

  it('rejects a missing grid, an empty policy row, a band that is not an object and bad rule fields', () => {
    expect(() => parseBands({ ...VALID, grid: {} })).toThrow('grid is missing or empty');
    expect(() => parseBands({ ...VALID, grid: { greedy: [] } })).toThrow(
      'grid.greedy must list level difficulties',
    );
    expect(() => parseBands({ ...VALID, bands: 'all of them' })).toThrow(
      'bands must list at least one band',
    );
    expect(() => parseBands({ ...VALID, bands: [3] })).toThrow('bands[0] is not an object');
    expect(() => parseBands({ ...VALID, skillGap: { ...VALID.skillGap, better: 'more' } })).toThrow(
      'skillGap.better is missing or invalid',
    );
    expect(() =>
      parseBands({ ...VALID, firstPayoff: { ...VALID.firstPayoff, withinMoves: 11 } }),
    ).toThrow('firstPayoff.withinMoves is missing or invalid');
  });

  it('asks approved bands for the approval date', () => {
    expect(() => parseBands({ ...VALID, status: 'approved' })).toThrow('approvedOn');
  });

  it('rejects something that is not an object', () => {
    expect(() => parseBands([])).toThrow('not a JSON object');
  });
});
