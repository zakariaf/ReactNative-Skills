// scripts/deep-links/link-native-config.ts
// The native half of verified links, for app.config.ts (Node, type stripping): iOS
// ios.associatedDomains ('applinks:<host>', no scheme, no path, no port) and one Android App Links
// intent filter (autoVerify, VIEW, BROWSABLE + DEFAULT, http and https, the hosts, a pathPattern per
// web path) for the variant's hosts in contracts/deep-links.json. One contract feeds this file, the
// gate (through the embedded config) and the well-known files, so the three never disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppVariant } from '../../src/config/app-variant.ts';

/** The repo-relative contract this file reads. */
export const LINK_CONTRACT = 'contracts/deep-links.json';

/** What app.config.ts needs from the contract. */
export type LinkContract = {
  /** Verified hosts per variant: 'tasks.example.com' or '*.example.com'. */
  readonly hosts: Readonly<Record<AppVariant, readonly string[]>>;
  /** Web paths that open the app: '/tasks/*', '/verify-email'. */
  readonly webPaths: readonly string[];
};

type IntentFilterData = {
  readonly scheme?: string;
  readonly host?: string;
  readonly pathPattern?: string;
};

/**
 * The Expo config fields this file fills (ExpoConfig's ios.associatedDomains, android.intentFilters).
 * `associatedDomains` is absent for a variant without hosts: prebuild writes the entitlement for any
 * array, an empty one too, and an Associated Domains entitlement the provisioning profile lacks breaks
 * signing (or makes EAS turn the capability on for an App ID without a domain).
 */
export type LinkNativeConfig = {
  readonly associatedDomains?: string[];
  readonly intentFilters: {
    action: 'VIEW';
    autoVerify: true;
    category: ['BROWSABLE', 'DEFAULT'];
    data: IntentFilterData[];
  }[];
};

/** '/tasks/*' -> '/tasks/.*' (Android pathPattern); web paths hold only [a-z0-9-/] and a final '*'. */
export function toPathPattern(webPath: string): string {
  return webPath.endsWith('*') ? `${webPath.slice(0, -1)}.*` : webPath;
}

/** The native link config of one variant; no hosts means no verified links and no entitlement key. */
export function linkNativeConfig(contract: LinkContract, variant: AppVariant): LinkNativeConfig {
  const hosts = contract.hosts[variant];
  if (hosts.length === 0) return { intentFilters: [] };
  const data: IntentFilterData[] = [
    { scheme: 'https' },
    { scheme: 'http' },
    ...hosts.map((host) => ({ host })),
    ...contract.webPaths.map((webPath) => ({ pathPattern: toPathPattern(webPath) })),
  ];
  return {
    associatedDomains: hosts.map((host) => `applinks:${host}`),
    intentFilters: [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'], data }],
  };
}

/** Reads contracts/deep-links.json of the app at `projectRoot`. */
export function readLinkContract(projectRoot: string): LinkContract {
  const parsed: unknown = JSON.parse(readFileSync(join(projectRoot, LINK_CONTRACT), 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('hosts' in parsed) ||
    !('webPaths' in parsed)
  ) {
    throw new Error(`${LINK_CONTRACT}: "hosts" and "webPaths" are required`);
  }
  return parsed as LinkContract;
}
