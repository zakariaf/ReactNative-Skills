// purchase-repo.mjs: what both in-app-purchases checkers need to know about an app repo: the layout
// paths of the purchase files, whether the purchase feature is adopted (or a repo fact makes the
// check not applicable), the app's contract (contracts/in-app-purchases.json) and the library facts.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, maskComments, readWorkspaces, resolveLayout, walkRepo } from '../check-lib.mjs';
import { findImports, isTestFile } from './source-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The library facts (assets/purchase-facts.json): pinned version, allowlists, banned words. */
export const FACTS = JSON.parse(readFileSync(join(HERE, '..', '..', 'assets', 'purchase-facts.json'), 'utf8'));
export const SDK = FACTS.sdk.package;

/** rn-skills.config.json key for a contract kept somewhere else. */
export const CONTRACT_KEY = 'inAppPurchasesContract';

/** Every purchase file of the skill, by role, at the app's layout paths. */
export function purchasePaths(layout) {
  const purchase = `${layout.servicesDir}/purchase`;
  const premium = `${layout.storesDir}/premium`;
  const paywall = `${layout.storesDir}/paywall`;
  const entitlements = `${layout.dataDir}/entitlements`;
  return {
    purchaseDir: purchase,
    premiumDir: premium,
    paywallDir: paywall,
    port: `${purchase}/purchase-port.ts`,
    adapter: `${purchase}/expo-iap-purchase-adapter.ts`,
    fake: `${purchase}/fake-purchase.ts`,
    gate: `${purchase}/connectivity-gated-purchase.ts`,
    evidence: `${purchase}/entitlement-evidence.ts`,
    service: `${purchase}/premium-service.ts`,
    flow: `${purchase}/premium-store-flow.ts`,
    reloads: `${purchase}/connect-premium-reloads.ts`,
    price: `${purchase}/store-price-text.ts`,
    premiumReducer: `${premium}/premium-reducer.ts`,
    premiumStore: `${premium}/premium-store.ts`,
    /** Optional: the in-context upsell line (checked only when it exists). */
    upsell: `${premium}/upsell-line.ts`,
    paywallState: `${paywall}/paywall-state.ts`,
    paywallReducer: `${paywall}/paywall-reducer.ts`,
    paywallView: `${paywall}/paywall-view.ts`,
    paywallNotice: `${paywall}/paywall-notice.ts`,
    paywallStore: `${paywall}/paywall-store.ts`,
    repository: `${entitlements}/entitlement-repository.ts`,
    products: `${layout.configDir}/purchase-products.ts`,
    mock: `${layout.mocksDir}/expo-iap.ts`,
    storekitDir: FACTS.storekit.dir,
    storekitFlowsDir: `${layout.e2eDir}/${FACTS.storekit.flowsFolder}`,
    debugSubflow: `${layout.e2eDir}/subflows/debug-setup.yaml`,
    harness: `${FACTS.storekit.dir}/storekit-harness.ts`,
    ascPayloads: 'scripts/asc/premium-iap-payloads.ts',
    ascCreate: 'scripts/asc/create-premium-iap.ts',
  };
}

/** The files a complete adoption holds (tests beside the modules that need them). */
export function requiredFiles(layout) {
  const p = purchasePaths(layout);
  const withTest = (rel) => [rel, rel.replace(/\.ts$/, '.test.ts')];
  return [
    p.mock,
    p.port,
    p.adapter,
    ...withTest(p.fake),
    ...withTest(p.gate),
    ...withTest(p.evidence),
    ...withTest(p.service),
    p.flow,
    ...withTest(p.reloads),
    ...withTest(p.price),
    ...withTest(p.premiumReducer),
    `${p.premiumDir}/premium-reducer-cases.ts`,
    `${p.premiumDir}/premium-selectors.ts`,
    ...withTest(p.premiumStore),
    `${p.premiumDir}/purchase-stores-context.tsx`,
    ...withTest(`${p.premiumDir}/open-purchase-stores.ts`),
    p.paywallState,
    `${p.paywallDir}/paywall-transitions.ts`,
    ...withTest(p.paywallReducer),
    `${p.paywallDir}/paywall-reducer-cases.ts`,
    p.paywallView,
    p.paywallNotice,
    ...withTest(p.paywallStore),
    p.repository,
    `${layout.dataDir}/entitlements/sqlite-entitlement-repository.ts`,
    `${layout.dataDir}/entitlements/fake-entitlement-repository.ts`,
    p.products,
  ];
}

/** Every package.json the repo installs from: the root and each workspace. */
export function packageJsonFiles(root) {
  return ['package.json', ...readWorkspaces(root).map((ws) => `${ws.dir}/package.json`)].filter((rel) => existsSync(join(root, rel)));
}

export function readJson(root, rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch {
    return null;
  }
}

/** The app's source and tooling files (TS/JS), installed skills and generated folders pruned. */
export function sourceFiles(root) {
  return walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'], ignore: ['**/*.d.ts'] });
}

function importsSdk(text) {
  return findImports(text).some((imp) => imp.from === SDK || imp.from.startsWith(`${SDK}/`));
}

/**
 * Whether the purchase feature is adopted. Not adopted: no purchase folder and no app file imports
 * expo-iap (root mocks and tests do not count). `dependency` says whether a package.json lists it.
 */
export function adoption(root, layout) {
  const paths = purchasePaths(layout);
  const dependency = packageJsonFiles(root).some((rel) => {
    const json = readJson(root, rel);
    return json?.dependencies?.[SDK] !== undefined || json?.devDependencies?.[SDK] !== undefined;
  });
  const importers = sourceFiles(root).filter((rel) => !isTestFile(rel) && importsSdk(readFileSync(join(root, rel), 'utf8')));
  const hasFolder = existsSync(join(root, paths.purchaseDir));
  return { dependency, importers, isAdopted: hasFolder || importers.length > 0 };
}

/** The repo facts behind a NOT APPLICABLE, or null when the check applies. */
export function notApplicableFact(state) {
  if (state.isAdopted) return null;
  if (!state.dependency) return `${SDK} is not in package.json and no code sells anything (no purchase folder, no import of ${SDK})`;
  return `${SDK} is installed but no code uses it yet (no purchase folder and no import of ${SDK})`;
}

/** The contract's path: contracts/in-app-purchases.json, or rn-skills.config.json inAppPurchasesContract. */
export function contractPath(layout) {
  const configured = layout.config?.[CONTRACT_KEY];
  return typeof configured === 'string' ? posix.normalize(configured) : `${layout.contractsDir}/in-app-purchases.json`;
}

/** The parsed contract, or null when the file is missing. Malformed JSON is bad input (exit 2). */
export function readContract(root, layout) {
  const rel = contractPath(layout);
  if (!existsSync(join(root, rel))) return { rel, contract: null };
  try {
    return { rel, contract: JSON.parse(readFileSync(join(root, rel), 'utf8')) };
  } catch (error) {
    return fail(`${rel} is not valid JSON (${error.message})`, 'Fix the contract (templates/contracts/in-app-purchases.json shows every key).');
  }
}

/** Contract defaults for keys an older contract leaves out. */
export function contractList(contract, key) {
  const value = contract?.[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

export function layoutOf(root) {
  return resolveLayout(root);
}

export function textOf(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

export function maskedOf(root, rel) {
  return maskComments(textOf(root, rel));
}
