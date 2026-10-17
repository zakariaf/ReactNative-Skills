#!/usr/bin/env node
// check-purchases.mjs: static checks of an app's in-app purchase (expo-iap behind PurchasePort, a
// saved Premium entitlement, the paywall flow, the StoreKit harness and the App Store Connect script).
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-purchases.mjs [repo-root]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, lineOf, UsageError, maskComments, matchGlob, notYetCreated, parseArgs, requireDir, run, walkRepo } from './check-lib.mjs';
import { findCalls, findImports, isTestFile } from './lib/source-scan.mjs';
import {
  adoption,
  contractList,
  FACTS,
  layoutOf,
  notApplicableFact,
  packageJsonFiles,
  purchasePaths,
  readContract,
  readJson,
  requiredFiles,
  SDK,
  sourceFiles,
  textOf,
} from './lib/purchase-repo.mjs';

const SPEC = {
  name: 'check-purchases',
  summary: 'Checks the in-app purchase of an Expo app: files in place, expo-iap pinned and imported only by its adapter, no server APIs or plugin options unless the contract opts in, the adapter facts, the store gated on connectivity, who may write the entitlement, the product id, no typed prices, catalog keys, paywall test IDs, and the StoreKit harness kept out of app code.',
  usage: '[repo-root] [options]',
  options: {
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: contract, required-file, sdk-pin, sdk-import, sdk-api, banned-api, plugin-entry, plugin-options,',
    '  adapter-facts, store-offline, entitlement-writers, port-callers, product-id, typed-price, catalog-keys, state-testids,',
    '  harness-isolation, storekit-config, family-sharing, price-target, harness-maestro, harness-relaunch-wait,',
    '  harness-subflow (a SKIP only: the StoreKit flows run the debug sub-flow).',
    'App facts come from contracts/in-app-purchases.json (rn-skills.config.json key inAppPurchasesContract moves it);',
    'library facts from assets/purchase-facts.json. Paths come from resolveLayout (src/services/purchase,',
    'src/stores/premium, src/stores/paywall, src/data/entitlements, src/config, __mocks__, .maestro).',
    'NOT APPLICABLE when no code sells anything (no purchase folder and no import of expo-iap); with expo-iap',
    'installed but unused, sdk-pin and plugin-options still run first.',
    'SKIP lines (a pass): catalog-keys until src/i18n/catalogs exists (i18n-strings-and-catalogs creates it),',
    '  state-testids until the paywall screen folder exists (screen-contracts creates it), the StoreKit flows\'',
    '  debug sub-flow until .maestro/subflows/debug-setup.yaml exists (e2e-maestro creates it).',
    'The repo scan prunes installed skills (.agents/, .claude/, skills/, any folder with a SKILL.md) and generated folders.',
  ].join('\n'),
};

/** A typed price: a currency sign next to digits, or digits with a currency code. */
const PRICE = /(?:[€$£¥₹]\s?\d)|(?:\d+[.,]\d{2}\s?(?:€|EUR|USD|GBP|\$))|(?:\b(?:EUR|USD|GBP)\s?\d)/;

/** expo-iap's allowed server APIs (contract allowedApis) never include these two. */
function bannedApis(contract) {
  const allowed = new Set(contractList(contract, 'allowedApis'));
  return [...FACTS.serverApis.filter((name) => !allowed.has(name)), ...FACTS.neverAllowedApis];
}

function checkContract(contract, rel, report) {
  const fix = 'Copy templates/contracts/in-app-purchases.json (and its schema) and fill in the developer\'s decisions.';
  if (contract === null) {
    report.problem({ file: rel, rule: 'contract', message: 'the purchase contract is missing', fix });
    return false;
  }
  const missing = ['productId', 'familyShareable', 'price', 'paywallScreenDir', 'catalogKeys', 'priceKeys', 'stateTestIds'].filter((key) => contract[key] === undefined);
  for (const key of missing) report.problem({ file: rel, rule: 'contract', message: `"${key}" is missing`, fix });
  for (const name of contractList(contract, 'allowedApis')) {
    if (!FACTS.serverApis.includes(name)) report.problem({ file: rel, rule: 'contract', message: `allowedApis lists "${name}", which can never be allowed`, fix: 'useIAP and auto-finishing hide the finishing order; only the server APIs (verifyPurchase, verifyPurchaseWithProvider, kitApi, KitApiError) are an opt-in.' });
  }
  return missing.length === 0;
}

