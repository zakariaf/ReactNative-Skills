#!/usr/bin/env node
// audit-privacy-manifest.mjs: after `npx expo prebuild --platform ios`, reads the PrivacyInfo.xcprivacy
// of every pod CocoaPods puts into the app (trunk pods under ios/Pods, development pods from their own
// folder) and checks the app's declared manifest and contracts/privacy.json against them: every
// required-reason API declared, no tracking by the app, tracking only by declared tracking SDKs, the
// data each pod collects declared with the same linked and tracking answers, and the prebuilt
// manifest current. Prints the App Privacy input.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/audit-privacy-manifest.mjs [repo-root]

import { existsSync, globSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { createReporter, fail, maskComments, parseArgs, requireDir, resolveLayout, run, toPosix, walk } from './check-lib.mjs';
import { readPlist } from './lib/plist.mjs';
import { contractPath, DATA_TYPES, readContract } from './lib/privacy-scan.mjs';

const SPEC = {
  name: 'audit-privacy-manifest',
  summary: "Checks the app's iOS privacy manifest and contracts/privacy.json against every pod's PrivacyInfo.xcprivacy after a prebuild: required-reason APIs, tracking, collected data and a current prebuilt manifest. Prints the App Privacy input.",
  usage: '[repo-root] [--ios <dir>] [--manifest <file>] [--contract <file>] [--json]',
  options: {
    ios: { type: 'string', value: 'dir', help: 'The prebuilt ios folder (default: <repo-root>/ios)' },
    manifest: { type: 'string', value: 'file', help: 'Declared manifest module (default: <configDir>/privacy-manifest.ts)' },
    contract: { type: 'string', value: 'file', help: 'Privacy contract (default: rn-skills.config.json "privacyContract", else contracts/privacy.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: missing-reason, app-tracking, tracking-outside-declared, undeclared-collection, unreadable-manifest,',
    '  prebuilt-stale, contract.',
    'tracking-outside-declared: a pod sets NSPrivacyTracking, lists NSPrivacyTrackingDomains or collects a data type with',
    '  NSPrivacyCollectedDataTypeTracking true, and no SDK marked "tracking": true lists it in "pods".',
    'undeclared-collection: a pod collects a data type (NSPrivacyCollectedDataTypes) that the SDK bringing it does not',
    '  declare in contracts/privacy.json "collects" with the same linked and tracking answers and every purpose the',
    '  pod names (mapped through assets/data-types.json nsPurpose), or no declared SDK brings the pod: the App Privacy',
    '  answers would understate what the app collects. One line per pod and data type.',
    'Needs a prebuild (npx expo prebuild --platform ios --clean runs pod install); binary plists are read without plutil.',
  ].join('\n'),
};

const NS_TO_ID = new Map(Object.entries(DATA_TYPES.types).map(([id, entry]) => [entry.nsType, id]));

/** category -> Set(reasons), NSPrivacyTracking and whether tracking domains are listed, from privacy-manifest.ts. */
function declaredManifest(text) {
  const body = maskComments(text);
  const declared = new Map();
  for (const match of body.matchAll(/NSPrivacyAccessedAPIType\s*:\s*['"]([^'"]+)['"]\s*,\s*NSPrivacyAccessedAPITypeReasons\s*:\s*\[([^\]]*)\]/g)) {
    declared.set(match[1], new Set([...(declared.get(match[1]) ?? []), ...[...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])]));
  }
  const tracking = /NSPrivacyTracking\s*:\s*(true|false)/.exec(body)?.[1] ?? null;
  const domains = /NSPrivacyTrackingDomains\s*:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '';
  return { declared, tracking, hasDomains: /['"`]/.test(domains) };
}

function mergeInto(target, manifest) {
  for (const api of manifest?.NSPrivacyAccessedAPITypes ?? []) {
    const set = target.get(api.NSPrivacyAccessedAPIType) ?? new Set();
    for (const reason of api.NSPrivacyAccessedAPITypeReasons ?? []) set.add(reason);
    target.set(api.NSPrivacyAccessedAPIType, set);
  }
}

function externalSources(lock) {
  const section = lock.split('\nEXTERNAL SOURCES:\n')[1]?.split('\n\n')[0] ?? '';
  const sources = new Map();
  let current = null;
  for (const line of section.split('\n')) {
    const pod = /^ {2}"?([^"\s]+?)"?:$/.exec(line)?.[1];
    if (pod !== undefined) sources.set(pod, (current = {}));
    const key = /^ {4}:(\w+): "?([^"]*)"?$/.exec(line);
    if (key && current) current[key[1]] = key[2];
  }
  return sources;
}

