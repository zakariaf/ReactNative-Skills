// scripts/git/commit-config.ts
// Where the commit rules get their facts: the scopes (the folders under src/features/ and src/, the
// workspace folders when multi-package, and the fixed scopes), the gated paths (quality-gates.json,
// owned by quality-gates) and the optional requirement-reference rule. contracts/commits.json may
// change the scope folders, add scopes and switch the requirement rule on; without it the defaults
// below apply. check-commits.mjs (git-commits-and-reporting) reads the same file the same way. Both
// honour the same two keys of rn-skills.config.json, "srcDir" and "contractsDir" (the shared layout
// file of the skills' checkers), so a moved src/ or contracts/ folder moves both readers together; an
// app whose scopes live anywhere else sets "scopeFolders" in contracts/commits.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import requirementRef from './requirement-ref.json' with { type: 'json' };
import { gatedPathsOf } from '../quality/gated-paths.ts';

import type { CommitRules } from './commit-message-rules.ts';
import type { RequirementRule } from './commit-trailer-rules.ts';

/** Scopes for work outside src/: always allowed, and never asked for a requirement reference. */
export const FIXED_SCOPES = [
  'repo',
  'deps',
  'docs',
  'ci',
  'tooling',
  'e2e',
  'release',
  'skills',
] as const;

/** The two layout keys of rn-skills.config.json the commit rules read, with their defaults. */
type Layout = { readonly srcDir: string; readonly contractsDir: string };
const DEFAULT_LAYOUT: Layout = { srcDir: 'src', contractsDir: 'contracts' };
const LAYOUT_CONFIG = 'rn-skills.config.json';

/** Folders whose sub-folder names are scopes ("<folder>/*") or which are one scope ("<folder>"). */
export const scopeFoldersOf = (layout: Layout): readonly string[] => [
  `${layout.srcDir}/features/*`,
  `${layout.srcDir}/*`,
];

/**
 * A requirement reference when the repo names no pattern: #123, TASK-12, "spec 4.2", "issue 31".
 * The pattern lives in requirement-ref.json, the one copy tdd-workflow's history check also reads.
 */
export const DEFAULT_REQUIREMENT_REF = new RegExp(requirementRef.pattern, requirementRef.flags);

/** The contract's name inside the contracts folder (contracts/commits.json by default). */
export const COMMITS_CONTRACT = 'commits.json';

type Contract = {
  readonly scopeFolders?: readonly string[];
  readonly extraScopes?: readonly string[];
  readonly requirementRef?: {
    readonly pattern: string;
    readonly required?: boolean;
    readonly exemptScopes?: readonly string[];
  } | null;
};

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The scope names one folder entry gives: its visible sub-folders, or the folder's own name. */
function scopesOfFolder(rootDir: string, entry: string): readonly string[] {
  const isWildcard = entry.endsWith('/*');
  const folder = path.join(rootDir, isWildcard ? entry.slice(0, -2) : entry);
  if (!existsSync(folder)) {
    return [];
  }
  if (!isWildcard) {
    return [path.basename(folder)];
  }
  return readdirSync(folder, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !/^[.(_]/u.test(item.name))
    .map((item) => item.name);
}

/** package.json "workspaces" globs (an array, or yarn's { packages }), or none for a single app. */
function workspaceFolders(rootDir: string): readonly string[] {
  const file = path.join(rootDir, 'package.json');
  if (!existsSync(file)) {
    return [];
  }
  const manifest = readJson(file) as { readonly workspaces?: unknown };
  const { workspaces } = manifest;
  if (isStringList(workspaces)) {
    return workspaces;
  }
  const packages = (workspaces as { readonly packages?: unknown } | undefined)?.packages;
  return isStringList(packages) ? packages : [];
}

/** A repo-relative folder: no leading slash, no "..", not empty. */
const isRepoFolder = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  !value.startsWith('/') &&
  !value.split('/').includes('..');

/** srcDir and contractsDir from rn-skills.config.json; the defaults without the file or the key. */
export function layoutOf(rootDir: string): Layout {
  const file = path.join(rootDir, LAYOUT_CONFIG);
  if (!existsSync(file)) {
    return DEFAULT_LAYOUT;
  }
  const config = readJson(file) as Partial<Record<keyof Layout, unknown>>;
  const pick = (key: keyof Layout): string => {
    const value = config[key];
    if (value === undefined) {
      return DEFAULT_LAYOUT[key];
    }
    if (!isRepoFolder(value)) {
      throw new Error(`${LAYOUT_CONFIG}: "${key}" must be a repo-relative folder`);
    }
    return value.replace(/\/+$/u, '');
  };
  return { srcDir: pick('srcDir'), contractsDir: pick('contractsDir') };
}

/** Every allowed scope: the folder scopes, the contract's extra scopes and FIXED_SCOPES, sorted. */
export function scopesIn(
  rootDir: string,
  contract: Contract,
  layout: Layout = DEFAULT_LAYOUT,
): readonly string[] {
  const folders = contract.scopeFolders ?? [
    ...workspaceFolders(rootDir),
    ...scopeFoldersOf(layout),
  ];
  const names = folders.flatMap((entry) => scopesOfFolder(rootDir, entry));
  return [...new Set([...names, ...(contract.extraScopes ?? []), ...FIXED_SCOPES])].sort();
}

/** The requirement rule: off (any reference names a Spec-Change) unless the contract sets one. */
export function requirementOf(contract: Contract): RequirementRule {
  const ref = contract.requirementRef ?? null;
  if (ref === null) {
    return { pattern: DEFAULT_REQUIREMENT_REF, required: false, exemptScopes: FIXED_SCOPES };
  }
  return {
    pattern: new RegExp(ref.pattern, 'u'),
    required: ref.required ?? true,
    exemptScopes: ref.exemptScopes ?? FIXED_SCOPES,
  };
}

/** Throws a plain message when contracts/commits.json has the wrong shape. */
function contractOf(value: unknown): Contract {
  const data = (typeof value === 'object' && value !== null ? value : {}) as Contract;
  const lists = [data.scopeFolders, data.extraScopes, data.requirementRef?.exemptScopes];
  const ref = data.requirementRef;
  const isRefValid = ref === undefined || ref === null || typeof ref.pattern === 'string';
  if (lists.some((list) => list !== undefined && !isStringList(list)) || !isRefValid) {
    throw new Error(`${COMMITS_CONTRACT} does not match commits.schema.json`);
  }
  return data;
}

/** The commit rules of the repo at rootDir. */
export function readCommitRules(rootDir: string): CommitRules {
  const layout = layoutOf(rootDir);
  const contractFile = path.join(rootDir, layout.contractsDir, COMMITS_CONTRACT);
  const contract = existsSync(contractFile) ? contractOf(readJson(contractFile)) : {};
  return {
    scopes: scopesIn(rootDir, contract, layout),
    gatedPatterns: gatedPathsOf(readJson(path.join(rootDir, 'quality-gates.json'))),
    requirement: requirementOf(contract),
  };
}
