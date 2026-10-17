// scripts/audit/license-policy.ts
// Pure: which licence expressions may ship, where a bundled package lives on disk, and which
// shipped packages break the policy.
import path from 'node:path';

/** Permissive licences a shipped dependency may use without an exception (the default allowlist). */
export const ALLOWED_LICENSES: readonly string[] = [
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'OFL-1.1',
  'CC0-1.0',
];

type LicenseException = { readonly license: string; readonly reason: string };
type Policy = {
  readonly allowed: readonly string[];
  readonly exceptions: Readonly<Record<string, LicenseException>>;
};

/**
 * True when an SPDX expression is acceptable: an OR needs one allowed side, an AND needs both.
 * AND binds tighter than OR and parentheses group, as SPDX defines; a malformed expression is
 * never allowed.
 */
export function isAllowedLicense(
  expression: string,
  allowed: readonly string[] = ALLOWED_LICENSES,
): boolean {
  const tokens = expression.replace(/[()]/gu, ' $& ').trim().split(/\s+/u);
  let next = 0;
  const peek = (): string | undefined => tokens[next];
  const take = (): string | undefined => tokens[next++];

  function parseOr(): boolean | null {
    let isAllowed = parseAnd();
    while (isAllowed !== null && peek() === 'OR') {
      take();
      const isRightAllowed = parseAnd();
      isAllowed = isRightAllowed === null ? null : isAllowed || isRightAllowed;
    }
    return isAllowed;
  }

  function parseAnd(): boolean | null {
    let isAllowed = parseTerm();
    while (isAllowed !== null && peek() === 'AND') {
      take();
      const isRightAllowed = parseTerm();
      isAllowed = isRightAllowed === null ? null : isAllowed && isRightAllowed;
    }
    return isAllowed;
  }

  function parseTerm(): boolean | null {
    const token = take();
    if (token === '(') {
      const isInnerAllowed = parseOr();
      return take() === ')' ? isInnerAllowed : null;
    }
    if (token === undefined || token === ')' || token === 'AND' || token === 'OR') {
      return null;
    }
    return allowed.includes(token);
  }

  const isWhole = parseOr();
  return isWhole === true && next === tokens.length;
}

/** Maps a bundled source path to the package root that owns it, or null for the app's own code. */
export function packageRootOf(sourcePath: string): string | null {
  const match = /^(?<root>.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(sourcePath);
  return match?.groups?.['root'] ?? null;
}

/**
 * The package.json paths that may hold a bundled package root, nearest first: the root under the
 * working folder, then under each parent folder up to the filesystem root. That one walk covers the
 * three spellings a source map uses: relative to the Metro server root (a leading '/', which is a
 * parent folder of an app inside npm workspaces), relative ('../node_modules/x'), and absolute
 * (node_modules symlinked or hoisted outside the project).
 */
export function packageJsonCandidates(root: string, cwd: string): readonly string[] {
  const candidates: string[] = [];
  let folder = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(folder, root, 'package.json');
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
    const parent = path.dirname(folder);
    if (parent === folder) {
      return candidates;
    }
    folder = parent;
  }
}

/** One problem per package whose licence is neither allowed nor covered by its exception. */
export function licenseProblems(
  licenses: ReadonlyMap<string, string | null>,
  policy: Policy,
): readonly string[] {
  return [...licenses.entries()].flatMap(([name, license]) => {
    if (license !== null && isAllowedLicense(license, policy.allowed)) {
      return [];
    }
    if (policy.exceptions[name]?.license === license) {
      return [];
    }
    return [`${name}: licence "${String(license)}" is not allowed and has no exception entry`];
  });
}
