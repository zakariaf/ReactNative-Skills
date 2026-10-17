#!/usr/bin/env node
// check-crash-reporting.mjs: proves an Expo app's crash reporting follows the
// crash-reporting-and-observability rules: Sentry behind one adapter, started only on consent,
// privacy-first options, one rejection tracker, a root kit that forwards the error net's reports,
// breadcrumbs without content,
// debug IDs, the config plugin, symbol uploads per release profile, OTA source maps, the upload
// token kept out of the repo, and a contract that matches the store declarations.
// Usage: node check-crash-reporting.mjs [repo-root] [options]
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, createReporter, notYetCreated, parseArgs, readProjectConfig, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { extractBlock } from './lib/object-literal.mjs';
import { isTestFile } from './lib/source-scan.mjs';
import {
  SENTRY_PACKAGE,
  braceDepth,
  entryMap,
  factoryBody,
  findBodyOpen,
  firstArgument,
  isGitIgnored,
  lineAt,
  lineOfMatch,
  localImportNames,
  parseJson,
  readMaybe,
  resolveOptionsObject,
  runsInFactoryBody,
  scanFile,
  sdkCalls,
  sentryBindings,
} from './lib/crash-scan.mjs';

const SPEC = {
  name: 'check-crash-reporting',
  summary:
    'Checks crash reporting in an Expo app: @sentry/react-native behind one CrashReporterPort adapter, started only on consent, privacy-first options, one rejection tracker, the root kit that forwards the error net\'s reports, content-free breadcrumbs, debug IDs, the config plugin, symbol uploads, OTA source maps, the upload token and the contract.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'App folder relative to the repo root (when multi-package); default: the root' },
    contract: { type: 'string', value: 'file', help: 'The contract (default: rn-skills.config.json "crashReportingContract", else <contractsDir>/crash-reporting.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  sdk-package          sentry-expo is not installed (superseded by @sentry/react-native)',
    '  sdk-import           only <servicesDir>/<concern>/sentry-*-adapter.ts imports @sentry/react-native (tests may jest.mock it);',
    '                       the root entry files (package.json "main", index.*, App.*) are read too',
    '  adapter-single       exactly one adapter imports the SDK',
    '  init-scope           Sentry.init runs in a function the adapter factory defines (the setConsent path), never at module',
    '                       scope or directly in the create*Adapter body',
    '  init-options         the init options are readable: an object literal, a local const or a local function returning one',
    '  pii-default          the options say sendDefaultPii: false',
    '  screen-capture       no attachScreenshot/attachViewHierarchy true, no Session Replay or feedback widget, no enableLogs,',
    '                       no enableCaptureFailedRequests',
    '  scrub-hooks          beforeSend, beforeSendTransaction and beforeBreadcrumb call the scrubber imported from a local module',
    '  environment-set      the options set environment (the variant)',
    '  release-native       the options set no release or dist (the native build names them)',
    '  rejection-tracker    integrations has reactNativeErrorHandlersIntegration({ onunhandledrejection: false })',
    '  trace-rate           tracesSampleRate, profilesSampleRate, TRACES_SAMPLE_RATE and PROFILES_SAMPLE_RATE literals are at most',
    '                       the contract maxTracesSampleRate; no tracesSampler',
    '  no-wrap              no Sentry.wrap or TouchEventBoundary (touch breadcrumbs carry on-screen text)',
    '  no-user-identity     no SDK setUser(...) other than setUser(null), and no setUser member on the port',
    '  sink-forwarding      FORWARDED_SOURCES is exactly render and unhandled-rejection (never global-handler)',
    '  sink-connected       the crash reporting root kit forwards the error net\'s reports (forward: createCrashForwarder(...)) and',
    '                       is registered: createRootKits (src/services/create-root-kits.ts) calls createCrashReportingKit(...)',
    '  capture-recorded     the reporter sits behind the error log (architecture-and-boundaries\' ErrorLogPort): outside the',
    '                       reporter files, a captureException(...) call follows an error-log record(...) in the same function',
    '  consent-applied      the app calls useCrashReportingConsent (the kit\'s effects) or setConsent outside the adapter and the',
    '                       fake, and never from the composition root, the root-kit registry, the root layout, a root entry file or',
    '                       startApp (that would start before the first frame), and never as a literal setConsent(true), isGranted:',
    '                       true or fixedCrashConsent(true) (that ignores the saved choice); a setConsent',
    '                       call counts only when its receiver names the crash reporter or its argument is a boolean',
    '                       (analytics.setConsent(\'granted\') is another port)',
    '  consent-default      the settings default of crashReportsEnabled matches the contract consentModel',
    '  route-breadcrumbs    a file that adds breadcrumbs does not read usePathname/useLocalSearchParams/useGlobalSearchParams',
    '  metro-debug-ids      the Metro config is built with getSentryExpoConfig or withSentryConfig: in metro.config, or, when it',
    '                       composes the Metro slot (readMetroKits), in a kit of scripts/metro/metro-kits.ts',
    '  config-plugin        the app config lists @sentry/react-native/expo with organization and project',
    '  plugin-auth-token    the app config holds no authToken and reads no SENTRY_AUTH_TOKEN',
    '  upload-not-disabled  no upload profile (contract uploadProfiles) sets SENTRY_DISABLE_AUTO_UPLOAD, SENTRY_ALLOW_FAILURE or a',
    '                       SENTRY_DISABLE_*_DEBUG_UPLOAD to true in eas.json',
    '  optional-deps        no install drops optional dependencies (the sentry-cli binary is one)',
    '  ota-sourcemaps       every script or workflow that runs eas update also runs sentry-expo-upload-sourcemaps; every',
    '                       EAS Workflows type: update job sets upload_sentry_sourcemaps: true (or uploads in after_update)',
    '  token-files          no committed .sentryclirc or sentry.properties with a token, .env.sentry-build-plugin git-ignored',
    '  contract             the contract exists and is valid',
    '  declaration          contract declarations include performance-data whenever a sample rate is above 0',
    '  privacy-sync         contracts/privacy.json (privacy-and-store-declarations) declares @sentry/react-native with exactly',
    '                       the contract\'s collects, each not linked and not tracking (SKIP until that file exists)',
    'SKIP eas.json [upload-not-disabled] when eas.json is not yet created (eas-build-and-submit creates it).',
    'NOT APPLICABLE when package.json lists no @sentry/react-native (and no sentry-expo), or when it is installed but no',
    'app code, config plugin, Metro config or crash reporting contract uses it yet.',
    'rn-skills.config.json keys read: "crashReportingContract" (path of the contract).',
  ].join('\n'),
};

