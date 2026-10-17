#!/usr/bin/env node
// audit-repo.mjs: the static privacy audit of an Expo app repo, no build needed: first-party network
// code only where the profile allows it, every network-capable SDK declared, the store answers
// complete and consistent with the other contracts, the iOS privacy manifest wired, CocoaPods trunk
// pods (after a prebuild) and Gradle families (with --gradle-deps) covered by declared SDKs, the
// audit tooling wired, and no key or signing file anywhere in the repo.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/audit-repo.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, maskComments, matchGlob, notYetCreated, parseArgs, readText, REPO_SCAN_IGNORES, requireDir, requireFile, resolveLayout, run, walk } from './check-lib.mjs';
import { placeholdersIn } from './lib/ship-placeholders.mjs';
import { allCollects, answerTypes, configSources, contractPath, DATA_TYPES, FACTS, installedPackages, lineAt, matchesAny, networkFamilyOf, networkSeams, parseImports, readContract, readRepoJson, readRepoText, runtimeSourceFiles, urlSeams } from './lib/privacy-scan.mjs';

/** Defaults while the contract is missing or broken: the api-port profile, nothing declared. */
const EMPTY_CONTRACT = Object.freeze({ profile: 'api-port', networkModules: [], linkFiles: [], sdks: {}, app: { collects: [] }, permissionAnswers: {}, accountDeletion: null });

