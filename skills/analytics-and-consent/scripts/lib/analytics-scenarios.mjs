// analytics-scenarios.mjs: check-analytics-behaviour's scenarios. Each runs the app's own modules
// (loaded through Node type stripping) against scripted stand-ins and returns the problems it saw
// (strings). Not an entry point.

import { FACTS } from './analytics-repo.mjs';

const NOW_MS = 1_700_000_000_000;

/** Lets every pending promise chain run. */
export async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

function fakeSdk(failOn = null) {
  const calls = [];
  const captured = [];
  const step = (name, detail) => {
    calls.push(detail === undefined ? name : `${name} ${detail}`);
    if (failOn === name) throw new Error(`${name} failed`);
  };
  return {
    calls,
    captured,
    sdk: {
      optIn: async () => step('optIn'),
      capture: (name, props) => {
        step('capture', name);
        captured.push({ name, props });
      },
      flush: async () => step('flush'),
      optOut: async () => step('optOut'),
      reset: () => step('reset'),
    },
  };
}

function memoryStore(text = null) {
  const store = { saved: text };
  store.port = {
    read: () => ({ ok: true, value: store.saved }),
    write: (next) => {
      store.saved = next;
      return { ok: true, value: undefined };
    },
    clear: () => {
      store.saved = null;
      return { ok: true, value: undefined };
    },
  };
  return store;
}

/** A gate over stand-ins: { analytics, created, errors, store, fake, trackingAsks, cleared }. */
function gate(mods, { mode = 'live', saved = null, failOn = null, tracking, createThrows = false, consentVersion } = {}) {
  const fake = fakeSdk(failOn);
  const store = memoryStore(saved);
  const created = [];
  const errors = [];
  const trackingAsks = [];
  const cleared = [];
  const options = {
    mode,
    store: store.port,
    nowMs: () => NOW_MS,
    onError: (error) => errors.push(error),
    createSdk: (setup) => {
      created.push(setup);
      if (createThrows) throw new Error('no native module');
      return fake.sdk;
    },
    clearSdkStorage: () => {
      cleared.push(fake.calls.length);
    },
  };
  if (consentVersion !== undefined) options.consentVersion = consentVersion;
  if (tracking !== undefined) {
    options.tracking = { requestTracking: async () => (trackingAsks.push(tracking), tracking) };
  }
  return { analytics: mods.gate.createAnalytics(options), created, errors, store, fake, trackingAsks, cleared };
}

function grantedRecord(mods, version = mods.consent.ANALYTICS_CONSENT_VERSION) {
  return mods.consent.encodeConsentRecord({ choice: 'granted', version, decidedAtMs: 1 });
}

/** A valid event built from the app's own catalog, with the value each property kind expects. */
export function sampleEvent(catalog, predicate = () => true) {
  for (const [name, spec] of Object.entries(catalog)) {
    if (!predicate(spec)) continue;
    const props = {};
    for (const [key, prop] of Object.entries(spec.props)) {
      if (prop.kind === 'enum') props[key] = prop.values[0];
      else if (prop.kind === 'boolean') props[key] = true;
      else if (prop.kind === 'count') props[key] = prop.max;
      else props[key] = 'index';
    }
    return { name, props };
  }
  return null;
}

function event(mods) {
  return sampleEvent(mods.events.ANALYTICS_EVENTS);
}

// ------------------------------------------------------------------------------------------------

async function consentBeforeSdk(mods) {
  const { analytics, created } = gate(mods);
  analytics.track(event(mods));
  await settle();
  const out = [];
  if (analytics.consent() !== 'unknown') out.push(`consent() is ${analytics.consent()} before any answer (expected unknown)`);
  if (created.length > 0) out.push('the SDK was created before the user answered');
  return out;
}

