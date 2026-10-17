// consent-rules.mjs: check-ads.mjs's consent, ATT and SDK-boundary rules. Each takes the scan
// context (lib/ads-facts.mjs) and the reporter. Not an entry point.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments, notYetCreated } from '../check-lib.mjs';
import { FACTS, SDK, TRACKING } from './ads-facts.mjs';
import { callRanges, importsModule, isTestFile, lineAt, packageJsonFiles, parseImports, readRepoJson, readRepoText } from './repo-scan.mjs';

export function checkRequiredFiles(ctx, report, groups) {
  const { layout } = ctx;
  const bases = {
    ads: ctx.adsDir, consent: ctx.consentDir, config: layout.configDir, hooks: `${layout.srcDir}/hooks`,
    ui: layout.uiDir, connectivity: `${layout.servicesDir}/connectivity`, scripts: layout.scriptsDir, mocks: layout.mocksDir,
    tracking: ctx.consentDir, trackingMock: layout.mocksDir,
  };
  for (const group of groups) {
    for (const name of FACTS.files[group]) {
      const rel = `${bases[group]}/${name}`;
      if (!existsSync(join(ctx.root, rel))) report.problem({ file: rel, rule: 'required-file', message: 'missing', fix: `Copy templates/${rel.replace(layout.srcDir, 'src')} from the admob-ads-and-consent skill (keep its path) and adapt it.` });
    }
  }
}

export function checkPins(ctx, report) {
  for (const rel of packageJsonFiles(ctx.root)) {
    const json = readRepoJson(ctx.root, rel);
    for (const field of ['dependencies', 'devDependencies']) {
      const spec = json?.[field]?.[SDK];
      if (spec !== undefined && spec !== FACTS.sdk.version) {
        report.problem({ file: rel, rule: 'sdk-pin', message: `${field}.${SDK} is "${spec}", not exactly "${FACTS.sdk.version}"`, fix: `Run npm install -E ${SDK}@${FACTS.sdk.version} (npx expo install writes a caret: the package is not in the Expo SDK map).` });
      }
    }
  }
}

export function checkSdkImports(ctx, report) {
  for (const rel of ctx.runtime.filter((file) => !isTestFile(file))) {
    for (const imp of parseImports(ctx.sources.get(rel))) {
      if (imp.specifier !== SDK && !imp.specifier.startsWith(`${SDK}/`)) continue;
      const allowed = ctx.adapters[rel];
      if (allowed === undefined) {
        report.problem({ file: rel, line: imp.line, rule: 'sdk-import', message: `imports ${SDK} outside its adapters`, fix: 'Go through AdsPort and ConsentPort; only admob-ads-adapter.ts, admob-consent-adapter.ts and the test-only admob-consent-debug-adapter.ts import the SDK.' });
        continue;
      }
      for (const name of imp.names.filter((item) => !allowed.includes(item))) {
        const banned = FACTS.bannedSdkNames.includes(name);
        report.problem({ file: rel, line: imp.line, rule: 'sdk-api', message: `imports ${name} from ${SDK}${banned ? ' (v17 hooks, pools and other formats are not used)' : ''}`, fix: 'Keep the classic create/load/show API of the template: hooks tie ads to a component and pools preload before consent; pacing lives in ad-policy.ts.' });
      }
    }
  }
}

export function checkDebugAdapterImports(ctx, report) {
  const base = ctx.debugAdapter.split('/').pop();
  for (const rel of ctx.runtime.filter((file) => file !== ctx.debugAdapter && !isTestFile(file) && !ctx.isTestOnly(file))) {
    for (const imp of parseImports(ctx.sources.get(rel))) {
      // import type { ConsentDebugTools } is erased by the compiler: no code reaches a bundle.
      if (imp.isType || !importsModule(imp.specifier, base)) continue;
      report.problem({ file: rel, line: imp.line, rule: 'debug-adapter-import', message: 'imports the consent debug adapter outside test-only code', fix: 'Import it only from the test-only entry (src/test-only-entry.ts), which production bundles drop through the test-only gate (debug-menu-and-test-hooks).' });
    }
  }
}

