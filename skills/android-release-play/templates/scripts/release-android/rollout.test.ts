// scripts/release-android/rollout.test.ts
import { haltRelease, nextRolloutFraction, promotionProblems, rolloutRelease } from './rollout.ts';

const STEPS = [0.05, 0.2, 0.5, 1];

describe('nextRolloutFraction', () => {
  it('starts at the first step and walks up', () => {
    expect(nextRolloutFraction(STEPS, null)).toBe(0.05);
    expect(nextRolloutFraction(STEPS, 0.05)).toBe(0.2);
    expect(nextRolloutFraction(STEPS, 0.3)).toBe(0.5);
    expect(nextRolloutFraction(STEPS, 0.5)).toBe(1);
  });

  it('refuses to go past every user', () => {
    expect(() => nextRolloutFraction(STEPS, 1)).toThrow('already reaches every user');
  });
});

describe('rolloutRelease', () => {
  it('is in progress below 1 and completed at 1', () => {
    expect(rolloutRelease({ versionCode: 15, fraction: 0.2 })).toStrictEqual({
      versionCodes: ['15'],
      status: 'inProgress',
      userFraction: 0.2,
    });
    expect(rolloutRelease({ versionCode: 15, fraction: 1 })).toStrictEqual({
      versionCodes: ['15'],
      status: 'completed',
    });
  });

  it('refuses a fraction outside (0, 1]', () => {
    expect(() => rolloutRelease({ versionCode: 15, fraction: 0 })).toThrow('is not in (0, 1]');
    expect(() => rolloutRelease({ versionCode: 15, fraction: 1.5 })).toThrow('is not in (0, 1]');
  });
});

describe('haltRelease', () => {
  it('keeps the fraction it reached', () => {
    expect(haltRelease({ versionCode: 15, fraction: 0.2 })).toStrictEqual({
      versionCodes: ['15'],
      status: 'halted',
      userFraction: 0.2,
    });
  });
});

describe('promotionProblems', () => {
  it('promotes only an uploaded versionCode', () => {
    expect(promotionProblems({ versionCode: 15, uploadedVersionCodes: [14, 15] })).toStrictEqual(
      [],
    );
    expect(promotionProblems({ versionCode: 16, uploadedVersionCodes: [14, 15] })[0]).toContain(
      'has no upload tag',
    );
  });
});