const RULE_FIX = {
  adapter: 'Copy templates/src/services/crash-reporter/sentry-crash-reporter-adapter.ts (the one file that imports the SDK).',
};
const CAPTURE_KEYS = ['attachScreenshot', 'attachViewHierarchy', 'enableLogs', 'enableCaptureFailedRequests'];
const REPLAY_KEYS = ['replaysSessionSampleRate', 'replaysOnErrorSampleRate'];
const CAPTURE_CALLS = ['mobileReplayIntegration', 'feedbackIntegration', 'FeedbackWidget', 'FeedbackButton', 'showFeedbackWidget'];
const DISABLE_VARS = ['SENTRY_DISABLE_AUTO_UPLOAD', 'SENTRY_ALLOW_FAILURE', 'SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD', 'SENTRY_DISABLE_XCODE_DEBUG_UPLOAD'];
const ROUTE_VALUE_HOOKS = ['usePathname', 'useLocalSearchParams', 'useGlobalSearchParams'];
const COLLECTS = ['crash-data', 'other-diagnostic-data', 'performance-data'];
const DEFAULT_CONTRACT = { maxTracesSampleRate: 0.2, uploadProfiles: ['preview', 'production'], consentModel: 'opt-in', collects: ['crash-data'] };
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
/** The app's Metro kits file, which the canonical metro.config.js composes (app-startup-and-bootstrap's Metro slot). */
const METRO_KITS_FILE = 'scripts/metro/metro-kits.ts';
/** `eas update`, `npx eas-cli update`, `npx eas-cli@18 update`; not `eas update:list` and the other subcommands. */
const EAS_UPDATE = /\beas(?:-cli(?:@[\w.^~-]+)?)?\s+update(?![:\w-])/;
/** Root-level entry files (index.ts, App.tsx, ...); tool configs (app.config, metro.config, babel.config) are not. */
const ROOT_ENTRY = /^(?:index|App)\.(?:[cm]?[jt]sx?)$/;

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repoRoot = positionals[0] ?? '.';
  const root = options['app-dir'] ? join(repoRoot, options['app-dir']) : repoRoot;
  const report = createReporter({ name: SPEC.name, json: options.json });
  const pkgText = readMaybe(root, 'package.json');
  if (pkgText === null) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run the checker from the app root or pass it as the first argument (multi-package: --app-dir apps/<app>).');
  const pkg = parseJson(pkgText);
  if (pkg.error) throw new UsageError(`package.json is not valid JSON: ${pkg.error}`, 'Fix package.json.');
  const deps = { ...pkg.value.dependencies, ...pkg.value.devDependencies };
  if (deps['sentry-expo']) {
    report.problem({ file: 'package.json', line: lineOfMatch(pkgText, '"sentry-expo"'), rule: 'sdk-package', message: 'sentry-expo is installed; it is superseded by @sentry/react-native and does not support current Expo SDKs', fix: 'npm uninstall sentry-expo; npx expo install @sentry/react-native; move its plugin entry to "@sentry/react-native/expo".' });
  }
  if (!deps[SENTRY_PACKAGE]) {
    if (deps['sentry-expo']) return report.finish({ checked: 1, unit: 'files' });
    return report.notApplicable(`${SENTRY_PACKAGE} is not in package.json`);
  }

  const layout = resolveLayout(root);
  const ctx = collect(root, layout, pkg.value);
  const contractRel = options.contract ?? readProjectConfig(root).crashReportingContract ?? `${layout.contractsDir}/crash-reporting.json`;
  const hasEvidence = ctx.sentryFiles.length > 0 || ctx.appConfig?.text.includes(SENTRY_PACKAGE) || ctx.metro?.text.includes(SENTRY_PACKAGE) || ctx.metroKits?.text.includes(SENTRY_PACKAGE) || existsSync(join(root, layout.servicesDir, 'crash-reporter')) || existsSync(join(root, contractRel));
  if (!hasEvidence) return report.notApplicable(`${SENTRY_PACKAGE} is installed, but no app code, config plugin, Metro config or crash reporting contract uses it yet`);

  const contract = checkContract(root, contractRel, report);
  checkImports(ctx, layout, report);
  const rates = checkAdapter(ctx, layout, contract, report);
  checkRates(ctx, layout, contract, report, rates);
  checkIdentityAndWrap(ctx, report);
  checkSink(ctx, layout, report);
  checkCaptureRecorded(ctx, layout, report);
  checkConsent(ctx, layout, contract, report);
  checkRouteBreadcrumbs(ctx, report);
  checkDeclaration(contract, contractRel, rates, report);
  checkPrivacySync(root, layout, contract, report);
  checkMetro(ctx, report);
  checkAppConfig(ctx, report);
  checkEas(root, contract, report);
  checkOptionalDeps(root, pkg.value, pkgText, report);
  checkOtaSourcemaps(root, pkg.value, pkgText, report);
  checkTokenFiles(root, report);
  return report.finish({ checked: ctx.files.length + 4, unit: 'files' });
});