export function checkTestOnlyCalls(ctx, report) {
  const patterns = FACTS.testOnlyCalls.map((call) => new RegExp(`\\b${call.replace('.', '\\s*\\.\\s*')}\\s*\\(`));
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && file !== ctx.debugAdapter && !ctx.isTestOnly(file))) {
    const text = ctx.masked.get(rel);
    for (const re of patterns) {
      const match = re.exec(text);
      if (match) report.problem({ file: rel, line: lineAt(text, match.index), rule: 'test-only-api', message: `${match[0].replace(/\s+/g, '')}...) outside the test-only debug adapter`, fix: 'Move it into admob-consent-debug-adapter.ts, reachable only from the test-only entry: it changes consent behaviour for real users.' });
    }
  }
}

// UMP's debug geography (and its test devices) makes any network answer as the EEA or as elsewhere.
// Only test-build code may set it; the store path passes only { onError }.
export function checkDebugGeography(ctx, report) {
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && file !== ctx.consentAdapter && !ctx.isTestOnly(file))) {
    const text = ctx.masked.get(rel);
    for (const match of text.matchAll(/\b(debugGeography|testDeviceIdentifiers)\s*:|\b(AdsConsentDebugGeography)\b/g)) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'debug-geography-test-only', message: `${match[1] ?? match[2]} is set outside test-only code, so a store build could ask UMP with a debug geography`, fix: 'Pass only { tracking, onError } to createAdmobConsentAdapter on the store path; a test build builds its own consent port with { debugGeography, tracking, onError } in test-only code.' });
    }
  }
}

/** A call of `callee` that does not sit inside the arguments of a call of `factory`. */
export function callsOutsideFactory(text, callee, factory) {
  const inside = callRanges(text, [factory]);
  return [...text.matchAll(new RegExp(`\\b${callee}\\s*\\(`, 'g'))].filter((match) => !inside.some((range) => match.index > range.start && match.index < range.end));
}

// An ADS_MODE=off build (screenshots, E2E, the network audit) must never ask Google's UMP: the
// consent adapter is created only inside createConsentPort(adsMode, () => createAdmobConsentAdapter(...)).
export function checkConsentFactory(ctx, report) {
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && !file.startsWith(`${ctx.consentDir}/`) && !ctx.isTestOnly(file))) {
    const text = ctx.masked.get(rel);
    for (const match of callsOutsideFactory(text, 'createAdmobConsentAdapter', 'createConsentPort')) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'consent-factory', message: 'createAdmobConsentAdapter() is called outside createConsentPort()', fix: 'In the composition root: consent: createConsentPort(adsExtra.adsMode, () => createAdmobConsentAdapter({ tracking, onError })), so an ADS_MODE=off build never asks Google UMP (a network request from the app).' });
    }
  }
}

export function checkAdsFactory(ctx, report) {
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && !file.startsWith(`${ctx.adsDir}/`) && !ctx.isTestOnly(file))) {
    const text = ctx.masked.get(rel);
    for (const match of callsOutsideFactory(text, 'createAdmobAdsAdapter', 'createAdsPort')) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'ads-factory', message: 'createAdmobAdsAdapter() is called outside createAdsPort()', fix: 'In the composition root: ads: createAdsPort(readAdsExtraForBinary(Application.applicationId), { platform, createAdmob: (units) => createAdmobAdsAdapter({ units, onAdError }) }), so the ads mode decides (off: no SDK, test: test units, live: this platform\'s units).' });
    }
  }
}

// Apple's tracking prompt goes through ConsentPort.requestTracking(): only the tracking adapter
// (expo-tracking-consent-adapter.ts) imports expo-tracking-transparency, and only the permission calls.
export function checkTrackingImports(ctx, report) {
  for (const rel of ctx.runtime.filter((file) => !isTestFile(file))) {
    for (const imp of parseImports(ctx.sources.get(rel))) {
      if (imp.specifier !== TRACKING && !imp.specifier.startsWith(`${TRACKING}/`)) continue;
      if (rel !== ctx.trackingAdapter) {
        report.problem({ file: rel, line: imp.line, rule: 'att-adapter-only', message: `imports ${TRACKING} outside the tracking adapter`, fix: `Ask through ConsentPort.requestTracking() (inside prepareAds); only ${ctx.trackingAdapter} imports ${TRACKING}.` });
        continue;
      }
      for (const name of imp.names.filter((item) => !FACTS.tracking.allowedNames.includes(item))) {
        report.problem({ file: rel, line: imp.line, rule: 'att-adapter-only', message: `imports ${name} from ${TRACKING}`, fix: `Use only ${FACTS.tracking.allowedNames.join(', ')}; the IDFA itself is the ads SDK's business, never the app's.` });
      }
    }
  }
}

