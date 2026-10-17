#!/usr/bin/env node
// audit-app-bundle.mjs: the privacy half of the release audit, on what users actually receive: a
// built iOS .app (unzip the .ipa and pass Payload/<App>.app) and/or the merged Android manifest of
// the release build. Checks the shipped privacy manifest, App Transport Security and cleartext,
// the development launcher's local-network keys, the tracking text against the declared tracking,
// a store answer for every permission the binary asks for, and (production) placeholder values.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/audit-app-bundle.mjs [repo-root] --app <App.app> [--android-manifest <xml>]

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createReporter, fail, maskComments, parseArgs, requireDir, requireFile, resolveLayout, run } from './check-lib.mjs';
import { readPlist } from './lib/plist.mjs';
import { placeholderProblem, placeholdersIn } from './lib/ship-placeholders.mjs';
import { ATT_KEY, usageStringProblems } from './lib/usage-strings.mjs';
import { contractPath, declaresTracking, FACTS, readContract } from './lib/privacy-scan.mjs';

const SPEC = {
  name: 'audit-app-bundle',
  summary: 'Audits a built app for privacy: the shipped iOS privacy manifest, ATS and Android cleartext, local-network keys, the tracking text against the declared tracking, a store answer for every permission the binary asks for, and placeholder values in production.',
  usage: '[repo-root] (--app <App.app> | --android-manifest <file>)... [--variant production|preview|development] [--contract <file>] [--json]',
  options: {
    app: { type: 'string', value: 'dir', help: 'The built .app (Payload/<App>.app of an unzipped .ipa, or a simulator build)' },
    'android-manifest': { type: 'string', value: 'file', help: 'The merged AndroidManifest.xml of the release build (apkanalyzer manifest print <apk|aab>, or the merged_manifests output of Gradle)' },
    variant: { type: 'string', default: 'production', value: 'variant', help: 'The APP_VARIANT the build was made with' },
    contract: { type: 'string', value: 'file', help: 'Privacy contract, relative to repo-root (default: rn-skills.config.json "privacyContract", else contracts/privacy.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (iOS): privacy-manifest-file, built-manifest, ats, local-network, att-string, permission-answer, ship-placeholder.',
    'Rules (Android): android-cleartext, android-ad-id, permission-answer.',
    'android-ad-id: com.google.android.gms.permission.AD_ID in the release manifest needs an SDK marked "tracking": true or a',
    '  device-id row whose purposes include third-party-advertising, developer-advertising or analytics; Play Console also',
    '  asks its own Advertising ID question (references/release-audit.md).',
    'Rules (both): contract.',
    'att-string: when contracts/privacy.json declares tracking, NSUserTrackingUsageDescription is in Info.plist and in every',
    '  app language (.lproj); when it declares none, the binary carries no tracking text (a child-directed app asks no ATT).',
    'local-network (production): no _expo._tcp Bonjour service and no Expo Dev Launcher purpose text: the dev launcher',
    '  plugin strips both from Release builds, so their presence means a Debug build or a removed build phase.',
    'permission-answer: every purpose string (iOS) and runtime permission (Android) the binary carries maps to a permission',
    '  kind that contracts/privacy.json "permissionAnswers" answers (tracking is answered by the declared tracking).',
    'Signing, entitlements, StoreKit artefacts, variant and app-id checks belong to the release gates',
    '  (ios-release-testflight, android-release-play) and ios-simulator-build.',
  ].join('\n'),
};

const KIND_OF_KEY = new Map(Object.entries(FACTS.permissionKinds).flatMap(([kind, entry]) => entry.ios.map((key) => [key, kind])));
const KIND_OF_PERMISSION = new Map(Object.entries(FACTS.permissionKinds).flatMap(([kind, entry]) => entry.android.map((name) => [name, kind])));

function answered(contract, kind, key) {
  return contract.permissionAnswers[kind] !== undefined || contract.permissionAnswers[key] !== undefined;
}

function iosChecks(ctx, appDir) {
  const { report, contract, isProduction } = ctx;
  const info = readPlist(requireFile(join(appDir, 'Info.plist'), 'Info.plist of the app'));
  const manifestPath = join(appDir, 'PrivacyInfo.xcprivacy');
  if (!existsSync(manifestPath)) report.problem({ file: 'PrivacyInfo.xcprivacy', rule: 'privacy-manifest-file', message: 'missing from the app', fix: 'Set ios.privacyManifests: PRIVACY_MANIFESTS in app.config.ts; prebuild writes the file and Xcode copies it into the app.' });
  else {
    const manifest = readPlist(manifestPath);
    if (manifest?.NSPrivacyTracking === true || (manifest?.NSPrivacyTrackingDomains ?? []).length > 0) report.problem({ file: 'PrivacyInfo.xcprivacy', rule: 'built-manifest', message: 'the shipped manifest declares tracking or tracking domains', fix: "The app's own code tracks nothing; iOS blocks listed domains for everyone who declines App Tracking Transparency. Fix PRIVACY_MANIFESTS and rebuild." });
    const shipped = new Set((manifest?.NSPrivacyAccessedAPITypes ?? []).flatMap((api) => (api.NSPrivacyAccessedAPITypeReasons ?? []).map((reason) => `${api.NSPrivacyAccessedAPIType} ${reason}`)));
    for (const needed of ctx.declaredReasons) if (!shipped.has(needed)) report.problem({ file: 'PrivacyInfo.xcprivacy', rule: 'built-manifest', message: `the shipped manifest lacks ${needed}, which ${ctx.manifestRel} declares`, fix: 'The build is older than the declared manifest: prebuild with --clean and build again.' });
  }
  const ats = info.NSAppTransportSecurity ?? {};
  if (ats.NSAllowsArbitraryLoads === true) report.problem({ file: 'Info.plist', rule: 'ats', message: 'NSAllowsArbitraryLoads is true', fix: 'Remove the App Transport Security exception (prebuild writes NSAllowsArbitraryLoads false and NSAllowsLocalNetworking true); App Review asks for a reason and every request may go out in cleartext.' });
  for (const [domain, rules] of Object.entries(ats.NSExceptionDomains ?? {})) if (rules?.NSExceptionAllowsInsecureHTTPLoads === true && !/^(localhost|127\.0\.0\.1)$/.test(domain)) report.problem({ file: 'Info.plist', rule: 'ats', message: `NSExceptionDomains allows cleartext HTTP to ${domain}`, fix: 'Serve that host over HTTPS; release builds never carry a cleartext exception.' });
  if (isProduction) {
    const bonjour = Array.isArray(info.NSBonjourServices) ? info.NSBonjourServices : [];
    if (bonjour.includes('_expo._tcp') || String(info.NSLocalNetworkUsageDescription ?? '').includes('Expo Dev Launcher')) report.problem({ file: 'Info.plist', rule: 'local-network', message: 'carries the development launcher\'s local-network keys (_expo._tcp or its purpose text)', fix: 'The expo-dev-client plugin strips them from Release builds: build the Release configuration and keep the plugin\'s "Strip Local Network Keys for Release" build phase.' });
  }
  const tracks = declaresTracking(contract);
  if (tracks) for (const found of usageStringProblems(appDir, info, { keys: [ATT_KEY], readPlist })) report.problem({ file: found.file, rule: 'att-string', message: found.message, fix: 'The tracking prompt text comes from one catalog key through the expo-tracking-transparency plugin and app.config.ts locales (admob-ads-and-consent); prebuild with --clean.' });
  if (!tracks && typeof info[ATT_KEY] === 'string') report.problem({ file: 'Info.plist', rule: 'att-string', message: `${ATT_KEY} is present, but contracts/privacy.json declares no tracking`, fix: 'Either an SDK tracks (declare it with "tracking": true and its data) or the app asks no tracking permission: remove expo-tracking-transparency and its text (a child-directed app never carries it).' });
  for (const key of Object.keys(info).filter((name) => /^NS\w+UsageDescription$/.test(name) && name !== ATT_KEY)) {
    const kind = KIND_OF_KEY.get(key) ?? key;
    const isDevLauncherText = String(info[key]).includes('Expo Dev Launcher');
    if (!answered(contract, kind, key) && !isDevLauncherText) report.problem({ file: 'Info.plist', rule: 'permission-answer', message: `${key} is in the app, but contracts/privacy.json answers no "${kind}"`, fix: `Answer it in permissionAnswers ("not-collected: <why>" or "collected: <type>"), or remove the purpose string and the permission it serves (expo-prebuild-and-config-plugins).` });
  }
  if (isProduction) placeholderChecks(report, info, appDir);
}

function placeholderChecks(report, info, appDir) {
  if (typeof info.GADApplicationIdentifier === 'string') for (const entry of placeholdersIn(info.GADApplicationIdentifier)) report.problem(placeholderProblem({ entry, value: info.GADApplicationIdentifier, where: 'Info.plist GADApplicationIdentifier', file: 'Info.plist' }));
  const configPath = join(appDir, 'EXConstants.bundle', 'app.config');
  if (!existsSync(configPath)) return;
  let extra = {};
  try {
    extra = JSON.parse(readFileSync(configPath, 'utf8')).extra ?? {};
  } catch {
    return;
  }
  const visit = (value, where) => {
    if (typeof value === 'string') for (const entry of placeholdersIn(value)) report.problem(placeholderProblem({ entry, value, where, file: 'EXConstants.bundle/app.config' }));
    else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, `${where}.${key}`);
  };
  visit(extra, 'extra');
}

