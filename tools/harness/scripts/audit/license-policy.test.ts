// scripts/audit/license-policy.test.ts
import {
  ALLOWED_LICENSES,
  isAllowedLicense,
  licenseProblems,
  packageJsonCandidates,
  packageRootOf,
} from './license-policy.ts';

const POLICY = { allowed: ALLOWED_LICENSES, exceptions: {} };

describe('isAllowedLicense', () => {
  it('accepts an OR expression with one allowed side', () => {
    expect(isAllowedLicense('(BSD-3-Clause OR GPL-2.0)')).toBe(true);
  });

  it('rejects a copyleft licence', () => {
    expect(isAllowedLicense('MPL-2.0')).toBe(false);
  });

  it('requires both sides of an AND expression', () => {
    expect(isAllowedLicense('MIT AND CC-BY-4.0')).toBe(false);
  });

  it('keeps the grouping of parentheses: an AND outside a group binds the whole group', () => {
    expect(isAllowedLicense('(MIT OR GPL-3.0) AND GPL-2.0')).toBe(false);
    expect(isAllowedLicense('(MIT OR GPL-3.0) AND ISC')).toBe(true);
  });

  it('binds AND tighter than OR, as SPDX does', () => {
    expect(isAllowedLicense('GPL-2.0 AND MIT OR ISC')).toBe(true);
    expect(isAllowedLicense('MIT OR GPL-2.0 AND GPL-3.0')).toBe(true);
    expect(isAllowedLicense('GPL-2.0 OR GPL-3.0 AND MIT')).toBe(false);
  });

  it('rejects an expression with unbalanced parentheses', () => {
    expect(isAllowedLicense('(MIT OR ISC')).toBe(false);
  });

  it('uses the allowlist the policy names', () => {
    expect(isAllowedLicense('Apache-2.0', ['MIT'])).toBe(false);
    expect(isAllowedLicense('MPL-2.0', ['MIT', 'MPL-2.0'])).toBe(true);
  });
});

describe('packageRootOf', () => {
  it('finds a scoped package root', () => {
    expect(packageRootOf('/node_modules/@formatjs/intl/lib/x.js')).toBe(
      '/node_modules/@formatjs/intl',
    );
  });

  it('returns null for the app sources', () => {
    expect(packageRootOf('/src/ui/app-text.tsx')).toBeNull();
  });
});

describe('packageJsonCandidates', () => {
  it('tries the working folder first, then each parent folder (npm workspaces hoist to the root)', () => {
    expect(packageJsonCandidates('/node_modules/react', '/repo/apps/notes')).toStrictEqual([
      '/repo/apps/notes/node_modules/react/package.json',
      '/repo/apps/node_modules/react/package.json',
      '/repo/node_modules/react/package.json',
      '/node_modules/react/package.json',
    ]);
  });

  it('reaches an absolute source path (node_modules outside the project) as the last candidate', () => {
    const candidates = packageJsonCandidates('/store/proj/node_modules/react', '/repo');
    expect(candidates.at(-1)).toBe('/store/proj/node_modules/react/package.json');
  });

  it('resolves a relative source path against each folder', () => {
    expect(packageJsonCandidates('../node_modules/zustand', '/repo/apps/notes')[0]).toBe(
      '/repo/apps/node_modules/zustand/package.json',
    );
  });
});

describe('licenseProblems', () => {
  it('accepts an excepted licence only when the exception names that licence', () => {
    const licenses = new Map([['caniuse-lite', 'CC-BY-4.0']]);
    const exceptions = { 'caniuse-lite': { license: 'CC-BY-4.0', reason: 'data only' } };
    expect(licenseProblems(licenses, { ...POLICY, exceptions })).toStrictEqual([]);
    const relicensed = new Map([['caniuse-lite', 'CC-BY-SA-4.0']]);
    expect(licenseProblems(relicensed, { ...POLICY, exceptions })).toHaveLength(1);
  });

  it('reports a package without a licence field', () => {
    expect(licenseProblems(new Map([['mystery', null]]), POLICY)).toStrictEqual([
      'mystery: licence "null" is not allowed and has no exception entry',
    ]);
  });
});