const SPEC = {
  name: 'audit-repo',
  summary: 'Audits an Expo app repo for privacy: network calls and remote URLs only where the profile allows, every network-capable SDK declared in contracts/privacy.json, store answers complete and consistent, the privacy manifest wired, trunk pods and Gradle families covered, the audit tooling wired, and no secrets in the repo.',
  usage: '[repo-root] [--app <dir>] [--contract <file>] [--manifest <file>] [--gradle-deps <file>] [--answers] [--json]',
  options: {
    app: { type: 'string', value: 'dir', help: 'The app folder inside a multi-package repo (default: the repo root)' },
    contract: { type: 'string', value: 'file', help: 'The privacy contract, relative to the app (default: rn-skills.config.json "privacyContract", else contracts/privacy.json)' },
    manifest: { type: 'string', value: 'file', help: 'The declared iOS privacy manifest module (default: <configDir>/privacy-manifest.ts)' },
    'gradle-deps': { type: 'string', value: 'file', help: 'Saved output of ./gradlew :app:dependencies --configuration releaseRuntimeClasspath (Android SDK layer)' },
    answers: { type: 'boolean', help: 'Also print the App Privacy and Data safety answers the contract gives' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (network): network-call, network-global, remote-url, network-guard-import.',
    'Rules (declarations): contract, network-sdk, sdk-inventory, store-answer, permission-answer, profile-policy.',
    'Rules (offline-only profile): config-updates, config-ats (under api-port networking-and-server-state owns cleartext).',
    'Rules (native): vendor-pod, banned-pod, pod-source (ios/Podfile.lock, after a prebuild), vendor-maven (--gradle-deps),',
    '  privacy-manifest (PRIVACY_MANIFESTS as is, or spread first with SDK collected data types beside it),',
    '  required-reason (installed packages\' reasons, and required-reason symbols in modules/*/ios sources).',
    'Rules (tooling and secrets): baseline, audit-wiring, gated-paths, runtime-proof, gitignore-secrets, secret-file,',
    '  private-key, deny-rules.',
    'gated-paths: quality-gates.json gatedPaths covers contracts/network-baseline.json and contracts/privacy.json.',
    'runtime-proof: contracts/e2e.json network.mode is offline-only for the offline-only profile, allowlist or',
    '  offline-only for api-port (e2e-maestro\'s socket sampler enforces it on named devices).',
    'Profiles (contracts/privacy.json "profile"): api-port (default) allows fetch, XMLHttpRequest, WebSocket,',
    '  EventSource, sendBeacon, expo-file-system transfers and request-client imports (expo/fetch, axios, ky, ...) only',
    '  in <apiDir>/** plus "networkModules", URL literals only in <configDir> and "linkFiles"; offline-only allows no',
    '  first-party network code and URL literals only in "linkFiles".',
    'SKIP: ios/Podfile.lock [vendor-pod] until npx expo prebuild --platform ios creates it;',
    '  contracts/dependency-policy.json [profile-policy] until dependency-management creates it (offline-only only);',
    '  quality-gates.json [gated-paths] until quality-gates creates it; contracts/e2e.json [runtime-proof] until',
    '  e2e-maestro creates it.',
    'The secret scan is the one scan that also reads installed agent skill folders: a key is a key wherever it sits.',
    'Layout keys come from resolveLayout (rn-skills.config.json may move src/, contracts/ and the rest).',
  ].join('\n'),
};

// Also the forms lint's no-restricted-globals cannot see: globalThis['fetch'](...), new globalThis.WebSocket(...).
const NETWORK_CALLS = [
  [/\bfetch\s*\(|\[\s*(['"`])fetch\1\s*\]\s*\(/g, 'fetch()', isGlobalFetch],
  [/\bnew\s+(?:[\w$]+\s*\.\s*)*XMLHttpRequest\b/g, 'new XMLHttpRequest'],
  [/\bnew\s+(?:[\w$]+\s*\.\s*)*WebSocket\s*\(/g, 'new WebSocket()'],
  [/\bnew\s+(?:[\w$]+\s*\.\s*)*EventSource\s*\(/g, 'new EventSource()'],
  [/\bsendBeacon\s*\(|\[\s*(['"`])sendBeacon\1\s*\]\s*\(/g, 'sendBeacon()'],
  // expo-file-system downloads and uploads (File.downloadFileAsync, the legacy API); a no-argument
  // downloadAsync() is expo-asset's copy of a bundled asset, not a request.
  [/\b(?:downloadFileAsync|uploadAsync|createDownloadResumable|createUploadTask)\s*\(|\bdownloadAsync\s*\(\s*[^\s)]/g, 'a file transfer (expo-file-system)'],
];
// Importing a request client is a request outside the seam, whatever name it gets (import { fetch as get } from 'expo/fetch').
const NETWORK_CLIENTS = /^(?:expo\/fetch|axios|ky|got|node-fetch|cross-fetch|undici|superagent)(?:\/|$)/;
// XML namespace and schema identifiers (react-native-svg xmlns, JSON Schema $schema) name no request.
const REMOTE_URL = /(['"`])((?:https?|wss?|ftp):\/\/(?!localhost\b|127\.0\.0\.1\b|10\.0\.2\.2\b|www\.w3\.org\/|json-schema\.org\/)[^'"`\s]*)/gi;
// A network global taken as a value (const Socket = WebSocket; const send = globalThis.fetch). Calls are NETWORK_CALLS.
const NETWORK_GLOBALS = [
  /(?<!new\s+)(?<![\w$.'"`])(XMLHttpRequest|WebSocket|EventSource)\b(?!\s*:)/g,
  /(?<!new\s+)\b(?:globalThis|window|global|self|navigator)\s*(?:\.\s*(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\[\s*(['"`])(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\2\s*\])(?!\s*\()/g,
  // Destructured from the global scope: const { fetch } = globalThis; const { WebSocket: Ws } = window.
  /\{[^{}]*?\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b\s*(?::\s*[\w$]+\s*)?(?:,[^{}]*)?\}\s*=\s*(?:globalThis|window|global|self|navigator)\b/g,
];

/**
 * A `fetch(` that is the global: not a member call on another object (repo.fetch(id), api?.fetch(x)) and
 * not a method signature (fetch(id: string): Task, async fetch() {). globalThis/window/global/self.fetch(
 * still count. An untyped JavaScript method { fetch(id) { ... } } is a documented limit (network-layers.md).
 */
function isGlobalFetch(text, match) {
  if (match[0].startsWith('[')) return true;
  const before = text.slice(Math.max(0, match.index - 80), match.index);
  const member = /([\w$]*)\s*\??\.\s*$/.exec(before);
  if (member !== null) return /^(?:globalThis|window|global|self)$/.test(member[1]);
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 120);
  return !/^\s*(?:\.\.\.)?[\w$]+\??\s*:/.test(after) && !/^\s*\)\s*[:{]/.test(after);
}

function seamText(contract, layout) {
  return contract.profile === 'offline-only' ? 'the offline-only profile allows no first-party network code' : `only ${networkSeams(contract, layout).join(', ')} may open a connection (the ApiClient port)`;
}

function layerA(ctx) {
  const { contract, layout, report } = ctx;
  const seams = networkSeams(contract, layout);
  const urls = urlSeams(contract, layout);
  for (const rel of ctx.files) {
    const text = maskComments(ctx.sources.get(rel));
    if (!matchesAny(rel, seams)) {
      for (const imp of parseImports(ctx.sources.get(rel))) if (!imp.isType && NETWORK_CLIENTS.test(imp.specifier)) report.problem({ file: rel, line: imp.line, rule: 'network-call', message: `imports the request client ${imp.specifier} outside the network seam`, fix: `Request through the ApiClient port; ${seamText(contract, layout)}. An alias hides the call from every pattern, so the import itself is the finding.` });
      for (const [pattern, label, isCall] of NETWORK_CALLS) for (const match of text.matchAll(pattern)) if (isCall === undefined || isCall(text, match)) report.problem({ file: rel, line: lineAt(text, match.index), rule: 'network-call', message: `${label} outside the network seam`, fix: `Request through the ApiClient port; ${seamText(contract, layout)}. A second transport is declared in contracts/privacy.json "networkModules".` });
      const reported = new Set();
      for (const pattern of NETWORK_GLOBALS) {
        for (const match of text.matchAll(pattern)) {
          const key = `${lineAt(text, match.index)} ${match[1] ?? match[3]}`;
          if (reported.has(key)) continue;
          reported.add(key);
          report.problem({ file: rel, line: lineAt(text, match.index), rule: 'network-global', message: `${match[1] ?? match[3]} taken as a value outside the network seam`, fix: `Do not alias or pass around fetch, XMLHttpRequest, WebSocket, EventSource or sendBeacon; ${seamText(contract, layout)}.` });
        }
      }
    }
    if (!matchesAny(rel, urls)) {
      for (const match of text.matchAll(REMOTE_URL)) report.problem({ file: rel, line: lineAt(text, match.index), rule: 'remote-url', message: `remote URL ${match[2]}`, fix: `Remote images, fonts and downloads make requests without fetch. The API base URL lives in ${layout.configDir} (from EXPO_PUBLIC_API_URL; endpoints in ${layout.apiDir} are paths on it), links the OS opens (store page, privacy policy, mailto) in ${contract.profile === 'offline-only' ? '' : `${layout.configDir} or `}a file listed in "linkFiles".` });
    }
    const guardFile = ctx.guardFile.replace(/\.ts$/, '');
    const allowed = [`${layout.srcDir}/test-only-entry.ts`, `${layout.servicesDir}/test-hooks/`, `${layout.featuresDir}/debug/`];
    for (const imp of parseImports(ctx.sources.get(rel))) {
      const target = imp.specifier.startsWith('@/') ? `${layout.srcDir}/${imp.specifier.slice(2)}` : imp.specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(rel), imp.specifier)) : imp.specifier;
      if (target.replace(/\.ts$/, '') !== guardFile || imp.isType) continue;
      if (!allowed.some((path) => rel === path || (path.endsWith('/') && rel.startsWith(path)))) report.problem({ file: rel, line: imp.line, rule: 'network-guard-import', message: 'imports the test-only network guard outside test-only code', fix: 'Install it only from the test hooks the test-only entry exports (debug-menu-and-test-hooks), so production builds never contain it.' });
    }
  }
}

function contractProblems(ctx) {
  for (const problem of ctx.contractRead.problems) ctx.report.problem({ file: ctx.contractRel, rule: 'contract', message: problem.message, fix: problem.fix });
}

function sdkInventory(ctx) {
  const { contract, installed, report } = ctx;
  for (const [name, where] of installed.anywhere) {
    const family = networkFamilyOf(name);
    if (family === null || contract.sdks[name] !== undefined) continue;
    const viaDirect = installed.direct.has(name);
    if (!viaDirect && family.scope !== 'anywhere') continue;
    report.problem({ file: viaDirect ? installed.direct.get(name) : where.lock, rule: 'network-sdk', message: `${name} (${family.family}) is installed${viaDirect ? (installed.direct.get(name) === 'package.json' ? '' : ` through the workspace package ${installed.direct.get(name)}`) : ` through another package (${where.path})`} but not declared in contracts/privacy.json "sdks"`, fix: `Declare it with why the app needs it, the pods and Gradle groups it brings and what it collects (references/sdk-inventory.md); if the app does not need it, remove it${viaDirect ? '' : ` (npm explain ${name})`}.` });
  }
  for (const name of Object.keys(contract.sdks)) {
    if (!installed.anywhere.has(name)) report.problem({ file: ctx.contractRel, rule: 'sdk-inventory', message: `sdks["${name}"] is declared but not installed`, fix: 'Delete the entry: the store answers would declare data an SDK the app does not ship collects.' });
  }
}

function storeAnswers(ctx) {
  const { contract, root, report, layout } = ctx;
  const problem = (message, fix) => report.problem({ file: ctx.contractRel, rule: 'store-answer', message, fix });
  for (const sdk of Object.values(contract.sdks)) {
    if (sdk.tracking && !sdk.collects.some((row) => row.tracking)) problem(`sdks["${sdk.name}"] tracks but lists no collects row with tracking: true`, 'Copy the data the SDK uses for tracking from its privacy manifest or its data disclosure page (Device ID for ads SDKs).');
    for (const row of sdk.collects) if (row.tracking && !sdk.tracking) problem(`sdks["${sdk.name}"] collects ${row.type} for tracking but is not marked "tracking": true`, 'Mark the SDK as tracking (only these SDKs may declare tracking in their pod manifests), or fix the row.');
  }
  for (const row of contract.app.collects) if (row.tracking) problem(`app.collects ${row.type} is marked tracking`, "The app's own code tracks nothing (its privacy manifest keeps NSPrivacyTracking false); tracking belongs to a declared SDK, after App Tracking Transparency.");
  if (contract.profile === 'offline-only' && contract.app.collects.length > 0) problem('the offline-only profile has app.collects rows', 'An app without a server collects nothing itself; move each row to the SDK that collects it, or switch to the api-port profile.');
  const collected = new Map(allCollects(contract).map((row) => [`${row.owner}:${row.type}`, row]));
  const iap = readRepoJson(root, `${layout.contractsDir}/in-app-purchases.json`);
  if (Array.isArray(iap?.allowedApis) && iap.allowedApis.length > 0 && !collected.has('expo-iap:purchase-history')) problem('contracts/in-app-purchases.json allows server APIs (allowedApis), but sdks["expo-iap"] does not collect purchase-history', 'A purchase server receives the purchase history: declare it (linked when it is tied to an account).');
  const push = readRepoJson(root, `${layout.contractsDir}/push.json`);
  if (push !== null) {
    const row = collected.get('expo-notifications:device-id');
    if (row === undefined) problem('contracts/push.json exists, but sdks["expo-notifications"] does not collect device-id (the push token)', 'The push token is a device identifier sent to the app\'s server: declare device-id for app-functionality, not tracking.');
    else if (row.linked !== (push.requiresAccount === true)) problem(`the push token is linked=${row.linked}, but contracts/push.json requiresAccount is ${push.requiresAccount === true}`, 'A token registered with an account is linked to the person.');
  }
  const auth = readRepoJson(root, `${layout.contractsDir}/auth.json`);
  const signals = accountSignals(ctx);
  if (auth?.createsAccounts !== true && auth?.createsAccounts !== false && contract.accountDeletion === null && signals.length > 0) problem(`the contract shows accounts (${signals.join('; ')}), but accountDeletion is null and contracts/auth.json does not say whether the app creates accounts`, 'An app with sign-in usually has accounts, and both stores then need account deletion: set accountDeletion.inApp and accountDeletion.webUrl, or, when the sign-in creates no account the app keeps, set createsAccounts: false in contracts/auth.json (auth-and-secure-storage) so the answer "no account" is a stated fact.');
  const deletion = contract.accountDeletion;
  // Whenever the contract states deletion paths, they must be real, and the same route auth-and-secure-storage checks.
  if (deletion !== null) {
    if (!/^https:\/\//.test(deletion.webUrl) || placeholdersIn(deletion.webUrl).length > 0) problem(`accountDeletion.webUrl ${JSON.stringify(deletion.webUrl)} is not a real https link`, 'Google Play shows this link in the store listing; use the page where people request deletion.');
    if (!existsSync(join(root, deletion.inApp))) problem(`accountDeletion.inApp ${deletion.inApp} does not exist`, 'Point it at the route file that deletes the account in the app (auth-and-secure-storage).');
    if (typeof auth?.accountDeletionRoute === 'string' && auth.accountDeletionRoute !== deletion.inApp) problem(`accountDeletion.inApp ${deletion.inApp} differs from contracts/auth.json accountDeletionRoute ${auth.accountDeletionRoute}`, 'Both contracts name the one route that deletes the account: make them equal (auth-and-secure-storage checks its route; the store answer must point at the same screen).');
  }
  if (auth?.createsAccounts === true) {
    if (deletion === null) problem('contracts/auth.json creates accounts, but accountDeletion is null', 'Both stores need account deletion: an in-app path (App Store 5.1.1(v), Google Play) and, for Google Play, a web link; set accountDeletion.inApp and accountDeletion.webUrl.');
    if (!contract.app.collects.some((row) => ['user-id', 'email-address', 'name'].includes(row.type))) problem('the app creates accounts but app.collects lists no account data (user-id, email-address or name)', 'An account is data the app collects: declare what the server stores, linked: true, for app-functionality or account-management.');
  }
}

/**
 * Why the app probably has accounts: a declared sign-in SDK or an installed sign-in package that is no network SDK
 * (expo-apple-authentication) that app code imports, an account-management purpose, a user-id row. A sign-in package
 * nothing imports builds no sign-in (auth-and-secure-storage's check-auth is NOT APPLICABLE then too).
 */
function accountSignals(ctx) {
  const { contract, installed } = ctx;
  const imported = importedPackages(ctx);
  const signals = Object.keys(contract.sdks).filter((name) => networkFamilyOf(name)?.signIn === true && imported.has(name)).map((name) => `sign-in SDK ${name}`);
  for (const name of FACTS.signInPackages.names) if (installed.direct.has(name) && imported.has(name)) signals.push(`sign-in package ${name}`);
  for (const row of allCollects(contract)) {
    if (row.purposes.includes('account-management')) signals.push(`${row.owner} collects ${row.type} for account-management`);
    else if (row.type === 'user-id') signals.push(`${row.owner} collects user-id`);
  }
  return signals;
}

/** The npm packages app code imports at run time (type-only imports do not count). */
function importedPackages(ctx) {
  if (ctx.importedPackages) return ctx.importedPackages;
  const names = new Set();
  for (const rel of ctx.files) {
    for (const imp of parseImports(ctx.sources.get(rel))) {
      if (imp.isType || imp.specifier.startsWith('.') || imp.specifier.startsWith('@/')) continue;
      const parts = imp.specifier.split('/');
      names.add(imp.specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  ctx.importedPackages = names;
  return names;
}

function deletionAnswer(ctx) {
  const deletion = ctx.contract.accountDeletion;
  if (deletion !== null) return `yes, in the app (${deletion.inApp}) and on the web (${deletion.webUrl}, the store listing link)`;
  if (readRepoJson(ctx.root, `${ctx.layout.contractsDir}/auth.json`)?.createsAccounts === false) return 'no (contracts/auth.json says the app creates no accounts)';
  const signals = accountSignals(ctx);
  if (signals.length > 0) return `unknown: confirm whether the app has accounts (${signals.join('; ')}); accountDeletion is null`;
  return 'no (no code imports a sign-in package and the contract holds no account data; accountDeletion is null): confirm the app has no accounts';
}

function permissionAnswers(ctx) {
  const { contract, root, report, layout } = ctx;
  const known = new Set(allCollects(contract).map((row) => row.type));
  for (const [kind, answer] of Object.entries(contract.permissionAnswers)) {
    if (typeof answer !== 'string') continue;
    for (const type of answerTypes(answer)) if (!known.has(type)) report.problem({ file: ctx.contractRel, rule: 'permission-answer', message: `permissionAnswers["${kind}"] says ${type} is collected, but no collects row declares it`, fix: 'Add the collects row (who receives it, linked, purposes), or answer not-collected with the reason.' });
  }
  const permissions = readRepoJson(root, `${layout.contractsDir}/permissions.json`);
  for (const entry of Array.isArray(permissions?.permissions) ? permissions.permissions : []) {
    if (typeof entry?.kind === 'string' && contract.permissionAnswers[entry.kind] === undefined) report.problem({ file: ctx.contractRel, rule: 'permission-answer', message: `contracts/permissions.json asks for ${entry.kind}, but permissionAnswers has no "${entry.kind}"`, fix: `Answer it: "not-collected: <why>" when the data stays on the device, or "collected: <type>" when it leaves it (references/store-declarations.md).` });
  }
}

function profilePolicy(ctx) {
  const { contract, root, report, layout } = ctx;
  if (contract.profile !== 'offline-only') return;
  const policyRel = `${layout.contractsDir}/dependency-policy.json`;
  const reason = notYetCreated(root, { file: policyRel, owner: 'dependency-management' });
  if (reason !== null) report.skip({ file: policyRel, rule: 'profile-policy', message: reason });
  else {
    const policy = readRepoJson(root, policyRel);
    if (!Array.isArray(policy?.profiles) || !policy.profiles.includes('offline-only')) report.problem({ file: policyRel, rule: 'profile-policy', message: 'the app is offline-only, but the dependency policy does not list the offline-only profile', fix: 'Add "offline-only" to "profiles" and copy the profile\'s bans into "banned" (dependency-management), so OTA updates, analytics, crash reporting, push, web views and HTTP clients cannot be installed.' });
  }
  let hasUpdatesOff = false;
  for (const rel of ctx.configFiles) {
    const raw = readRepoText(root, rel);
    const text = rel.endsWith('.json') ? raw : maskComments(raw);
    if (/\bupdates\b['"]?\s*:\s*\{\s*['"]?enabled['"]?\s*:\s*false\b/.test(text)) hasUpdatesOff = true;
    for (const match of text.matchAll(/['"]expo-updates['"]/g)) report.problem({ file: rel, line: lineAt(text, match.index), rule: 'config-updates', message: 'expo-updates in the build config of an offline-only app', fix: 'Over-the-air updates are network traffic: remove the plugin and the package.' });
    for (const match of text.matchAll(/NSAllowsArbitraryLoads['"]?\s*:\s*true|usesCleartextTraffic['"]?\s*:\s*true/g)) report.problem({ file: rel, line: lineAt(text, match.index), rule: 'config-ats', message: `${match[0].split(/['"\s:]/)[0]} is switched on`, fix: 'An offline app loads nothing remote: remove the App Transport Security or cleartext exception (prebuild keeps NSAllowsLocalNetworking only).' });
  }
  if (!hasUpdatesOff) report.problem({ file: ctx.configFiles[0] ?? 'app.config.ts', rule: 'config-updates', message: 'no updates: { enabled: false } in the app config', fix: 'An offline-only app sets updates: { enabled: false } in app.config.ts, so no build ever checks for an update.' });
}

function podLayer(ctx) {
  const { contract, root, report } = ctx;
  const rel = 'ios/Podfile.lock';
  const reason = notYetCreated(root, { file: rel, owner: 'npx expo prebuild --platform ios' });
  if (reason !== null) {
    report.skip({ file: rel, rule: 'vendor-pod', message: reason });
    return;
  }
  const lock = readRepoText(root, rel);
  const declared = new Map(Object.values(contract.sdks).flatMap((sdk) => sdk.pods.map((pod) => [pod, sdk.name])));
  const families = FACTS.podFamilies.map((family) => ({ ...family, re: new RegExp(family.pattern) }));
  const trunk = (lock.split('\nSPEC REPOS:\n')[1]?.split('\n\n')[0] ?? '').split('\n').map((line) => /^ {4}- "?([^"\s]+)"?$/.exec(line)?.[1]).filter(Boolean);
  for (const pod of trunk) {
    if (declared.has(pod)) continue;
    const family = families.find((f) => f.re.test(pod));
    report.problem({ file: rel, line: lineAt(lock, lock.indexOf(`- ${pod}`)), rule: family ? 'banned-pod' : 'vendor-pod', message: `trunk pod ${pod}${family ? ` (${family.family})` : ''} is not brought by a declared SDK`, fix: 'A trunk pod is a binary no source layer reads: find the package or plugin option that added it (pod install --verbose) and remove it, or declare it in that SDK\'s "pods".' });
  }
  const section = lock.split('\nEXTERNAL SOURCES:\n')[1]?.split('\n\n')[0] ?? '';
  let pod = null;
  for (const line of section.split('\n')) {
    const name = /^ {2}"?([^"\s]+?)"?:$/.exec(line)?.[1];
    if (name !== undefined) pod = name;
    const key = /^ {4}:(\w+): "?([^"]*)"?$/.exec(line);
    if (pod === null || key === null || declared.has(pod)) continue;
    const [, kind, value] = key;
    // :path and :podspec are relative to <app>/ios; inside the repo, or an installed npm package
    // (autolinked; the native layer scans it), is fine.
    const inRepo = posix.normalize(posix.join(ctx.appInRepo, 'ios', value));
    const isPackage = /(^|\/)node_modules\//.test(posix.normalize(value));
    const isOutside = value.includes('://') || (!isPackage && (posix.isAbsolute(value) || inRepo === '..' || inRepo.startsWith('../')));
    const foreign = kind === 'git' || kind === 'http' || ((kind === 'path' || kind === 'podspec') && isOutside);
    if (foreign) report.problem({ file: rel, line: lineAt(lock, lock.indexOf(line)), rule: 'pod-source', message: `pod ${pod} comes from a :${kind} source (${value}), not the CocoaPods trunk or a folder in the repo`, fix: 'Such a pod bypasses every other layer (its code is neither a reviewed trunk binary nor in node_modules): remove it, or declare it in an SDK\'s "pods" after review.' });
  }
}

function mavenLayer(ctx, file) {
  const { contract, report } = ctx;
  const text = readFileSync(requireFile(file, 'Gradle dependency report (--gradle-deps)'), 'utf8');
  const covered = Object.values(contract.sdks).flatMap((sdk) => sdk.maven);
  const families = FACTS.mavenFamilies.map((family) => ({ ...family, re: new RegExp(family.pattern) }));
  const seen = new Set();
  for (const match of text.matchAll(/(?:---|\\---)\s+([\w.-]+):([\w.-]+)/g)) {
    const coordinate = `${match[1]}:${match[2]}`;
    if (seen.has(coordinate)) continue;
    seen.add(coordinate);
    const family = families.find((f) => f.re.test(coordinate));
    // A strict family (analytics, crash reporting) needs an entry that names the artifact: a bare group
    // (com.google.firebase:, which push brings for firebase-messaging) must not hide Firebase Analytics.
    const covers = (group) => coordinate.startsWith(group) && (family.strict !== true || !group.endsWith(':'));
    if (family && !covered.some(covers)) report.problem({ file, line: lineAt(text, match.index), rule: 'vendor-maven', message: `${coordinate} (${family.family}) is in the release classpath but no declared SDK lists it in "maven"${family.strict === true ? ' by artifact (a bare group prefix does not cover this family)' : ''}`, fix: `Find who brings it (./gradlew :app:dependencies --configuration releaseRuntimeClasspath) and remove it, or add ${family.strict === true ? 'the artifact (group:artifact)' : 'its group'} to the SDK that brings it after review.` });
  }
}

function privacyManifest(ctx) {
  const { root, report, installed, manifestRel } = ctx;
  if (!existsSync(join(root, manifestRel))) {
    report.problem({ file: manifestRel, rule: 'privacy-manifest', message: 'missing', fix: 'Copy templates/src/config/privacy-manifest.ts (+ test) and set ios.privacyManifests: PRIVACY_MANIFESTS in app.config.ts.' });
    return;
  }
  const text = maskComments(readRepoText(root, manifestRel));
  if (!/NSPrivacyTracking\s*:\s*false/.test(text)) report.problem({ file: manifestRel, rule: 'privacy-manifest', message: 'NSPrivacyTracking is not false', fix: "The app's own code tracks nothing; keep NSPrivacyTracking: false (tracking SDKs declare theirs in their own manifests)." });
  const domains = /NSPrivacyTrackingDomains\s*:\s*\[([^\]]*)\]/.exec(text);
  if (domains && /['"`]/.test(domains[1])) report.problem({ file: manifestRel, line: lineAt(text, domains.index), rule: 'privacy-manifest', message: 'NSPrivacyTrackingDomains lists domains', fix: 'iOS blocks requests to listed domains for everyone who declines App Tracking Transparency (ads and attribution stop for them); list none.' });
  const declared = new Map();
  for (const match of text.matchAll(/NSPrivacyAccessedAPIType\s*:\s*['"]([^'"]+)['"]\s*,\s*NSPrivacyAccessedAPITypeReasons\s*:\s*\[([^\]]*)\]/g)) {
    declared.set(match[1], new Set([...(declared.get(match[1]) ?? []), ...[...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])]));
  }
  for (const [pkg, categories] of Object.entries(FACTS.requiredReasons)) {
    if (!installed.anywhere.has(pkg)) continue;
    for (const [category, reasons] of Object.entries(categories)) for (const reason of reasons) {
      if (declared.get(category)?.has(reason) !== true) report.problem({ file: manifestRel, rule: 'required-reason', message: `${category} ${reason} is not declared, but ${pkg}'s own privacy manifest declares it`, fix: 'Add it to PRIVACY_MANIFESTS: Apple does not reliably read static pods\' manifests, so the app\'s manifest carries every reason its pods declare (audit-privacy-manifest.mjs after a prebuild gives the full list).' });
    }
  }
  localModuleReasons(ctx, declared);
  // Either the module as is, or spread first with SDK collected data types beside it (analytics-and-consent and
  // crash-reporting-and-observability add NSPrivacyCollectedDataTypes that way): references/privacy-manifest.md.
  const wired = /privacyManifests\s*:\s*(?:PRIVACY_MANIFESTS\b|\{\s*\.\.\.\s*PRIVACY_MANIFESTS\b)/;
  if (!ctx.configFiles.some((rel) => wired.test(maskComments(readRepoText(root, rel))))) report.problem({ file: ctx.configFiles[0] ?? 'app.config.ts', rule: 'privacy-manifest', message: 'ios.privacyManifests is not set from PRIVACY_MANIFESTS', fix: 'Set ios: { privacyManifests: PRIVACY_MANIFESTS } in app.config.ts, or { ...PRIVACY_MANIFESTS, NSPrivacyCollectedDataTypes: [...] } when an SDK skill adds collected data types; never edit ios/ by hand (prebuild rewrites it).' });
}

// A local Expo module (modules/<name>/ios) is a development pod with no manifest: the app's manifest must
// declare every required-reason category its Swift or Objective-C uses (native-modules-and-new-architecture).
function localModuleReasons(ctx, declared) {
  const { root, report, manifestRel } = ctx;
  if (!existsSync(join(root, 'modules'))) return;
  const symbols = Object.entries(FACTS.nativeReasonSymbols).filter(([key]) => !key.startsWith('$')).map(([category, source]) => [category, new RegExp(source)]);
  for (const rel of walk(join(root, 'modules')).filter((file) => /(^|\/)ios\/.*\.(swift|m|mm)$/.test(file))) {
    const text = readText(join(root, 'modules', rel));
    if (typeof text !== 'string') continue;
    for (const [category, re] of symbols) {
      const found = re.exec(text);
      if (found === null || declared.has(category)) continue;
      report.problem({ file: `modules/${rel}`, line: lineAt(text, found.index), rule: 'required-reason', message: `uses ${found[0]} (${category}), but ${manifestRel} declares no reason in that category`, fix: `Add the ${category} entry with the reason that matches this use (Apple's required-reason API list) to PRIVACY_MANIFESTS, or remove the call; a local module has no manifest of its own.` });
    }
  }
}

function tooling(ctx) {
  const { root, report, layout } = ctx;
  const baselineRel = `${layout.contractsDir}/network-baseline.json`;
  const baseline = readRepoJson(root, baselineRel);
  if (baseline === null) report.problem({ file: baselineRel, rule: 'baseline', message: existsSync(join(root, baselineRel)) ? 'not valid JSON' : 'missing', fix: 'Copy templates/contracts/network-baseline.json; every entry names the categories found and why the app cannot reach them.' });
  else {
    for (const layer of ['js', 'native']) {
      if (typeof baseline[layer] !== 'object' || baseline[layer] === null) {
        report.problem({ file: baselineRel, rule: 'baseline', message: `has no "${layer}" section`, fix: 'Keep both sections, { "js": {}, "native": {} } at least.' });
        continue;
      }
      for (const [owner, entry] of Object.entries(baseline[layer])) {
        if (!Array.isArray(entry?.categories) || entry.categories.length === 0 || typeof entry?.reason !== 'string' || entry.reason.trim().length < 10) report.problem({ file: baselineRel, rule: 'baseline', message: `${layer} entry "${owner}" has no categories or no real reason`, fix: 'Every entry names what was found and why the app cannot reach it; a baseline change needs the reviewer and a Gate-Change trailer.' });
        if (/^\.|^src\/|\.(ts|tsx|js)$/.test(owner)) report.problem({ file: baselineRel, rule: 'baseline', message: `${layer} entry "${owner}" is first-party code`, fix: 'First-party code is never baselined: move the request behind the ApiClient port or remove it.' });
      }
    }
  }
  const scripts = readRepoJson(root, 'package.json')?.scripts ?? {};
  for (const [name, command] of [['audit:network', `node ${layout.scriptsDir}/audit/audit-network.ts`], ['audit:privacy', `node ${layout.scriptsDir}/audit/audit-privacy.ts`]]) {
    if (typeof scripts[name] !== 'string' || !scripts[name].startsWith(command)) report.problem({ file: 'package.json', rule: 'audit-wiring', message: `scripts["${name}"] is ${scripts[name] === undefined ? 'missing' : JSON.stringify(scripts[name])}`, fix: `Set it to "${command}" (the template runner).` });
  }
  const required = ['audit-network.ts', 'audit-privacy.ts', 'privacy-contract.ts', 'bundle-modules.ts', 'network-baseline.ts', 'network-js-layer.ts', 'network-native-layer.ts', 'network-pods-layer.ts', 'network-config-layer.ts', 'privacy-manifest.ts'].map((file) => `${layout.scriptsDir}/audit/${file}`);
  const missing = [...required, ctx.guardFile].filter((rel) => !existsSync(join(root, rel)));
  gatedPaths(ctx, baselineRel);
  runtimeProof(ctx);
  if (missing.length > 0) report.problem({ file: missing[0], rule: 'audit-wiring', message: `the audit tooling is incomplete: ${missing.length === 1 ? `${missing[0]} is` : `${missing.length} files are`} missing (${missing.map((rel) => rel.split('/').pop()).join(', ')})`, fix: 'Copy them from this skill\'s templates/ (each file names its repo path on line 1) and run their Jest tests.' });
}

// The baseline and the contract are the allow-lists of this audit: changing them must take the
// Gate-Change trailer and the reviewer, which only quality-gates.json "gatedPaths" enforces.
function gatedPaths(ctx, baselineRel) {
  const { repoRoot, report } = ctx;
  const prefix = ctx.appInRepo === '.' ? '' : `${ctx.appInRepo}/`;
  const reason = notYetCreated(repoRoot, { file: 'quality-gates.json', owner: 'quality-gates' });
  if (reason !== null) {
    report.skip({ file: 'quality-gates.json', rule: 'gated-paths', message: reason });
    return;
  }
  const listed = readRepoJson(repoRoot, 'quality-gates.json')?.gatedPaths;
  const globs = Array.isArray(listed) ? listed.filter((glob) => typeof glob === 'string') : [];
  for (const rel of [baselineRel, ctx.contractRel].map((file) => `${prefix}${file}`)) {
    if (!globs.some((glob) => matchGlob(rel, glob))) report.problem({ file: 'quality-gates.json', rule: 'gated-paths', message: `gatedPaths does not cover ${rel}`, fix: `Add "${rel}" to gatedPaths (quality-gates): a baseline or contract change then needs a Gate-Change trailer and the reviewer, instead of passing the audit silently.` });
  }
}

// Layer F runs in e2e-maestro's runner with contracts/e2e.json "network" as its policy; it must be the
// profile's policy, or the runtime proof proves a different promise.
function runtimeProof(ctx) {
  const { root, report, layout, contract } = ctx;
  const rel = `${layout.contractsDir}/e2e.json`;
  const reason = notYetCreated(root, { file: rel, owner: 'e2e-maestro' });
  if (reason !== null) {
    report.skip({ file: rel, rule: 'runtime-proof', message: reason });
    return;
  }
  const mode = readRepoJson(root, rel)?.network?.mode;
  const wanted = contract.profile === 'offline-only' ? ['offline-only'] : ['allowlist', 'offline-only'];
  if (!wanted.includes(mode)) report.problem({ file: rel, rule: 'runtime-proof', message: `network.mode is ${JSON.stringify(mode ?? null)}, but the ${contract.profile} profile needs ${wanted.map((m) => `"${m}"`).join(' or ')}`, fix: contract.profile === 'offline-only' ? 'Set "network": { "mode": "offline-only" }: the socket sampler then fails any peer that is not loopback.' : 'Set "network": { "mode": "allowlist", "allowHosts": ["<the API host of the test build>"] } (or offline-only when E2E runs on a fake API): without it the runtime layer proves nothing.' });
}

// The repo-scan ignores without the agent skill folders: a key is allowed nowhere in the repo, and no
// skill fixture holds one (planted keys are stored defused and completed at test time).
const SECRET_SCAN_IGNORES = [...REPO_SCAN_IGNORES.filter((glob) => !/^\.?[a-z]+\/\*\*$/.test(glob) || ['ios/**', 'android/**', 'build/**', 'out/**', 'dist/**', 'web-build/**', 'coverage/**', '.skill-tooling/**'].includes(glob)), 'dist-audit/**', 'reports/**'];

function secrets(repoRoot, report) {
  const { gitignorePatterns, secretFilePattern, denyRules } = FACTS.secrets;
  const gitignore = existsSync(join(repoRoot, '.gitignore')) ? readFileSync(join(repoRoot, '.gitignore'), 'utf8').split('\n').map((line) => line.trim()) : null;
  if (gitignore === null) report.problem({ file: '.gitignore', rule: 'gitignore-secrets', message: 'missing', fix: `Create it with ${gitignorePatterns.join(', ')}.` });
  else for (const pattern of gitignorePatterns) if (!gitignore.includes(pattern)) report.problem({ file: '.gitignore', rule: 'gitignore-secrets', message: `does not ignore ${pattern}`, fix: `Add the line ${pattern} (signing keys, store credentials and build artefacts never enter git).` });
  const secretFile = new RegExp(secretFilePattern);
  // PEM armour only, so prose that names the marker (a checklist's git grep, a skill reference) is not key material.
  const marker = new RegExp(['-----BEGIN ', '(?:[A-Z]+ )*', 'PRIVATE KEY-----'].join(''));
  // repo-scan-walk: deliberate (a key is wrong anywhere in the repo, installed agent skills included)
  for (const rel of walk(repoRoot, { ignore: SECRET_SCAN_IGNORES })) {
    if (secretFile.test(rel)) {
      report.problem({ file: rel, rule: 'secret-file', message: 'a key, keystore or store credential file inside the repo', fix: 'Move it out of the repo (EAS credentials, CI secrets or a folder outside the repo, mode 600). If it was ever committed, revoke and rotate it: git history keeps it.' });
      continue;
    }
    const text = readText(join(repoRoot, rel));
    const found = typeof text === 'string' ? marker.exec(text) : null;
    if (found !== null) report.problem({ file: rel, line: lineAt(text, found.index), rule: 'private-key', message: 'contains private key material', fix: 'Remove it and revoke the key where it was issued (App Store Connect, Google Cloud, the keystore owner); stop and tell the developer.' });
  }
  if (existsSync(join(repoRoot, '.claude', 'settings.json'))) {
    const deny = readRepoJson(repoRoot, '.claude/settings.json')?.permissions?.deny ?? [];
    for (const rule of denyRules) if (!deny.includes(rule)) report.problem({ file: '.claude/settings.json', rule: 'deny-rules', message: `permissions.deny lacks ${rule}`, fix: 'Add it, so an agent never reads key or signing files (other agents: their ignore files, references/secrets.md).' });
  }
}

/** Data safety "Data is encrypted in transit": no first-party collection, or every remote URL the app holds is https/wss. */
function encryptedInTransit(ctx) {
  const { contract, layout } = ctx;
  if (allCollects(ctx.contract).length === 0) return 'yes (nothing is collected)';
  if (contract.profile === 'offline-only') return 'yes (only the SDKs send data, over TLS)';
  for (const rel of ctx.files.filter((file) => matchesAny(file, urlSeams(contract, layout)))) {
    const text = maskComments(ctx.sources.get(rel));
    const plain = [...text.matchAll(REMOTE_URL)].find((match) => /^(?:http|ws|ftp):/i.test(match[2]));
    if (plain !== undefined) return `NO: ${rel}:${lineAt(text, plain.index)} holds ${plain[2]} (make it https before answering yes)`;
  }
  return 'yes (every URL the app holds is https; the SDKs send over TLS)';
}

function printAnswers(ctx) {
  const { contract, report } = ctx;
  report.note('Store answers from contracts/privacy.json (the developer enters them in App Store Connect and Play Console):');
  const rows = new Map();
  for (const row of allCollects(contract)) {
    const merged = rows.get(row.type) ?? { type: row.type, owners: [], linked: false, tracking: false, shared: false, optional: true, purposes: new Set(), sharedPurposes: new Set() };
    merged.owners.push(row.owner);
    merged.linked ||= row.linked;
    merged.tracking ||= row.tracking;
    merged.shared ||= row.shared === true;
    merged.optional &&= row.optional === true;
    for (const purpose of row.purposes) {
      merged.purposes.add(purpose);
      if (row.shared === true) merged.sharedPurposes.add(purpose);
    }
    rows.set(row.type, merged);
  }
  if (rows.size === 0) report.note('  App Privacy: Data Not Collected · Data safety: no data collected or shared');
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const play = (purposes) => unique([...purposes].map((purpose) => DATA_TYPES.purposes[purpose].play)).join(', ');
  const sorted = [...rows.values()].sort((a, b) => a.type.localeCompare(b.type));
  // App Privacy has fewer types than Data safety (emails and texts are one Apple type; files, calendar events and
  // installed apps have none), so its lines merge by Apple label and Play-only types print no App Privacy line.
  const appleRows = new Map();
  for (const row of sorted) {
    const label = DATA_TYPES.types[row.type].apple;
    if (label === null) continue;
    const merged = appleRows.get(label) ?? { owners: [], linked: false, tracking: false, purposes: new Set() };
    merged.owners.push(...row.owners);
    merged.linked ||= row.linked;
    merged.tracking ||= row.tracking;
    for (const purpose of row.purposes) merged.purposes.add(purpose);
    appleRows.set(label, merged);
  }
  for (const [label, row] of appleRows) {
    const apple = unique([...row.purposes].map((purpose) => DATA_TYPES.purposes[purpose].apple));
    report.note(`  App Privacy: ${label} · ${row.linked ? 'linked to the user' : 'not linked'} · ${row.tracking ? 'used for tracking' : 'not used for tracking'} · ${(apple.length > 0 ? apple : ['App Functionality']).join(', ')} (${unique(row.owners).join(', ')})`);
  }
  // Data safety merges by Play label too (performance-data and other-diagnostic-data are both Diagnostics).
  const playRows = new Map();
  for (const row of sorted) {
    const facts = DATA_TYPES.types[row.type];
    const merged = playRows.get(facts.play) ?? { owners: [], shared: false, optional: true, purposes: new Set(), sharedPurposes: new Set(), playOnly: true };
    merged.owners.push(...row.owners);
    merged.shared ||= row.shared;
    merged.optional &&= row.optional;
    merged.playOnly &&= facts.apple === null;
    for (const purpose of row.purposes) merged.purposes.add(purpose);
    for (const purpose of row.sharedPurposes) merged.sharedPurposes.add(purpose);
    playRows.set(facts.play, merged);
  }
  for (const [label, row] of playRows) {
    report.note(`  Data safety: ${label} · collected${row.shared ? ', shared' : ''} · ${row.optional ? 'optional' : 'required'} · collection purposes: ${play(row.purposes)}${row.shared ? ` · sharing purposes: ${play(row.sharedPurposes)}` : ''} (${unique(row.owners).join(', ')})${row.playOnly ? ' (Data safety only: App Privacy has no such type)' : ''}`);
  }
  report.note('  Data safety: security practices');
  report.note(`    Data is encrypted in transit: ${encryptedInTransit(ctx)}`);
  report.note(`    Users can request that their data is deleted: ${deletionAnswer(ctx)}`);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repoRoot = requireDir(positionals[0] ?? '.', 'repo root');
  const root = options.app ? requireDir(join(repoRoot, options.app), 'app folder (--app)') : repoRoot;
  requireFile(join(root, 'package.json'), "the app's package.json (pass --app <dir> in a multi-package repo)");
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'audit-repo', json: options.json });
  const contractRel = contractPath(layout, options.contract);
  const contractRead = readContract(root, contractRel);
  const contract = contractRead.contract ?? EMPTY_CONTRACT;
  const files = runtimeSourceFiles(root, layout);
  const ctx = {
    root, repoRoot, layout, report, contract, contractRead, contractRel, files,
    sources: new Map(files.map((rel) => [rel, readRepoText(root, rel)])),
    installed: installedPackages(repoRoot, options.app ? posix.normalize(options.app) : '.'),
    configFiles: configSources(root, layout),
    manifestRel: options.manifest ?? `${layout.configDir}/privacy-manifest.ts`,
    guardFile: `${layout.servicesDir}/test-hooks/network-guard.ts`,
    appInRepo: options.app ? posix.normalize(options.app) : '.',
  };
  contractProblems(ctx);
  layerA(ctx);
  if (contractRead.contract !== null) {
    sdkInventory(ctx);
    storeAnswers(ctx);
    permissionAnswers(ctx);
    profilePolicy(ctx);
    podLayer(ctx);
    if (options['gradle-deps']) mavenLayer(ctx, options['gradle-deps']);
  }
  privacyManifest(ctx);
  tooling(ctx);
  secrets(repoRoot, report);
  if (options.answers && contractRead.contract !== null) printAnswers(ctx);
  return report.finish({ checked: files.length, unit: 'source files' });
});

