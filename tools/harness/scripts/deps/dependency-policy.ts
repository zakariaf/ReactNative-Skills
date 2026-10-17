// scripts/deps/dependency-policy.ts
// Reads the parts of the dependency policy that the repo's own gates enforce: the banned list
// (check-deps.ts) and the licence policy (audit-licenses.ts). The policy is found the way the
// dependency-management skill's checkers find it: rn-skills.config.json "dependencyPolicy", else
// "<contractsDir>/dependency-policy.json", else contracts/dependency-policy.json. The skill's checker
// validates the whole file; this module refuses a missing file and any entry it cannot use, so a
// broken or moved policy fails the gate instead of passing it. Everything but readDependencyPolicy
// is pure.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ALLOWED_LICENSES } from '../audit/license-policy.ts';

export const DEFAULT_POLICY_FILE = 'contracts/dependency-policy.json';
export const PROJECT_CONFIG_FILE = 'rn-skills.config.json';
const POLICY_NAME = 'dependency-policy.json';

export type BannedScope = 'anywhere' | 'direct';
export type BannedRule = {
  readonly pattern: RegExp;
  readonly scope: BannedScope;
  readonly reason: string;
};
export type LicenseException = { readonly license: string; readonly reason: string };
export type LicensePolicy = {
  readonly allowed: readonly string[];
  readonly exceptions: Readonly<Record<string, LicenseException>>;
};
export type DependencyPolicy = { readonly file: string; readonly policy: unknown };

type JsonObject = Readonly<Record<string, unknown>>;
/** Where an entry sits, for error messages: the policy file and the entry's path in it. */
type Place = { readonly file: string; readonly where: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Drops // and block comments outside strings, then commas before a closing bracket (JSONC). */
export function stripJsonComments(text: string): string {
  const tokens = /("(?:[^"\\]|\\.)*")|(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)/gu;
  const withoutComments = text.replace(
    tokens,
    (_match, quoted: string | undefined) => quoted ?? ' ',
  );
  const trailing = /("(?:[^"\\]|\\.)*")|,(\s*[}\]])/gu;
  return withoutComments.replace(
    trailing,
    (match: string, quoted: string | undefined, close: string | undefined) =>
      quoted ?? close ?? match,
  );
}

function configPath(config: JsonObject, key: string): string | null {
  const value = config[key];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.includes('..')) {
    throw new Error(`${PROJECT_CONFIG_FILE}: "${key}" must be a repo-relative path`);
  }
  return value;
}

/**
 * The repo-relative policy path for a parsed rn-skills.config.json (undefined when the repo has
 * none): "dependencyPolicy", else "<contractsDir>/dependency-policy.json", else the default.
 */
export function policyFileOf(config: unknown): string {
  if (config === undefined) {
    return DEFAULT_POLICY_FILE;
  }
  if (!isObject(config)) {
    throw new Error(`${PROJECT_CONFIG_FILE} must hold one JSON object`);
  }
  const contractsDir = configPath(config, 'contractsDir');
  const configured = configPath(config, 'dependencyPolicy');
  if (configured !== null) {
    return configured;
  }
  return contractsDir === null ? DEFAULT_POLICY_FILE : path.posix.join(contractsDir, POLICY_NAME);
}

/** Reads the policy of the repo at root; a missing file throws (a gate never falls back). */
export function readDependencyPolicy(root = '.'): DependencyPolicy {
  const configFile = path.join(root, PROJECT_CONFIG_FILE);
  const config: unknown = existsSync(configFile)
    ? JSON.parse(stripJsonComments(readFileSync(configFile, 'utf8')))
    : undefined;
  const file = policyFileOf(config);
  const absolute = path.join(root, file);
  if (!existsSync(absolute)) {
    throw new Error(
      `${file} is missing: the dependency policy holds the bans and the licence policy ` +
        '(copy it from the dependency-management skill, or point rn-skills.config.json ' +
        '"dependencyPolicy" at it)',
    );
  }
  return { file, policy: JSON.parse(readFileSync(absolute, 'utf8')) as unknown };
}

function stringField(entry: JsonObject, key: string, place: Place): string {
  const value = entry[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${place.file}: ${place.where} needs a non-empty "${key}"`);
  }
  return value;
}

function bannedRuleOf(entry: unknown, index: number, file: string): BannedRule {
  const where = `banned[${String(index)}]`;
  if (!isObject(entry)) {
    throw new Error(`${file}: ${where} is not an object`);
  }
  const place = { file, where };
  const scope = stringField(entry, 'scope', place);
  if (scope !== 'anywhere' && scope !== 'direct') {
    throw new Error(`${file}: ${where} scope must be "anywhere" or "direct"`);
  }
  const pattern = new RegExp(stringField(entry, 'pattern', place), 'u');
  return { pattern, scope, reason: stringField(entry, 'reason', place) };
}

/** The banned list of the policy (the supply-chain floor plus the app's own bans and profiles). */
export function bannedRulesOf(policy: unknown, file = DEFAULT_POLICY_FILE): readonly BannedRule[] {
  const banned = isObject(policy) ? policy['banned'] : undefined;
  if (!Array.isArray(banned)) {
    throw new Error(`${file}: "banned" must be a list`);
  }
  const entries: readonly unknown[] = banned;
  return entries.map((entry, index) => bannedRuleOf(entry, index, file));
}

function exceptionsOf(value: unknown, file: string): Readonly<Record<string, LicenseException>> {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value)) {
    throw new Error(`${file}: "licenses.exceptions" must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => {
      const where = `licenses.exceptions.${name}`;
      if (!isObject(entry)) {
        throw new Error(`${file}: ${where} is not an object`);
      }
      const place = { file, where };
      const exception = {
        license: stringField(entry, 'license', place),
        reason: stringField(entry, 'reason', place),
      };
      return [name, exception];
    }),
  );
}

function allowedOf(value: unknown, file: string): readonly string[] {
  if (value === undefined) {
    return ALLOWED_LICENSES;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${file}: "licenses.allowed" must be a list of SPDX ids`);
  }
  return value;
}

/** The licence policy: allowed SPDX ids (the permissive defaults when absent) and the exceptions. */
export function licensePolicyOf(policy: unknown, file = DEFAULT_POLICY_FILE): LicensePolicy {
  const licenses = isObject(policy) ? policy['licenses'] : undefined;
  if (licenses === undefined) {
    return { allowed: ALLOWED_LICENSES, exceptions: {} };
  }
  if (!isObject(licenses)) {
    throw new Error(`${file}: "licenses" must be an object`);
  }
  return {
    allowed: allowedOf(licenses['allowed'], file),
    exceptions: exceptionsOf(licenses['exceptions'], file),
  };
}