function androidChecks(ctx, file) {
  const { report, contract, isProduction } = ctx;
  const xml = readFileSync(requireFile(file, 'merged Android manifest (--android-manifest)'), 'utf8').replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const rel = ctx.androidRel;
  const lineAt = (index) => xml.slice(0, index).split('\n').length;
  const app = /<application\b[^>]*>/.exec(xml);
  if (isProduction && app && /android:usesCleartextTraffic\s*=\s*"true"/.test(app[0])) report.problem({ file: rel, line: lineAt(app.index), rule: 'android-cleartext', message: 'the release manifest sets android:usesCleartextTraffic="true"', fix: 'Only the debug manifests of the prebuild template allow cleartext (Metro); remove it from release (app.config.ts or expo-build-properties) and use HTTPS.' });
  for (const match of xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name\s*=\s*"([^"]+)"[^>]*>/g)) {
    const name = match[1];
    // A source manifest may still carry blockedPermissions as tools:node="remove"; the merge drops them.
    if (/tools:node\s*=\s*"remove"/.test(match[0])) continue;
    const kind = KIND_OF_PERMISSION.get(name);
    if (kind === undefined) continue;
    if (kind === 'tracking') {
      if (!answersAdvertisingId(contract)) report.problem({ file: rel, line: lineAt(match.index), rule: 'android-ad-id', message: `${name} is merged into the release manifest, but contracts/privacy.json declares no tracking SDK and no device-id row for advertising or analytics (a push token or other app-functionality device ID is not the advertising ID)`, fix: 'Declare the advertising ID the ads SDK collects (Data safety: Device or other IDs, for advertising or analytics; Play Console > App content > Advertising ID: yes), or block the permission (android.blockedPermissions in app.config.ts; a child-directed app must).' });
      continue;
    }
    if (!answered(contract, kind, name)) report.problem({ file: rel, line: lineAt(match.index), rule: 'permission-answer', message: `${name} is in the release manifest, but contracts/privacy.json answers no "${kind}"`, fix: `Answer it in permissionAnswers, or remove it from the build with android.blockedPermissions in app.config.ts when the app never asks for it (libraries and the prebuild template merge permissions on their own).` });
  }
}

