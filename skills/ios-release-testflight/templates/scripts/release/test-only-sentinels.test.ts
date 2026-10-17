// scripts/release/test-only-sentinels.test.ts
import {
  appSourceDirs,
  configuredSentinels,
  sentinelGapProblem,
  sentinelsIn,
} from './test-only-sentinels.ts';

describe('sentinelsIn', () => {
  it('finds exported sentinel constants, typed or not', () => {
    const source = [
      "export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY';",
      'export const DEBUG_SENTINEL: string = "TASKS_DEBUG_MENU";',
      "const LOCAL_SENTINEL = 'NOT_EXPORTED_ONE';",
      "export const SHORT_SENTINEL = 'abc';",
    ].join('\n');
    expect(sentinelsIn(source)).toStrictEqual(['TASKS_TEST_BUILD_ONLY', 'TASKS_DEBUG_MENU']);
  });
});

describe('configuredSentinels', () => {
  it('reads the non-empty strings of testOnlySentinels', () => {
    const config = { testOnlySentinels: ['TASKS_TEST_BUILD_ONLY', '', 7, '  '] };
    expect(configuredSentinels(config)).toStrictEqual(['TASKS_TEST_BUILD_ONLY']);
  });

  it('is empty for a config without the key, or no config object', () => {
    expect(configuredSentinels({ srcDir: 'src' })).toStrictEqual([]);
    expect(configuredSentinels(null)).toStrictEqual([]);
  });
});

describe('sentinelGapProblem', () => {
  it('stops a release whose test-only gate has no sentinel', () => {
    expect(sentinelGapProblem('src/test-only.ts', [])).toContain(
      'src/test-only.ts gates test-only code, but no test-only sentinel is known',
    );
  });

  it('accepts a gate with a sentinel, and an app without a gate', () => {
    expect(sentinelGapProblem('src/test-only.ts', ['TASKS_TEST_BUILD_ONLY'])).toBeNull();
    expect(sentinelGapProblem(null, [])).toBeNull();
  });
});

describe('appSourceDirs', () => {
  it('reads rn-skills.config.json srcDir first and keeps only folders that exist', () => {
    expect(appSourceDirs('.', { srcDir: 'scripts' })[0]).toBe('scripts');
    expect(appSourceDirs('no-such-app', { srcDir: 'scripts' })).toStrictEqual(['scripts']);
    expect(appSourceDirs('no-such-app', { srcDir: 'no-such-src' })).toStrictEqual([]);
    expect(appSourceDirs('.', null)).toStrictEqual(appSourceDirs('.', { srcDir: 7 }));
  });
});