/** A flat or nested catalog value. */
function catalogValue(json, key) {
  if (json === null || typeof json !== 'object') return undefined;
  if (typeof json[key] === 'string') return json[key];
  return key.split('.').reduce((node, part) => (node !== null && typeof node === 'object' ? node[part] : undefined), json);
}

// Apple's prompt needs NSUserTrackingUsageDescription (without it expo-tracking-transparency stops the
// app): the plugin entry with the source text, the localised text for every language, the package.
// One writer only: the AdMob plugin's userTrackingUsageDescription stays unset. A child-directed app
// is the opposite: Kids Category apps do not implement ATT (App Review guideline 1.3), so the plugin,
// the localised key, the package and the tracking adapter are all absent.
export function checkTrackingPlugin(ctx, contract, report) {
  const { root, layout } = ctx;
  const configText = ctx.config.map((rel) => ctx.masked.get(rel)).join('\n');
  const appConfig = ctx.config.find((rel) => rel.startsWith('app.config')) ?? 'app.config.ts';
  const pluginEntry = new RegExp(`\\[\\s*['"]${TRACKING}['"]`);
  const pkg = readRepoJson(root, 'package.json');
  if (contract?.audience === 'child-directed') {
    const fix = 'A child-directed app never asks ATT (App Review 1.3; App Privacy: data not used for tracking): remove the expo-tracking-transparency plugin entry, NSUserTrackingUsageDescription from every locale, the package (npm uninstall expo-tracking-transparency), its root mock and expo-tracking-consent-adapter.ts, and pass tracking: null to createAdmobConsentAdapter.';
    const config = ctx.config.find((rel) => pluginEntry.test(ctx.masked.get(rel)) || /\bNSUserTrackingUsageDescription\b/.test(ctx.masked.get(rel)));
    if (pluginEntry.test(configText)) report.problem({ file: config ?? appConfig, rule: 'att-plugin', message: `a child-directed app lists the ${TRACKING} plugin`, fix });
    if (/\bNSUserTrackingUsageDescription\b/.test(configText)) report.problem({ file: config ?? appConfig, rule: 'att-plugin', message: 'a child-directed app writes NSUserTrackingUsageDescription', fix });
    for (const field of ['dependencies', 'devDependencies']) {
      if (pkg?.[field]?.[TRACKING] !== undefined) report.problem({ file: 'package.json', rule: 'att-plugin', message: `a child-directed app depends on ${TRACKING}`, fix });
    }
    if (existsSync(join(root, ctx.trackingAdapter))) report.problem({ file: ctx.trackingAdapter, rule: 'att-plugin', message: 'a child-directed app keeps the ATT adapter', fix });
    return;
  }
  if (!new RegExp(`\\[\\s*['"]${TRACKING}['"]\\s*,\\s*\\{[^}]*userTrackingPermission\\s*:`).test(configText)) {
    report.problem({ file: appConfig, rule: 'att-plugin', message: `no ['${TRACKING}', { userTrackingPermission }] entry in the plugin list`, fix: `Add ['${TRACKING}', { userTrackingPermission: <the source language's text of the tracking catalog key> }] to the app config's plugins.` });
  }
  if (!/\bNSUserTrackingUsageDescription\b/.test(configText)) {
    report.problem({ file: appConfig, rule: 'att-plugin', message: 'the app config writes no localised NSUserTrackingUsageDescription', fix: 'Write it for every language in the config\'s locales (locales.<lang>.ios.NSUserTrackingUsageDescription, from the catalogs; i18n-strings-and-catalogs\' native locales do it).' });
  }
  if (pkg?.dependencies?.[TRACKING] === undefined) {
    report.problem({ file: 'package.json', rule: 'att-plugin', message: `${TRACKING} is not a dependency (its plugin cannot resolve)`, fix: `npx expo install ${TRACKING} (the Expo SDK map gives ${FACTS.tracking.spec}).` });
  }
  const catalogs = `${layout.i18nDir}/catalogs`;
  const reason = notYetCreated(root, { file: catalogs, owner: 'i18n-strings-and-catalogs' });
  if (reason) {
    report.skip({ file: catalogs, rule: 'att-plugin', message: reason });
    return;
  }
  const key = contract?.trackingTextKey ?? FACTS.tracking.defaultTextKey;
  for (const name of readdirSync(join(root, catalogs)).filter((file) => file.endsWith('.json')).sort()) {
    const rel = `${catalogs}/${name}`;
    const text = catalogValue(readRepoJson(root, rel), key);
    if (typeof text !== 'string' || text.trim() === '') report.problem({ file: rel, rule: 'att-plugin', message: `no "${key}" text in ${name.replace('.json', '')}`, fix: 'Add the tracking purpose text to every language (i18n-strings-and-catalogs): iOS shows it in the system prompt.' });
  }
}