function podspecResources(spec) {
  if (typeof spec !== 'object' || spec === null) return [];
  const own = [...Object.values(spec.resource_bundles ?? {}), spec.resources ?? []].flat();
  return [...own, ...[spec.ios, ...(spec.subspecs ?? [])].flatMap(podspecResources)];
}

/** Development pods: EXTERNAL SOURCES with a local :path or :podspec, bundled from their own folder. */
function developmentPodManifests(iosDir, report, iosRel) {
  const lockPath = join(iosDir, 'Podfile.lock');
  if (!existsSync(lockPath)) return [];
  const found = [];
  for (const [pod, source] of externalSources(readFileSync(lockPath, 'utf8'))) {
    const local = source.path ?? (source.podspec && !source.podspec.includes('://') ? dirname(source.podspec) : null);
    const specFile = join(iosDir, 'Pods', 'Local Podspecs', `${pod}.podspec.json`);
    if (local === null || !existsSync(specFile)) continue;
    const root = join(iosDir, local);
    for (const resource of podspecResources(JSON.parse(readFileSync(specFile, 'utf8')))) {
      const isGlob = /[*?[{]/.test(resource);
      if (!isGlob && !resource.endsWith('.xcprivacy')) continue;
      if (isGlob && !existsSync(root)) {
        report.problem({ file: `${iosRel}/Pods/Local Podspecs/${pod}.podspec.json`, rule: 'unreadable-manifest', message: `pod ${pod}: cannot expand the resource pattern "${resource}" (its folder ${local} is missing)`, fix: 'Run npm ci and npx expo prebuild --platform ios --clean again; the audit must read every manifest CocoaPods bundles.' });
        continue;
      }
      const files = isGlob ? globSync(resource, { cwd: root }).filter((file) => basename(file) === 'PrivacyInfo.xcprivacy') : [resource];
      for (const file of files) {
        if (existsSync(join(root, file))) found.push({ pod, path: join(root, file), rel: toPosix(join(local, file)) });
        else report.problem({ file: `${iosRel}/Pods/Local Podspecs/${pod}.podspec.json`, rule: 'unreadable-manifest', message: `pod ${pod} bundles ${toPosix(join(local, file))}, which the audit cannot read`, fix: 'Run npm ci and prebuild again; a manifest the audit cannot read is a manifest nobody checked.' });
      }
    }
  }
  return found;
}

function trunkPodManifests(podsDir, iosRel) {
  return walk(podsDir, { include: ['PrivacyInfo.xcprivacy'], followSymlinks: false }).map((rel) => ({ pod: rel.split('/')[0], path: join(podsDir, rel), rel: `${iosRel}/Pods/${rel}` }));
}

const NS_PURPOSE_TO_ID = new Map(Object.entries(DATA_TYPES.purposes).filter(([, entry]) => entry.nsPurpose).map(([id, entry]) => [entry.nsPurpose, id]));

/** What a pod's collected data type needs from the contract, or null when its row answers it. */
function collectionGap({ pod, item, type, owner, row }) {
  const linked = item.NSPrivacyCollectedDataTypeLinked === true;
  const tracking = item.NSPrivacyCollectedDataTypeTracking === true;
  if (!owner) return `pod ${pod} collects ${type}, but no SDK in contracts/privacy.json lists ${pod} in "pods"`;
  if (!row) return `pod ${pod} collects ${type} (linked=${linked}, tracking=${tracking}), but sdks["${owner}"].collects does not declare it`;
  if ((linked && !row.linked) || (tracking && !row.tracking)) return `pod ${pod} collects ${type} linked=${linked}, tracking=${tracking}, but sdks["${owner}"] answers linked=${row.linked}, tracking=${row.tracking}`;
  const purposes = (item.NSPrivacyCollectedDataTypePurposes ?? []).map((ns) => NS_PURPOSE_TO_ID.get(ns) ?? String(ns));
  const missing = [...new Set(purposes)].filter((purpose) => !row.purposes.includes(purpose));
  if (missing.length > 0) return `pod ${pod} collects ${type} for ${missing.join(', ')}, but sdks["${owner}"] ${type} purposes are ${row.purposes.join(', ')}`;
  return null;
}

/** One problem per pod and data type (an xcframework repeats its manifest in every slice). */
function collectionChecks({ pod, rel, manifest, contract, ownerOf, report, contractRel, seen }) {
  for (const item of manifest?.NSPrivacyCollectedDataTypes ?? []) {
    const type = NS_TO_ID.get(item.NSPrivacyCollectedDataType) ?? item.NSPrivacyCollectedDataType;
    if (seen.has(`${pod} ${type}`)) continue;
    seen.add(`${pod} ${type}`);
    const owner = ownerOf.get(pod);
    const row = owner ? contract.sdks[owner].collects.find((entry) => entry.type === type) : undefined;
    const message = collectionGap({ pod, item, type, owner, row });
    if (message) report.problem({ file: contractRel, rule: 'undeclared-collection', message, fix: `Declare what the pod's manifest declares (${rel}), purposes included: the App Privacy and Data safety answers come from the contract, and Apple compares them with the SDKs' manifests.` });
  }
}

function prebuiltManifest(iosDir) {
  return readdirSync(iosDir).filter((name) => name !== 'Pods' && statSync(join(iosDir, name)).isDirectory()).map((name) => join(iosDir, name, 'PrivacyInfo.xcprivacy')).find((path) => existsSync(path)) ?? null;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root);
  const iosRel = options.ios ?? 'ios';
  const iosDir = join(root, iosRel);
  const podsDir = join(iosDir, 'Pods');
  if (!existsSync(podsDir)) fail(`no prebuilt iOS project: ${iosRel}/Pods is missing`, 'Run npx expo prebuild --platform ios --clean first (it runs pod install), then rerun.');
  const manifestRel = options.manifest ?? `${layout.configDir}/privacy-manifest.ts`;
  if (!existsSync(join(root, manifestRel))) fail(`${manifestRel} is missing`, "Copy the skill's templates/src/config/privacy-manifest.ts and wire ios.privacyManifests in app.config.ts (audit-repo.mjs checks it).");
  const report = createReporter({ name: 'audit-privacy-manifest', json: options.json });
  const contractRel = contractPath(layout, options.contract);
  const contractRead = readContract(root, contractRel);
  for (const problem of contractRead.problems) report.problem({ file: contractRel, rule: 'contract', message: problem.message, fix: problem.fix });
  const contract = contractRead.contract ?? { sdks: {} };
  const ownerOf = new Map(Object.values(contract.sdks).flatMap((sdk) => sdk.pods.map((pod) => [pod, sdk.name])));
  const trackingAllowed = new Set(Object.values(contract.sdks).filter((sdk) => sdk.tracking).flatMap((sdk) => sdk.pods));
  const { declared, tracking, hasDomains } = declaredManifest(readFileSync(join(root, manifestRel), 'utf8'));
  const trackingFix = "The app's own code tracks nothing: NSPrivacyTracking: false and no NSPrivacyTrackingDomains (iOS blocks requests to listed domains for everyone who declines App Tracking Transparency). Tracking SDKs declare their own tracking in their pods' manifests.";
  if (tracking !== 'false') report.problem({ file: manifestRel, rule: 'app-tracking', message: `NSPrivacyTracking is ${tracking ?? 'missing'}`, fix: trackingFix });
  if (hasDomains) report.problem({ file: manifestRel, rule: 'app-tracking', message: 'NSPrivacyTrackingDomains lists domains', fix: trackingFix });
  const pods = [...trunkPodManifests(podsDir, iosRel), ...developmentPodManifests(iosDir, report, iosRel)];
  const required = new Map();
  const owners = new Map();
  const collected = new Set();
  const seen = new Set();
  const trackingSeen = new Set();
  for (const { pod, path, rel } of pods) {
    const manifest = readPlist(path);
    mergeInto(required, manifest);
    for (const api of manifest?.NSPrivacyAccessedAPITypes ?? []) for (const reason of api.NSPrivacyAccessedAPITypeReasons ?? []) if (!owners.has(`${api.NSPrivacyAccessedAPIType} ${reason}`)) owners.set(`${api.NSPrivacyAccessedAPIType} ${reason}`, pod);
    const domains = manifest?.NSPrivacyTrackingDomains ?? [];
    // Real SDKs often omit NSPrivacyTracking and say it per data type instead (Google-Mobile-Ads-SDK 13.6.0: Device ID tracking=true).
    const trackedTypes = (manifest?.NSPrivacyCollectedDataTypes ?? []).filter((item) => item.NSPrivacyCollectedDataTypeTracking === true).map((item) => NS_TO_ID.get(item.NSPrivacyCollectedDataType) ?? item.NSPrivacyCollectedDataType);
    const evidence = [domains.length > 0 ? `domains: ${domains.join(', ')}` : '', trackedTypes.length > 0 ? `collects ${trackedTypes.join(', ')} for tracking` : ''].filter(Boolean).join('; ');
    if ((manifest?.NSPrivacyTracking === true || evidence !== '') && !trackingAllowed.has(pod) && !trackingSeen.has(pod) && trackingSeen.add(pod)) report.problem({ file: rel, rule: 'tracking-outside-declared', message: `pod ${pod} declares tracking${evidence ? ` (${evidence})` : ''}, but no tracking SDK in contracts/privacy.json brings it`, fix: 'A tracking pod means an analytics, attribution or ads SDK slipped in: remove the package that brought it, or declare that SDK with "tracking": true, its pods and its data (and ask App Tracking Transparency first).' });
    for (const item of manifest?.NSPrivacyCollectedDataTypes ?? []) collected.add(`${pod}: ${String(item.NSPrivacyCollectedDataType).replace('NSPrivacyCollectedDataType', '')} linked=${item.NSPrivacyCollectedDataTypeLinked} tracking=${item.NSPrivacyCollectedDataTypeTracking}`);
    if (contractRead.contract !== null) collectionChecks({ pod, rel, manifest, contract, ownerOf, report, contractRel, seen });
  }
  for (const [category, reasons] of [...required].sort()) {
    for (const reason of [...reasons].sort()) if (declared.get(category)?.has(reason) !== true) report.problem({ file: manifestRel, rule: 'missing-reason', message: `${category} ${reason} is declared by pod ${owners.get(`${category} ${reason}`)} but not by the app`, fix: 'Add it to PRIVACY_MANIFESTS (never edit ios/), then prebuild again. App Store Connect rejects uploads with ITMS-91053 for a missing declaration.' });
  }
  const builtPath = prebuiltManifest(iosDir);
  if (builtPath !== null) {
    const builtRel = toPosix(builtPath.slice(root.length + 1));
    const built = new Map();
    const builtManifest = readPlist(builtPath);
    mergeInto(built, builtManifest);
    if (builtManifest?.NSPrivacyTracking === true || (builtManifest?.NSPrivacyTrackingDomains ?? []).length > 0) report.problem({ file: builtRel, rule: 'app-tracking', message: 'the prebuilt app manifest declares tracking or tracking domains', fix: trackingFix });
    for (const [category, reasons] of declared) for (const reason of reasons) if (built.get(category)?.has(reason) !== true) report.problem({ file: builtRel, rule: 'prebuilt-stale', message: `the prebuilt manifest lacks ${category} ${reason}`, fix: 'ios/ is older than privacy-manifest.ts: run npx expo prebuild --platform ios --clean.' });
  }
  report.note(`${iosRel}: ${pods.length} pod manifests`);
  for (const [category, reasons] of [...required].sort()) report.note(`  required ${category}: ${[...reasons].sort().join(', ')}`);
  for (const line of [...collected].sort()) report.note(`  collected ${line}`);
  return report.finish({ checked: pods.length, unit: 'pod manifests' });
});
