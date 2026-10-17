// src/core/goals/score-day-bands.test.ts: a long test file (tests may hold 400 code lines, logic 250).
import { scoreDay } from './score-day';

describe('scoreDay bands', () => {
  it('returns the points for 0 done tasks of 0', () => {
    const result = { tasksDone: 0, focusMinutes: 0, isClosed: false };
    expect(scoreDay({ result, goal: { kind: 'count', target: 0 }, isPremium: false, snoozesUsed: 0 }).points).toBe(0);
  });

  it('returns the points for 1 done tasks of 1', () => {
    const result = { tasksDone: 1, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 1 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 2 done tasks of 2', () => {
    const result = { tasksDone: 2, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 2 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 3 done tasks of 3', () => {
    const result = { tasksDone: 3, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 3 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 4 done tasks of 4', () => {
    const result = { tasksDone: 4, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 4 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 5 done tasks of 5', () => {
    const result = { tasksDone: 5, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 5 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 6 done tasks of 6', () => {
    const result = { tasksDone: 6, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 6 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 7 done tasks of 7', () => {
    const result = { tasksDone: 7, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 7 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 8 done tasks of 8', () => {
    const result = { tasksDone: 8, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 8 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 9 done tasks of 9', () => {
    const result = { tasksDone: 9, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 9 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 10 done tasks of 10', () => {
    const result = { tasksDone: 10, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 10 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 11 done tasks of 11', () => {
    const result = { tasksDone: 11, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 11 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 12 done tasks of 12', () => {
    const result = { tasksDone: 12, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 12 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 13 done tasks of 13', () => {
    const result = { tasksDone: 13, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 13 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 14 done tasks of 14', () => {
    const result = { tasksDone: 14, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 14 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 15 done tasks of 15', () => {
    const result = { tasksDone: 15, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 15 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 16 done tasks of 16', () => {
    const result = { tasksDone: 16, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 16 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 17 done tasks of 17', () => {
    const result = { tasksDone: 17, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 17 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 18 done tasks of 18', () => {
    const result = { tasksDone: 18, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 18 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 19 done tasks of 19', () => {
    const result = { tasksDone: 19, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 19 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 20 done tasks of 20', () => {
    const result = { tasksDone: 20, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 20 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 21 done tasks of 21', () => {
    const result = { tasksDone: 21, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 21 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 22 done tasks of 22', () => {
    const result = { tasksDone: 22, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 22 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 23 done tasks of 23', () => {
    const result = { tasksDone: 23, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 23 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 24 done tasks of 24', () => {
    const result = { tasksDone: 24, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 24 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 25 done tasks of 25', () => {
    const result = { tasksDone: 25, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 25 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 26 done tasks of 26', () => {
    const result = { tasksDone: 26, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 26 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 27 done tasks of 27', () => {
    const result = { tasksDone: 27, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 27 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 28 done tasks of 28', () => {
    const result = { tasksDone: 28, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 28 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 29 done tasks of 29', () => {
    const result = { tasksDone: 29, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 29 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 30 done tasks of 30', () => {
    const result = { tasksDone: 30, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 30 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 31 done tasks of 31', () => {
    const result = { tasksDone: 31, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 31 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 32 done tasks of 32', () => {
    const result = { tasksDone: 32, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 32 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 33 done tasks of 33', () => {
    const result = { tasksDone: 33, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 33 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 34 done tasks of 34', () => {
    const result = { tasksDone: 34, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 34 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 35 done tasks of 35', () => {
    const result = { tasksDone: 35, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 35 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 36 done tasks of 36', () => {
    const result = { tasksDone: 36, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 36 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 37 done tasks of 37', () => {
    const result = { tasksDone: 37, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 37 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 38 done tasks of 38', () => {
    const result = { tasksDone: 38, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 38 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 39 done tasks of 39', () => {
    const result = { tasksDone: 39, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 39 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 40 done tasks of 40', () => {
    const result = { tasksDone: 40, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 40 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 41 done tasks of 41', () => {
    const result = { tasksDone: 41, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 41 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 42 done tasks of 42', () => {
    const result = { tasksDone: 42, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 42 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 43 done tasks of 43', () => {
    const result = { tasksDone: 43, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 43 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 44 done tasks of 44', () => {
    const result = { tasksDone: 44, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 44 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 45 done tasks of 45', () => {
    const result = { tasksDone: 45, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 45 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 46 done tasks of 46', () => {
    const result = { tasksDone: 46, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 46 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 47 done tasks of 47', () => {
    const result = { tasksDone: 47, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 47 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 48 done tasks of 48', () => {
    const result = { tasksDone: 48, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 48 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 49 done tasks of 49', () => {
    const result = { tasksDone: 49, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 49 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 50 done tasks of 50', () => {
    const result = { tasksDone: 50, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 50 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 51 done tasks of 51', () => {
    const result = { tasksDone: 51, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 51 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 52 done tasks of 52', () => {
    const result = { tasksDone: 52, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 52 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 53 done tasks of 53', () => {
    const result = { tasksDone: 53, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 53 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 54 done tasks of 54', () => {
    const result = { tasksDone: 54, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 54 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 55 done tasks of 55', () => {
    const result = { tasksDone: 55, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 55 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 56 done tasks of 56', () => {
    const result = { tasksDone: 56, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 56 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 57 done tasks of 57', () => {
    const result = { tasksDone: 57, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 57 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 58 done tasks of 58', () => {
    const result = { tasksDone: 58, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 58 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 59 done tasks of 59', () => {
    const result = { tasksDone: 59, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 59 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 60 done tasks of 60', () => {
    const result = { tasksDone: 60, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 60 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 61 done tasks of 61', () => {
    const result = { tasksDone: 61, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 61 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 62 done tasks of 62', () => {
    const result = { tasksDone: 62, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 62 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 63 done tasks of 63', () => {
    const result = { tasksDone: 63, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 63 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 64 done tasks of 64', () => {
    const result = { tasksDone: 64, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 64 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 65 done tasks of 65', () => {
    const result = { tasksDone: 65, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 65 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 66 done tasks of 66', () => {
    const result = { tasksDone: 66, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 66 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 67 done tasks of 67', () => {
    const result = { tasksDone: 67, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 67 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 68 done tasks of 68', () => {
    const result = { tasksDone: 68, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 68 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

  it('returns the points for 69 done tasks of 69', () => {
    const result = { tasksDone: 69, focusMinutes: 0, isClosed: true };
    expect(scoreDay({ result, goal: { kind: 'count', target: 69 }, isPremium: false, snoozesUsed: 0 }).points).toBe(300);
  });

});
