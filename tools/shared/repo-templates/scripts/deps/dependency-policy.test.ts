// scripts/deps/dependency-policy.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  bannedRulesOf,
  licensePolicyOf,
  policyFileOf,
  readDependencyPolicy,
  stripJsonComments,
} from './dependency-policy.ts';

const POLICY = {
  banned: [
    { pattern: '^node-ipc$', scope: 'anywhere', reason: 'protestware' },
    { pattern: '^request$', scope: 'direct', reason: 'deprecated' },
  ],
  licenses: {
    allowed: ['MIT'],
    exceptions: {
      'caniuse-lite': { license: 'CC-BY-4.0', reason: 'browser data, build tools only' },
    },
  },
};

describe('bannedRulesOf', () => {
  it('reads every banned entry with its scope and reason', () => {
    const rules = bannedRulesOf(POLICY);
    expect(rules.map((rule) => [rule.pattern.source, rule.scope])).toStrictEqual([
      ['^node-ipc$', 'anywhere'],
      ['^request$', 'direct'],
    ]);
    expect(rules[0]?.pattern.test('node-ipc')).toBe(true);
  });

  it('refuses a policy without a banned list, or with an entry it cannot use', () => {
    expect(() => bannedRulesOf({})).toThrow('"banned" must be a list');
    expect(() =>
      bannedRulesOf({ banned: [{ pattern: '^x$', scope: 'everywhere', reason: 'r' }] }),
    ).toThrow('scope must be "anywhere" or "direct"');
    expect(() => bannedRulesOf({ banned: [{ pattern: '^x$', scope: 'direct' }] })).toThrow(
      'banned[0] needs a non-empty "reason"',
    );
  });

  it('names the policy file it read in its errors', () => {
    expect(() => bannedRulesOf({}, 'qa/dependency-policy.json')).toThrow(
      'qa/dependency-policy.json: "banned" must be a list',
    );
  });
});

describe('licensePolicyOf', () => {
  it('reads the allowed ids and the exceptions', () => {
    expect(licensePolicyOf(POLICY)).toStrictEqual({
      allowed: ['MIT'],
      exceptions: {
        'caniuse-lite': { license: 'CC-BY-4.0', reason: 'browser data, build tools only' },
      },
    });
  });

  it('falls back to the permissive defaults when the policy names no licences', () => {
    const policy = licensePolicyOf({ banned: [] });
    expect(policy.allowed).toContain('Apache-2.0');
    expect(policy.exceptions).toStrictEqual({});
  });

  it('refuses an exception without a reason', () => {
    const policy = { licenses: { exceptions: { pkg: { license: 'MPL-2.0' } } } };
    expect(() => licensePolicyOf(policy)).toThrow(
      'licenses.exceptions.pkg needs a non-empty "reason"',
    );
  });
});

describe('policyFileOf', () => {
  it('uses the default without rn-skills.config.json', () => {
    expect(policyFileOf(undefined)).toBe('contracts/dependency-policy.json');
    expect(policyFileOf({ srcDir: 'app-src' })).toBe('contracts/dependency-policy.json');
  });

  it('follows "dependencyPolicy", else "contractsDir"', () => {
    expect(policyFileOf({ dependencyPolicy: 'qa/deps.json', contractsDir: 'x' })).toBe(
      'qa/deps.json',
    );
    expect(policyFileOf({ contractsDir: 'qa/contracts' })).toBe(
      'qa/contracts/dependency-policy.json',
    );
  });

  it('refuses a path outside the repo', () => {
    expect(() => policyFileOf({ dependencyPolicy: '../policy.json' })).toThrow(
      '"dependencyPolicy" must be a repo-relative path',
    );
  });
});

describe('stripJsonComments', () => {
  it('keeps strings and drops comments and trailing commas', () => {
    const text = '{ "a": "// not a comment", /* note */ "b": [1, 2,], // end\n }';
    expect(JSON.parse(stripJsonComments(text))).toStrictEqual({ a: '// not a comment', b: [1, 2] });
  });
});

describe('readDependencyPolicy', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'dependency-policy-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the policy where rn-skills.config.json points', () => {
    mkdirSync(path.join(root, 'qa'));
    writeFileSync(path.join(root, 'qa', 'deps.json'), JSON.stringify(POLICY));
    writeFileSync(
      path.join(root, 'rn-skills.config.json'),
      '{\n  // moved with the other contracts\n  "dependencyPolicy": "qa/deps.json",\n}\n',
    );
    const read = readDependencyPolicy(root);
    expect(read.file).toBe('qa/deps.json');
    expect(bannedRulesOf(read.policy, read.file)).toHaveLength(2);
  });

  it('fails when the policy file is missing instead of using defaults', () => {
    expect(() => readDependencyPolicy(root)).toThrow('contracts/dependency-policy.json is missing');
  });
});