function checkFilesAndPins(root, layout, report) {
  for (const rel of requiredFiles(layout)) {
    if (!existsSync(join(root, rel))) report.problem({ file: rel, rule: 'required-file', message: 'missing', fix: `Copy templates/${rel.replace(/^.*?(?=src\/|__mocks__\/)/, '')} from the in-app-purchases skill (at your layout's path).` });
  }
}

function checkPins(root, report, words) {
  for (const rel of packageJsonFiles(root)) {
    const json = readJson(root, rel);
    for (const field of ['dependencies', 'devDependencies']) {
      const spec = json?.[field]?.[SDK];
      if (spec !== undefined && spec !== FACTS.sdk.version) report.problem({ file: rel, rule: 'sdk-pin', message: `${field}.${SDK} is "${spec}", not exactly "${FACTS.sdk.version}"`, fix: `Run npm install -E ${SDK}@${FACTS.sdk.version} (a single-maintainer SDK with frequent releases: upgrade only after the re-verification in references/store-and-adapter.md).` });
    }
    const scripts = JSON.stringify(json?.scripts ?? {});
    for (const word of words.filter((item) => item.startsWith('EXPO_IAP_'))) {
      if (scripts.includes(word)) report.problem({ file: rel, rule: 'plugin-options', message: `a script sets ${word}`, fix: 'Remove it: it switches expo-iap to another billing SDK (Onside, Meta Horizon, Amazon); list it in contracts/in-app-purchases.json allowedConfigWords only when the developer decided so.' });
    }
  }
}

/**
 * app.config.ts/js, app.json, eas.json and .env* at the root, plus gradle.properties and
 * android/gradle.properties when present: where plugin entries and store switches live.
 */
function configFiles(root) {
  const names = existsSync(root) ? readdirSync(root) : [];
  const gradle = ['gradle.properties', 'android/gradle.properties'].filter((rel) => existsSync(join(root, rel)));
  return [...names.filter((name) => /^app\.config\.[cm]?[jt]s$|^app\.json$|^eas\.json$|^\.env/.test(name)).sort(), ...gradle];
}

/** openiapStore / ORG_GRADLE_PROJECT_openiapStore may only pin Play (a Quest or Fire store links another billing SDK). */
function checkStorePin(rel, text, keys, report) {
  if (keys.length === 0) return;
  const pattern = new RegExp(`\\b(${keys.join('|')})\\b["']?\\s*[:=]\\s*["']?([\\w-]*)`, 'g');
  for (const match of text.matchAll(pattern)) {
    if (FACTS.storePin.allowedValues.includes(match[2].toLowerCase())) continue;
    report.problem({ file: rel, line: lineOf(text, match.index), rule: 'plugin-options', message: `${match[1]} pins the Android store to "${match[2]}", not Play`, fix: 'Remove it, or pin play (openiapStore=play): another store links the Meta Horizon or Amazon billing SDK. Record a deliberate second store in contracts/in-app-purchases.json allowedConfigWords.' });
  }
}

