#!/usr/bin/env node
// check-purchase-behaviour.mjs: runs the app's own purchase modules (the paywall and premium
// reducers, view, notice, evidence, service, store flow, reloads, store price text, connectivity gate,
// the optional upsell line)
// through Node's type stripping against the purchase rules, and runs the expo-iap adapter against a
// scripted expo-iap stand-in (lib/stubs/expo-iap.mjs). It also reads the composition root for the
// two calls that start the store and keep it fresh.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-purchase-behaviour.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, maskComments, parseArgs, requireDir, run, UsageError } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { registerModuleStubs } from './lib/module-stubs.mjs';
import { adoption, layoutOf, notApplicableFact, purchasePaths, sourceFiles } from './lib/purchase-repo.mjs';
import { isTestFile } from './lib/source-scan.mjs';
import { iapStub } from './lib/stubs/expo-iap.mjs';

registerModuleStubs({ 'expo-iap': join(dirname(fileURLToPath(import.meta.url)), 'lib', 'stubs', 'expo-iap.mjs') });

const SPEC = {
  name: 'check-purchase-behaviour',
  summary: "Loads the app's purchase modules (Node type stripping) and checks every paywall state, the restore notices, the entitlement reducer and evidence rules, the service order (listen first; save -> show -> finish, never finish an unsaved purchase), restore and revocation, the offline gate, the reloads after startup, the store price text, the optional upsell cap and the expo-iap adapter (never finishing on its own).",
  usage: '[repo-root] [options]',
  options: {
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: module-load, paywall-states, restore-notices, entitlement-reducer, evidence, service-order, restore-flow,',
    '  revocation, store-flow, price-text, upsell-line, offline-gate, store-reloads, adapter-errors, adapter-restore,',
    '  adapter-transactions, adapter-finish, adapter-calls, adapter-results.',
    'upsell-line runs only when src/stores/premium/upsell-line.ts exists (an optional template).',
    'store-reloads also reads the composition root: a non-test file under src/ outside src/services/purchase/',
    '  must call startPremium(...) and connectPremiumReloads(...) (startPremium runs before the first network',
    '  report, so without the reloads the price never loads and a refund waits for the next launch).',
    'expo-iap is replaced by the scripted stand-in lib/stubs/expo-iap.mjs. Paths come from resolveLayout.',
    'NOT APPLICABLE when no code sells anything (no purchase folder and no import of expo-iap).',
    'Needs Node 22.18+ (type stripping).',
  ].join('\n'),
};

const ID = 'com.example.tasks.premium';
const PRODUCT = { productId: ID, displayPrice: '€1.99', price: 1.9899999999999998, currency: 'EUR' };
const REVOKED_AT = 1_700_000_000_000;
const ok = (value) => ({ ok: true, value });
const storeErr = (code) => ({ ok: false, error: { kind: 'store-error', code } });
const tx = (overrides = {}) => ({ productId: ID, transactionId: 't1', state: 'purchased', revocationDateMs: null, handle: null, ...overrides });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function label(action) {
  return `paywall:${action.type}${action.evidence ? `:${action.evidence}` : ''}${action.failure ? `:${action.failure}` : ''}`;
}

/**
 * A scripted PurchasePort, a premium store and a paywall store over the app's real reducers, and
 * deps that log every call in order: port calls, 'grant', 'revoke@<ms>', 'paywall:<action>', 'onError'.
 */
function harness(mods, script = {}) {
  const { isConnected = true, product = PRODUCT, restoreFails = false, transactions = [], connectFails = false, readFails = false, finishFails = false, saveRefused = false, isPremium = false } = script;
  const log = [];
  const listeners = new Set();
  const port = {
    connect: async () => { log.push('connect'); return connectFails ? storeErr('init-connection') : ok(isConnected); },
    fetchProduct: async () => { log.push('fetchProduct'); return ok(product); },
    requestPurchase: async () => { log.push('requestPurchase'); },
    finish: async (t) => { log.push(`finish:${t.transactionId}`); return finishFails ? storeErr('unknown') : ok(undefined); },
    restore: async () => { log.push('restore'); return restoreFails ? storeErr('sync-error') : ok(undefined); },
    readTransactions: async () => { log.push('readTransactions'); return readFails ? storeErr('unknown') : ok(transactions); },
    subscribe: (listener) => { log.push('subscribe'); listeners.add(listener); return () => listeners.delete(listener); },
  };
  let premiumState = { entitlement: { isOwned: isPremium, ownedSinceMs: isPremium ? 1 : null, revokedAtMs: null } };
  const refused = { ok: false, error: { kind: 'storage-full' } };
  const methods = {
    grantPremium: ({ ownedSinceMs }) => {
      log.push('grant');
      if (saveRefused) return refused;
      premiumState = mods.premiumReducer.premiumReducer(premiumState, { type: 'grant-premium', atMs: ownedSinceMs });
      return ok(undefined);
    },
    revokePremium: (revokedAtMs) => {
      log.push(`revoke@${revokedAtMs}`);
      if (saveRefused) return refused;
      premiumState = mods.premiumReducer.premiumReducer(premiumState, { type: 'revoke-premium', revokedAtMs });
      return ok(undefined);
    },
  };
  let paywallState = mods.paywallState.INITIAL_PAYWALL_STATE;
  const dispatch = (action) => {
    log.push(label(action));
    paywallState = mods.paywallReducer.paywallReducer(paywallState, action);
  };
  const deps = {
    port,
    productId: ID,
    premium: { getState: () => ({ ...premiumState, ...methods }) },
    paywall: { getState: () => ({ ...paywallState, dispatch }) },
    nowMs: () => 1_000,
    formatPrice: mods.price ? mods.price.storePriceText : (p) => p.displayPrice,
    onError: () => log.push('onError'),
  };
  const emit = (event) => listeners.forEach((listener) => listener(event));
  return { log, deps, emit, isOwned: () => premiumState.entitlement.isOwned, flow: () => paywallState.flow, state: () => paywallState };
}