const AD_ID_PURPOSES = new Set(['third-party-advertising', 'developer-advertising', 'analytics']);

/** AD_ID is the advertising ID: answered by a tracking SDK or a device-id row used for advertising or analytics. */
function answersAdvertisingId(contract) {
  if (Object.values(contract.sdks).some((sdk) => sdk.tracking === true)) return true;
  return [...Object.values(contract.sdks).flatMap((sdk) => sdk.collects), ...contract.app.collects].some((row) => row.type === 'device-id' && row.purposes.some((purpose) => AD_ID_PURPOSES.has(purpose)));
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (!options.app && !options['android-manifest']) fail('nothing to audit: pass --app <App.app>, --android-manifest <file>, or both', 'Unzip the .ipa and pass Payload/<App>.app; for Android pass the merged release manifest (apkanalyzer manifest print app-release.aab > merged.xml).');
  if (!['production', 'preview', 'development'].includes(options.variant)) fail(`--variant ${options.variant} is not production, preview or development`, 'Pass the APP_VARIANT the build was made with.');
  const root = requireDir(positionals[0] ?? '.', 'repo root (it holds contracts/privacy.json)');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'audit-app-bundle', json: options.json });
  const contractRel = contractPath(layout, options.contract);
  const contractRead = readContract(root, contractRel);
  for (const problem of contractRead.problems) report.problem({ file: contractRel, rule: 'contract', message: problem.message, fix: problem.fix });
  const contract = contractRead.contract ?? { sdks: {}, app: { collects: [] }, permissionAnswers: {} };
  const manifestRel = `${layout.configDir}/privacy-manifest.ts`;
  const declaredReasons = existsSync(join(root, manifestRel)) ? [...maskComments(readFileSync(join(root, manifestRel), 'utf8')).matchAll(/NSPrivacyAccessedAPIType\s*:\s*['"]([^'"]+)['"]\s*,\s*NSPrivacyAccessedAPITypeReasons\s*:\s*\[([^\]]*)\]/g)].flatMap((match) => [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((reason) => `${match[1]} ${reason[1]}`)) : [];
  const ctx = { report, contract, isProduction: options.variant === 'production', declaredReasons, manifestRel, androidRel: options['android-manifest'] };
  let checked = 0;
  if (options.app) {
    iosChecks(ctx, requireDir(resolve(options.app), '.app folder'));
    checked += 1;
  }
  if (options['android-manifest']) {
    androidChecks(ctx, resolve(options['android-manifest']));
    checked += 1;
  }
  return report.finish({ checked, unit: 'artefacts' });
});
