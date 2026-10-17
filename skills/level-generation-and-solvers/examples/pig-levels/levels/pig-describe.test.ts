// src/games/pig/levels/pig-describe.test.ts
import { create } from '@/games/pig/rules/create';

import { describeLevel } from './pig-describe';

describe('describeLevel', () => {
  it('shows the budgets, then the first eight rolls the stream holds', () => {
    const state = { ...create(1, 0), target: 30, maxTurns: 10, maxBusts: 3 };
    const [budgets, rolls] = describeLevel(state).split('\n');
    expect(budgets).toBe('target 30 turns 10 busts 3');
    expect(rolls).toMatch(/^rolls [1-6](?:,[1-6]){7}$/);
  });

  it('reads the stream without advancing it, so the same start always gives the same text', () => {
    const state = create(7, 45);
    const text = describeLevel(state);
    expect(describeLevel(state)).toBe(text);
    expect(describeLevel(create(7, 45))).toBe(text);
  });
});
