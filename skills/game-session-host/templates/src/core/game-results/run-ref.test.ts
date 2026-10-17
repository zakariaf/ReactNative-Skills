// src/core/game-results/run-ref.test.ts
import { runKeyOf } from './run-ref';

describe('runKeyOf', () => {
  it('gives every kind of run its own stable key', () => {
    expect(runKeyOf({ kind: 'level', level: 12 })).toBe('level:12');
    expect(runKeyOf({ kind: 'daily', date: '2026-10-14' })).toBe('daily:2026-10-14');
    expect(runKeyOf({ kind: 'endless' })).toBe('endless');
    expect(runKeyOf({ kind: 'tutorial' })).toBe('tutorial');
  });
});
