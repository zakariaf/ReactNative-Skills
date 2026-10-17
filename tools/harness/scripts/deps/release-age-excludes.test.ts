// scripts/deps/release-age-excludes.test.ts
import {
  checkReleaseAgeExcludes,
  excludePatternsOf,
  releaseAgeDaysOf,
} from './release-age-excludes.ts';

const POLICY =
  'min-release-age=7\nengine-strict=true\nsave-exact=true\nstrict-allow-scripts=true\n';
const BLOCK = [
  '# exclude-block expires=2026-10-03 reason=bootstrap of the verified set',
  'min-release-age-exclude[]=expo',
  'min-release-age-exclude[]=@expo/*',
].join('\n');
const BEFORE_EXPIRY = '2026-09-26';

describe('checkReleaseAgeExcludes', () => {
  it('accepts a dated block up to and including its expiry day', () => {
    const npmrc = `${POLICY}\n${BLOCK}\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([]);
    expect(checkReleaseAgeExcludes(npmrc, '2026-10-03')).toStrictEqual([]);
  });

  it('reports every exclude of a block once it has expired', () => {
    const violations = checkReleaseAgeExcludes(`${POLICY}\n${BLOCK}\n`, '2026-10-04');
    expect(violations.map((violation) => violation.problem)).toStrictEqual(['expired', 'expired']);
    expect(violations[0]).toStrictEqual({ line: 7, pattern: 'expo', problem: 'expired' });
  });

  it('reports an exclude that has no dated block header', () => {
    const npmrc = `${POLICY}\nmin-release-age-exclude[]=prettier\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 6, pattern: 'prettier', problem: 'no-block' },
    ]);
  });

  it('ends a block at the first blank line', () => {
    const npmrc = `${POLICY}\n${BLOCK}\n\nmin-release-age-exclude[]=knip\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 10, pattern: 'knip', problem: 'no-block' },
    ]);
  });

  it('reports every missing policy line by its key', () => {
    expect(checkReleaseAgeExcludes('save-exact=true\n', BEFORE_EXPIRY)).toStrictEqual([
      { line: 0, pattern: 'min-release-age', problem: 'policy-missing' },
      { line: 0, pattern: 'engine-strict', problem: 'policy-missing' },
      { line: 0, pattern: 'strict-allow-scripts', problem: 'policy-missing' },
    ]);
  });

  it('reports a missing strict-allow-scripts=true (npm would run unreviewed scripts)', () => {
    const npmrc = POLICY.replace('strict-allow-scripts=true\n', '');
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 0, pattern: 'strict-allow-scripts', problem: 'policy-missing' },
    ]);
  });

  it('reports a later line that switches a policy line off (npm keeps the last value)', () => {
    const npmrc = `${POLICY}min-release-age = 0\nengine-strict=false\nstrict-allow-scripts=false\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 5, pattern: 'min-release-age = 0', problem: 'policy-overridden' },
      { line: 6, pattern: 'engine-strict=false', problem: 'policy-overridden' },
      { line: 7, pattern: 'strict-allow-scripts=false', problem: 'policy-overridden' },
    ]);
  });

  it('reports every key that switches a guard off, in any spelling npm reads as true', () => {
    const lines = [
      'legacy-peer-deps=true',
      'force',
      'dangerously-allow-all-scripts=',
      'before=2099-12-31',
      'allow-scripts=lefthook',
      'package-lock=false',
    ];
    const violations = checkReleaseAgeExcludes(`${POLICY}${lines.join('\n')}\n`, BEFORE_EXPIRY);
    expect(violations.map((violation) => [violation.line, violation.problem])).toStrictEqual([
      [5, 'policy-bypass'],
      [6, 'policy-bypass'],
      [7, 'policy-bypass'],
      [8, 'policy-bypass'],
      [9, 'policy-bypass'],
      [10, 'policy-bypass'],
    ]);
  });

  it('accepts a guard key set to its harmless value', () => {
    const lines = [
      'legacy-peer-deps=false',
      'force=false',
      'dangerously-allow-all-scripts=false',
      'package-lock=true',
    ];
    expect(checkReleaseAgeExcludes(`${POLICY}${lines.join('\n')}\n`, BEFORE_EXPIRY)).toStrictEqual(
      [],
    );
  });

  it('reads values the way npm does: inline comments cut, one pair of quotes dropped', () => {
    const npmrc = `${POLICY}force # until the conflict is fixed\nengine-strict=false ; for now\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 5, pattern: 'force # until the conflict is fixed', problem: 'policy-bypass' },
      { line: 6, pattern: 'engine-strict=false ; for now', problem: 'policy-overridden' },
    ]);
    const quoted = POLICY.replace('strict-allow-scripts=true', 'strict-allow-scripts="true"');
    const commented = quoted.replace('engine-strict=true', 'engine-strict = true # why');
    expect(checkReleaseAgeExcludes(commented, BEFORE_EXPIRY)).toStrictEqual([]);
  });

  it('accepts a stricter release age that is not a whole number of days', () => {
    expect(checkReleaseAgeExcludes(POLICY.replace('=7', '=10.5'), BEFORE_EXPIRY)).toStrictEqual([]);
    expect(releaseAgeDaysOf(POLICY.replace('=7', '=10.5'))).toBe(10.5);
  });

  it('reads a file with Windows line endings', () => {
    const npmrc = `${POLICY}\n${BLOCK}\n`.replaceAll('\n', '\r\n');
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([]);
  });

  it('treats every spelling npm accepts as an exclude', () => {
    const npmrc = `${POLICY}\nmin-release-age-exclude = knip\n  min-release-age-exclude[] = prettier\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 6, pattern: 'knip', problem: 'no-block' },
      { line: 7, pattern: 'prettier', problem: 'no-block' },
    ]);
  });

  it('reports a catch-all pattern, also inside a comma list, even in a valid block', () => {
    const block = '# exclude-block expires=2026-10-01 reason=urgent fix';
    const npmrc = `${POLICY}\n${block}\nmin-release-age-exclude[]=*\nmin-release-age-exclude[]=expo,@*/*\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 7, pattern: '*', problem: 'catch-all' },
      { line: 8, pattern: '@*/*', problem: 'catch-all' },
    ]);
  });

  it('reports a block that outlives today plus the release age (extended or invented)', () => {
    const npmrc = `${POLICY}\n${BLOCK.replace('2026-10-03', '2099-12-31')}\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([
      { line: 6, pattern: '2099-12-31', problem: 'outlives-release' },
    ]);
  });

  it('measures the expiry limit with the stricter release age the .npmrc sets', () => {
    const stricter = POLICY.replace('=7', '=14');
    const npmrc = `${stricter}\n${BLOCK.replace('2026-10-03', '2026-10-10')}\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([]);
    expect(checkReleaseAgeExcludes(npmrc.replace(stricter, POLICY), BEFORE_EXPIRY)).toStrictEqual([
      { line: 6, pattern: '2026-10-10', problem: 'outlives-release' },
    ]);
  });

  it('accepts a stricter release age and flags one below the 7-day floor', () => {
    expect(checkReleaseAgeExcludes(POLICY.replace('=7', '=14'), BEFORE_EXPIRY)).toStrictEqual([]);
    expect(checkReleaseAgeExcludes(POLICY.replace('=7', '=3'), BEFORE_EXPIRY)).toStrictEqual([
      { line: 0, pattern: 'min-release-age', problem: 'policy-missing' },
      { line: 1, pattern: 'min-release-age=3', problem: 'policy-overridden' },
    ]);
  });

  it('ignores commented-out settings and placeholder headers', () => {
    const npmrc = `${POLICY}# exclude-block expires=YYYY-MM-DD reason=<link>\n# min-release-age=0\n; force\n`;
    expect(checkReleaseAgeExcludes(npmrc, BEFORE_EXPIRY)).toStrictEqual([]);
  });
});

describe('releaseAgeDaysOf', () => {
  it('returns the last acceptable min-release-age, else the 7-day floor', () => {
    expect(releaseAgeDaysOf(POLICY)).toBe(7);
    expect(releaseAgeDaysOf(`${POLICY}min-release-age = 14\n`)).toBe(14);
    expect(releaseAgeDaysOf('save-exact=true\n')).toBe(7);
    expect(releaseAgeDaysOf('min-release-age=2\n')).toBe(7);
  });
});

describe('excludePatternsOf', () => {
  it('lists every exclude pattern in any spelling, split on commas', () => {
    const npmrc = `${POLICY}\n${BLOCK}\nmin-release-age-exclude = knip,prettier # why\n`;
    expect(excludePatternsOf(npmrc)).toStrictEqual(['expo', '@expo/*', 'knip', 'prettier']);
    expect(excludePatternsOf(POLICY)).toStrictEqual([]);
  });
});