/** A ConnectivityPort the check drives. */
function connectivityAt(isOnline) {
  let online = isOnline;
  const listeners = new Set();
  return {
    isOnline: () => online,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    setOnline: (next) => { if (next === online) return; online = next; listeners.forEach((listener) => listener(next)); },
    count: () => listeners.size,
  };
}

async function loadModules(app, paths, report) {
  const files = {
    premiumReducer: paths.premiumReducer,
    paywallState: paths.paywallState,
    paywallReducer: paths.paywallReducer,
    view: paths.paywallView,
    notice: paths.paywallNotice,
    evidence: paths.evidence,
    service: paths.service,
    flow: paths.flow,
    reloads: paths.reloads,
    price: paths.price,
    adapter: paths.adapter,
    gate: paths.gate,
  };
  const mods = {};
  if (app.exists(paths.upsell)) {
    files.upsell = paths.upsell;
    try {
      mods.upsell = await app.load(paths.upsell);
    } catch (error) {
      report.problem({ file: paths.upsell, rule: 'module-load', message: `cannot be imported: ${String(error?.message ?? error).split('\n')[0]}`, fix: 'Keep upsell-line.ts pure: no React Native, Expo or zustand imports.' });
    }
  }
  for (const [key, rel] of Object.entries(files)) {
    if (key === 'upsell') continue;
    if (!app.exists(rel)) {
      report.problem({ file: rel, rule: 'module-load', message: `${rel.split('/').pop()} does not exist`, fix: 'Copy the module from the in-app-purchases templates.' });
      continue;
    }
    try {
      mods[key] = await app.load(rel);
    } catch (error) {
      report.problem({ file: rel, rule: 'module-load', message: `cannot be imported: ${String(error?.message ?? error).split('\n')[0]}`, fix: 'Keep the module pure (types, other pure modules, @/core/result): no React Native, Expo or zustand imports, no enums.' });
    }
  }
  return { mods, files };
}