/** Every app source file, scanned, plus the root entry files and the root config files. */
function collect(root, layout, pkg) {
  const prefixes = [`${layout.srcDir}/`, `${layout.routesDir}/`];
  const inApp = (rel) => prefixes.some((prefix) => rel.startsWith(prefix));
  const rels = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'] })
    .filter((rel) => inApp(rel) && CODE_FILE.test(rel) && !rel.endsWith('.d.ts'));
  const entryRels = entryFiles(root, pkg).filter((rel) => !inApp(rel));
  const files = [...rels, ...entryRels].map((rel) => ({ rel, isTest: isTestFile(rel), ...scanFile(readMaybe(root, rel)) }));
  const sentryFiles = files.filter((file) => file.imports.some((entry) => isSentrySpec(entry.spec)));
  const appConfigRel = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'].find((rel) => existsSync(join(root, rel)));
  const metroRel = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'].find((rel) => existsSync(join(root, rel)));
  const fileOf = (rel) => (rel ? { rel, text: readMaybe(root, rel), masked: scanFile(readMaybe(root, rel)).masked } : null);
  const metro = fileOf(metroRel);
  // The canonical metro.config.js composes the Metro slot: the kits live in scripts/metro/metro-kits.ts.
  const usesSlot = metro !== null && /\breadMetroKits\s*\(/.test(metro.masked);
  const metroKits = usesSlot && existsSync(join(root, METRO_KITS_FILE)) ? fileOf(METRO_KITS_FILE) : null;
  return { root, files, entryRels, sentryFiles, appConfig: fileOf(appConfigRel), metro, usesSlot, metroKits };
}

/**
 * The files that run before any route module: package.json "main" when it names a local file
 * (`index.ts`, `./src/main.tsx`; not a package such as `expo-router/entry`), and every root-level
 * index.* or App.* code file. Sentry's manual setup puts Sentry.init there, and the ESLint vendor
 * ban (src/**) does not reach them.
 */
function entryFiles(root, pkg) {
  const found = new Set();
  const main = typeof pkg.main === 'string' ? pkg.main.replace(/^\.\//, '') : '';
  if (main !== '' && !main.startsWith('/') && !main.startsWith('..')) {
    const candidates = CODE_FILE.test(main) ? [main] : ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].map((ext) => `${main}.${ext}`);
    const hit = candidates.find((rel) => existsSync(join(root, rel)) && statSync(join(root, rel)).isFile());
    if (hit) found.add(hit);
  }
  for (const name of readdirSync(root)) {
    if (ROOT_ENTRY.test(name) && statSync(join(root, name)).isFile()) found.add(name);
  }
  return [...found].sort();
}

function isSentrySpec(spec) {
  return spec === SENTRY_PACKAGE || spec.startsWith('@sentry/') || spec === 'sentry-expo' || spec.startsWith('sentry-expo/');
}

function adapterPattern(layout) {
  const services = layout.servicesDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${services}/[^/]+/sentry-[a-z0-9-]*adapter(?:\\.(?:ios|android|native|web))?\\.tsx?$`);
}

function checkImports(ctx, layout, report) {
  const isAdapter = adapterPattern(layout);
  for (const file of ctx.sentryFiles) {
    if (file.isTest) continue;
    for (const entry of file.imports.filter((item) => isSentrySpec(item.spec))) {
      if (isAdapter.test(file.rel) && entry.spec === SENTRY_PACKAGE) continue;
      const where = ctx.entryRels.includes(file.rel) ? ' (an entry file runs before the first frame and before any consent, and the ESLint vendor ban does not reach it)' : '';
      report.problem({ file: file.rel, line: entry.line, rule: 'sdk-import', message: `imports ${entry.spec}; only the CrashReporterPort adapter may import the SDK (${layout.servicesDir}/crash-reporter/sentry-crash-reporter-adapter.ts)${where}`, fix: 'Report through services.crashReporter (CrashReporterPort); config-time subpaths (/expo, /metro) belong in app.config and metro.config only.' });
    }
  }
}

/** Checks the adapter's init call and options; returns the sample-rate literals it found. */
function checkAdapter(ctx, layout, contract, report) {
  const isAdapter = adapterPattern(layout);
  const adapters = ctx.sentryFiles.filter((file) => !file.isTest && isAdapter.test(file.rel) && file.imports.some((entry) => entry.spec === SENTRY_PACKAGE));
  const expected = `${layout.servicesDir}/crash-reporter/sentry-crash-reporter-adapter.ts`;
  if (adapters.length === 0) {
    report.problem({ file: expected, line: 1, rule: 'adapter-single', message: `no adapter imports ${SENTRY_PACKAGE}, so nothing reports through CrashReporterPort`, fix: RULE_FIX.adapter });
    return [];
  }
  for (const extra of adapters.slice(1)) {
    report.problem({ file: extra.rel, line: 1, rule: 'adapter-single', message: `a second adapter imports ${SENTRY_PACKAGE} (the first is ${adapters[0].rel})`, fix: 'Keep one Sentry adapter: two would init the SDK twice and split the privacy options.' });
  }
  const adapter = adapters[0];
  const bindings = sentryBindings(adapter.masked);
  const inits = sdkCalls(adapter.code, bindings, 'init');
  if (inits.length === 0) {
    report.problem({ file: adapter.rel, line: 1, rule: 'init-scope', message: 'the adapter never calls Sentry.init', fix: 'Start the SDK inside setConsent(true), as templates/src/services/crash-reporter/sentry-crash-reporter-adapter.ts does.' });
    return [];
  }
  const factory = factoryBody(adapter.code);
  const misplaced = new Set();
  for (const index of inits) {
    if (braceDepth(adapter.code, index) === 0) {
      misplaced.add(index);
      report.problem({ file: adapter.rel, line: lineAt(adapter.text, index), rule: 'init-scope', message: 'Sentry.init runs at module scope: it starts the SDK (and its network) at import time, before the person chose', fix: 'Call Sentry.init only from the adapter function that setConsent(true) runs.' });
    } else if (factory !== null && runsInFactoryBody(adapter.code, factory, index)) {
      misplaced.add(index);
      report.problem({ file: adapter.rel, line: lineAt(adapter.text, index), rule: 'init-scope', message: `Sentry.init runs in the body of ${factory.name}: the composition root creates the adapter during the first render, so the SDK starts (and connects) before the person chose`, fix: 'Move the call into a function the factory defines and only setConsent(true) runs (startSentry in the template).' });
    }
  }
  const main = inits.find((index) => !misplaced.has(index)) ?? inits[0];
  const options = resolveOptionsObject(adapter.masked, firstArgument(adapter.masked, main));
  if (options === null) {
    report.problem({ file: adapter.rel, line: lineAt(adapter.text, main), rule: 'init-options', message: 'cannot read the options Sentry.init receives', fix: 'Pass an object literal, a local const, or a local function that returns one (sentryOptions(dsn, config)).' });
    return sampleRates(adapter);
  }
  checkOptions(adapter, options, report);
  return sampleRates(adapter);
}

function checkOptions(adapter, options, report) {
  const entries = entryMap(options.inner);
  const at = (key) => (entries.has(key) ? lineAt(adapter.text, options.index + 1 + entries.get(key).offset) : lineAt(adapter.text, options.index));
  const value = (key) => entries.get(key)?.value.replace(/,\s*$/, '').trim();
  const problem = (rule, key, message, fix) => report.problem({ file: adapter.rel, line: at(key), rule, message, fix });
  if (value('sendDefaultPii') !== 'false') {
    problem('pii-default', 'sendDefaultPii', `sendDefaultPii is ${entries.has('sendDefaultPii') ? value('sendDefaultPii') : 'not written'}; the SDK then may attach IP addresses, device names and request data`, 'Write sendDefaultPii: false explicitly (the official snippet turns it on).');
  }
  for (const key of CAPTURE_KEYS) {
    if (entries.has(key) && value(key) !== 'false') problem('screen-capture', key, `${key}: ${value(key)} sends what the person sees, typed or requested`, `Set ${key}: false or drop the key.`);
  }
  for (const key of REPLAY_KEYS) {
    if (entries.has(key)) problem('screen-capture', key, `${key} turns on Session Replay, which records the screen`, `Drop ${key}; reports carry no screen content.`);
  }
  for (const name of CAPTURE_CALLS) {
    const index = adapter.code.search(new RegExp(`\\b${name}\\b`));
    if (index >= 0) report.problem({ file: adapter.rel, line: lineAt(adapter.text, index), rule: 'screen-capture', message: `${name} captures screen content or free text`, fix: `Remove ${name}; feedback, if any, goes through the app's own support flow.` });
  }
  const locals = localImportNames(adapter.masked);
  for (const key of ['beforeSend', 'beforeSendTransaction', 'beforeBreadcrumb']) {
    const text = value(key) ?? '';
    const isScrubbed = [...locals].some((name) => new RegExp(`\\b${name}\\b`).test(text));
    if (!entries.has(key) || !isScrubbed) {
      problem('scrub-hooks', key, `${key} ${entries.has(key) ? 'does not call the scrubber' : 'is missing'}, so events leave the device unscrubbed`, `Set ${key} to the scrubber from crash-scrubber.ts (scrubEvent for beforeSend and beforeSendTransaction, filterBreadcrumb for beforeBreadcrumb).`);
    }
  }
  if (!entries.has('environment')) problem('environment-set', 'environment', 'environment is not set; every release build then reports as "production", preview included', 'Set environment: config.environment (the variant).');
  for (const key of ['release', 'dist']) {
    if (entries.has(key)) problem('release-native', key, `${key} is set in JavaScript; native crash events and the build's symbol upload use the native names, so the two disagree`, `Drop ${key}: the native SDK names it <bundle id>@<version>+<build> (dist: <build>).`);
  }
  const integrations = value('integrations') ?? '';
  if (!/reactNativeErrorHandlersIntegration\s*\(\s*\{[^}]*\bonunhandledrejection\s*:\s*false\b/.test(integrations)) {
    problem('rejection-tracker', 'integrations', 'Sentry keeps its own unhandled-rejection tracker, which replaces the error net\'s (Hermes keeps one tracker)', 'Add integrations: [Sentry.reactNativeErrorHandlersIntegration({ onunhandledrejection: false })] and let the net\'s sink forward rejections.');
  }
  if (entries.has('tracesSampler')) problem('trace-rate', 'tracesSampler', 'tracesSampler hides the sample rate from review', 'Use a fixed tracesSampleRate from src/config (TRACES_SAMPLE_RATE).');
}

/** Numeric sample-rate literals in a file: [{ name, value, line }]. */
function sampleRates(file) {
  const found = [];
  const patterns = [/\b(tracesSampleRate|profilesSampleRate)\s*:\s*(\d+(?:\.\d+)?)\b/g, /\b(TRACES_SAMPLE_RATE|PROFILES_SAMPLE_RATE)\b[^=\n]*=\s*(\d+(?:\.\d+)?)\b/g];
  for (const pattern of patterns) {
    for (const match of file.masked.matchAll(pattern)) found.push({ file: file.rel, name: match[1], value: Number(match[2]), line: lineAt(file.text, match.index) });
  }
  return found;
}

function checkRates(ctx, layout, contract, report, adapterRates) {
  const configRates = ctx.files.filter((file) => !file.isTest && file.rel.startsWith(`${layout.configDir}/`)).flatMap(sampleRates);
  const all = [...adapterRates, ...configRates];
  for (const rate of all) {
    if (rate.value > contract.maxTracesSampleRate) {
      report.problem({ file: rate.file, line: rate.line, rule: 'trace-rate', message: `${rate.name} is ${rate.value}, above the contract maxTracesSampleRate ${contract.maxTracesSampleRate}`, fix: 'Lower the rate, or raise maxTracesSampleRate in the contract with the reviewer and declare performance-data.' });
    }
  }
  adapterRates.push(...configRates);
}

function checkIdentityAndWrap(ctx, report) {
  for (const file of ctx.files.filter((item) => !item.isTest)) {
    const bindings = sentryBindings(file.masked);
    // Only the SDK's setUser (Sentry.setUser, a named import, or scope.setUser in a file that
    // imports the SDK); a React state setter or a store action named setUser is app code.
    const importsSdk = file.imports.some((entry) => entry.spec === SENTRY_PACKAGE);
    const scopeCalls = importsSdk ? [...file.code.matchAll(/\.\s*setUser\s*\(/g)].map((match) => match.index) : [];
    // Keyed by the call's "(" so Sentry.setUser( is reported once, not also as .setUser(.
    const opens = new Set([...sdkCalls(file.code, bindings, 'setUser'), ...scopeCalls].map((index) => file.code.indexOf('(', index)));
    for (const open of opens) {
      const arg = file.masked.slice(open + 1).trimStart();
      if (arg.startsWith('null')) continue;
      report.problem({ file: file.rel, line: lineAt(file.text, open), rule: 'no-user-identity', message: 'Sentry setUser(...) links reports to a person; the scope syncs to native crash reports, beyond beforeSend', fix: 'Remove the SDK call: reports stay anonymous (only setUser(null) is allowed, to clear).' });
    }
    if (/Port\s*=\s*\{/.test(file.code) && file.rel.endsWith('crash-reporter-port.ts')) {
      const index = file.code.search(/\bsetUser\b/);
      if (index >= 0) report.problem({ file: file.rel, line: lineAt(file.text, index), rule: 'no-user-identity', message: 'CrashReporterPort has a setUser member', fix: 'Remove the member; the port deliberately has no way to name the person.' });
    }
    const wraps = [...sdkCalls(file.code, bindings, 'wrap'), ...[...file.code.matchAll(/\bTouchEventBoundary\b/g)].map((match) => match.index)];
    for (const index of wraps) {
      report.problem({ file: file.rel, line: lineAt(file.text, index), rule: 'no-wrap', message: 'Sentry.wrap / TouchEventBoundary records touch breadcrumbs with the labels of what was pressed (task titles, names)', fix: 'Leave the root layout unwrapped; navigation and app breadcrumbs go through the port.' });
    }
  }
}

function checkSink(ctx, layout, report) {
  const app = ctx.files.filter((file) => !file.isTest);
  const declared = app.filter((file) => /\bFORWARDED_SOURCES\b[^=\n]*=/.test(file.code));
  const expected = `${layout.servicesDir}/crash-reporter/crash-forwarder.ts`;
  if (declared.length === 0) {
    report.problem({ file: expected, line: 1, rule: 'sink-forwarding', message: 'no forwarder declares FORWARDED_SOURCES, so nothing decides what Sentry receives from the error net', fix: 'Copy templates/src/services/crash-reporter/crash-forwarder.ts (+ test).' });
  }
  for (const file of declared) {
    const match = /\bFORWARDED_SOURCES\b[^=\n]*=\s*\[([^\]]*)\]/.exec(file.masked);
    const items = match ? [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]).sort() : [];
    if (items.join(',') !== 'render,unhandled-rejection') {
      report.problem({ file: file.rel, line: lineOfMatch(file.masked, 'FORWARDED_SOURCES'), rule: 'sink-forwarding', message: `FORWARDED_SOURCES is [${items.join(', ')}]; Sentry captures global-handler errors itself, so exactly render and unhandled-rejection are forwarded`, fix: "Set FORWARDED_SOURCES = ['render', 'unhandled-rejection']." });
    }
  }
  const definers = new Set(app.filter((file) => /function\s+createCrashForwarder\b/.test(file.code)).map((file) => file.rel));
  const kitFile = `${layout.servicesDir}/crash-reporter/crash-reporting-root-kit.tsx`;
  const forwards = app.some((file) => !definers.has(file.rel) && /(?<![\w$])forward\s*:\s*createCrashForwarder\s*\(/.test(file.code));
  if (!forwards) {
    report.problem({ file: kitFile, line: 1, rule: 'sink-connected', message: 'no root kit forwards the error net\'s reports to the crash reporter, so render errors and rejections never reach it', fix: 'Copy templates/src/services/crash-reporter/crash-reporting-root-kit.tsx: its kit sets forward: createCrashForwarder(crashReporter), and the root skeleton\'s error sink hands it every report after the error log recorded it.' });
  }
  const kitDefiners = new Set(app.filter((file) => /function\s+createCrashReportingKit\b/.test(file.code)).map((file) => file.rel));
  const registered = app.some((file) => !kitDefiners.has(file.rel) && /(?<![\w$.])createCrashReportingKit\s*\(/.test(file.code));
  if (kitDefiners.size > 0 && !registered) {
    const registry = `${layout.servicesDir}/create-root-kits.ts`;
    report.problem({ file: registry, line: 1, rule: 'sink-connected', message: 'the crash reporting kit is never registered, so nothing forwards reports, applies the choice or records breadcrumbs', fix: `Add createCrashReportingKit({ crashReporter, consent }) to the list createRootKits returns in ${registry} (app-startup-and-bootstrap's slots); the root files stay unchanged.` });
  }
}

/**
 * capture-recorded: every report is in the local error log first. The sink records, then forwards; a
 * handled defect reported from the code that handles it records to ErrorLogPort before it calls
 * captureException. Heuristic: the nearest record( before the call, within the enclosing function
 * (the text after the last function start before the call).
 */
function checkCaptureRecorded(ctx, layout, report) {
  const reporterDir = `${layout.servicesDir}/crash-reporter/`;
  for (const file of ctx.files.filter((item) => !item.isTest && !item.rel.startsWith(reporterDir))) {
    for (const match of file.masked.matchAll(/\.\s*captureException\s*\(/g)) {
      const before = file.masked.slice(0, match.index);
      const fnStart = Math.max(before.lastIndexOf('=>'), before.search(/function\b(?![\s\S]*function\b)/));
      const scope = before.slice(Math.max(0, fnStart));
      if (/\.\s*record\s*\(/.test(scope)) continue;
      report.problem({ file: file.rel, line: lineAt(file.text, match.index), rule: 'capture-recorded', message: 'reports to the crash reporter without recording to the error log first, so the defect is missing from the local log and support export', fix: "Record it first, then report: errorLog.record('storage', error); crashReporter.captureException(error, { source: 'storage', isFatal: false }). Defects the error net catches go through createCrashReportingSink, which does both." });
    }
  }
}

/**
 * `.setConsent(` calls that reach the crash reporter: the receiver names it (`crashReporter.setConsent(`,
 * `services.crashReporter?.setConsent(`), or the one argument is a boolean (`true`, `isGranted`,
 * `crashReportsEnabled`). Other ports have a member of the same name (analytics-and-consent's
 * `analytics.setConsent('granted')`), and their calls hand nothing to the crash reporter.
 */
function crashConsentCalls(code) {
  return [...code.matchAll(/([\w$.?]*)\.\s*setConsent\s*\(\s*([^()]*?)\s*\)/g)].filter((match) => {
    if (/crash/i.test(match[1])) return true;
    return /^(?:true|false|is[A-Z][\w$]*|[\w$]*(?:Enabled|Granted))$/.test(match[2]);
  });
}

function checkConsent(ctx, layout, contract, report) {
  const app = ctx.files.filter((file) => !file.isTest);
  const reporterDir = `${layout.servicesDir}/crash-reporter/`;
  const hookDefiners = new Set(app.filter((file) => /function\s+useCrashReportingConsent\b/.test(file.code)).map((file) => file.rel));
  const early = [`${layout.servicesDir}/create-device-services.ts`, `${layout.servicesDir}/create-root-kits.ts`, `${layout.routesDir}/_layout.tsx`, ...ctx.entryRels];
  let callers = 0;
  for (const file of app) {
    const hook = [...file.code.matchAll(/(?<![\w$])useCrashReportingConsent\s*\(/g)];
    // The adapter, the fake and the port define setConsent; a reporter file counts only when it
    // applies the choice through the hook (the root kit's effects).
    if (file.rel.startsWith(reporterDir) && hook.length === 0) continue;
    const setConsent = file.rel.startsWith(reporterDir) ? [] : crashConsentCalls(file.code);
    if (early.includes(file.rel)) {
      for (const match of [...setConsent, ...hook]) {
        report.problem({ file: file.rel, line: lineAt(file.text, match.index), rule: 'consent-applied', message: 'the crash reporter gets its consent in the composition root, the root-kit registry, the root layout or an entry file, before the first frame (the SDK starts during startup)', fix: 'Hand the registry a consent source instead (createCrashReportingKit({ crashReporter, consent })): the kit\'s effects apply it after the splash release.' });
      }
      for (const match of file.masked.matchAll(/(?<![\w$.])fixedCrashConsent\s*\(\s*true\s*\)/g)) {
        report.problem({ file: file.rel, line: lineAt(file.text, match.index), rule: 'consent-applied', message: 'the crash reporting kit gets a hard-coded grant, so the person\'s saved choice (and a refusal) is ignored', fix: 'Pass a source over the settings field crashReportsEnabled, or fixedCrashConsent(false) until the app has that row.' });
      }
      continue;
    }
    if (!hookDefiners.has(file.rel) && (hook.length > 0 || setConsent.length > 0)) callers += 1;
    checkConsentValue(file, [...setConsent, ...hook], report);
  }
  if (callers === 0) {
    report.problem({ file: `${layout.servicesDir}/crash-reporter/crash-reporting-root-kit.tsx`, line: 1, rule: 'consent-applied', message: 'nothing hands the person\'s choice to the crash reporter, so it never starts (or a refusal is never applied)', fix: 'Copy templates/src/services/crash-reporter/crash-reporting-root-kit.tsx and register its kit in createRootKits: its effects call useCrashReportingConsent after the splash release.' });
  }
  const schema = app.find((file) => /\bDEFAULT_SETTINGS\b/.test(file.code) && /\bcrashReportsEnabled\s*:\s*(true|false)\b/.test(file.masked));
  if (schema) {
    const defaults = schema.masked.slice(schema.masked.search(/\bDEFAULT_SETTINGS\b/));
    const match = /\bcrashReportsEnabled\s*:\s*(true|false)\b/.exec(defaults);
    const want = contract.consentModel === 'opt-out' ? 'true' : 'false';
    if (match && match[1] !== want) {
      report.problem({ file: schema.rel, line: lineAt(schema.text, schema.masked.search(/\bDEFAULT_SETTINGS\b/) + match.index), rule: 'consent-default', message: `crashReportsEnabled starts ${match[1]}, but the contract consentModel is ${contract.consentModel}`, fix: `Start it ${want}, or change consentModel in the contract (and the privacy policy) first.` });
    }
  }
}

/**
 * A hard-coded grant ignores the saved choice, and a call in startApp (the first render's state
 * initializer) runs before the splash is released. Heuristic: literal `setConsent(true)` and
 * `isGranted: true`, and any consent call inside a function named startApp.
 */
function checkConsentValue(file, calls, report) {
  const fix = 'Pass the saved choice: createCrashReportingKit({ crashReporter, consent }) with a source over the settings field crashReportsEnabled (or fixedCrashConsent(false) until the app has the row); the kit\'s effects apply it after the splash.';
  for (const match of file.masked.matchAll(/\.\s*setConsent\s*\(\s*true\s*\)|(?<![\w$])isGranted\s*:\s*true\b|(?<![\w$.])fixedCrashConsent\s*\(\s*true\s*\)/g)) {
    report.problem({ file: file.rel, line: lineAt(file.text, match.index), rule: 'consent-applied', message: 'the crash reporter gets a hard-coded grant, so the person\'s saved choice (and a refusal) is ignored', fix });
  }
  const start = /function\s+startApp\s*\(/.exec(file.code);
  if (!start) return;
  const open = findBodyOpen(file.code, start.index + start[0].length - 1);
  const body = open < 0 ? null : extractBlock(file.code, open);
  if (!body) return;
  for (const match of calls.filter((item) => item.index > open && item.index < body.close)) {
    report.problem({ file: file.rel, line: lineAt(file.text, match.index), rule: 'consent-applied', message: 'startApp applies the crash-report choice: it runs in the first render, before the splash is released, so the SDK starts during startup', fix });
  }
}

function checkRouteBreadcrumbs(ctx, report) {
  for (const file of ctx.files.filter((item) => !item.isTest && /\baddBreadcrumb\s*\(/.test(item.code))) {
    const importsRouter = /import\s*\{([^}]*)\}\s*from\s*['"]expo-router['"]/.exec(file.masked);
    const hooks = importsRouter ? ROUTE_VALUE_HOOKS.filter((name) => new RegExp(`\\b${name}\\b`).test(importsRouter[1])) : [];
    if (hooks.length > 0) {
      report.problem({ file: file.rel, line: lineOfMatch(file.masked, hooks[0]), rule: 'route-breadcrumbs', message: `adds breadcrumbs and reads ${hooks.join(', ')}: ids and search text in a path are content`, fix: "Name the route pattern from useSegments() ('tasks/[id]'), as templates/src/hooks/use-route-breadcrumbs.ts does." });
    }
  }
}

function checkMetro(ctx, report) {
  if (ctx.metro === null) {
    report.problem({ file: 'metro.config.js', line: 1, rule: 'metro-debug-ids', message: 'no Metro config: Expo\'s default writes a debug ID into the source map only, and the running bundle cannot report it, so uploaded maps never match a crash', fix: 'Create metro.config.js from getSentryExpoConfig(__dirname) (keep config.cacheVersion from app-variants-and-environment).' });
    return;
  }
  const builds = (file) => /\b(getSentryExpoConfig|withSentryConfig)\s*\(/.test(file.masked);
  const kitFix = `List Sentry's kit in ${METRO_KITS_FILE} (templates/scripts/metro/metro-kits.ts): { name: 'crash-reporting', baseConfig: (projectRoot) => getSentryExpoConfig(projectRoot) }; metro.config.js stays the canonical one.`;
  if (ctx.usesSlot && !builds(ctx.metro)) {
    if (ctx.metroKits === null) {
      report.problem({ file: METRO_KITS_FILE, line: 1, rule: 'metro-debug-ids', message: 'metro.config composes the Metro slot, but no scripts/metro/metro-kits.ts lists Sentry\'s kit: without its debug-ID module the bundle cannot tell an event which source map it needs', fix: kitFix });
    } else if (!builds(ctx.metroKits)) {
      report.problem({ file: METRO_KITS_FILE, line: 1, rule: 'metro-debug-ids', message: 'no Metro kit builds the config with getSentryExpoConfig or withSentryConfig: without Sentry\'s debug-ID module the bundle cannot tell an event which source map it needs', fix: kitFix });
    }
    return;
  }
  if (!builds(ctx.metro)) {
    report.problem({ file: ctx.metro.rel, line: 1, rule: 'metro-debug-ids', message: 'metro.config does not use getSentryExpoConfig or withSentryConfig: without Sentry\'s debug-ID module the bundle cannot tell an event which source map it needs', fix: 'Build the config with getSentryExpoConfig(__dirname) from @sentry/react-native/metro and keep cacheVersion on it, or compose the canonical Metro slot (readMetroKits) and list Sentry\'s kit in scripts/metro/metro-kits.ts.' });
  }
}

function checkAppConfig(ctx, report) {
  const config = ctx.appConfig;
  if (config === null) {
    report.problem({ file: 'app.config.ts', line: 1, rule: 'config-plugin', message: 'no app config, so no build uploads source maps or native symbols', fix: 'Add the "@sentry/react-native/expo" plugin entry to app.config.ts.' });
    return;
  }
  const match = /(['"])@sentry\/react-native(?:\/expo)?\1/.exec(config.masked);
  if (!match) {
    report.problem({ file: config.rel, line: 1, rule: 'config-plugin', message: 'the app config lists no @sentry/react-native/expo plugin, so native builds upload no source maps or debug symbols', fix: "Add ['@sentry/react-native/expo', { organization: '<org>', project: '<project>' }] to plugins." });
  } else {
    const after = config.masked.slice(match.index + match[0].length);
    const objectMatch = /^\s*,\s*\{/.exec(after);
    let keys = new Map();
    if (objectMatch) {
      const open = match.index + match[0].length + objectMatch[0].length - 1;
      const inner = blockInner(config.masked, open);
      keys = inner === null ? keys : entryMap(inner);
    }
    const missing = ['organization', 'project'].filter((key) => !keys.has(key));
    if (missing.length > 0) {
      report.problem({ file: config.rel, line: lineAt(config.text, match.index), rule: 'config-plugin', message: `the Sentry plugin entry has no ${missing.join(' or ')}, so the upload targets depend on whoever's environment builds`, fix: "Give the entry { organization: '<org>', project: '<project>' } (not secret)." });
    }
    if (keys.has('authToken')) {
      report.problem({ file: config.rel, line: lineAt(config.text, match.index), rule: 'plugin-auth-token', message: 'the Sentry plugin entry holds authToken: prebuild writes it into sentry.properties of the native projects and build artifacts', fix: 'Remove authToken; the build reads SENTRY_AUTH_TOKEN from an EAS secret (or CI secret).' });
    }
  }
  const tokenIndex = config.masked.search(/\bSENTRY_AUTH_TOKEN\b/);
  if (tokenIndex >= 0) {
    report.problem({ file: config.rel, line: lineAt(config.text, tokenIndex), rule: 'plugin-auth-token', message: 'the app config reads SENTRY_AUTH_TOKEN; whatever the config returns is public in every build', fix: 'Do not read the token in the config: sentry-cli reads SENTRY_AUTH_TOKEN from the build environment by itself.' });
  }
}

function blockInner(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

function checkEas(root, contract, report) {
  const text = readMaybe(root, 'eas.json');
  if (text === null) {
    const reason = notYetCreated(root, { file: 'eas.json', owner: 'eas-build-and-submit' });
    report.skip({ file: 'eas.json', rule: 'upload-not-disabled', message: reason });
    return;
  }
  const parsed = parseJson(text);
  if (parsed.error) {
    report.problem({ file: 'eas.json', line: 1, rule: 'upload-not-disabled', message: `eas.json is not valid JSON: ${parsed.error}`, fix: 'Fix eas.json.' });
    return;
  }
  const build = parsed.value?.build ?? {};
  for (const profile of contract.uploadProfiles.filter((name) => build[name])) {
    const env = profileEnv(build, profile, new Set());
    for (const name of DISABLE_VARS) {
      if (String(env[name] ?? '').toLowerCase() === 'true') {
        report.problem({ file: 'eas.json', line: lineOfMatch(text, `"${name}"`), rule: 'upload-not-disabled', message: `build profile "${profile}" sets ${name}=true, so its builds report crashes without readable stacks`, fix: `Remove ${name} from "${profile}" (and the profiles it extends); keep it only in profiles outside uploadProfiles (development, e2e).` });
      }
    }
  }
}

function profileEnv(build, name, seen) {
  const profile = build[name];
  if (!profile || seen.has(name)) return {};
  seen.add(name);
  const base = typeof profile.extends === 'string' ? profileEnv(build, profile.extends, seen) : {};
  return { ...base, ...(profile.env ?? {}) };
}

function checkOptionalDeps(root, pkg, pkgText, report) {
  const npmrc = readMaybe(root, '.npmrc');
  if (npmrc !== null) {
    const lines = npmrc.split('\n');
    lines.forEach((line, index) => {
      const clean = line.replace(/[#;].*$/, '').replace(/\s+/g, '');
      if (/^omit(\[\])?=.*optional/.test(clean) || clean === 'optional=false') {
        report.problem({ file: '.npmrc', line: index + 1, rule: 'optional-deps', message: 'installs drop optional dependencies; the sentry-cli binary (@sentry/cli-<platform>) is one, so symbol uploads fail', fix: 'Remove the line; deny install scripts in allowScripts instead.' });
      }
    });
  }
  for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
    if (/--omit[= ]optional|--no-optional|--ignore-optional/.test(String(value))) {
      report.problem({ file: 'package.json', line: lineOfMatch(pkgText, `"${name}"`), rule: 'optional-deps', message: `script "${name}" installs without optional dependencies (the sentry-cli binary is one)`, fix: 'Drop the flag.' });
    }
  }
}

function checkOtaSourcemaps(root, pkg, pkgText, report) {
  for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
    const text = String(value);
    if (EAS_UPDATE.test(text) && !text.includes('sentry-expo-upload-sourcemaps')) {
      report.problem({ file: 'package.json', line: lineOfMatch(pkgText, `"${name}"`), rule: 'ota-sourcemaps', message: `script "${name}" publishes an update without uploading its source maps, so its crashes show minified frames`, fix: 'Append && npx sentry-expo-upload-sourcemaps dist to the script.' });
    }
  }
  for (const dir of ['.github/workflows', '.eas/workflows']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).filter((file) => /\.ya?ml$/.test(file))) {
      const rel = `${dir}/${name}`;
      const text = readMaybe(root, rel);
      const lines = text.split('\n');
      if (dir === '.eas/workflows') checkUpdateJobs(rel, lines, report);
      const updateLine = lines.findIndex((line) => !line.trim().startsWith('#') && EAS_UPDATE.test(line));
      if (updateLine < 0) continue;
      const uploads = lines.slice(updateLine).some((line) => line.includes('sentry-expo-upload-sourcemaps'));
      if (!uploads) {
        report.problem({ file: rel, line: updateLine + 1, rule: 'ota-sourcemaps', message: 'this workflow publishes an update without uploading its source maps', fix: 'Run npx sentry-expo-upload-sourcemaps dist right after eas update, with SENTRY_AUTH_TOKEN from the CI secrets.' });
      }
    }
  }
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * EAS Workflows `type: update` jobs, read by indentation (the job's keys and everything nested
 * under them; no YAML parser). The job uploads maps itself with `upload_sentry_sourcemaps: true`
 * (a failed upload fails the job), or an `after_update` hook runs sentry-expo-upload-sourcemaps
 * (dist/ exists only on that job's worker). Left out, the job only tries and stays green when the
 * upload fails; false skips it.
 */
function checkUpdateJobs(rel, lines, report) {
  lines.forEach((line, index) => {
    if (!/^\s*type:\s*["']?update["']?\s*(#.*)?$/.test(line)) return;
    const indent = indentOf(line);
    const inJob = (text) => text.trim() === '' || text.trim().startsWith('#') || indentOf(text) >= indent;
    let first = index;
    while (first > 0 && inJob(lines[first - 1])) first -= 1;
    let last = index;
    while (last + 1 < lines.length && inJob(lines[last + 1])) last += 1;
    const block = lines.slice(first, last + 1).filter((text) => !text.trim().startsWith('#'));
    const setting = block.map((text) => /^\s*upload_sentry_sourcemaps:\s*["']?(\w+)["']?/.exec(text)).find(Boolean);
    const hooked = block.some((text) => text.includes('sentry-expo-upload-sourcemaps'));
    if (hooked || setting?.[1] === 'true') return;
    const why = setting ? `sets upload_sentry_sourcemaps: ${setting[1]}, so its bundles upload no source maps` : 'leaves out upload_sentry_sourcemaps, so it only tries to upload the source maps and stays green when that fails (no token in its environment)';
    report.problem({ file: rel, line: index + 1, rule: 'ota-sourcemaps', message: `this EAS Workflows update job ${why}`, fix: 'Add upload_sentry_sourcemaps: true under the job\'s params (and SENTRY_AUTH_TOKEN as a secret in the job\'s EAS environment), or run npx sentry-expo-upload-sourcemaps dist in its after_update hook.' });
  });
}

function checkTokenFiles(root, report) {
  const rc = readMaybe(root, '.sentryclirc');
  if (rc !== null && /^\s*token\s*=/m.test(rc) && !isGitIgnored(root, '.sentryclirc')) {
    report.problem({ file: '.sentryclirc', line: lineOfMatch(rc, /^\s*token\s*=/m), rule: 'token-files', message: '.sentryclirc holds an auth token and is not git-ignored', fix: 'Delete the token line, rotate the token in Sentry, and use SENTRY_AUTH_TOKEN from EAS or CI secrets.' });
  }
  const props = readMaybe(root, 'sentry.properties');
  if (props !== null && /^\s*auth\.token\s*=/m.test(props) && !isGitIgnored(root, 'sentry.properties')) {
    report.problem({ file: 'sentry.properties', line: lineOfMatch(props, /^\s*auth\.token\s*=/m), rule: 'token-files', message: 'sentry.properties holds auth.token and is not git-ignored', fix: 'Delete the line, rotate the token, and use SENTRY_AUTH_TOKEN from EAS or CI secrets.' });
  }
  if (existsSync(join(root, '.env.sentry-build-plugin')) && !isGitIgnored(root, '.env.sentry-build-plugin')) {
    report.problem({ file: '.env.sentry-build-plugin', line: 1, rule: 'token-files', message: '.env.sentry-build-plugin (read by the upload scripts, holds the token) is not git-ignored', fix: 'Add .env.sentry-build-plugin to .gitignore; rotate the token if it was ever committed.' });
  }
}

/** Reads and validates the contract; returns usable values (defaults when invalid). */
function checkContract(root, rel, report) {
  const text = readMaybe(root, rel);
  const fail = (message, line = 1) => report.problem({ file: rel, line, rule: 'contract', message, fix: 'Copy templates/contracts/crash-reporting.json (+ schema) and fill in the facts.' });
  if (text === null) {
    fail('the crash reporting contract does not exist');
    return { ...DEFAULT_CONTRACT };
  }
  const parsed = parseJson(text);
  if (parsed.error) {
    fail(`not valid JSON: ${parsed.error}`);
    return { ...DEFAULT_CONTRACT };
  }
  const data = parsed.value ?? {};
  const contract = { ...DEFAULT_CONTRACT };
  if (data.provider !== 'sentry') fail(`provider must be "sentry", got ${JSON.stringify(data.provider)}`, lineOfMatch(text, '"provider"'));
  if (data.consentModel === 'opt-in' || data.consentModel === 'opt-out') contract.consentModel = data.consentModel;
  else fail(`consentModel must be "opt-in" or "opt-out", got ${JSON.stringify(data.consentModel)}`, lineOfMatch(text, '"consentModel"'));
  if (typeof data.maxTracesSampleRate === 'number' && data.maxTracesSampleRate >= 0 && data.maxTracesSampleRate <= 1) contract.maxTracesSampleRate = data.maxTracesSampleRate;
  else fail('maxTracesSampleRate must be a number from 0 to 1', lineOfMatch(text, '"maxTracesSampleRate"'));
  if (Array.isArray(data.uploadProfiles) && data.uploadProfiles.every((item) => typeof item === 'string' && item !== '')) contract.uploadProfiles = data.uploadProfiles;
  else fail('uploadProfiles must be a list of eas.json build profile names', lineOfMatch(text, '"uploadProfiles"'));
  const declarations = data.declarations ?? {};
  const collects = Array.isArray(declarations.collects) ? declarations.collects : [];
  const unknown = collects.filter((item) => !COLLECTS.includes(item));
  if (collects.length === 0 || unknown.length > 0 || !collects.includes('crash-data')) {
    fail(`declarations.collects must list crash-data and only ${COLLECTS.join(', ')}${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}`, lineOfMatch(text, '"collects"'));
  } else {
    contract.collects = collects;
  }
  if (declarations.linkedToUser !== false) fail('declarations.linkedToUser must be false: the reports carry no identity', lineOfMatch(text, '"linkedToUser"'));
  if (declarations.usedForTracking !== false) fail('declarations.usedForTracking must be false', lineOfMatch(text, '"usedForTracking"'));
  contract.text = text;
  return contract;
}

/**
 * privacy-sync: one truth for the store answers. The crash contract's declarations are the source;
 * privacy-and-store-declarations' contracts/privacy.json must declare the SDK with the same data types
 * (its audits read only that file), each not linked to the user and not used for tracking.
 */
function checkPrivacySync(root, layout, contract, report) {
  const rel = `${layout.contractsDir}/privacy.json`;
  const text = readMaybe(root, rel);
  if (text === null) {
    report.skip({ file: rel, rule: 'privacy-sync', message: notYetCreated(root, { file: rel, owner: 'privacy-and-store-declarations' }) });
    return;
  }
  const parsed = parseJson(text);
  if (parsed.error) return; // privacy-and-store-declarations' audit reports the broken file
  const entry = parsed.value?.sdks?.[SENTRY_PACKAGE];
  const fix = `Set sdks["${SENTRY_PACKAGE}"].collects in ${rel} to one row per declared type ({ "type", "linked": false, "tracking": false, "purposes": ["app-functionality"] }), with pods ["Sentry"] and maven ["io.sentry:"].`;
  if (!entry || typeof entry !== 'object') {
    report.problem({ file: rel, line: 1, rule: 'privacy-sync', message: `${SENTRY_PACKAGE} is not declared in sdks, so the store answers leave out its crash data`, fix });
    return;
  }
  const rows = Array.isArray(entry.collects) ? entry.collects.filter((row) => row && typeof row === 'object') : [];
  const types = [...new Set(rows.map((row) => row.type))].sort();
  const expected = [...contract.collects].sort();
  const line = lineOfMatch(text, `"${SENTRY_PACKAGE}"`);
  if (types.join(',') !== expected.join(',')) {
    report.problem({ file: rel, line, rule: 'privacy-sync', message: `sdks["${SENTRY_PACKAGE}"].collects lists ${types.join(', ') || 'nothing'}, but the crash reporting contract declares ${expected.join(', ')}`, fix });
  }
  const wrong = rows.filter((row) => row.linked !== false || row.tracking !== false).map((row) => row.type);
  if (wrong.length > 0) report.problem({ file: rel, line, rule: 'privacy-sync', message: `sdks["${SENTRY_PACKAGE}"].collects marks ${wrong.join(', ')} as linked or tracking, but crash reports carry no identity and never track`, fix });
}

function checkDeclaration(contract, rel, rates, report) {
  const traced = rates.filter((rate) => rate.value > 0);
  if (traced.length > 0 && !contract.collects.includes('performance-data')) {
    report.problem({ file: rel, line: contract.text ? lineOfMatch(contract.text, '"collects"') : 1, rule: 'declaration', message: `${traced[0].name} is ${traced[0].value} in ${traced[0].file}, but the contract does not declare performance-data`, fix: 'Add "performance-data" to declarations.collects and update the App Privacy and Data safety answers (privacy-and-store-declarations).' });
  }
}
