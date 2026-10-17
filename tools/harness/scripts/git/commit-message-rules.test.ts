// scripts/git/commit-message-rules.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_REQUIREMENT_REF,
  FIXED_SCOPES,
  readCommitRules,
  requirementOf,
} from './commit-config.ts';
import { checkCommitMessage, normalizeMessage, type CommitRules } from './commit-message-rules.ts';
import SAMPLES from './commit-message-samples.json';

type SampleRef = {
  readonly pattern: string;
  readonly exemptScopes: readonly string[];
} | null;

const rulesFor = (ref: SampleRef): CommitRules => ({
  scopes: SAMPLES.scopes,
  gatedPatterns: SAMPLES.gatedPaths,
  requirement: requirementOf({ requirementRef: ref }),
});

const rulesOf = (message: string, files: readonly string[] | null, rules: CommitRules): string[] =>
  [...new Set(checkCommitMessage({ message, files, rules }).map((found) => found.rule))].sort();

describe('checkCommitMessage', () => {
  // The same list check-commits.mjs --samples runs: the hook and the checker cannot drift.
  it.each(SAMPLES.samples.map((sample) => [sample.name, sample] as const))(
    'judges the shared sample %s as the list says',
    (_name, sample) => {
      const ref = 'requirementRef' in sample ? sample.requirementRef : SAMPLES.requirementRef;
      expect(rulesOf(sample.message, sample.files, rulesFor(ref))).toStrictEqual(
        [...sample.rules].sort(),
      );
    },
  );

  it('covers every rule id with a sample', () => {
    const covered = new Set(SAMPLES.samples.flatMap((sample) => sample.rules));
    expect(covered.size).toBe(18);
  });

  it('names the line of a misplaced trailer', () => {
    const [found] = checkCommitMessage({
      message: 'chore(repo): tidy the scripts\n\nCo-Authored-By: someone\n\nWhy it changed.',
      files: null,
      rules: rulesFor(null),
    });
    expect(found).toMatchObject({ rule: 'trailer-placement', line: 3 });
  });
});

describe('normalizeMessage', () => {
  it('drops comment lines and everything below the scissors', () => {
    const raw =
      'chore(repo): tidy\n# comment\n\nBody.\n# ------------------------ >8 ------------------------\ndiff';
    expect(normalizeMessage(raw)).toBe('chore(repo): tidy\n\nBody.');
  });
});

describe('requirementOf', () => {
  it('keeps the requirement rule off without a contract pattern', () => {
    expect(requirementOf({})).toStrictEqual({
      pattern: DEFAULT_REQUIREMENT_REF,
      required: false,
      exemptScopes: FIXED_SCOPES,
    });
  });

  it('accepts an issue number, a ticket key and a spec section by default', () => {
    const refs = ['closes #31', 'TASK-12 drafts', 'spec 4.2 changed'];
    expect(refs.map((ref) => DEFAULT_REQUIREMENT_REF.test(ref))).toStrictEqual([true, true, true]);
    expect(DEFAULT_REQUIREMENT_REF.test('the test was wrong')).toBe(false);
  });
});

describe('readCommitRules', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'commit-config-'));
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  beforeAll(() => {
    write('quality-gates.json', JSON.stringify({ gatedPaths: ['knip.json'] }));
    write('src/features/tasks/tasks-screen.tsx', 'export {};\n');
    write('src/features/(hidden)/x.ts', 'export {};\n');
    write('src/ui/button.tsx', 'export {};\n');
  });

  // Each test writes its own layout or contract; removing them after every test keeps the tests
  // independent of their order (test:coverage runs with --randomize).
  afterEach(() => {
    rmSync(path.join(root, 'rn-skills.config.json'), { force: true });
    rmSync(path.join(root, 'contracts/commits.json'), { force: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('takes the scopes from src/features/*, src/* and the fixed list', () => {
    const rules = readCommitRules(root);
    expect(rules.scopes).toStrictEqual(
      ['features', 'tasks', 'ui', ...FIXED_SCOPES].sort((a, b) => a.localeCompare(b)),
    );
    expect(rules.gatedPatterns).toStrictEqual(['knip.json']);
  });

  it('follows srcDir and contractsDir of rn-skills.config.json, as check-commits.mjs does', () => {
    write('rn-skills.config.json', JSON.stringify({ srcDir: 'app-src', contractsDir: 'qa' }));
    write('app-src/orders/orders.ts', 'export {};\n');
    write('qa/commits.json', JSON.stringify({ extraScopes: ['billing'] }));
    const { scopes } = readCommitRules(root);
    expect(scopes).toContain('orders');
    expect(scopes).toContain('billing');
    expect(scopes).not.toContain('tasks');
  });

  it('refuses a layout folder that leaves the repo', () => {
    write('rn-skills.config.json', JSON.stringify({ contractsDir: '../elsewhere' }));
    expect(() => readCommitRules(root)).toThrow('"contractsDir" must be a repo-relative folder');
  });

  it('reads extra scopes and the requirement rule from contracts/commits.json', () => {
    write(
      'contracts/commits.json',
      JSON.stringify({ extraScopes: ['store'], requirementRef: { pattern: '\\bTASK-\\d+\\b' } }),
    );
    const rules = readCommitRules(root);
    expect(rules.scopes).toContain('store');
    expect(rules.requirement.required).toBe(true);
    expect(rules.requirement.pattern.test('TASK-7')).toBe(true);
  });

  it('refuses a contract of the wrong shape', () => {
    write('contracts/commits.json', JSON.stringify({ extraScopes: 'store' }));
    expect(() => readCommitRules(root)).toThrow('commits.json does not match');
  });
});
