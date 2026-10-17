// scripts/audit/privacy-contract.ts
// Reads the parts of contracts/privacy.json (privacy-and-store-declarations) that npm run
// audit:network and audit:privacy enforce: the network profile, the first-party network seams, the
// declared SDKs (their findings need no baseline entry), the pods each brings and which may track. The skill's audit-repo.mjs validates the
// whole file; this module refuses a missing file or a value it cannot use, so a broken contract
// fails the audit instead of passing it. Everything but readPrivacyContract is pure.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONTRACT_FILE = 'contracts/privacy.json';
const PROJECT_CONFIG_FILE = 'rn-skills.config.json';
const OFFLINE_ONLY = 'offline-only';
const PROFILES = ['api-port', OFFLINE_ONLY] as const;

export type Profile = (typeof PROFILES)[number];
export type DeclaredSdk = {
  readonly name: string;
  readonly pods: readonly string[];
  readonly isTracking: boolean;
};
export type PrivacyContract = {
  readonly profile: Profile;
  readonly networkModules: readonly string[];
  readonly linkFiles: readonly string[];
  readonly sdks: readonly DeclaredSdk[];
};

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, where: string): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${where} must be a list of strings`);
  }
  return value as readonly string[];
}

function profileOf(value: unknown): Profile {
  const match = PROFILES.find((profile) => profile === (value ?? 'api-port'));
  if (match === undefined) {
    throw new Error(`profile ${JSON.stringify(value)} is not one of ${PROFILES.join(', ')}`);
  }
  return match;
}

function sdksOf(value: unknown): readonly DeclaredSdk[] {
  if (!isObject(value)) {
    throw new Error('sdks must be an object keyed by npm package name');
  }
  return Object.entries(value).map(([name, entry]) => {
    if (!isObject(entry)) {
      throw new Error(`sdks["${name}"] must be an object`);
    }
    return {
      name,
      pods: stringList(entry['pods'], `sdks["${name}"].pods`),
      isTracking: entry['tracking'] === true,
    };
  });
}

/** The contract's enforced facts from its parsed JSON; throws on anything unusable. */
export function parsePrivacyContract(data: unknown): PrivacyContract {
  if (!isObject(data)) {
    throw new Error('the privacy contract must be a JSON object');
  }
  const profile = profileOf(data['profile']);
  const networkModules = stringList(data['networkModules'], 'networkModules');
  if (profile === OFFLINE_ONLY && networkModules.length > 0) {
    throw new Error('the offline-only profile allows no networkModules');
  }
  return {
    profile,
    networkModules,
    linkFiles: stringList(data['linkFiles'], 'linkFiles'),
    sdks: sdksOf(data['sdks'] ?? {}),
  };
}

/** Where the contract lives: rn-skills.config.json "privacyContract", else contracts/privacy.json. */
export function contractFileOf(root: string): string {
  const configFile = path.join(root, PROJECT_CONFIG_FILE);
  if (!existsSync(configFile)) {
    return path.join(root, DEFAULT_CONTRACT_FILE);
  }
  const config = JSON.parse(readFileSync(configFile, 'utf8')) as unknown;
  const given = isObject(config) ? config['privacyContract'] : undefined;
  return path.join(root, typeof given === 'string' ? given : DEFAULT_CONTRACT_FILE);
}

/** The app's privacy contract; a missing or broken file throws (an audit never passes without it). */
export function readPrivacyContract(root: string): PrivacyContract {
  const file = contractFileOf(root);
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: copy the privacy-and-store-declarations template`);
  }
  return parsePrivacyContract(JSON.parse(readFileSync(file, 'utf8')) as unknown);
}

/** First-party files that may open a connection: the ApiClient folder and networkModules (api-port only). */
export function networkSeams(contract: PrivacyContract, apiDir = 'src/api'): readonly string[] {
  return contract.profile === OFFLINE_ONLY ? [] : [`${apiDir}/**`, ...contract.networkModules];
}

/**
 * First-party files that may hold a remote URL literal: the config folder (api-port: the base URL
 * from EXPO_PUBLIC_API_URL, links) and linkFiles. Never src/api: endpoints are paths on that base.
 */
export function urlSeams(contract: PrivacyContract, configDir = 'src/config'): string[] {
  const own = contract.profile === OFFLINE_ONLY ? [] : [`${configDir}/**`];
  return [...own, ...contract.linkFiles];
}

/** The npm packages contracts/privacy.json declares as SDKs: their network findings need no baseline entry. */
export function declaredSdkNames(contract: PrivacyContract): ReadonlySet<string> {
  return new Set(contract.sdks.map((sdk) => sdk.name));
}

/** Every trunk pod a declared SDK brings. */
export function declaredPods(contract: PrivacyContract): ReadonlySet<string> {
  return new Set(contract.sdks.flatMap((sdk) => sdk.pods));
}

/** The pods allowed to declare tracking in their privacy manifests: those of tracking SDKs. */
export function trackingPods(contract: PrivacyContract): ReadonlySet<string> {
  return new Set(contract.sdks.filter((sdk) => sdk.isTracking).flatMap((sdk) => sdk.pods));
}

/** True when a repo-relative path matches one of the globs ('src/api/**', 'src/config/links.ts'). */
export function matchesAnyGlob(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => path.posix.matchesGlob(file, glob));
}