async function consentYesStarts(mods) {
  const { analytics, created, fake, store } = gate(mods);
  const sample = event(mods);
  analytics.setConsent('granted');
  analytics.track(sample);
  analytics.track(sample);
  await settle();
  const out = [];
  if (created.length !== 1) out.push(`createSdk ran ${created.length} times after a yes (expected once)`);
  if (fake.calls[0] !== 'optIn') out.push(`the SDK was not opted in first (calls: ${fake.calls.join(', ')})`);
  if (fake.captured.length !== 2) out.push(`${fake.captured.length} of 2 events reached the SDK after a yes`);
  const record = mods.consent.parseConsentRecord(store.saved);
  if (record?.choice !== 'granted' || record.decidedAtMs !== NOW_MS) out.push('the yes was not saved with its time');
  return out;
}

async function consentNoStops(mods) {
  const { analytics, fake } = gate(mods, { saved: grantedRecord(mods) });
  analytics.track(event(mods));
  await settle();
  analytics.setConsent('denied');
  analytics.track(event(mods));
  await settle();
  const after = fake.calls.slice(fake.calls.indexOf('reset'));
  const out = [];
  if (!fake.calls.includes('reset') || !fake.calls.includes('optOut')) out.push(`a no did not reset and opt out the SDK (calls: ${fake.calls.join(', ')})`);
  else if (fake.calls.indexOf('reset') > fake.calls.indexOf('optOut')) out.push('optOut ran before reset: PostHog-style SDKs clear the saved opt-out on reset');
  if (after.some((call) => call.startsWith('capture'))) out.push('an event reached the SDK after a no');
  return out;
}

async function consentVersion(mods) {
  const version = mods.consent.ANALYTICS_CONSENT_VERSION;
  if (!Number.isInteger(version) || version < 1) return [`ANALYTICS_CONSENT_VERSION is ${version} (a whole number from 1)`];
  const { analytics, created } = gate(mods, { saved: grantedRecord(mods, version - 1) });
  analytics.track(event(mods));
  await settle();
  return created.length > 0 || analytics.consent() !== 'unknown' ? ['an answer to an older question still counts as a yes'] : [];
}

async function forget(mods) {
  const { analytics, fake, store } = gate(mods, { saved: grantedRecord(mods) });
  analytics.track(event(mods));
  await settle();
  await analytics.forget();
  const out = [];
  if (store.saved !== null) out.push('forget() kept the saved answer');
  if (analytics.consent() !== 'unknown') out.push('consent() is not unknown after forget()');
  if (!fake.calls.includes('reset')) out.push('forget() did not reset the SDK identity');
  return out;
}

async function clearWithoutSdk(mods) {
  const out = [];
  const version = mods.consent.ANALYTICS_CONSENT_VERSION;
  // (a) An earlier version's yes reads as unknown, nothing starts, then the user says no.
  const bumped = gate(mods, { saved: grantedRecord(mods, version), consentVersion: version + 1 });
  bumped.analytics.setConsent('denied');
  await settle();
  if (bumped.created.length > 0) out.push('a no after the question changed created the SDK just to stop it (the constructor may contact the vendor)');
  if (bumped.cleared.length === 0) out.push('a no with no SDK in the session left the stored SDK state (ids, unsent queue): clearSdkStorage was not called');
  // (b) forget() in a fresh session (account deletion while analytics never started).
  const fresh = gate(mods);
  await fresh.analytics.forget();
  if (fresh.created.length > 0) out.push('forget() created the SDK');
  if (fresh.cleared.length === 0) out.push('forget() with no SDK in the session left the stored SDK state: clearSdkStorage was not called');
  return out;
}

async function modeOff(mods) {
  const { analytics, created } = gate(mods, { mode: 'off' });
  analytics.setConsent('granted');
  analytics.track(event(mods));
  await analytics.flush();
  await settle();
  return created.length > 0 ? ['an off build created the SDK'] : [];
}

async function trackingGate(mods) {
  const out = [];
  const plain = gate(mods, { saved: grantedRecord(mods) });
  plain.analytics.track(event(mods));
  await settle();
  if (plain.created[0]?.isTrackingAllowed !== false) out.push('the default profile told the adapter tracking is allowed');
  for (const [status, expected] of [['denied', false], ['authorized', true], ['unavailable', false]]) {
    const run = gate(mods, { saved: grantedRecord(mods), tracking: status });
    run.analytics.track(event(mods));
    await settle();
    if (run.created[0]?.isTrackingAllowed !== expected) out.push(`ATT ${status} gave isTrackingAllowed ${run.created[0]?.isTrackingAllowed} (expected ${expected})`);
  }
  return out;
}

