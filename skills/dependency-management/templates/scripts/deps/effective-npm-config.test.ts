// scripts/deps/effective-npm-config.test.ts
import {
  childProcessEnv,
  EFFECTIVE_KEYS,
  effectiveConfigProblems,
  parseConfigGet,
} from './effective-npm-config.ts';

// What `npm config get <EFFECTIVE_KEYS...>` printed on npm 11.17.0 for the template .npmrc with one
// dated block (2026-10-03).
const POLICY_OUTPUT = [
  'min-release-age=7',
  'engine-strict=true',
  'save-exact=true',
  'strict-allow-scripts=true',
  'legacy-peer-deps=false',
  'force=false',
  'dangerously-allow-all-scripts=false',
  'package-lock=true',
  'before=null',
  'min-release-age-exclude=expo,expo-*',
  'allow-scripts=',
  '',
].join('\n');
const PROJECT_EXCLUDES = ['expo', 'expo-*'];

describe('parseConfigGet', () => {
  it('reads one key=value line per key, keeping "=" inside a value', () => {
    const values = parseConfigGet('before=null\nnode-options=--max-old-space-size=4096\n');
    expect(values.get('before')).toBe('null');
    expect(values.get('node-options')).toBe('--max-old-space-size=4096');
  });
});

describe('effectiveConfigProblems', () => {
  it('passes the config the template .npmrc gives', () => {
    const values = parseConfigGet(POLICY_OUTPUT);
    expect([...values.keys()]).toStrictEqual([...EFFECTIVE_KEYS]);
    expect(effectiveConfigProblems(values, PROJECT_EXCLUDES)).toStrictEqual([]);
  });

  it('accepts a stricter release age', () => {
    const values = parseConfigGet(POLICY_OUTPUT.replace('min-release-age=7', 'min-release-age=14'));
    expect(effectiveConfigProblems(values, PROJECT_EXCLUDES)).toStrictEqual([]);
  });

  it('reports what an environment variable or ~/.npmrc switched off', () => {
    const output = POLICY_OUTPUT.replace('legacy-peer-deps=false', 'legacy-peer-deps=true')
      .replace('min-release-age=7', 'min-release-age=0')
      .replace('before=null', 'before=Thu Jan 01 2099 01:00:00 GMT+0100');
    const problems = effectiveConfigProblems(parseConfigGet(output), PROJECT_EXCLUDES);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('npm runs with min-release-age=0 (the policy needs 7 or more)');
    expect(problems[1]).toContain('legacy-peer-deps=true (the policy needs false)');
    expect(problems[2]).toContain('before=Thu Jan 01 2099');
  });

  it('reports an exclude list that replaced the dated blocks of the project .npmrc', () => {
    const output = POLICY_OUTPUT.replace('=expo,expo-*', '=*,@*/*');
    expect(effectiveConfigProblems(parseConfigGet(output), PROJECT_EXCLUDES)).toStrictEqual([
      expect.stringContaining('min-release-age-exclude=*,@*/* (no line of the project .npmrc'),
    ]);
  });

  it('reports an allow-scripts list from a variable or ~/.npmrc (it breaks installs in the project)', () => {
    const output = POLICY_OUTPUT.replace('\nallow-scripts=\n', '\nallow-scripts=esbuild@0.25.0\n');
    expect(effectiveConfigProblems(parseConfigGet(output), PROJECT_EXCLUDES)).toStrictEqual([
      expect.stringContaining(
        'npm runs with allow-scripts=esbuild@0.25.0 (the policy needs it unset',
      ),
    ]);
  });

  it('reports a key an old npm does not know (npm 10 has no min-release-age)', () => {
    const output = POLICY_OUTPUT.replace('min-release-age=7', 'min-release-age=undefined');
    expect(effectiveConfigProblems(parseConfigGet(output), PROJECT_EXCLUDES)).toStrictEqual([
      expect.stringContaining('min-release-age=undefined (the policy needs 7 or more)'),
    ]);
  });
});

describe('childProcessEnv', () => {
  it('drops the log level npm run -s exports, in either case, and keeps every other variable', () => {
    const env = {
      NODE_ENV: 'test',
      PATH: '/usr/bin',
      npm_config_loglevel: 'silent',
      NPM_CONFIG_LOGLEVEL: 'silent',
      npm_config_min_release_age: '7',
    } as const;

    expect(childProcessEnv(env)).toStrictEqual({
      NODE_ENV: 'test',
      PATH: '/usr/bin',
      npm_config_min_release_age: '7',
    });
    expect(env.npm_config_loglevel).toBe('silent');
  });
});