function makeExpect(report, counter) {
  return async (rule, file, label, fn, expected, fix) => {
    counter.checked += 1;
    let actual;
    try {
      actual = await fn();
    } catch (error) {
      actual = `threw ${String(error?.message ?? error).split('\n')[0]}`;
    }
    if (!same(actual, expected)) report.problem({ file, rule, message: `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, fix });
  };
}

async function checkPaywall(mods, files, expect) {
  const { paywallReducer, paywallState, view, notice } = mods;
  if (!paywallReducer || !paywallState || !view) return;
  const run1 = (actions) => actions.reduce(paywallReducer.paywallReducer, paywallState.INITIAL_PAYWALL_STATE);
  const viewOf = (actions, isPremium = false) => view.paywallView(run1(actions), isPremium);
  const READY = [{ type: 'set-price', price: '€1.99' }];
  const BUYING = [...READY, { type: 'start-purchase', isPremium: false }];
  const fail = (failure) => ({ type: 'record-purchase-failure', failure });
  const restoreWith = (evidence, isPremium = evidence === 'owned') => [...READY, { type: 'start-restore' }, { type: 'finish-restore', evidence, isPremium }];
  const fix = 'Restore the paywall reducer, transitions and view from the templates; every paywall state must stay reachable exactly as in the state table.';
  const cases = [
    ['Loading price', [], false, 'loading-price'],
    ['Store unavailable', [{ type: 'mark-store-unavailable' }], false, 'store-unavailable'],
    ['the normal page', READY, false, 'ready'],
    ['Purchase in progress', BUYING, false, 'purchase-in-progress'],
    ['Pending (a deferred failure)', [...BUYING, fail('deferred')], false, 'pending'],
    ['Pending (a pending transaction)', [...BUYING, { type: 'mark-purchase-pending' }], false, 'pending'],
    ['Success', [...BUYING, { type: 'finish-purchase' }], true, 'success'],
    ['Success after an approved Ask to Buy', [...BUYING, { type: 'mark-purchase-pending' }, { type: 'finish-purchase' }], true, 'success'],
    ['Cancelled by the user', [...BUYING, fail('cancelled')], false, 'ready'],
    ['Error', [...BUYING, fail('failed')], false, 'error'],
    ['offline during the purchase', [...BUYING, fail('unavailable')], false, 'store-unavailable'],
    ['already owned runs restore', [...BUYING, fail('already-owned')], false, 'restoring'],
    ['Saved nowhere: a purchase the disk refused', [...BUYING, { type: 'record-save-failure' }], false, 'save-failed'],
    ['Already owned after the thank-you', [...BUYING, { type: 'finish-purchase' }, { type: 'clear-thanks' }], true, 'already-owned'],
    ['a purchase delivered at launch shows no thank-you', [{ type: 'finish-purchase' }], true, 'already-owned'],
    ['nothing to restore after a successful sync', restoreWith('unknown'), false, 'restore-empty'],
    ['restore failed', restoreWith('sync-failed'), false, 'restore-failed'],
    ['restored', restoreWith('owned'), true, 'already-owned'],
    ['a duplicated failure is ignored', [...BUYING, fail('deferred'), fail('failed')], false, 'pending'],
    ['BUY is ignored while the store is unavailable', [{ type: 'mark-store-unavailable' }, { type: 'start-purchase', isPremium: false }], false, 'store-unavailable'],
    ['a late price after "unavailable" is ignored', [{ type: 'mark-store-unavailable' }, { type: 'set-price', price: '€1.99' }], false, 'store-unavailable'],
    ['start-loading returns to loading', [...READY, { type: 'start-loading' }], false, 'loading-price'],
    ['a restore after a purchase shows "owned", not the thank-you', [...BUYING, { type: 'finish-purchase' }, { type: 'start-restore' }, { type: 'finish-restore', evidence: 'owned', isPremium: true }], true, 'already-owned'],
    ['"nothing to restore" never shows for an owner', restoreWith('unknown', true), true, 'already-owned'],
  ];
  for (const [label, actions, isPremium, want] of cases) await expect('paywall-states', files.paywallReducer, label, () => viewOf(actions, isPremium), want, fix);
  await expect('paywall-states', files.paywallReducer, 'BUY is ignored when already Premium', () => run1([...READY, { type: 'start-purchase', isPremium: true }]).flow.kind, 'ready', fix);
  if (!notice) return;
  const nfix = 'Restore paywall-notice.ts: restoring / restore-empty / restore-failed from the flow, restore-success once from didJustRestore.';
  await expect('restore-notices', files.notice, 'normal page', () => notice.paywallNotice(run1(READY)), null, nfix);
  await expect('restore-notices', files.notice, 'while restoring', () => notice.paywallNotice(run1([...READY, { type: 'start-restore' }])), 'restoring', nfix);
  for (const [evidence, want] of [['unknown', 'restore-empty'], ['sync-failed', 'restore-failed'], ['owned', 'restore-success']]) {
    await expect('restore-notices', files.notice, `restore finished with ${evidence}`, () => notice.paywallNotice(run1(restoreWith(evidence))), want, nfix);
  }
  await expect('restore-notices', files.notice, 'the restored notice shows once', () => notice.paywallNotice(run1([...restoreWith('owned'), { type: 'clear-restore-notice' }])), null, nfix);
}

async function checkEntitlementReducer(mods, files, expect) {
  const { premiumReducer } = mods;
  if (!premiumReducer) return;
  const reduce = premiumReducer.premiumReducer;
  const NEVER = { entitlement: { isOwned: false, ownedSinceMs: null, revokedAtMs: null } };
  const OWNED = { entitlement: { isOwned: true, ownedSinceMs: 1_000, revokedAtMs: null } };
  const fix = 'Restore premium-reducer.ts: grant is idempotent, a revoke needs a positive store date, a purchase clears an old refund date.';
  await expect('entitlement-reducer', files.premiumReducer, 'a grant turns Premium on', () => reduce(NEVER, { type: 'grant-premium', atMs: 2_000 }).entitlement, { isOwned: true, ownedSinceMs: 2_000, revokedAtMs: null }, fix);
  await expect('entitlement-reducer', files.premiumReducer, 'a second grant returns the same state (no write)', () => reduce(OWNED, { type: 'grant-premium', atMs: 9_000 }) === OWNED, true, fix);
  await expect('entitlement-reducer', files.premiumReducer, 'a revoke without a date keeps Premium', () => reduce(OWNED, { type: 'revoke-premium', revokedAtMs: 0 }) === OWNED, true, 'Absence is never a refund: only a dated revocation turns Premium off.');
  await expect('entitlement-reducer', files.premiumReducer, 'a dated revoke turns Premium off and keeps the date', () => reduce(OWNED, { type: 'revoke-premium', revokedAtMs: 5_000 }).entitlement, { isOwned: false, ownedSinceMs: 1_000, revokedAtMs: 5_000 }, fix);
  await expect('entitlement-reducer', files.premiumReducer, 'a purchase after a refund clears the refund date', () => reduce({ entitlement: { isOwned: false, ownedSinceMs: 1_000, revokedAtMs: 5_000 } }, { type: 'grant-premium', atMs: 9_000 }).entitlement.revokedAtMs, null, fix);
}

async function checkEvidence(mods, files, expect) {
  const { evidence } = mods;
  if (!evidence) return;
  const fix = 'Restore entitlement-evidence.ts: owned beats revoked, absence is "unknown", other products are ignored.';
  const cases = [
    ['no transactions', [], 'unknown'],
    ['a purchase', [tx()], 'owned'],
    ['a pending purchase only', [tx({ state: 'pending' })], 'unknown'],
    ['a refunded purchase', [tx({ revocationDateMs: REVOKED_AT })], 'revoked'],
    ['a newer purchase after a refund', [tx({ revocationDateMs: REVOKED_AT }), tx({ transactionId: 't2' })], 'owned'],
    ['another product', [tx({ productId: 'com.example.other.premium' })], 'unknown'],
  ];
  for (const [label, list, want] of cases) await expect('evidence', files.evidence, label, () => evidence.entitlementEvidence(list, ID), want, fix);
  await expect('evidence', files.evidence, 'latest revocation date', () => evidence.latestRevocationMs([tx({ revocationDateMs: 5 }), tx({ transactionId: 't2', revocationDateMs: 9 })], ID), 9, fix);
}

async function checkService(mods, files, expect) {
  const { service, flow, premiumReducer, paywallReducer, paywallState } = mods;
  if (!service || !flow || !premiumReducer || !paywallReducer || !paywallState) return;
  const h = (script) => harness(mods, script);
  const notPaywall = (log) => log.filter((entry) => !entry.startsWith('paywall:'));
  const sfix = 'Restore premium-service.ts / premium-store-flow.ts from the templates.';
  await expect('store-flow', files.flow, 'startPremium subscribes before connecting, then re-checks', async () => {
    const t = h();
    await flow.startPremium(t.deps);
    return notPaywall(t.log);
  }, ['subscribe', 'connect', 'fetchProduct', 'readTransactions'], 'Subscribe first: the store replays unfinished and approved transactions right after connecting.');
  for (const [label, script] of [['an empty product list', { product: null }], ['no connection', { isConnected: false }], ['a connection error', { connectFails: true }], ['a product without price text', { product: { ...PRODUCT, displayPrice: '' } }]]) {
    await expect('store-flow', files.flow, `${label} -> store unavailable`, async () => {
      const t = h(script);
      await flow.loadStore(t.deps);
      return t.log.filter((entry) => entry.startsWith('paywall:'));
    }, ['paywall:start-loading', 'paywall:mark-store-unavailable'], 'An empty product list or a failed connect is "store unavailable", never an error dialog.');
  }
  for (const [label, script] of [['the store is unavailable', { product: null }], ['the user already owns Premium', { isPremium: true }]]) {
    await expect('store-flow', files.flow, `BUY asks the store for nothing when ${label}`, async () => {
      const t = h(script);
      await flow.startPremium(t.deps);
      await flow.buyPremium(t.deps);
      return t.log.includes('requestPurchase');
    }, false, 'buyPremium requests a purchase only when the paywall accepted the tap (flow "purchasing").');
  }
  await expect('service-order', files.service, 'a purchase: save -> show -> finish', async () => {
    const t = h();
    await flow.startPremium(t.deps);
    await flow.buyPremium(t.deps);
    t.emit({ type: 'transaction', transaction: tx() });
    await flush();
    return t.log.slice(t.log.indexOf('requestPurchase'));
  }, ['requestPurchase', 'grant', 'paywall:finish-purchase', 'finish:t1'], 'Save Premium (grantPremium, synchronous) -> the paywall\'s finish-purchase -> finishTransaction; never finish first.');
  await expect('service-order', files.service, 'a pending transaction is not finished', async () => {
    const t = h();
    await service.processTransaction(t.deps, tx({ state: 'pending' }));
    return t.log;
  }, ['paywall:mark-purchase-pending'], sfix);
  await expect('service-order', files.service, 'another product is ignored', async () => {
    const t = h();
    await service.processTransaction(t.deps, tx({ productId: 'com.example.other.premium' }));
    return t.log;
  }, [], sfix);
  await expect('service-order', files.service, 'an unsaved purchase is never finished', async () => {
    const t = h({ saveRefused: true });
    await service.processTransaction(t.deps, tx());
    return t.log;
  }, ['grant', 'onError', 'paywall:record-save-failure'], 'grantPremium returns an error when the save did not reach the disk: show save-failed and return before finish, so the store delivers the purchase again (a finished but unsaved purchase is lost for good).');
  const ufix = 'Play Billing never delivers an unacknowledged purchase again and Google refunds it after 3 days: recheckPremium and restorePremium finish every owned transaction marked isUnfinished, after grantPremium returned ok (and never one the store already holds as finished).';
  await expect('service-order', files.service, 'the re-check finishes an unfinished purchase once saved', async () => {
    const t = h({ transactions: [tx({ isUnfinished: true })] });
    await service.recheckPremium(t.deps);
    return t.log;
  }, ['readTransactions', 'grant', 'finish:t1'], ufix);
  await expect('service-order', files.service, 'a restore finishes an unfinished purchase once saved', async () => {
    const t = h({ transactions: [tx({ isUnfinished: true })] });
    await service.restorePremium(t.deps);
    return t.log;
  }, ['paywall:start-restore', 'restore', 'readTransactions', 'grant', 'paywall:finish-restore:owned', 'finish:t1'], ufix);
  await expect('service-order', files.service, 'the re-check leaves an unfinished purchase alone while its save fails', async () => {
    const t = h({ transactions: [tx({ isUnfinished: true })], saveRefused: true });
    await service.recheckPremium(t.deps);
    return t.log;
  }, ['readTransactions', 'grant', 'onError'], ufix);
  await expect('service-order', files.service, 'a failing finish is logged, Premium stays', async () => {
    const t = h({ finishFails: true });
    await service.processTransaction(t.deps, tx());
    return { log: t.log, isOwned: t.isOwned() };
  }, { log: ['grant', 'paywall:finish-purchase', 'finish:t1', 'onError'], isOwned: true }, 'An unfinished transaction is delivered again at the next launch; log the failure and move on.');
  const rfix = 'Never read transactions or say "nothing to restore" after a failed sync.';
  await expect('restore-flow', files.service, 'a failed sync is "couldn\'t restore"', async () => {
    const t = h({ restoreFails: true });
    await service.restorePremium(t.deps);
    return t.log;
  }, ['paywall:start-restore', 'restore', 'paywall:finish-restore:sync-failed'], rfix);
  await expect('restore-flow', files.service, 'a successful sync with nothing', async () => {
    const t = h();
    await service.restorePremium(t.deps);
    return t.log;
  }, ['paywall:start-restore', 'restore', 'readTransactions', 'paywall:finish-restore:unknown'], sfix);
  if (mods.view && mods.notice) {
    await expect('restore-flow', files.service, 'an owner whose sync finds nothing never hears "nothing to restore"', async () => {
      const t = h({ isPremium: true });
      await flow.loadStore(t.deps);
      await service.restorePremium(t.deps);
      return { view: mods.view.paywallView(t.state(), t.isOwned()), notice: mods.notice.paywallNotice(t.state()) };
    }, { view: 'already-owned', notice: null }, 'restorePremium passes the saved entitlement (premium.getState().entitlement.isOwned) to finish-restore: "nothing to restore" is never said to someone who owns Premium.');
  }
  await expect('restore-flow', files.service, 'a successful sync with a purchase', async () => {
    const t = h({ transactions: [tx()] });
    await service.restorePremium(t.deps);
    return t.log;
  }, ['paywall:start-restore', 'restore', 'readTransactions', 'grant', 'paywall:finish-restore:owned'], sfix);
  await expect('restore-flow', files.service, 'a read error after the sync counts as failed', async () => {
    const t = h({ readFails: true });
    await service.restorePremium(t.deps);
    return t.log.filter((entry) => entry.startsWith('paywall:'));
  }, ['paywall:start-restore', 'paywall:finish-restore:sync-failed'], rfix);
  await expect('restore-flow', files.service, 'a restored purchase the disk refused shows save-failed', async () => {
    const t = h({ transactions: [tx()], saveRefused: true });
    await service.restorePremium(t.deps);
    return t.log;
  }, ['paywall:start-restore', 'restore', 'readTransactions', 'grant', 'onError', 'paywall:record-save-failure'], 'A restore whose save failed is not "restored": show save-failed (Restore retries it).');
  await expect('restore-flow', files.service, '"already owned" runs restore', async () => {
    const t = h({ transactions: [tx()] });
    await service.processPurchaseEvent(t.deps, { type: 'failure', failure: 'already-owned', code: 'already-owned' });
    return t.log;
  }, ['paywall:record-purchase-failure:already-owned', 'paywall:start-restore', 'restore', 'readTransactions', 'grant', 'paywall:finish-restore:owned'], sfix);
  await expect('revocation', files.service, 'the launch re-check without transactions keeps Premium', async () => {
    const t = h({ isPremium: true });
    await service.recheckPremium(t.deps);
    return { log: t.log, isOwned: t.isOwned() };
  }, { log: ['readTransactions'], isOwned: true }, 'Absence is not evidence: never save Premium off without a revocation date.');
  await expect('revocation', files.service, 'a re-check error keeps Premium', async () => {
    const t = h({ isPremium: true, readFails: true });
    await service.recheckPremium(t.deps);
    return { log: t.log, isOwned: t.isOwned() };
  }, { log: ['readTransactions', 'onError'], isOwned: true }, 'Errors keep the saved state.');
  await expect('revocation', files.service, 'a refund is revoked with its date', async () => {
    const refunded = tx({ revocationDateMs: REVOKED_AT });
    const t = h({ transactions: [refunded], isPremium: true });
    await service.processTransaction(t.deps, refunded);
    return t.log;
  }, ['readTransactions', `revoke@${REVOKED_AT}`, 'paywall:clear-thanks', 'finish:t1'], 'A revocation is saved with the store\'s revocation date (a revoke without a date is ignored).');
  await expect('revocation', files.service, 'a refund is ignored while a newer purchase exists', async () => {
    const refunded = tx({ revocationDateMs: REVOKED_AT });
    const t = h({ transactions: [refunded, tx({ transactionId: 't2' })] });
    await service.processTransaction(t.deps, refunded);
    return t.log.filter((entry) => entry === 'grant' || entry.startsWith('revoke'));
  }, ['grant'], sfix);
}

async function checkGate(mods, files, expect) {
  const { gate, flow, service, premiumReducer, paywallReducer, paywallState } = mods;
  if (!gate || !flow || !service || !premiumReducer || !paywallReducer || !paywallState) return;
  const gfix = 'Restore connectivity-gated-purchase.ts: offline, connect -> ok(false), fetchProduct -> ok(null), restore -> a store error, readTransactions -> ok([]) without calling the store; online, every call passes through.';
  const gated = (script, isOnline) => {
    const t = harness(mods, script);
    return { ...t, deps: { ...t.deps, port: gate.withConnectivity(t.deps.port, () => isOnline) } };
  };
  await expect('offline-gate', files.gate, 'offline: nothing reaches the store', async () => {
    const t = gated({ transactions: [tx()] }, false);
    const port = t.deps.port;
    const answers = [await port.connect(), await port.fetchProduct(ID), (await port.restore()).ok, await port.readTransactions()];
    return { answers, log: t.log };
  }, { answers: [ok(false), ok(null), false, ok([])], log: [] }, gfix);
  await expect('offline-gate', files.gate, 'online: calls pass through', async () => {
    const t = gated({}, true);
    await t.deps.port.connect();
    await t.deps.port.restore();
    return t.log;
  }, ['connect', 'restore'], gfix);
  await expect('offline-gate', files.gate, 'loadStore offline -> store unavailable', async () => {
    const t = gated({}, false);
    await flow.loadStore(t.deps);
    return t.log;
  }, ['paywall:start-loading', 'paywall:mark-store-unavailable'], gfix);
  await expect('offline-gate', files.gate, 'restore offline -> couldn\'t restore', async () => {
    const t = gated({ transactions: [tx()] }, false);
    await service.restorePremium(t.deps);
    return t.log;
  }, ['paywall:start-restore', 'paywall:finish-restore:sync-failed'], gfix);
  await expect('offline-gate', files.gate, 'the offline re-check keeps Premium', async () => {
    const t = gated({ isPremium: true }, false);
    await service.recheckPremium(t.deps);
    return { log: t.log, isOwned: t.isOwned() };
  }, { log: [], isOwned: true }, 'Offline, readTransactions answers ok([]) (absence is not evidence), so nothing is saved.');
  const rfix = 'Restore shouldReloadStore in premium-store-flow.ts: online reloads only an "unavailable" page; offline reloads only a quiet page (ready, failed, restore-empty, restore-failed); never while loading, purchasing, pending or restoring.';
  const table = [
    ['unavailable', true, true], ['ready', true, false], ['ready', false, true], ['failed', false, true],
    ['restore-empty', false, true], ['restore-failed', false, true], ['unavailable', false, false],
    ['loading', false, false], ['purchasing', false, false], ['pending', false, false], ['restoring', false, false], ['unsaved', false, false],
  ];
  for (const [kind, isOnline, want] of table) await expect('offline-gate', files.flow, `shouldReloadStore(${kind}, online=${isOnline})`, () => flow.shouldReloadStore(kind, isOnline), want, rfix);
}

async function checkReloads(root, layout, paths, mods, files, expect, report) {
  const { reloads, gate, flow } = mods;
  if (reloads && gate && flow && mods.service && mods.premiumReducer && mods.paywallReducer && mods.paywallState) {
    const start = (script, isOnline) => {
      const t = harness(mods, script);
      const connectivity = connectivityAt(isOnline);
      const active = new Set();
      const service = { ...t.deps, port: gate.withConnectivity(t.deps.port, connectivity.isOnline) };
      const stop = reloads.connectPremiumReloads({ connectivity, onAppActive: (listener) => { active.add(listener); return () => active.delete(listener); }, service });
      return { ...t, service, connectivity, active, stop };
    };
    const fix = 'Restore connect-premium-reloads.ts: on a connectivity change, loadStore when shouldReloadStore says so and, back online, recheckPremium after it; on a return to the foreground while online, recheckPremium.';
    await expect('store-reloads', files.reloads, 'the price loads once the first network report says online', async () => {
      const t = start({}, false);
      await flow.startPremium(t.service);
      t.connectivity.setOnline(true);
      await flush();
      return t.flow();
    }, { kind: 'ready', price: '€1.99' }, fix);
    await expect('store-reloads', files.reloads, 'back online, Premium is re-checked (a refund after an offline launch)', async () => {
      const t = start({ isPremium: true, transactions: [tx({ revocationDateMs: REVOKED_AT })] }, false);
      await flow.startPremium(t.service);
      t.connectivity.setOnline(true);
      await flush();
      return t.isOwned();
    }, false, fix);
    await expect('store-reloads', files.reloads, 'a return to the foreground re-checks while online', async () => {
      const t = start({ transactions: [tx()] }, true);
      t.active.forEach((listener) => listener());
      await flush();
      return t.isOwned();
    }, true, fix);
    await expect('store-reloads', files.reloads, 'nothing reloads while a purchase is in flight', async () => {
      const t = start({}, true);
      await flow.startPremium(t.service);
      t.service.paywall.getState().dispatch({ type: 'start-purchase', isPremium: false });
      t.log.length = 0;
      t.connectivity.setOnline(false);
      await flush();
      return t.log;
    }, [], fix);
    await expect('store-reloads', files.reloads, 'the unsubscribe stops both subscriptions', async () => {
      const t = start({}, true);
      t.stop();
      return t.connectivity.count() + t.active.size;
    }, 0, fix);
  }
  // The composition root starts the store and connects the reloads (startPremium runs before the
  // first network report, so without the reloads the paywall never shows a price after an offline start).
  const roots = sourceFiles(root).filter((rel) => rel.startsWith(`${layout.srcDir}/`) && !rel.startsWith(`${paths.purchaseDir}/`) && !isTestFile(rel));
  const texts = roots.map((rel) => maskComments(readFileSync(join(root, rel), 'utf8')));
  for (const call of ['startPremium', 'connectPremiumReloads']) {
    expect.counter.checked += 1;
    if (texts.some((text) => new RegExp(`\\b${call}\\s*\\(`).test(text))) continue;
    report.problem({ file: layout.srcDir, rule: 'store-reloads', message: `no composition-root file calls ${call}(...)`, fix: 'In the composition root, after the first frame: startPremium(premiumDeps).catch(onError), then connectPremiumReloads({ connectivity, onAppActive, service: premiumDeps }) (examples/purchase-root.tsx).' });
  }
}

async function checkPrice(mods, files, expect) {
  const { price } = mods;
  if (!price) return;
  const fix = "Restore store-price-text.ts: the store's own displayPrice unchanged (the text the purchase sheet shows), null when it is empty; never rebuilt from the numeric price.";
  await expect('price-text', files.price, "the store's text", () => price.storePriceText(PRODUCT), '€1.99', fix);
  await expect('price-text', files.price, 'never rebuilt from the double (HUF)', () => price.storePriceText({ ...PRODUCT, displayPrice: '1\u00A0190\u00A0Ft', price: 1190, currency: 'HUF' }), '1\u00A0190\u00A0Ft', fix);
  await expect('price-text', files.price, "the store's digits and marks", () => price.storePriceText({ ...PRODUCT, displayPrice: '\u200F١٫٩٩ €' }), '\u200F١٫٩٩ €', fix);
  await expect('price-text', files.price, 'no text', () => [price.storePriceText({ ...PRODUCT, displayPrice: '' }), price.storePriceText({ ...PRODUCT, displayPrice: ' ' })], [null, null], fix);
}

async function checkUpsell(mods, files, expect) {
  const { upsell } = mods;
  if (!upsell) return;
  const fix = 'Restore upsell-line.ts: null for an owner, null without a store price, null when lastShownOn is today; otherwise the price text.';
  const first = { isPremium: false, priceText: '€1.99', lastShownOn: null, today: '2026-10-10' };
  const cases = [
    ['the first time', first, '€1.99'],
    ['already shown today', { ...first, lastShownOn: '2026-10-10' }, null],
    ['shown yesterday', { ...first, lastShownOn: '2026-10-09' }, '€1.99'],
    ['an owner', { ...first, isPremium: true }, null],
    ['an owner who never saw it', { ...first, isPremium: true, lastShownOn: '2026-10-09' }, null],
    ['no store price', { ...first, priceText: null }, null],
  ];
  for (const [label, input, want] of cases) await expect('upsell-line', files.upsell, label, () => upsell.upsellPrice(input), want, fix);
}

async function checkAdapter(mods, files, expect) {
  const { adapter } = mods;
  if (!adapter) return;
  const file = files.adapter;
  const create = () => adapter.createExpoIapPurchaseAdapter();
  const purchase = (overrides = {}) => ({ id: 'p1', productId: ID, transactionId: 't1', purchaseState: 'purchased', revocationDateIOS: null, platform: 'ios', ...overrides });
  const failureOf = async (code, via) => {
    iapStub.reset(via === 'reject' ? { requestPurchase: { rejectWith: { code } } } : {});
    const port = create();
    const events = [];
    const unsubscribe = port.subscribe((event) => events.push(event));
    if (via === 'reject') await port.requestPurchase(ID);
    else iapStub.emitError({ code, message: 'stub' });
    unsubscribe();
    return events.map((event) => (event.type === 'failure' ? event.failure : event.type));
  };
  const efix = 'Restore the FAILURES table of the adapter template: user-cancelled -> cancelled, deferred-payment/pending -> deferred, already-owned -> already-owned, connection and service codes -> unavailable, anything else -> failed.';
  const codes = [
    ['user-cancelled', 'cancelled'], ['deferred-payment', 'deferred'], ['pending', 'deferred'], ['already-owned', 'already-owned'],
    ['network-error', 'unavailable'], ['service-error', 'unavailable'], ['iap-not-available', 'unavailable'], ['init-connection', 'unavailable'], ['billing-unavailable', 'unavailable'],
    ['unknown', 'failed'], ['purchase-error', 'failed'], ['item-unavailable', 'failed'],
  ];
  for (const [code, want] of codes) await expect('adapter-errors', file, `listener error ${code}`, () => failureOf(code, 'listener'), [want], efix);
  await expect('adapter-errors', file, 'a rejected requestPurchase (Ask to Buy)', () => failureOf('deferred-payment', 'reject'), ['deferred'], 'A rejected requestPurchase is emitted as a failure event too (the paywall ignores the repeat).');
  await expect('adapter-errors', file, 'a rejection without a code', async () => {
    iapStub.reset({ requestPurchase: new Error('boom') });
    const port = create();
    const events = [];
    port.subscribe((event) => events.push(event));
    await port.requestPurchase(ID);
    return events;
  }, [{ type: 'failure', failure: 'failed', code: 'unknown' }], efix);

  const rfix = 'restore() answers a store error whenever restorePurchases() throws (sync-error, a cancelled account prompt, offline) and ok only when it resolves.';
  for (const [label, rejection] of [['sync-error', { rejectWith: { code: 'sync-error' } }], ['a cancelled account prompt', { rejectWith: { code: 'user-cancelled' } }], ['a network error', { rejectWith: { code: 'network-error' } }], ['an error without a code', new Error('offline')]]) {
    await expect('adapter-restore', file, `restorePurchases rejects with ${label}`, async () => {
      iapStub.reset({ restorePurchases: rejection });
      return (await create().restore()).ok;
    }, false, rfix);
  }
  await expect('adapter-restore', file, 'restorePurchases resolves', async () => {
    iapStub.reset();
    return create().restore();
  }, ok(undefined), rfix);

  const tfix = 'readTransactions reads getAvailablePurchases({ onlyIncludeActiveItemsIOS: false }) (Transaction.all), maps revocationDateIOS to revocationDateMs, drops purchaseState unknown and uses transactionId ?? id.';
  await expect('adapter-transactions', file, 'Transaction.all with refunds, pending and unknown', async () => {
    iapStub.reset({ getAvailablePurchases: [purchase({ revocationDateIOS: REVOKED_AT }), purchase({ id: 'p2', transactionId: null, purchaseState: 'pending' }), purchase({ id: 'p3', transactionId: 't3', purchaseState: 'unknown' })] });
    const read = await create().readTransactions();
    return { list: read.ok ? read.value.map(({ handle, ...rest }) => rest) : read, calls: iapStub.calls() };
  }, {
    list: [
      { productId: ID, transactionId: 't1', state: 'purchased', revocationDateMs: REVOKED_AT },
      { productId: ID, transactionId: 'p2', state: 'pending', revocationDateMs: null },
    ],
    calls: ['getAvailablePurchases:{"onlyIncludeActiveItemsIOS":false}'],
  }, tfix);
  await expect('adapter-transactions', file, 'an unacknowledged Android purchase is marked unfinished', async () => {
    const android = (overrides) => ({ id: 'a1', productId: ID, transactionId: 'GPA.1', purchaseState: 'purchased', platform: 'android', purchaseToken: 'token', ...overrides });
    iapStub.reset({ getAvailablePurchases: [android({ isAcknowledgedAndroid: false }), android({ id: 'a2', transactionId: 'GPA.2', isAcknowledgedAndroid: true })] });
    const read = await create().readTransactions();
    return read.ok ? read.value.map(({ handle, ...rest }) => rest) : read;
  }, [
    { productId: ID, transactionId: 'GPA.1', state: 'purchased', revocationDateMs: null, isUnfinished: true },
    { productId: ID, transactionId: 'GPA.2', state: 'purchased', revocationDateMs: null },
  ], 'Map isAcknowledgedAndroid === false to isUnfinished: true (absent otherwise): the re-check finishes it once Premium is saved, before Google refunds it.');
  await expect('adapter-transactions', file, 'listener purchases', async () => {
    iapStub.reset();
    const port = create();
    const events = [];
    port.subscribe((event) => events.push(event));
    iapStub.emitPurchase(purchase({ purchaseState: 'unknown' }));
    iapStub.emitPurchase(purchase({ transactionId: 't9', revocationDateIOS: REVOKED_AT }));
    return events.map((event) => ({ type: event.type, id: event.transaction?.transactionId, revocationDateMs: event.transaction?.revocationDateMs }));
  }, [{ type: 'transaction', id: 't9', revocationDateMs: REVOKED_AT }], tfix);
  await expect('adapter-transactions', file, 'unsubscribe removes both listeners', () => {
    iapStub.reset();
    const unsubscribe = create().subscribe(() => undefined);
    const before = iapStub.listenerCount();
    unsubscribe();
    return { before, after: iapStub.listenerCount() };
  }, { before: 2, after: 0 }, 'subscribe() registers purchaseUpdatedListener and purchaseErrorListener; its unsubscribe removes both.');

  await expect('adapter-finish', file, 'a delivered purchase is finished only by finish(tx)', async () => {
    iapStub.reset();
    const port = create();
    const events = [];
    port.subscribe((event) => events.push(event));
    iapStub.emitPurchase(purchase());
    await flush();
    const finishes = () => iapStub.calls().filter((call) => call.startsWith('finishTransaction'));
    const beforeFinish = finishes();
    const delivered = events.find((event) => event.type === 'transaction');
    if (delivered) await port.finish(delivered.transaction);
    return { beforeFinish, afterFinish: finishes() };
  }, { beforeFinish: [], afterFinish: ['finishTransaction:{"purchase":"t1","isConsumable":false}'] }, 'Never finish inside purchaseUpdatedListener (or any other adapter path): finishTransaction runs only in the port\'s finish(), which the service calls after Premium is saved.');

  const cfix = 'Keep the calls of the adapter template: fetchProducts({ skus: [id], type: "in-app" }) with [] -> ok(null), requestPurchase({ request: { apple: { sku }, google: { skus } }, type: "in-app" }), finishTransaction({ purchase, isConsumable: false }).';
  await expect('adapter-calls', file, 'an empty product list', async () => {
    iapStub.reset({ fetchProducts: [] });
    const product = await create().fetchProduct(ID);
    return { product, calls: iapStub.calls() };
  }, { product: ok(null), calls: [`fetchProducts:{"skus":["${ID}"],"type":"in-app"}`] }, cfix);
  await expect('adapter-calls', file, 'the store product', async () => {
    iapStub.reset({ fetchProducts: [{ id: ID, displayPrice: '€1.99', currency: 'EUR', price: 1.9899999999999998, title: 'Premium', type: 'in-app', platform: 'ios' }] });
    const product = await create().fetchProduct(ID);
    return product.ok && product.value && { productId: product.value.productId, displayPrice: product.value.displayPrice, price: product.value.price, currency: product.value.currency };
  }, PRODUCT, cfix);
  await expect('adapter-calls', file, 'requestPurchase and finish', async () => {
    iapStub.reset();
    const port = create();
    await port.requestPurchase(ID);
    await port.finish({ productId: ID, transactionId: 't1', state: 'purchased', revocationDateMs: null, handle: purchase() });
    return iapStub.calls();
  }, [`requestPurchase:{"request":{"apple":{"sku":"${ID}"},"google":{"skus":["${ID}"]}},"type":"in-app"}`, 'finishTransaction:{"purchase":"t1","isConsumable":false}'], cfix);

  const xfix = 'Every store call resolves with a value or a store error: wrap each vendor call in attemptAsync(..., storeFailure) so a rejection never escapes the adapter (error-handling-typed-results).';
  for (const [label, script, call] of [
    ['connect', { initConnection: { rejectWith: { code: 'init-connection' } } }, (port) => port.connect()],
    ['fetchProduct', { fetchProducts: { rejectWith: { code: 'query-product' } } }, (port) => port.fetchProduct(ID)],
    ['readTransactions', { getAvailablePurchases: { rejectWith: { code: 'service-error' } } }, (port) => port.readTransactions()],
    ['finish', { finishTransaction: { rejectWith: { code: 'unknown' } } }, (port) => port.finish({ productId: ID, transactionId: 't1', state: 'purchased', revocationDateMs: null, handle: purchase() })],
  ]) {
    await expect('adapter-results', file, `a rejected ${label} becomes a store error`, async () => {
      iapStub.reset(script);
      const result = await call(create());
      return result?.ok === false ? result.error.kind : result;
    }, 'store-error', xfix);
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Pass the app\'s root (the folder with package.json); in a monorepo, the app workspace.');
  const layout = layoutOf(root);
  const report = createReporter({ name: 'check-purchase-behaviour', json: options.json });
  const fact = notApplicableFact(adoption(root, layout));
  if (fact !== null) return report.notApplicable(fact);
  const paths = purchasePaths(layout);
  const app = enableAppImports(root);
  const { mods, files } = await loadModules(app, paths, report);
  const counter = { checked: 0 };
  const expect = makeExpect(report, counter);
  expect.counter = counter;
  await checkPaywall(mods, files, expect);
  await checkEntitlementReducer(mods, files, expect);
  await checkEvidence(mods, files, expect);
  await checkService(mods, files, expect);
  await checkGate(mods, files, expect);
  await checkReloads(root, layout, paths, mods, files, expect, report);
  await checkPrice(mods, files, expect);
  await checkUpsell(mods, files, expect);
  await checkAdapter(mods, files, expect);
  return report.finish({ checked: counter.checked, unit: 'scenarios' });
});