function checkConfig(root, words, report, pinKeys = FACTS.storePin.keys) {
  let hasEntry = false;
  const pattern = words.length > 0 ? new RegExp(`\\b(${words.join('|')})\\b`, 'g') : null;
  const files = configFiles(root);
  for (const rel of files) {
    const raw = textOf(root, rel);
    const text = /\.[cm]?[jt]s$/.test(rel) ? maskComments(raw) : raw;
    if (/['"]expo-iap['"]/.test(text)) hasEntry = true;
    const withOptions = /\[\s*['"]expo-iap['"]\s*,/.exec(text);
    if (withOptions) report.problem({ file: rel, line: lineOf(text, withOptions.index), rule: 'plugin-options', message: 'the expo-iap plugin gets an options object', fix: "Use the bare string 'expo-iap': its options add a server (iapkitApiKey) or another billing SDK (Onside, Horizon, Amazon, alternative billing)." });
    checkStorePin(rel, text, pinKeys, report);
    if (pattern === null) continue;
    for (const match of text.matchAll(pattern)) report.problem({ file: rel, line: lineOf(text, match.index), rule: 'plugin-options', message: `${match[1]} in the build config`, fix: 'Remove it, or record the developer\'s decision in contracts/in-app-purchases.json allowedConfigWords.' });
  }
  return { hasEntry, files };
}

function checkPluginEntry(root, configs, report) {
  const appConfig = configs.files.find((name) => name.startsWith('app.'));
  if (appConfig === undefined) {
    report.problem({ file: 'app.config.ts', rule: 'plugin-entry', message: 'no app config', fix: "Keep the bare string 'expo-iap' in app.config.ts plugins." });
    return;
  }
  if (!configs.hasEntry) report.problem({ file: appConfig, rule: 'plugin-entry', message: "no 'expo-iap' plugin entry", fix: "Add the bare string 'expo-iap' to the plugins list (it declares Play Billing's com.android.vending.BILLING permission and links the StoreKit 2 module)." });
}

function checkSources(root, layout, contract, files, report) {
  const paths = purchasePaths(layout);
  const banned = bannedApis(contract);
  const bannedPattern = new RegExp(`\\b(${banned.join('|')})\\b`, 'g');
  const writersAllowed = contractList(contract, 'entitlementWritersAllowedIn');
  for (const rel of files) {
    const raw = textOf(root, rel);
    const text = maskComments(raw);
    const isTest = isTestFile(rel);
    for (const imp of findImports(raw)) {
      if (imp.from !== SDK && !imp.from.startsWith(`${SDK}/`)) continue;
      if (isTest) continue;
      if (rel !== paths.adapter) {
        report.problem({ file: rel, line: lineOf(raw, imp.index), rule: 'sdk-import', message: `imports ${imp.from} outside the adapter`, fix: `Use PurchasePort; only ${paths.adapter} imports ${SDK}.` });
        continue;
      }
      const names = (/\{([^}]*)\}/.exec(imp.text)?.[1] ?? '').split(',').map((name) => name.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const name of names) {
        if (!FACTS.adapter.allowedImports.includes(name)) report.problem({ file: rel, line: lineOf(raw, imp.index), rule: 'sdk-api', message: `imports ${name} from ${SDK}`, fix: 'Keep the adapter to the store functions the template uses.' });
      }
    }
    if (isTest) continue;
    const isApp = rel.startsWith(`${layout.srcDir}/`);
    if (isApp) for (const match of text.matchAll(bannedPattern)) report.problem({ file: rel, line: lineOf(text, match.index), rule: 'banned-api', message: `${match[1]} is used`, fix: 'Remove it: it calls a server (IAPKit, a verify endpoint), hides the finishing logic, or finishes before saving. A server profile is an explicit contract opt-in (allowedApis).' });
    if (isApp) for (const match of text.matchAll(/\b(SKTestSession|StoreKitTest)\b/g)) report.problem({ file: rel, line: lineOf(text, match.index), rule: 'harness-isolation', message: `${match[1]} in app code`, fix: `StoreKit test code lives only in ${paths.storekitDir}/ (a hosted XCTest bundle added to harness builds).` });
    checkStoreGate(rel, text, paths, report);
    checkWriters(rel, text, paths, writersAllowed, report);
    if (rel.startsWith(`${layout.srcDir}/`)) checkPortCallers(rel, text, paths, writersAllowed, report);
    if (rel.startsWith(`${layout.srcDir}/`) && !rel.startsWith(`${layout.i18nDir}/`)) checkTypedPrices(rel, text, report);
  }
}

/** The device adapter is created only inside withConnectivity(...). */
function checkStoreGate(rel, text, paths, report) {
  if (rel === paths.adapter) return;
  const gates = findCalls(text, 'withConnectivity');
  for (const match of text.matchAll(/\bcreateExpoIapPurchaseAdapter\s*\(/g)) {
    if (gates.some((gate) => match.index > gate.open && match.index < gate.close)) continue;
    report.problem({ file: rel, line: lineOf(text, match.index), rule: 'store-offline', message: 'the expo-iap adapter is used without withConnectivity()', fix: 'Build the port as withConnectivity(createExpoIapPurchaseAdapter(), connectivity.isOnline), so offline (and a simulated-offline switch) shows "store unavailable" without asking the store.' });
  }
}

/** Only the purchase service, the premium store and test-only code write the entitlement. */
function checkWriters(rel, text, paths, allowed, report) {
  if (rel === paths.service || rel.startsWith(`${paths.premiumDir}/`)) return;
  if (allowed.some((glob) => matchGlob(rel, glob))) return;
  for (const match of text.matchAll(/\b(grantPremium|revokePremium)\s*\(/g)) {
    report.problem({ file: rel, line: lineOf(text, match.index), rule: 'entitlement-writers', message: `${match[1]}() called outside the purchase service`, fix: 'Premium changes only through premium-service.ts (after the store verified a purchase or a revocation) and test-only code (contracts/in-app-purchases.json entitlementWritersAllowedIn); a stray call gives Premium away or takes it from a payer.' });
  }
}

/**
 * Only the purchase service talks to the store: a UI, model or store that calls the purchase port
 * itself skips buyPremium's paywall guard and drops a failed purchase silently. Seen: a call of
 * requestPurchase/finish/restore/readTransactions on a receiver named like the port
 * (`services.purchase`, `purchasePort`, `deps.purchase`), and requestPurchase/readTransactions on
 * anything in a file that imports the PurchasePort type.
 */
const PORT_METHODS = ['requestPurchase', 'finish', 'restore', 'readTransactions'];
function checkPortCallers(rel, text, paths, allowed, report) {
  if (rel.startsWith(`${paths.purchaseDir}/`) || allowed.some((glob) => matchGlob(rel, glob))) return;
  const named = new RegExp(`\\b[\\w$.]*[pP]urchase(?:Port)?\\s*\\??\\.\\s*(${PORT_METHODS.join('|')})\\s*\\(`, 'g');
  const seen = new Set();
  const flag = (index, method) => {
    if (seen.has(index)) return;
    seen.add(index);
    report.problem({ file: rel, line: lineOf(text, index), rule: 'port-callers', message: `calls the purchase port's ${method}() outside the purchase service`, fix: 'Wire the button through the purchase service (buyPremium / restorePremium from premium-service.ts): it guards the paywall state, saves before finishing and turns a failure into a notice.' });
  };
  for (const match of text.matchAll(named)) flag(match.index, match[1]);
  if (/\bPurchasePort\b/.test(text)) {
    for (const match of text.matchAll(/\.\s*(requestPurchase|readTransactions)\s*\(/g)) flag(match.index, match[1]);
  }
}

function checkTypedPrices(rel, text, report) {
  text.split('\n').forEach((line, index) => {
    for (const literal of line.match(/(['"`])(?:(?!\1).)*\1/g) ?? []) {
      if (PRICE.test(literal)) report.problem({ file: rel, line: index + 1, rule: 'typed-price', message: `price-like text ${literal} in code`, fix: "Show the store's own price text (storePriceText(product), the displayPrice) through the {priceText} placeholder; never type a price." });
    }
  });
}

function checkAdapterFacts(root, paths, report) {
  if (!existsSync(join(root, paths.adapter))) return;
  const text = maskComments(textOf(root, paths.adapter)).replace(/\s+/g, ' ');
  for (const [needle, why] of Object.entries(FACTS.adapter.mustContain)) {
    if (!text.includes(needle)) report.problem({ file: paths.adapter, rule: 'adapter-facts', message: `missing "${needle}"`, fix: `The adapter must ${why}.` });
  }
  if (/onlyIncludeActiveItemsIOS\s*:\s*true/.test(text)) report.problem({ file: paths.adapter, rule: 'adapter-facts', message: 'reads only active entitlements', fix: 'Pass onlyIncludeActiveItemsIOS: false so refunds (revocation dates) stay visible.' });
}

const PRODUCT_ID = /^[a-z0-9][a-z0-9._]{0,39}$/;

function checkProductId(root, paths, contract, contractRel, report) {
  const id = contract.productId;
  if (typeof id !== 'string' || !PRODUCT_ID.test(id) || id.startsWith('android.test')) {
    report.problem({ file: contractRel, rule: 'product-id', message: `productId "${String(id)}" is not valid on both stores`, fix: 'Lowercase letters, digits, "." and "_", a letter or digit first, at most 40 characters (naming-conventions\' product-id grammar): usually <bundle id>.premium. Choose it once: it can never be reused.' });
  }
  if (!existsSync(join(root, paths.products))) return;
  const text = maskComments(textOf(root, paths.products));
  const constant = /\bPREMIUM_PRODUCT_ID\s*=\s*['"]([^'"]*)['"]/.exec(text);
  if (constant === null || constant[1] !== id) report.problem({ file: paths.products, line: constant === null ? 1 : lineOf(text, constant.index), rule: 'product-id', message: `PREMIUM_PRODUCT_ID is "${constant?.[1] ?? 'not a literal'}", the contract says "${String(id)}"`, fix: 'One product id, written once: the constant equals contracts/in-app-purchases.json productId.' });
}

function checkCatalogs(root, layout, contract, report) {
  const dir = `${layout.i18nDir}/catalogs`;
  const reason = notYetCreated(root, { file: dir, owner: 'i18n-strings-and-catalogs' });
  if (reason) {
    report.skip({ file: dir, rule: 'catalog-keys', message: reason });
    return;
  }
  const keys = contractList(contract, 'catalogKeys');
  const priceKeys = contractList(contract, 'priceKeys');
  for (const name of readdirSync(join(root, dir)).filter((file) => file.endsWith('.json')).sort()) {
    const rel = `${dir}/${name}`;
    const catalog = readJson(root, rel);
    if (catalog === null) {
      report.problem({ file: rel, rule: 'catalog-keys', message: 'not valid JSON', fix: 'Fix the catalog.' });
      continue;
    }
    for (const key of keys) {
      if (typeof catalog[key] !== 'string') report.problem({ file: rel, rule: 'catalog-keys', message: `no "${key}"`, fix: 'Every locale holds every paywall key (contracts/in-app-purchases.json catalogKeys); store texts from App Store Connect are never shown in the app.' });
    }
    for (const key of priceKeys) {
      if (typeof catalog[key] === 'string' && !catalog[key].includes('{priceText}')) report.problem({ file: rel, rule: 'typed-price', message: `"${key}" has no {priceText} placeholder`, fix: 'Prices come from the store through {priceText}; never type one into a catalog.' });
    }
    for (const key of keys) {
      if (typeof catalog[key] === 'string' && PRICE.test(catalog[key])) report.problem({ file: rel, rule: 'typed-price', message: `"${key}" contains a typed price`, fix: 'Use {priceText}.' });
    }
  }
}

function checkScreen(root, contract, report) {
  const dir = typeof contract.paywallScreenDir === 'string' ? contract.paywallScreenDir.replace(/\/$/, '') : 'src/features/paywall';
  const reason = notYetCreated(root, { file: dir, owner: 'screen-contracts' });
  if (reason) {
    report.skip({ file: dir, rule: 'state-testids', message: reason });
    return;
  }
  const text = walkRepo(join(root, dir), { include: ['*.ts', '*.tsx'] }).filter((rel) => !isTestFile(rel)).map((rel) => readFileSync(join(root, dir, rel), 'utf8')).join('\n');
  for (const id of contractList(contract, 'stateTestIds')) {
    if (![`'${id}'`, `"${id}"`, `\`${id}\``].some((quoted) => text.includes(quoted))) report.problem({ file: dir, rule: 'state-testids', message: `no element with testID "${id}"`, fix: 'Every paywall state and notice has its test ID (the state table in references/paywall-states.md); Maestro and the StoreKit harness find the states by them.' });
  }
}

function checkHarnessFiles(root, layout, paths, report) {
  const flowsRoot = `${layout.e2eDir}/`;
  for (const rel of walkRepo(root)) {
    if (rel.startsWith(`${paths.storekitDir}/`)) continue;
    if (/\.(storekit|xctest)$/.test(rel)) report.problem({ file: rel, rule: 'harness-isolation', message: `StoreKit test artefact outside ${paths.storekitDir}/`, fix: `Keep the harness files in ${paths.storekitDir}/; the harness adds them only to throwaway harness builds.` });
    if (/\.(entitlements|plist|json|ts|tsx|rb|yaml|yml)$/.test(rel) && readFileSync(join(root, rel), 'utf8').includes('get-task-allow')) report.problem({ file: rel, rule: 'harness-isolation', message: 'mentions get-task-allow', fix: 'get-task-allow is added only to the Debug configuration of a harness build by add-harness.rb; it must never ship.' });
    if (rel.startsWith(flowsRoot) && !rel.startsWith(`${paths.storekitFlowsDir}/`) && /\.ya?ml$/.test(rel) && /testArm|tags:\s*\[[^\]]*storekit/i.test(readFileSync(join(root, rel), 'utf8'))) {
      report.problem({ file: rel, rule: 'harness-isolation', message: `a StoreKit flow outside ${paths.storekitFlowsDir}/`, fix: `Move it to ${paths.storekitFlowsDir}/: the normal E2E run must never run it against an unarmed build.` });
    }
  }
}

/** Every StoreKit configuration: the harness's file and any one left in a generated ios/. */
function storeKitConfigs(root, paths) {
  const found = [];
  for (const dir of [paths.storekitDir, 'ios']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir)).filter((file) => file.endsWith('.storekit')).sort()) found.push(`${dir}/${name}`);
  }
  return found;
}

function checkStoreKit(root, paths, contract, report) {
  for (const rel of storeKitConfigs(root, paths)) {
    let config = null;
    try {
      config = JSON.parse(textOf(root, rel));
    } catch {
      report.problem({ file: rel, rule: 'storekit-config', message: 'not valid JSON', fix: 'Copy the StoreKit configuration template from this skill.' });
      continue;
    }
    const products = config?.products ?? [];
    const product = products[0] ?? {};
    if (products.length !== 1 || product.type !== 'NonConsumable' || product.productID !== contract.productId) {
      report.problem({ file: rel, rule: 'storekit-config', message: `expects exactly one NonConsumable product "${String(contract.productId)}"`, fix: 'One non-consumable Premium whose productID is the contract\'s productId.' });
    }
    if (product.familyShareable !== contract.familyShareable) report.problem({ file: rel, rule: 'family-sharing', message: `familyShareable is ${String(product.familyShareable)}, the contract says ${String(contract.familyShareable)}`, fix: 'Family Sharing is the developer\'s decision (contracts/in-app-purchases.json familyShareable); once on in App Store Connect it can never be turned off.' });
    const amount = contract.price?.amount;
    if (product.displayPrice !== amount) report.problem({ file: rel, rule: 'price-target', message: `displayPrice is ${String(product.displayPrice)}, the contract's price point is ${String(amount)}`, fix: 'The test store sells at the contract\'s price.amount.' });
    const storefront = config?.settings?._storefront;
    if (storefront !== contract.price?.baseTerritory) report.problem({ file: rel, rule: 'price-target', message: `_storefront is ${String(storefront)}, the contract's base territory is ${String(contract.price?.baseTerritory)}`, fix: 'Set settings._storefront to contracts/in-app-purchases.json price.baseTerritory.' });
  }
}

function checkAscScripts(root, paths, report) {
  if (existsSync(join(root, paths.ascPayloads))) {
    const text = maskComments(textOf(root, paths.ascPayloads));
    const literal = /familySharable\s*:\s*(true|false)\b/.exec(text);
    if (literal) report.problem({ file: paths.ascPayloads, line: lineOf(text, literal.index), rule: 'family-sharing', message: `familySharable is the literal ${literal[1]}`, fix: 'Take it from the contract (contract.familyShareable), so the product and the test store can never disagree.' });
    if (!/NON_CONSUMABLE/.test(text)) report.problem({ file: paths.ascPayloads, rule: 'storekit-config', message: 'the product is not NON_CONSUMABLE', fix: 'Premium is one non-consumable product.' });
  }
  if (existsSync(join(root, paths.ascCreate))) {
    const text = maskComments(textOf(root, paths.ascCreate));
    const hardCoded = /\b(?:const|let)\s+[A-Z_]*(?:PRICE|TARGET|TERRITORY)[A-Z_]*\s*=\s*['"0-9]/.exec(text);
    if (hardCoded || !/\bparseIapContract\s*\(/.test(text)) report.problem({ file: paths.ascCreate, line: hardCoded ? lineOf(text, hardCoded.index) : 1, rule: 'price-target', message: hardCoded ? 'the price or territory is written into the script' : 'the script does not read the contract', fix: 'Read the price point and base territory from contracts/in-app-purchases.json (parseIapContract); the script stops when that price is not a price point, and the developer decides.' });
  }
}

/** Every Maestro run of the harness names its simulator and its own driver port. */
function checkHarnessMaestro(root, paths, report) {
  const rel = paths.harness;
  if (!existsSync(join(root, rel))) return;
  const text = maskComments(textOf(root, rel));
  const fix = 'Build the Maestro arguments with maestroGlobalArgs({ udid, driverPort }) from scripts/e2e/maestro-args.ts before the command (copy the harness template again).';
  if (!/\bmaestroGlobalArgs\s*\(/.test(text)) report.problem({ file: rel, line: 1, rule: 'harness-maestro', message: 'runs Maestro without maestroGlobalArgs (the global --device <udid> and its own --driver-host-port)', fix });
  for (const match of text.matchAll(/['"`]--udid['"`]/g)) report.problem({ file: rel, line: lineOf(text, match.index), rule: 'harness-maestro', message: "passes Maestro's per-command --udid, so the run shares the XCTest driver port with other sessions", fix });
  for (const spawned of text.matchAll(/\bspawn(?:Sync)?\s*\(\s*maestro\b/g)) {
    const starts = [...text.slice(0, spawned.index).matchAll(/\bfunction\s+\w+\s*\(/g)];
    const start = starts.at(-1)?.index ?? 0;
    if (/\b(?:driverPortFor|freeDriverPort)\s*\(/.test(text.slice(start, spawned.index))) continue;
    report.problem({ file: rel, line: lineOf(text, start), rule: 'harness-maestro', message: 'every flow reuses one driver port: the function that spawns Maestro does not pick its own port for each run', fix: 'Inside the function that runs one flow, build the target with { udid, driverPort: await driverPortFor(givenPort) }.' });
  }
}

/** The relaunch flows wait long enough for StoreKit's transaction-cache sync (28 s measured). */
function checkRelaunchWaits(root, paths, report) {
  const { relaunchFlows, relaunchWaitMs } = FACTS.storekit;
  for (const name of relaunchFlows) {
    const rel = `${paths.storekitFlowsDir}/${name}`;
    if (!existsSync(join(root, rel))) continue;
    const text = textOf(root, rel);
    for (const item of text.matchAll(/^- extendedWaitUntil:[^\n]*\n((?:[ \t]+[^\n]*\n?)*)/gm)) {
      const body = item[1];
      const id = /\bid:\s*['"]?([\w.-]+)['"]?/.exec(body)?.[1];
      if (id === undefined || id.endsWith('.screen')) continue;
      const timeout = /\btimeout:\s*(\d+)/.exec(body);
      if (timeout !== null && Number(timeout[1]) >= relaunchWaitMs) continue;
      const at = timeout === null ? item.index : item.index + item[0].indexOf(timeout[0]);
      report.problem({ file: rel, line: lineOf(text, at), rule: 'harness-relaunch-wait', message: `waits ${timeout?.[1] ?? 'the default'} ms for ${id} after a relaunch, but StoreKit answers the launch re-check only after its transaction sync (28 s measured)`, fix: `timeout: ${String(relaunchWaitMs)} on this extendedWaitUntil; never shorten it to make a run faster.` });
    }
  }
}

function checkSubflow(root, paths, report) {
  if (!existsSync(join(root, paths.storekitFlowsDir))) return;
  const reason = notYetCreated(root, { file: paths.debugSubflow, owner: 'e2e-maestro' });
  if (reason) report.skip({ file: paths.debugSubflow, rule: 'harness-subflow', message: reason });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Pass the app\'s root (the folder with package.json and app.config.ts); in a monorepo, the app workspace.');
  const layout = layoutOf(root);
  const report = createReporter({ name: 'check-purchases', json: options.json });
  const state = adoption(root, layout);
  const { rel: contractRel, contract } = readContract(root, layout);
  const allowedWords = contractList(contract, 'allowedConfigWords');
  const words = FACTS.bannedConfigWords.filter((word) => !allowedWords.includes(word));
  const pinKeys = FACTS.storePin.keys.filter((key) => !allowedWords.includes(key));
  const fact = notApplicableFact(state);
  checkPins(root, report, words);
  const configs = checkConfig(root, words, report, pinKeys);
  if (fact !== null) return report.count > 0 ? report.finish({ checked: configs.files.length + 1, unit: 'files' }) : report.notApplicable(fact);
  const paths = purchasePaths(layout);
  const files = sourceFiles(root);
  checkFilesAndPins(root, layout, report);
  checkPluginEntry(root, configs, report);
  checkAdapterFacts(root, paths, report);
  const contractOk = checkContract(contract, contractRel, report);
  checkSources(root, layout, contract, files, report);
  checkHarnessFiles(root, layout, paths, report);
  checkHarnessMaestro(root, paths, report);
  checkRelaunchWaits(root, paths, report);
  checkSubflow(root, paths, report);
  checkAscScripts(root, paths, report);
  if (contractOk) {
    checkProductId(root, paths, contract, contractRel, report);
    checkCatalogs(root, layout, contract, report);
    checkScreen(root, contract, report);
    checkStoreKit(root, paths, contract, report);
  }
  return report.finish({ checked: files.length, unit: 'files' });
});
