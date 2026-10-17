// scripts/analytics/analytics-manifest.ts
// The store declarations of analytics, from one source: contracts/analytics.json `collects`.
// app.config.ts puts collectedDataTypes() into ios.privacyManifests.NSPrivacyCollectedDataTypes
// (a JavaScript analytics SDK ships no native privacy manifest, so the app's own manifest declares
// what it collects), and dataSafetyRows() is what the developer enters in Google Play's Data safety
// form. Node tooling: app.config.ts runs it with type stripping, so only erasable syntax is used.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The data types analytics may collect (contracts/analytics.json `collects[].dataType`). The Play
 * labels are privacy-and-store-declarations' (it owns the store answers); diagnostics (crash,
 * performance) are not product analytics: crash reporting declares them.
 */
export const DATA_TYPES = {
  'product-interaction': {
    apple: 'NSPrivacyCollectedDataTypeProductInteraction',
    play: 'App activity > App interactions',
  },
  'other-usage-data': {
    apple: 'NSPrivacyCollectedDataTypeOtherUsageData',
    play: 'App activity > Other actions',
  },
  'search-history': {
    apple: 'NSPrivacyCollectedDataTypeSearchHistory',
    play: 'App activity > In-app search history',
  },
  'device-id': {
    apple: 'NSPrivacyCollectedDataTypeDeviceID',
    play: 'Device or other IDs > Device or other IDs',
  },
  'user-id': { apple: 'NSPrivacyCollectedDataTypeUserID', play: 'Personal info > User IDs' },
  'coarse-location': {
    apple: 'NSPrivacyCollectedDataTypeCoarseLocation',
    play: 'Location > Approximate location',
  },
} as const;

/** Why the data is collected (`collects[].purposes`). */
export const PURPOSES = {
  analytics: { apple: 'NSPrivacyCollectedDataTypePurposeAnalytics', play: 'Analytics' },
  'app-functionality': {
    apple: 'NSPrivacyCollectedDataTypePurposeAppFunctionality',
    play: 'App functionality',
  },
  'product-personalization': {
    apple: 'NSPrivacyCollectedDataTypePurposeProductPersonalization',
    play: 'Personalization',
  },
  'developer-advertising': {
    apple: 'NSPrivacyCollectedDataTypePurposeDeveloperAdvertising',
    play: 'Advertising or marketing',
  },
  'third-party-advertising': {
    apple: 'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
    play: 'Advertising or marketing',
  },
} as const;

export type DataTypeId = keyof typeof DATA_TYPES;
export type PurposeId = keyof typeof PURPOSES;

/** One `collects` entry of contracts/analytics.json. */
export type CollectedData = {
  readonly dataType: DataTypeId;
  readonly linked: boolean;
  readonly tracking: boolean;
  readonly purposes: readonly PurposeId[];
};

/** One NSPrivacyCollectedDataTypes entry, exactly the keys Expo's ios.privacyManifests takes. */
export type AppleCollectedDataType = {
  NSPrivacyCollectedDataType: string;
  NSPrivacyCollectedDataTypeLinked: boolean;
  NSPrivacyCollectedDataTypeTracking: boolean;
  NSPrivacyCollectedDataTypePurposes: string[];
};

/** One row of Google Play's Data safety form. */
export type DataSafetyRow = {
  readonly dataType: string;
  readonly collected: true;
  /** Analytics runs only after an opt-in, so collection is optional for every user. */
  readonly optional: true;
  readonly purposes: readonly string[];
};

function isDataType(value: unknown): value is DataTypeId {
  return typeof value === 'string' && Object.hasOwn(DATA_TYPES, value);
}

function isPurpose(value: unknown): value is PurposeId {
  return typeof value === 'string' && Object.hasOwn(PURPOSES, value);
}

function parseEntry(entry: unknown, index: number): CollectedData {
  const where = `contracts/analytics.json collects[${String(index)}]`;
  if (typeof entry !== 'object' || entry === null) throw new Error(`${where} is not an object`);
  const { dataType, linked, tracking, purposes } = entry as Record<string, unknown>;
  if (!isDataType(dataType)) throw new Error(`${where}.dataType is not a known data type`);
  if (typeof linked !== 'boolean' || typeof tracking !== 'boolean') {
    throw new Error(`${where} needs linked and tracking booleans`);
  }
  if (!Array.isArray(purposes) || purposes.length === 0 || !purposes.every(isPurpose)) {
    throw new Error(`${where}.purposes needs at least one known purpose`);
  }
  return { dataType, linked, tracking, purposes };
}

/** Validates the `collects` list of a parsed contract. */
export function parseCollects(contract: unknown): readonly CollectedData[] {
  const collects = (contract as { readonly collects?: unknown } | null)?.collects;
  if (!Array.isArray(collects)) throw new Error('contracts/analytics.json needs a collects list');
  return collects.map((entry, index) => parseEntry(entry, index));
}

/** The Apple privacy-manifest entries for `collects`. */
export function collectedDataTypes(collects: readonly CollectedData[]): AppleCollectedDataType[] {
  return collects.map((entry) => ({
    NSPrivacyCollectedDataType: DATA_TYPES[entry.dataType].apple,
    NSPrivacyCollectedDataTypeLinked: entry.linked,
    NSPrivacyCollectedDataTypeTracking: entry.tracking,
    NSPrivacyCollectedDataTypePurposes: entry.purposes.map((purpose) => PURPOSES[purpose].apple),
  }));
}

/** The Data safety rows for `collects`. */
export function dataSafetyRows(collects: readonly CollectedData[]): DataSafetyRow[] {
  return collects.map((entry) => ({
    dataType: DATA_TYPES[entry.dataType].play,
    collected: true,
    optional: true,
    purposes: [...new Set(entry.purposes.map((purpose) => PURPOSES[purpose].play))],
  }));
}

/** app.config.ts: the NSPrivacyCollectedDataTypes of contracts/analytics.json. */
export function analyticsCollectedDataTypes(projectRoot: string): AppleCollectedDataType[] {
  const text = readFileSync(join(projectRoot, 'contracts', 'analytics.json'), 'utf8');
  return collectedDataTypes(parseCollects(JSON.parse(text)));
}
