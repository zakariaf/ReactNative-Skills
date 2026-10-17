// scripts/quality/gated-paths.test.ts
import { AGENT_FOLDERS, gatedFilesIn, gatedPathsOf, isGatedFile } from './gated-paths.ts';

describe('isGatedFile', () => {
  it('matches a root config and a wildcard snapshot pattern', () => {
    expect(isGatedFile('eslint.config.mjs', 'eslint.config.mjs')).toBe(true);
    expect(
      isGatedFile(
        'src/features/tasks/__snapshots__/task-list.golden.test.ts.snap',
        '**/__snapshots__/*.golden.test.ts.snap',
      ),
    ).toBe(true);
  });

  it.each(AGENT_FOLDERS.map((folder) => [folder]))(
    'keeps a wildcard pattern out of %s',
    (folder) => {
      expect(
        isGatedFile(`${folder}golden-and-snapshot-tests/x.vectors.json`, '**/*.vectors.json'),
      ).toBe(false);
    },
  );

  it('gates a file a pattern names inside an agent folder', () => {
    expect(isGatedFile('.claude/settings.json', '.claude/settings.json')).toBe(true);
  });

  it('leaves a file outside every pattern ungated', () => {
    expect(isGatedFile('src/features/tasks/task-list.ts', 'src/data/**/fixtures/**')).toBe(false);
  });
});

describe('gatedFilesIn', () => {
  it('returns only the gated files', () => {
    const files = [
      'src/app/_layout.tsx',
      'jest.config.js',
      'src/data/migrations/fixtures/db-v1.sql',
    ];
    expect(gatedFilesIn(files, ['jest.config.js', 'src/data/**/fixtures/**'])).toStrictEqual([
      'jest.config.js',
      'src/data/migrations/fixtures/db-v1.sql',
    ]);
  });
});

describe('gatedPathsOf', () => {
  it('reads the gatedPaths strings', () => {
    expect(gatedPathsOf({ gatedPaths: ['knip.json', 3] })).toStrictEqual(['knip.json']);
  });

  it('returns an empty list without the key', () => {
    expect(gatedPathsOf(null)).toStrictEqual([]);
    expect(gatedPathsOf({})).toStrictEqual([]);
  });
});
