// scripts/release/what-to-test.test.ts
import {
  changeChecks,
  MAX_CHANGE_LINES,
  releaseWhatToTest,
  summarizeChanges,
} from './what-to-test.ts';

import type { WhatToTestInput } from './what-to-test.ts';

const PURCHASE = {
  paths: ['src/services/purchases/'],
  line: 'Buy Premium, cancel once, reinstall, then Restore.',
};

const INPUT: WhatToTestInput = {
  appName: 'Tasks',
  version: '1.4.0',
  buildNumber: 14,
  variant: 'production',
  notes: ['sort a list by due date'],
  knownIssues: [],
  history: {
    previousTag: 'v1.4.0+ios.13',
    subjects: ['feat(lists): sort by due date', 'fix(reminders): repeat on weekdays'],
    files: ['src/features/lists/sort.ts'],
  },
  always: ['Switch the language to an RTL one (Arabic) once: layout mirrored, nothing cut off.'],
  whenChanged: [PURCHASE],
};

describe('releaseWhatToTest', () => {
  it('lists the changes, the checks and the known issues', () => {
    expect(releaseWhatToTest(INPUT)).toBe(
      [
        'Tasks 1.4.0 (14) · production build',
        'What changed',
        '- feat(lists): sort by due date',
        '- fix(reminders): repeat on weekdays',
        'Please check',
        '- sort a list by due date',
        '- Switch the language to an RTL one (Arabic) once: layout mirrored, nothing cut off.',
        'Known issues',
        '- none',
      ].join('\n'),
    );
  });

  it('stops before anything is built when the text is too long for TestFlight', () => {
    expect(() => releaseWhatToTest({ ...INPUT, notes: ['x'.repeat(4000)] })).toThrow(
      'TestFlight allows 4000: shorten --notes or --known-issue',
    );
  });
});

describe('changeChecks', () => {
  it('adds a check when its paths changed, and every check on the first build', () => {
    expect(changeChecks(INPUT.history, [PURCHASE])).toStrictEqual([]);
    const touched = { ...INPUT.history, files: ['src/services/purchases/purchase-port.ts'] };
    expect(changeChecks(touched, [PURCHASE])).toStrictEqual([PURCHASE.line]);
    expect(changeChecks({ previousTag: '', subjects: [], files: [] }, [PURCHASE])).toStrictEqual([
      PURCHASE.line,
    ]);
  });
});

describe('summarizeChanges', () => {
  it('folds a long history into one more line', () => {
    const subjects = Array.from(
      { length: MAX_CHANGE_LINES + 3 },
      (_, index) => `fix: ${String(index)}`,
    );
    const lines = summarizeChanges(subjects, false);
    expect(lines).toHaveLength(MAX_CHANGE_LINES + 1);
    expect(lines.at(-1)).toBe('and 3 more fixes and features');
    expect(summarizeChanges(subjects, true)).toStrictEqual([
      'first TestFlight build: everything is new',
    ]);
  });
});