async function neverThrows(mods) {
  const out = [];
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    const broken = gate(mods, { saved: grantedRecord(mods), createThrows: true });
    try {
      broken.analytics.track(event(mods));
      await settle();
      broken.analytics.track(event(mods));
      await settle();
    } catch {
      out.push('track() threw when the SDK could not be created');
    }
    if (broken.created.length !== 1) out.push(`a failed start was retried ${broken.created.length - 1} times in the session`);
    if (broken.errors.length === 0) out.push('a failed start was not recorded through onError');
    for (const method of ['capture', 'optOut', 'flush']) {
      const run = gate(mods, { saved: grantedRecord(mods), failOn: method });
      try {
        run.analytics.track(event(mods));
        await settle();
        await run.analytics.flush();
        run.analytics.setConsent('denied');
        await settle();
      } catch {
        out.push(`a failing SDK ${method} escaped the port`);
      }
    }
    await settle();
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  if (rejections.length > 0) out.push(`an SDK failure became an unhandled rejection: ${String(rejections[0])}`);
  return out;
}

async function sanitize(mods) {
  const catalog = mods.events.ANALYTICS_EVENTS;
  const out = [];
  const run = gate(mods, { saved: grantedRecord(mods) });
  run.analytics.track({ name: 'not_in_the_catalog_event', props: {} });
  const withExtra = event(mods);
  run.analytics.track({ ...withExtra, props: { ...withExtra.props, email: 'someone@example.com' } });
  const withEnum = sampleEvent(catalog, (spec) => Object.values(spec.props).some((prop) => prop.kind === 'enum'));
  if (withEnum !== null) {
    const key = Object.keys(withEnum.props).find((name) => catalog[withEnum.name].props[name].kind === 'enum');
    run.analytics.track({ ...withEnum, props: { ...withEnum.props, [key]: 'Free text the user typed' } });
  }
  const withCount = sampleEvent(catalog, (spec) => Object.values(spec.props).some((prop) => prop.kind === 'count'));
  if (withCount !== null) {
    const key = Object.keys(withCount.props).find((name) => catalog[withCount.name].props[name].kind === 'count');
    run.analytics.track({ ...withCount, props: { ...withCount.props, [key]: catalog[withCount.name].props[key].max + 1000 } });
  }
  await settle();
  const names = run.fake.captured.map((entry) => entry.name);
  if (names.includes('not_in_the_catalog_event')) out.push('an event outside the catalog reached the SDK');
  if (run.fake.captured.some((entry) => 'email' in entry.props)) out.push('an undeclared property reached the SDK');
  if (run.fake.captured.some((entry) => Object.values(entry.props).includes('Free text the user typed'))) out.push('free text in an enum property reached the SDK');
  if (withCount !== null) {
    const key = Object.keys(withCount.props).find((name) => catalog[withCount.name].props[name].kind === 'count');
    const sent = run.fake.captured.filter((entry) => entry.name === withCount.name).at(-1);
    if (sent && sent.props[key] > catalog[withCount.name].props[key].max) out.push(`${withCount.name}.${key} was not clamped to its max`);
  }
  return out;
}

async function pendingCap(mods) {
  const max = mods.gate.MAX_PENDING_EVENTS;
  if (!Number.isInteger(max) || max < 1) return ['MAX_PENDING_EVENTS is not a whole number from 1'];
  const run = gate(mods, { saved: grantedRecord(mods), tracking: 'denied' });
  for (let index = 0; index < max + 50; index += 1) run.analytics.track(event(mods));
  await settle();
  return run.fake.captured.length > max ? [`${run.fake.captured.length} events were held while the SDK started (at most ${max})`] : [];
}

