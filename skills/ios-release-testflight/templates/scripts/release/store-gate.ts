// scripts/release/store-gate.ts
// The store-artifact gate as a pure function: facts read from the exported .ipa in, problems out.
// It is the only check that proves what testers and users receive: the right identity and variant,
// no test-only code or StoreKit test files, no debug entitlement, no placeholder value, the usage
// strings in every language. It runs before --validate-app; the ios-release-testflight skill's
// check-store-artifact.mjs checks the same .ipa independently.
import type { ReleaseVariant } from './release-options.ts';

const GOOGLE_SAMPLE_PUBLISHER = 'ca-app-pub-3940256099942544';
/** Google's sample AdMob app id for iOS: the only id testing builds and ads-off builds carry. */
export const SAMPLE_IOS_APP_ID = `${GOOGLE_SAMPLE_PUBLISHER}~1458002511`;
const ADMOB_APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const SAMPLE_PATTERN = /^ca-app-pub-3940256099942544[~/]/;
const PLACEHOLDER_TESTS: readonly (readonly [RegExp, string])[] = [
  [/^com\.example(\.|$)/i, 'the template bundle id (com.example.*)'],
  [SAMPLE_PATTERN, "Google's sample AdMob id"],
  [/^ca-app-pub-0{16}[~/]/, 'a template AdMob id (all-zero publisher)'],
  [/^[^@\s]+@(?:[\w-]+\.)*example\.(?:com|org|net)$/i, 'a placeholder email address'],
  [/^(?:https?:\/\/)?(?:[\w-]+\.)*example\.(?:com|org|net)(?:[/:?#]|$)/i, 'a placeholder domain'],
];
const TEMPLATE_TOKEN = /__[A-Z][A-Z0-9_]*__/;

export type ArtifactFacts = {
  readonly info: Readonly<Record<string, unknown>>;
  /** EXConstants.bundle/app.config, or null when the bundle has none. */
  readonly appConfig: Readonly<Record<string, unknown>> | null;
  /** Every string value of Info.plist and app.config, with its dotted path. */
  readonly strings: readonly { readonly where: string; readonly value: string }[];
  /** How often each sentinel and forbidden string occurs in main.jsbundle (null: no bundle). */
  readonly bundleCounts: Readonly<Record<string, number>> | null;
  readonly testArtefacts: readonly string[];
  readonly hasPrivacyManifest: boolean;
  /** null: the app has no signature; else whether its entitlements grant get-task-allow. */
  readonly getTaskAllow: boolean | null;
  /** '<place> lacks <key>' for every required usage string missing in Info.plist or a language. */
  readonly missingUsageStrings: readonly string[];
};

export type GateExpectation = {
  readonly variant: ReleaseVariant;
  /** The ads mode of the build, or null when the app has no ads SDK. */
  readonly adsMode: string | null;
  readonly version: string;
  readonly buildNumber: number;
  readonly bundleId: string;
  /** DTXcode of the pinned Xcode ('2660' for 26.6). */
  readonly xcodeBuild: string;
  readonly sentinels: readonly string[];
  readonly forbiddenStrings: readonly string[];
  readonly usesNonExemptEncryption: boolean | null;
};

function text(value: unknown): string {
  if (value === undefined || value === null) return 'missing';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function field(record: unknown, key: string): unknown {
  return typeof record === 'object' && record !== null ? Reflect.get(record, key) : undefined;
}

function identityProblems(facts: ArtifactFacts, want: GateExpectation): string[] {
  const { info } = facts;
  return [
    info['CFBundleShortVersionString'] === want.version
      ? ''
      : `CFBundleShortVersionString is ${text(info['CFBundleShortVersionString'])}, not ${want.version}`,
    text(info['CFBundleVersion']) === String(want.buildNumber)
      ? ''
      : `CFBundleVersion is ${text(info['CFBundleVersion'])}, not the new build number ${String(want.buildNumber)}`,
    text(info['DTXcode']) === want.xcodeBuild
      ? ''
      : `DTXcode is ${text(info['DTXcode'])}, not ${want.xcodeBuild} (the pinned Xcode)`,
    info['DTPlatformName'] === 'iphoneos'
      ? ''
      : `DTPlatformName is ${text(info['DTPlatformName'])}: not a device build`,
    info['CFBundleIdentifier'] === want.bundleId
      ? ''
      : `CFBundleIdentifier is ${text(info['CFBundleIdentifier'])}, not ${want.bundleId}`,
  ];
}

function constantsProblems(facts: ArtifactFacts, want: GateExpectation): string[] {
  if (facts.appConfig === null) return ['EXConstants.bundle/app.config is missing'];
  const extra = field(facts.appConfig, 'extra');
  const configId = field(field(facts.appConfig, 'ios'), 'bundleIdentifier');
  const variant = field(extra, 'appVariant');
  const ads = field(extra, 'adsMode');
  return [
    configId === undefined || configId === facts.info['CFBundleIdentifier']
      ? ''
      : `app.config ios.bundleIdentifier ${text(configId)} differs from Info.plist: the variant changed between prebuild and archive`,
    variant === undefined || variant === want.variant
      ? ''
      : `extra.appVariant is ${text(variant)}, not ${want.variant}`,
    ads === undefined || want.adsMode === null || ads === want.adsMode
      ? ''
      : `extra.adsMode is ${text(ads)}, not ${want.adsMode}`,
  ];
}

function adAppIdProblem(facts: ArtifactFacts, want: GateExpectation): string {
  if (want.adsMode === null) return '';
  const id = text(facts.info['GADApplicationIdentifier']);
  if (want.adsMode !== 'live')
    return id === SAMPLE_IOS_APP_ID
      ? ''
      : `GADApplicationIdentifier is ${id}, not Google's sample app id`;
  return ADMOB_APP_ID.test(id) ? '' : `GADApplicationIdentifier is ${id}, not an AdMob app id`;
}

/**
 * Production: no placeholder value anywhere; every build: no unfilled template token. Google's
 * sample AdMob ids are right in a build without live ads (the SDK needs an app id, and config plugin
 * options embed it in app.config), so they count only when the ads are live.
 */
export function placeholderProblems(facts: ArtifactFacts, want: GateExpectation): string[] {
  return facts.strings.flatMap(({ where, value }) => {
    if (TEMPLATE_TOKEN.test(value))
      return [`[ship-placeholder] ${where} is an unfilled template token: ${value}`];
    if (want.variant !== 'production') return [];
    const hit = PLACEHOLDER_TESTS.find(([pattern]) => pattern.test(value.trim()));
    if (hit === undefined || (hit[0] === SAMPLE_PATTERN && want.adsMode !== 'live')) return [];
    return [`[ship-placeholder] ${where} is ${hit[1]}: ${value}`];
  });
}

function bundleProblems(facts: ArtifactFacts, want: GateExpectation): string[] {
  const counts = facts.bundleCounts;
  if (counts === null) return ['main.jsbundle is missing (a Release archive embeds it)'];
  const sentinel = want.sentinels.map((name) => {
    const count = counts[name] ?? 0;
    if (want.variant === 'production')
      return count === 0
        ? ''
        : `main.jsbundle contains the test-only sentinel ${name} ${String(count)} time(s)`;
    return count > 0
      ? ''
      : `main.jsbundle lacks the test-only sentinel ${name}: bundled as production`;
  });
  const forbidden = want.forbiddenStrings.map((name) =>
    (counts[name] ?? 0) === 0
      ? ''
      : `main.jsbundle contains the forbidden string ${name}: unfinished work`,
  );
  return [...sentinel, ...forbidden];
}

function plistProblems(facts: ArtifactFacts): string[] {
  const ats = field(facts.info['NSAppTransportSecurity'], 'NSAllowsArbitraryLoads');
  const bonjour = facts.info['NSBonjourServices'];
  const localNetwork = text(facts.info['NSLocalNetworkUsageDescription'] ?? '');
  return [
    facts.hasPrivacyManifest ? '' : 'PrivacyInfo.xcprivacy is missing',
    ats === true ? 'NSAllowsArbitraryLoads is true' : '',
    Array.isArray(bonjour) && bonjour.includes('_expo._tcp')
      ? 'NSBonjourServices holds _expo._tcp: a dev-client key in a Release archive'
      : '',
    localNetwork.includes('Expo Dev Launcher')
      ? 'NSLocalNetworkUsageDescription is the dev launcher text: a dev-client key in a Release archive'
      : '',
    ...facts.missingUsageStrings,
  ];
}

function productionProblems(facts: ArtifactFacts, want: GateExpectation): string[] {
  if (want.variant !== 'production') return [];
  const flag = facts.info['ITSAppUsesNonExemptEncryption'];
  return [
    typeof flag === 'boolean' ? '' : 'ITSAppUsesNonExemptEncryption is not set',
    typeof flag === 'boolean' &&
    want.usesNonExemptEncryption !== null &&
    flag !== want.usesNonExemptEncryption
      ? `ITSAppUsesNonExemptEncryption is ${String(flag)}, the contract says ${String(want.usesNonExemptEncryption)}`
      : '',
    ...facts.testArtefacts.map((path) => `test artefact shipped: ${path}`),
  ];
}

/** Every problem of the exported build; the release stops on any of them before --validate-app. */
export function storeGateProblems(facts: ArtifactFacts, want: GateExpectation): string[] {
  return [
    ...identityProblems(facts, want),
    ...constantsProblems(facts, want),
    facts.getTaskAllow === false
      ? ''
      : 'the app is unsigned or its entitlements grant get-task-allow (a debug entitlement)',
    adAppIdProblem(facts, want),
    ...placeholderProblems(facts, want),
    ...bundleProblems(facts, want),
    ...plistProblems(facts),
    ...productionProblems(facts, want),
  ].filter((problem) => problem !== '');
}
