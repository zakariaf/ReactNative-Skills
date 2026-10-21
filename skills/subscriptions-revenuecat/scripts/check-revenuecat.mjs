#!/usr/bin/env node
// check-revenuecat.mjs: static checks of a RevenueCat subscription integration: the SDK only behind
// its adapter, no client entitlement deciding on the server, no typed or rebuilt prices, an
// authenticated and idempotent webhook, and no second purchase SDK beside RevenueCat.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-revenuecat.mjs [repo-root]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { importsOf, isTestFile, scanSource } from './lib/source-scan.mjs';

const SDK = 'react-native-purchases';
const SDK_UI = 'react-native-purchases-ui';
/** Purchase SDKs that must never sit beside RevenueCat (each owns transactions and finishing). */
const OTHER_SDKS = ['expo-iap', 'react-native-iap', 'expo-in-app-purchases', 'react-native-adapty', 'react-native-qonversion'];
const SERVER_OWNER = 'cloud-functions-backend';

const SPEC = {
  name: 'check-revenuecat',
  summary: 'Checks a RevenueCat subscription integration: react-native-purchases only in its adapter, server decisions never read a client entitlement, no typed or rebuilt prices, the webhook authenticated (constant-time Authorization check, 401) and idempotent by event id, and no second purchase SDK.',
  usage: '[repo-root] [options]',
  options: { json: { type: 'boolean', help: 'Also print the problems as one JSON line' } },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  sdk-outside-adapter           react-native-purchases (or -ui) imported outside the adapter (and, for -ui, the contract\'s sdkImportersAllowed)',
    '  client-entitlement-for-quota  server code reads a plan, Premium flag or customerInfo from the request or the client SDK',
    '  hardcoded-price               a typed price in app code or a catalog, or a price rebuilt from a number',
    '  webhook-unauthenticated       the webhook reads no Authorization header, compares it without timingSafeEqual, or never answers 401',
    '  webhook-not-idempotent        the webhook claims no record keyed by the RevenueCat event id before writing',
    '  mixed-purchase-sdks           another purchase SDK (expo-iap, react-native-iap, ...) in a package.json, an import or the app config',
    'App facts come from contracts/subscriptions.json (rn-skills.config.json key subscriptionsContract moves it):',
    '  entitlementId, serverDirs, webhookFiles (required), adapterFile, sdkImportersAllowed. Paths come from resolveLayout',
    '  (servicesDir for the adapter, srcDir, i18nDir/catalogs). A missing or incomplete contract is exit 2.',
    'NOT APPLICABLE when no package.json lists react-native-purchases and no code imports it.',
    `SKIP lines (a pass): the webhook rules while none of the contract's serverDirs exists yet (${SERVER_OWNER} creates it).`,
    'The repo scan prunes installed skills (.agents/, .claude/, skills/, any folder with a SKILL.md) and generated folders.',
  ].join('\n'),
};

/**
 * A typed price: a currency sign next to digits, or digits with a currency code. A dollar sign with
 * one bare digit ('$1') is a regex replacement token, not a price, so it needs decimals ('$4.99').
 */