function modeMatrix(mods) {
  const { resolveAnalyticsMode } = mods.config;
  const out = [];
  const outcome = (variant, env) => {
    try {
      return resolveAnalyticsMode(variant, env);
    } catch {
      return 'throws';
    }
  };
  for (const variant of ['development', 'preview']) {
    if (outcome(variant, { ANALYTICS_MODE: 'live' }) === 'live') out.push(`${variant} builds may send to the live project`);
    if (outcome(variant, {}) === 'live') out.push(`${variant} builds send to the live project by default`);
  }
  if (outcome('production', { ANALYTICS_MODE: 'test' }) === 'test') out.push('production builds may send to the test project');
  if (outcome('production', { ANALYTICS_MODE: 'off' }) !== 'off') out.push('a production build cannot be built with analytics off');
  return out;
}

function extraReader(mods) {
  const { analyticsExtra, readAnalyticsExtra } = mods.config;
  const env = { ANALYTICS_KEY: 'publishable-key', ANALYTICS_HOST: 'https://analytics.example.test' };
  const out = [];
  const extra = analyticsExtra('production', env, 'com.example.tasks');
  if (readAnalyticsExtra(extra, 'com.example.tasks').mode !== 'live') out.push('readAnalyticsExtra does not read back a live extra');
  if (readAnalyticsExtra(extra, 'com.example.tasks.preview').mode !== 'off') out.push('an extra built for another app id is not off');
  if (readAnalyticsExtra(null, 'com.example.tasks').mode !== 'off') out.push('a missing extra is not off');
  let threw = false;
  try {
    analyticsExtra('production', {}, 'com.example.tasks');
  } catch {
    threw = true;
  }
  if (!threw) out.push('a production build without ANALYTICS_KEY builds (analytics would go nowhere)');
  return out;
}

function screenName(mods) {
  const out = [];
  const name = mods.screen.screenNameFromSegments(['(app)', 'tasks', '[id]']);
  if (name !== 'tasks/[id]') out.push(`segments (app)/tasks/[id] give ${name} (expected tasks/[id])`);
  if (mods.sanitizer.isRoutePattern('tasks/42')) out.push('a concrete path (tasks/42) passes as a route pattern');
  return out;
}

function manifestMapping(mods, contract) {
  const { parseCollects, collectedDataTypes, dataSafetyRows } = mods.manifest;
  const entries = parseCollects(contract);
  const apple = collectedDataTypes(entries);
  const out = [];
  entries.forEach((entry, index) => {
    const got = apple[index];
    if (got?.NSPrivacyCollectedDataType !== FACTS.dataTypes[entry.dataType]) out.push(`${entry.dataType} maps to ${got?.NSPrivacyCollectedDataType} (expected ${FACTS.dataTypes[entry.dataType]})`);
    if (got?.NSPrivacyCollectedDataTypeLinked !== entry.linked || got?.NSPrivacyCollectedDataTypeTracking !== entry.tracking) out.push(`${entry.dataType}: linked or tracking changed on the way to the manifest`);
    const purposes = entry.purposes.map((purpose) => FACTS.purposes[purpose]);
    if (JSON.stringify(got?.NSPrivacyCollectedDataTypePurposes) !== JSON.stringify(purposes)) out.push(`${entry.dataType}: purposes map to ${JSON.stringify(got?.NSPrivacyCollectedDataTypePurposes)}`);
  });
  if (dataSafetyRows(entries).length !== entries.length) out.push('the Data safety rows do not cover every collected data type');
  return out;
}

/** [rule, module key the problem points at, run(mods, contract)] in report order. */
export const SCENARIOS = [
  ['consent-before-sdk', 'gate', consentBeforeSdk],
  ['consent-yes-starts', 'gate', consentYesStarts],
  ['consent-no-stops', 'gate', consentNoStops],
  ['consent-version', 'consent', consentVersion],
  ['forget', 'gate', forget],
  ['clear-without-sdk', 'gate', clearWithoutSdk],
  ['mode-off', 'gate', modeOff],
  ['tracking-gate', 'gate', trackingGate],
  ['never-throws', 'gate', neverThrows],
  ['sanitize', 'sanitizer', sanitize],
  ['pending-cap', 'gate', pendingCap],
  ['mode-matrix', 'config', modeMatrix],
  ['extra-reader', 'config', extraReader],
  ['screen-name', 'screen', screenName],
  ['manifest-mapping', 'manifest', manifestMapping],
];