// The composition root hands the consent adapter its ATT half: createExpoTrackingConsentAdapter(...)
// for a general audience (null would silently never ask, and the ads SDK would never get the IDFA
// of a user who allows it); tracking: null for a child-directed app, which never asks.
export function checkTrackingWiring(ctx, contract, report) {
  const isChild = contract?.audience === 'child-directed';
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && !file.startsWith(`${ctx.consentDir}/`))) {
    const text = ctx.masked.get(rel);
    for (const call of callRanges(text, ['createAdmobConsentAdapter'])) {
      const args = text.slice(call.start, call.end);
      const add = (message, fix) => report.problem({ file: rel, line: lineAt(text, call.start), rule: 'att-wiring', message, fix });
      if (isChild && !/\btracking\s*:\s*null\b/.test(args)) add('a child-directed app hands the consent adapter an ATT request', 'Pass tracking: null: Kids Category apps do not implement ATT (App Review 1.3).');
      if (!isChild && (/\btracking\s*:\s*null\b/.test(args) || !/\bcreateExpoTrackingConsentAdapter\s*\(/.test(text))) add("the consent adapter gets no ATT request: Apple's prompt is never shown", 'Pass tracking: createExpoTrackingConsentAdapter({ onError }) (or record "audience": "child-directed" in contracts/ads.json and follow that profile).');
    }
  }
}

/** The AdMob plugin's own ATT string would be a second writer of NSUserTrackingUsageDescription. */
export function checkNoSecondTrackingWriter(ctx, report) {
  for (const rel of [...ctx.config, ...ctx.runtime].filter((file) => !isTestFile(file))) {
    const text = ctx.masked.get(rel);
    for (const match of text.matchAll(/\buserTrackingUsageDescription\b/g)) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'att-plugin', message: 'userTrackingUsageDescription is set (a second writer of the ATT text)', fix: 'Remove it: the expo-tracking-transparency plugin and the config\'s locales write NSUserTrackingUsageDescription.' });
    }
  }
}

/** The body of `export async function prepareAds` (masked), or ''. */
function prepareAdsBody(text) {
  const start = text.search(/export\s+async\s+function\s+prepareAds\b/);
  if (start < 0) return { body: '', start: -1 };
  const end = text.indexOf('\n}', start);
  return { body: text.slice(start, end < 0 ? undefined : end), start };
}

// The order inside prepareAds: Google's form and the canRequestAds check, then requestTracking(),
// then initialize(): Apple's prompt never before Google's form, no ad request before the answer.
export function checkTrackingOrder(ctx, report) {
  const rel = `${ctx.adsDir}/ad-gate.ts`;
  if (!existsSync(join(ctx.root, rel))) return; // required-file reports it
  const text = maskComments(readRepoText(ctx.root, rel));
  const { body, start } = prepareAdsBody(text);
  const add = (index, message) => report.problem({ file: rel, line: lineAt(text, Math.max(start, 0) + Math.max(index, 0)), rule: 'att-order', message, fix: 'In prepareAds: refresh, then (where required) the primer and Google\'s form, then `if (!info.canRequestAds) return false;`, then `await deps.consent.requestTracking();`, then `await deps.ads.initialize();` and the preloads.' });
  if (start < 0) {
    add(0, 'no prepareAds() in the ad gate');
    return;
  }
  const at = (re) => body.search(re);
  const tracking = at(/\.requestTracking\s*\(/);
  const form = Math.max(at(/\bconsentThroughIntro\s*\(/), at(/\.showFormIfRequired\s*\(/));
  const allowed = at(/\bcanRequestAds\b/);
  const initialize = at(/\.initialize\s*\(/);
  if (tracking < 0) add(0, 'prepareAds never asks Apple\'s tracking prompt (ConsentPort.requestTracking)');
  else {
    if (form >= 0 && tracking < form) add(tracking, 'requestTracking() runs before Google\'s form');
    if (allowed >= 0 && tracking < allowed) add(tracking, 'requestTracking() runs before the canRequestAds check (a user who allowed no ads would be asked)');
    if (initialize >= 0 && tracking > initialize) add(tracking, 'requestTracking() runs after initialize(): the SDK may request an ad before the ATT answer');
  }
}