const PRICE = /(?:[€£¥₹]\s?\d)|(?:\$\s?(?:\d{2,}|\d[.,]\d))|(?:\d+[.,]\d{2}\s?(?:€|EUR|USD|GBP|\$))|(?:\b(?:EUR|USD|GBP)\s?\d)/;
/** A price rebuilt from the numeric product price, or currency formatting in app code. */
const REBUILT_PRICE = /\bprice\b[^;\n]*?\.(?:toFixed|toLocaleString)\s*\(|style\s*:\s*['"]currency['"]/g;
const CLIENT_FIELDS = 'isPremium|premium|isPro|isSubscribed|plan|tier|entitlements?|subscription|customerInfo';
const REQUEST_FLAG = new RegExp(`\\b(?:request|req)\\s*\\.\\s*(?:data|body|query|params)\\s*\\??\\.\\s*(?:${CLIENT_FIELDS})\\b`, 'g');
const REQUEST_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*(?:request|req)\s*\.\s*(?:data|body|query|params)\b/g;
const CLIENT_SDK_SHAPE = /\bcustomerInfo\b|\bentitlements\s*\.\s*active\b/g;
const CLAIM_CALL = /\b(?:claim\w*|create\w*|insert\w*|setIfAbsent|markProcessed\w*|recordOnce)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
const EVENT_ID = /\b\w*event\w*\s*\.\s*id\b|\beventId\b/i;

const readJson = (root, rel) => {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch {
    return null;
  }
};
const depsOf = (json) => ({ ...json?.dependencies, ...json?.devDependencies, ...json?.optionalDependencies });
const isSpec = (spec, name) => spec === name || spec.startsWith(`${name}/`);
const underAny = (rel, dirs) => dirs.some((dir) => rel === dir || rel.startsWith(`${dir.replace(/\/$/, '')}/`));

function readContract(root, layout) {
  const rel = layout.config?.subscriptionsContract ?? join(layout.contractsDir, 'subscriptions.json');
  const fix = 'Copy templates/contracts/subscriptions.json and its schema from the subscriptions-revenuecat skill and fill in the app\'s ids.';
  if (!existsSync(join(root, rel))) fail(`${rel} is missing`, fix);
  const contract = readJson(root, rel);
  if (contract === null || typeof contract !== 'object') fail(`${rel} is not valid JSON`, fix);
  if (typeof contract.entitlementId !== 'string' || contract.entitlementId === '') fail(`${rel} lacks "entitlementId"`, fix);
  for (const key of ['serverDirs', 'webhookFiles']) {
    if (!Array.isArray(contract[key]) || contract[key].length === 0) fail(`${rel} lacks "${key}"`, fix);
  }
  return { rel, contract };
}

function loadSources(root) {
  const files = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'], ignore: ['*.d.ts'] });
  return files.map((rel) => {
    const text = readFileSync(join(root, rel), 'utf8');
    const scan = scanSource(text);
    return { rel, text, scan, imports: importsOf(scan), isTest: isTestFile(rel) };
  });
}

function checkImports(sources, { adapterRel, uiAllowed }, report) {
  for (const file of sources.filter((item) => !item.isTest)) {
    for (const entry of file.imports) {
      const isUi = isSpec(entry.spec, SDK_UI);
      if (isUi && !uiAllowed.has(file.rel) && file.rel !== adapterRel) {
        report.problem({ file: file.rel, line: entry.line, rule: 'sdk-outside-adapter', message: `imports ${SDK_UI} outside the adapter`, fix: `Render RevenueCat's paywall only from a file listed in contracts/subscriptions.json sdkImportersAllowed (a deliberate decision), or build the paywall on SubscriptionPort.` });
      } else if (!isUi && isSpec(entry.spec, SDK) && file.rel !== adapterRel) {
        report.problem({ file: file.rel, line: entry.line, rule: 'sdk-outside-adapter', message: `imports ${SDK} outside the adapter (${adapterRel})`, fix: 'Call SubscriptionPort (services.subscription) instead; only the adapter imports the SDK, so tests use the fake and the SDK can be swapped.' });
      }
      const other = OTHER_SDKS.find((name) => isSpec(entry.spec, name));
      if (other) report.problem({ file: file.rel, line: entry.line, rule: 'mixed-purchase-sdks', message: `imports ${other} beside RevenueCat`, fix: 'Remove it: two purchase SDKs both observe and finish store transactions. RevenueCat replaces the in-app-purchases (expo-iap) adapter entirely.' });
    }
  }
}

function checkPackages(root, report) {
  let listsSdk = false;
  const files = walkRepo(root, { include: ['package.json'] });
  const others = [];
  for (const rel of files) {
    const deps = depsOf(readJson(root, rel));
    if (deps[SDK] !== undefined) listsSdk = true;
    const raw = readFileSync(join(root, rel), 'utf8');
    for (const name of OTHER_SDKS.filter((item) => deps[item] !== undefined)) {
      const index = raw.indexOf(`"${name}"`);
      others.push({ file: rel, line: index === -1 ? 0 : lineOf(raw, index), rule: 'mixed-purchase-sdks', message: `${name} is a dependency beside ${SDK}`, fix: `npm uninstall ${name}: RevenueCat is the one purchase layer; keep in-app-purchases' paywall rules, not its SDK.` });
    }
  }
  // Reported only once RevenueCat is in use: an app on in-app-purchases (expo-iap) alone is not this skill's.
  return { listsSdk, count: files.length, report: () => others.forEach((entry) => report.problem(entry)) };
}

function checkAppConfig(root, report) {
  for (const rel of ['app.config.ts', 'app.config.js', 'app.json'].filter((name) => existsSync(join(root, name)))) {
    const text = maskComments(readFileSync(join(root, rel), 'utf8'));
    for (const name of OTHER_SDKS) {
      const match = new RegExp(`['"]${name}['"]`).exec(text);
      if (match) report.problem({ file: rel, line: lineOf(text, match.index), rule: 'mixed-purchase-sdks', message: `${name} config plugin beside RevenueCat`, fix: 'Remove the plugin entry with the package; react-native-purchases needs no config plugin.' });
    }
  }
}

function checkPrices(root, sources, layout, report) {
  const i18nDir = layout.i18nDir;
  for (const file of sources.filter((item) => !item.isTest && underAny(item.rel, [layout.srcDir]) && !underAny(item.rel, [i18nDir]))) {
    for (const literal of file.scan.strings) {
      if (PRICE.test(literal.value)) report.problem({ file: file.rel, line: literal.line, rule: 'hardcoded-price', message: `a typed price "${literal.value}" in app code`, fix: 'Show the store\'s price string from the offering (packagePriceText), through a catalog message with {priceText}.' });
    }
    for (const match of file.scan.codeKeep.matchAll(REBUILT_PRICE)) {
      report.problem({ file: file.rel, line: lineOf(file.text, match.index), rule: 'hardcoded-price', message: 'a price rebuilt from a number (toFixed, toLocaleString or currency formatting)', fix: 'Use the SDK\'s priceString and pricePerMonthString unchanged; the store owns rounding and currency.' });
    }
  }
  for (const rel of walkRepo(root, { include: [`${i18nDir}/catalogs/*.json`] })) {
    const raw = readFileSync(join(root, rel), 'utf8');
    const json = readJson(root, rel) ?? {};
    for (const [key, value] of Object.entries(json)) {
      if (typeof value !== 'string' || !PRICE.test(value)) continue;
      const index = raw.indexOf(`"${key}"`);
      report.problem({ file: rel, line: index === -1 ? 0 : lineOf(raw, index), rule: 'hardcoded-price', message: `"${key}" holds a typed price "${value}"`, fix: 'Use a {priceText} placeholder filled with the store\'s price string; storefronts differ in price and currency.' });
    }
  }
}

function checkServer(sources, serverDirs, report) {
  const rule = 'client-entitlement-for-quota';
  const fix = 'Decide on the server from the entitlement record the webhook writes (resolvePlan(doc, nowMs)); a request field or the client SDK\'s customer info is a claim anyone can forge.';
  for (const file of sources.filter((item) => !item.isTest && underAny(item.rel, serverDirs))) {
    const code = file.scan.code;
    for (const match of code.matchAll(REQUEST_FLAG)) {
      report.problem({ file: file.rel, line: lineOf(code, match.index), rule, message: `${match[0].replace(/\s+/g, '')} read from the request decides a plan`, fix });
    }
    for (const match of code.matchAll(REQUEST_DESTRUCTURE)) {
      const names = match[1].split(',').map((part) => part.split(':')[0].trim());
      const field = names.find((name) => new RegExp(`^(?:${CLIENT_FIELDS})$`).test(name));
      if (field) report.problem({ file: file.rel, line: lineOf(code, match.index), rule, message: `${field} destructured from the request decides a plan`, fix });
    }
    const lines = new Set();
    for (const match of code.matchAll(CLIENT_SDK_SHAPE)) lines.add(lineOf(code, match.index));
    for (const line of lines) report.problem({ file: file.rel, line, rule, message: 'customerInfo (the client SDK\'s view) in server code', fix });
  }
}

function checkWebhookText(rel, text, report) {
  const code = maskComments(text);
  const fixAuth = 'Compare the Authorization header with the dashboard value in constant time (hash both, timingSafeEqual) and answer 401 before anything else, as templates/server/src/subscriptions/revenuecat-webhook-handler.ts does.';
  if (!/authorization/i.test(code)) report.problem({ file: rel, rule: 'webhook-unauthenticated', message: 'reads no Authorization header', fix: fixAuth });
  if (!/\btimingSafeEqual\s*\(/.test(code)) report.problem({ file: rel, rule: 'webhook-unauthenticated', message: 'no constant-time comparison (timingSafeEqual) of the Authorization header', fix: fixAuth });
  const plain = /authorization\w*\s*(?:===|!==|==|!=)\s*(?!null\b|undefined\b)|(?:===|!==|==|!=)\s*\w*\.?\w*authorization/i.exec(code);
  if (plain) report.problem({ file: rel, line: lineOf(code, plain.index), rule: 'webhook-unauthenticated', message: 'compares the Authorization header with an equality operator', fix: fixAuth });
  if (!/status\s*(?::|=|\()\s*401\b|sendStatus\s*\(\s*401\b/.test(code)) report.problem({ file: rel, rule: 'webhook-unauthenticated', message: 'never answers 401 for a wrong or missing Authorization header', fix: fixAuth });
  const claims = [...code.matchAll(CLAIM_CALL)];
  if (!claims.some((match) => EVENT_ID.test(match[1]))) {
    const at = claims.find((match) => /^claim/i.test(match[0])) ?? claims.find((match) => !/^createHash/.test(match[0]));
    report.problem({ file: rel, line: at === undefined ? 0 : lineOf(code, at.index), rule: 'webhook-not-idempotent', message: 'claims no record keyed by the RevenueCat event id (event.id) before writing', fix: 'Create-if-absent a ledger entry keyed by event.id (Firestore create, INSERT ... ON CONFLICT DO NOTHING) and return 200 on a duplicate; RevenueCat retries reuse the same id.' });
  }
}

function checkWebhooks(root, contract, report) {
  const serverExists = contract.serverDirs.some((dir) => existsSync(join(root, dir)));
  for (const rel of contract.webhookFiles) {
    if (existsSync(join(root, rel))) {
      checkWebhookText(rel, readFileSync(join(root, rel), 'utf8'), report);
      continue;
    }
    const reason = serverExists ? null : notYetCreated(root, { file: rel, owner: SERVER_OWNER });
    for (const rule of ['webhook-unauthenticated', 'webhook-not-idempotent']) {
      if (reason) report.skip({ file: rel, rule, message: reason });
      else report.problem({ file: rel, rule, message: 'the webhook handler listed in contracts/subscriptions.json does not exist', fix: 'Copy templates/server/src/subscriptions/ (the handler and its ports) into the server folder, or fix webhookFiles.' });
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`no package.json in ${positionals[0] ?? '.'}`, 'Run from the app\'s repo root, or pass it as the first argument.');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'check-revenuecat', json: options.json });
  const sources = loadSources(root);
  const packages = checkPackages(root, report);
  const importsSdk = sources.some((file) => !file.isTest && file.imports.some((entry) => isSpec(entry.spec, SDK)));
  if (!packages.listsSdk && !importsSdk) return report.notApplicable(`${SDK} is not in package.json and no code imports it`);
  const { contract } = readContract(root, layout);
  packages.report();
  const adapterRel = contract.adapterFile ?? `${layout.servicesDir}/subscription/revenuecat-subscription-adapter.ts`;
  checkImports(sources, { adapterRel, uiAllowed: new Set(contract.sdkImportersAllowed ?? []) }, report);
  checkAppConfig(root, report);
  checkPrices(root, sources, layout, report);
  checkServer(sources, contract.serverDirs, report);
  checkWebhooks(root, contract, report);
  return report.finish({ checked: sources.length + packages.count, unit: 'files' });
});
