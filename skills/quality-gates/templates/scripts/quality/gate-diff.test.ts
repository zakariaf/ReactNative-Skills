// scripts/quality/gate-diff.test.ts
import { addedKeys, diffContains, diffSubset, withRootDirTag } from './gate-diff.ts';

describe('diffSubset', () => {
  it('ignores keys that only exist in the actual value', () => {
    expect(diffSubset({ max: 250 }, { max: 250, skipComments: true }, 'rule')).toStrictEqual([]);
  });

  it('reports a weakened limit with its path', () => {
    const expected = { rules: { 'max-params': [2, 3] } };
    const actual = { rules: { 'max-params': [2, 5] } };
    expect(diffSubset(expected, actual, 'eslint')).toStrictEqual([
      'eslint.rules.max-params[1]: expected 3, got 5',
    ]);
  });

  it('reports a rule whose options were removed', () => {
    expect(diffSubset([2, { max: 40 }], [2], 'rule')).toHaveLength(1);
  });

  it('reports a list that grew, because lists are compared by position', () => {
    expect(diffSubset(['a', 'b'], ['a', 'b', 'c'], 'deny')).toStrictEqual([
      'deny: expected ["a","b"], got ["a","b","c"]',
    ]);
  });

  it('reports a missing object', () => {
    expect(diffSubset({ hooks: { Stop: [] } }, undefined, 'claude')).toHaveLength(1);
  });
});

describe('addedKeys', () => {
  const expected = {
    'pre-push': { jobs: [{ name: 'verify', run: 'npm run verify' }] },
  };

  it('finds a skip that a local override added to a job', () => {
    const actual = {
      'pre-push': {
        jobs: [{ name: 'verify', run: 'npm run verify', skip: true }],
      },
    };
    expect(
      addedKeys(expected, actual, {
        keys: ['skip', 'only'],
        where: 'lefthook.yml',
      }),
    ).toStrictEqual(['lefthook.yml.pre-push.jobs[0].skip: true switches a gate off']);
  });

  it('finds a skip on a whole hook', () => {
    const actual = {
      'pre-push': {
        skip: true,
        jobs: [{ name: 'verify', run: 'npm run verify' }],
      },
    };
    expect(addedKeys(expected, actual, { keys: ['skip'], where: 'lefthook.yml' })).toHaveLength(1);
  });

  it('accepts a key the expected value already has', () => {
    const withExclude = {
      jobs: [{ name: 'no-secrets', exclude: ['.env.example'] }],
    };
    expect(
      addedKeys(withExclude, withExclude, {
        keys: ['exclude'],
        where: 'pre-commit',
      }),
    ).toStrictEqual([]);
  });
});

describe('diffContains', () => {
  const hook = {
    type: 'command',
    command: 'node scripts/hooks/after-edit.ts',
    timeout: 120,
  };

  it('accepts entries of the app next to the expected ones, in any order', () => {
    expect(diffContains(['a', 'b'], ['own', 'b', 'a'], 'deny')).toStrictEqual([]);
  });

  it('reports an expected entry that is gone', () => {
    expect(diffContains(['a', 'b'], ['a'], 'deny')).toStrictEqual(['deny: lost "b"']);
  });

  it('accepts another hook of the app next to the gate hook', () => {
    const expected = [{ matcher: 'Edit|Write', hooks: [hook] }];
    const actual = [
      { matcher: 'Bash', hooks: [] },
      { matcher: 'Edit|Write', hooks: [hook] },
    ];
    expect(diffContains(expected, actual, 'PostToolUse')).toStrictEqual([]);
  });

  it('reports a gate hook whose command was neutralised', () => {
    const expected = [{ matcher: 'Edit|Write', hooks: [hook] }];
    const actual = [
      {
        matcher: 'Edit|Write',
        hooks: [{ ...hook, command: `${hook.command} || true` }],
      },
    ];
    expect(diffContains(expected, actual, 'PostToolUse')).toHaveLength(1);
  });
});

describe('withRootDirTag', () => {
  it('turns the absolute root folder back into the tag', () => {
    const resolved = {
      testMatch: ['/repo/app/src/**/*.test.ts'],
      rootDir: '/repo/app',
      bail: 0,
    };
    expect(withRootDirTag(resolved, '/repo/app')).toStrictEqual({
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      rootDir: '<rootDir>',
      bail: 0,
    });
  });
});
