#!/usr/bin/env node
// check-ad-behaviour.mjs: runs the app's own ad modules (ad-policy, ad-history, rewarded-offer,
// ad-gate, consent-moment-flow, ad-moments, fullscreen-ad, ads-config) against the pacing and
// consent decision tables, and the SDK adapters, both factories and read-ads-extra against scripted
// stand-ins of the ads SDK, expo-tracking-transparency, react-native, react and expo-constants
// (lib/stubs/), all loaded with Node's type stripping. A weakened Jest test cannot hide a broken rule.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-ad-behaviour.mjs [repo-root] [--app <dir>]

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, parseArgs, requireDir, requireFile, resolveLayout, run } from './check-lib.mjs';
import { readContract, requireAppForWorkspaces, SDK, TRACKING } from './lib/ads-facts.mjs';
import { adsScenarios } from './lib/ads-scenarios.mjs';
import { consentScenarios } from './lib/consent-scenarios.mjs';
import { appLoader, setModuleStubs } from './lib/load-ts.mjs';
import { readRepoJson } from './lib/repo-scan.mjs';

const STUBS = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'stubs');
setModuleStubs({
  [SDK]: join(STUBS, 'react-native-google-mobile-ads.mjs'),
  react: join(STUBS, 'react.mjs'),
  'expo-constants': join(STUBS, 'expo-constants.mjs'),
  [TRACKING]: join(STUBS, 'expo-tracking-transparency.mjs'),
  'react-native': join(STUBS, 'react-native.mjs'),
});

const SPEC = {
  name: 'check-ad-behaviour',
  summary: "Loads the app's ad and consent modules (Node type stripping) and checks them against the decision tables: interstitial pacing, banner screens, rewarded offers, the ad history, the consent -> ATT -> initialize -> preload order, pausing media around fullscreen ads, which IDs each ads mode gets, the variant x ads-mode matrix, and that an ADS_MODE=off build never asks Google for consent nor Apple for tracking.",
  usage: '[repo-root] [--app <dir>] [--json]',
  options: {
    app: { type: 'string', value: 'dir', help: 'The app folder inside a multi-package repo (default: the repo root)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: module-load, interstitial-rules, banner-rules, rewarded-offer-rules, ad-history, consent-order,',
    '  consent-moment-flow, fullscreen-lifecycle, ads-config, ads-mode-matrix, adapter-init, adapter-interstitial,',
    '  adapter-rewarded, adapter-rewarded-status, adapter-banner, ads-factory, read-ads-extra (the ads module),',
    '  consent-adapter, tracking-adapter (general audience only), consent-factory (the consent module).',
    'The SDK, expo-tracking-transparency, react-native, react and expo-constants are replaced by the scripted',
    'stand-ins in lib/stubs/. The audience in contracts/ads.json decides the expected request configuration.',
    'Needs Node 22.18+ (type stripping). The modules must use erasable TypeScript; tsconfig "paths" aliases and',
    'extensionless relative imports resolve.',
    'NOT APPLICABLE when neither the SDK nor expo-tracking-transparency is in package.json, or when the SDK is',
    'installed but the app has no src/services/ads/ and no src/services/consent/ yet.',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repo = requireDir(positionals[0] ?? '.', 'repo root');
  const root = options.app ? requireDir(join(repo, options.app), 'app folder (--app)') : repo;
  requireFile(join(root, 'package.json'), 'the app\'s package.json (pass --app <dir> in a multi-package repo)');
  const report = createReporter({ name: 'check-ad-behaviour', json: options.json });
  const layout = resolveLayout(root);
  const pkg = readRepoJson(root, 'package.json') ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const adsDir = `${layout.servicesDir}/ads`;
  const consentDir = `${layout.servicesDir}/consent`;
  if (deps[SDK] === undefined && deps[TRACKING] === undefined && !options.app) requireAppForWorkspaces(root, [SDK, TRACKING]);
  if (deps[SDK] === undefined && deps[TRACKING] === undefined) return report.notApplicable(`${SDK} and ${TRACKING} are not in package.json`);
  const hasAds = existsSync(join(root, adsDir));
  const hasConsent = existsSync(join(root, consentDir));
  if (!hasAds && !hasConsent) return report.notApplicable(`${SDK} is installed, but the app has no ${adsDir}/ and no ${consentDir}/ yet`);

  const loader = appLoader(root);
  const mods = {};
  let checked = 0;
  const load = async (key, rel) => {
    const loaded = await loader.load(rel);
    if (loaded.error) report.problem({ file: rel, rule: 'module-load', message: loaded.error, fix: 'Copy the module from the admob-ads-and-consent templates; keep erasable TypeScript (no enums, namespaces or parameter properties).' });
    else mods[key] = loaded.module;
  };
  const expect = async (rule, file, label, actualFn, expected, fix) => {
    checked += 1;
    let actual;
    try {
      actual = await actualFn();
    } catch (error) {
      actual = `threw ${String(error?.message ?? error).split('\n')[0]}`;
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) report.problem({ file, rule, message: `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, fix });
  };

  // A child-directed app has no ATT adapter (App Review 1.3); a general one must have it.
  const contract = readContract(root, layout).data;
  const isChild = contract?.audience === 'child-directed';
  const files = {
    consentAdapter: `${consentDir}/admob-consent-adapter.ts`,
    consentFactory: `${consentDir}/consent-factory.ts`,
    ...(isChild ? {} : { trackingAdapter: `${consentDir}/expo-tracking-consent-adapter.ts` }),
  };
  for (const [key, rel] of Object.entries(files)) await load(key, rel);
  await consentScenarios({ mods, files, expect });
  if (!hasAds) {
    report.note(`no ${adsDir}/: the ads scenarios do not apply yet; the consent scenarios ran`);
    return report.finish({ checked, unit: 'scenarios' });
  }
  const adsFiles = {
    policy: `${adsDir}/ad-policy.ts`,
    history: `${adsDir}/ad-history.ts`,
    offer: `${adsDir}/rewarded-offer.ts`,
    gate: `${adsDir}/ad-gate.ts`,
    flow: `${adsDir}/consent-moment-flow.ts`,
    moments: `${adsDir}/ad-moments.ts`,
    fullscreen: `${adsDir}/fullscreen-ad.ts`,
    adapter: `${adsDir}/admob-ads-adapter.ts`,
    factory: `${adsDir}/ads-factory.ts`,
    extra: `${adsDir}/read-ads-extra.ts`,
    config: `${layout.configDir}/ads-config.ts`,
  };
  for (const [key, rel] of Object.entries(adsFiles)) await load(key, rel);
  await adsScenarios({ mods, files: adsFiles, expect, contract });
  return report.finish({ checked, unit: 'scenarios' });
});
