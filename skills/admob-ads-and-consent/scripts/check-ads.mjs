#!/usr/bin/env node
// check-ads.mjs: static checks of an Expo app's AdMob, UMP consent and App Tracking Transparency code.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-ads.mjs [repo-root] [--app <dir>]

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, requireFile, resolveLayout, run } from './check-lib.mjs';
import { readContract, requireAppForWorkspaces, scanContext, SDK, TRACKING } from './lib/ads-facts.mjs';
import { checkAdapterContent, checkAppIds, checkBanners, checkBreakRecorded, checkConsentMoment, checkContentRating, checkExtraBinaryGuard, checkFreeAllowance, checkIdsImport, checkPluginEntry, checkPolicyNumbers, checkPortCalls, checkRewardedStatus, checkSkadnetwork, checkSmokeFolder, checkSourceRules, checkUnitsExtra } from './lib/ads-rules.mjs';
import { checkAdsFactory, checkConsentFactory, checkDebugAdapterImports, checkDebugGeography, checkNoSecondTrackingWriter, checkPins, checkRequiredFiles, checkSdkImports, checkTestOnlyCalls, checkTrackingImports, checkTrackingOrder, checkTrackingPlugin, checkTrackingWiring } from './lib/consent-rules.mjs';
import { parseImports, readRepoJson } from './lib/repo-scan.mjs';

const SPEC = {
  name: 'check-ads',
  summary: 'Checks the AdMob integration of an Expo app: the files in place, the SDK pinned and imported only by its adapters, no banned SDK API, consent built per ads mode, test-only consent tools kept out of store code, IDs, the App Tracking Transparency prompt (only in the consent adapter, after the Google form, before initialize, with its plugin and a text in every language), the plugin and expo.extra wiring, SKAdNetwork, pacing numbers, banner placement and the moments ads may appear.',
  usage: '[repo-root] [--app <dir>] [--json]',
  options: {
    app: { type: 'string', value: 'dir', help: 'The app folder inside a multi-package repo (default: the repo root)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (consent and ATT, wherever the app uses the SDK or expo-tracking-transparency): required-file, sdk-pin,',
    '  sdk-import, sdk-api, att-adapter-only, att-plugin, att-wiring, consent-factory, debug-geography-test-only,',
    '  test-only-api, debug-adapter-import. A child-directed audience (contracts/ads.json) inverts att-plugin and',
    '  att-wiring: no tracking plugin, text, package or adapter, and tracking: null (App Review 1.3).',
    'Rules (ads, once the app has src/services/ads/ or imports the SDK outside the consent adapters): required-file,',
    '  deprecated-banner-size, error-code-branch, reward-on-earned, content-rating, rewarded-status, sample-id,',
    '  hard-coded-id, ids-import, att-order, plugin-entry, extra-ad-units, skadnetwork, app-ids, policy-numbers,',
    '  banner-placement, ad-in-effect, pure-policy, root-mock, break-recorded, consent-moment, ads-factory,',
    '  port-calls, ads-extra-binary, smoke-flows, free-allowance-config.',
    'Facts (version, allowlists, ID formats) come from assets/admob-facts.json; the app\'s facts from',
    'contracts/ads.json (rn-skills.config.json "adsContract" moves it): audience, maxAdContentRating, bannerSlots,',
    'pacingFloors, trackingTextKey. Paths follow resolveLayout (rn-skills.config.json can move src/, services, config).',
    '',
    'NOT APPLICABLE when neither react-native-google-mobile-ads nor expo-tracking-transparency is in package.json, or',
    'when the SDK is installed but no code uses it (no src/services/ads/, no src/services/consent/, no import).',
    'SKIP: att-plugin while the i18n catalogs folder does not exist (i18n-strings-and-catalogs creates it).',
  ].join('\n'),
};

/** Which parts apply: ads (the module exists or the SDK is used outside consent) and consent/ATT. */
function scopes(ctx) {
  const pkg = readRepoJson(ctx.root, 'package.json') ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hasSdk = deps[SDK] !== undefined;
  const hasTracking = deps[TRACKING] !== undefined;
  const importers = (spec, outside) => ctx.runtime.filter((rel) => !outside.some((dir) => rel.startsWith(`${dir}/`)) && parseImports(ctx.sources.get(rel)).some((imp) => imp.specifier === spec));
  const isAds = hasSdk && (existsSync(join(ctx.root, ctx.adsDir)) || importers(SDK, [ctx.consentDir]).length > 0);
  const isConsent = isAds || existsSync(join(ctx.root, ctx.consentDir)) || importers(TRACKING, []).length > 0;
  return { hasSdk, hasTracking, isAds, isConsent };
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repo = requireDir(positionals[0] ?? '.', 'repo root');
  const root = options.app ? requireDir(join(repo, options.app), 'app folder (--app)') : repo;
  const report = createReporter({ name: 'check-ads', json: options.json });
  requireFile(join(root, 'package.json'), 'the app\'s package.json (pass --app <dir> in a multi-package repo)');
  const layout = resolveLayout(root);
  const ctx = scanContext(root, layout);
  const scope = scopes(ctx);
  if (!scope.hasSdk && !scope.hasTracking && !options.app) requireAppForWorkspaces(root, [SDK, TRACKING]);
  if (!scope.hasSdk && !scope.hasTracking) return report.notApplicable(`${SDK} and ${TRACKING} are not in package.json`);
  if (!scope.isAds && !scope.isConsent) return report.notApplicable(`${SDK} is installed, but no code uses it yet (no ${ctx.adsDir}/, no ${ctx.consentDir}/, nothing imports it)`);
  const contract = readContract(root, layout);
  const isChild = contract.data?.audience === 'child-directed';
  checkPins(ctx, report);
  checkSdkImports(ctx, report);
  checkTrackingImports(ctx, report);
  checkConsentFactory(ctx, report);
  checkDebugGeography(ctx, report);
  checkTestOnlyCalls(ctx, report);
  checkDebugAdapterImports(ctx, report);
  checkNoSecondTrackingWriter(ctx, report);
  // ATT applies to a general audience once the app uses ads or the tracking package; never to a child-directed one.
  const needsTracking = !isChild && (scope.hasTracking || scope.isAds);
  const groups = ['consent', ...(needsTracking ? ['tracking', 'trackingMock'] : []), ...(scope.hasTracking || scope.isAds ? ['mocks'] : [])];
  if (scope.hasSdk) checkRequiredFiles(ctx, report, groups);
  if (isChild || needsTracking) checkTrackingPlugin(ctx, contract.data, report);
  checkTrackingWiring(ctx, contract.data, report);
  if (!scope.isAds) {
    report.note(`no ${ctx.adsDir}/ and no ${SDK} import outside ${ctx.consentDir}/: the ads rules do not apply yet; the consent and ATT rules ran`);
    return report.finish({ checked: ctx.runtime.length + ctx.config.length, unit: 'files' });
  }
  if (contract.data === null) report.problem({ file: contract.rel, rule: 'required-file', message: 'missing', fix: 'Copy templates/contracts/ads.json (and ads.schema.json) and fill the app\'s banner screens, audience and pacing floors.' });
  checkRequiredFiles(ctx, report, ['ads', 'config', 'hooks', 'ui', 'connectivity', 'scripts']);
  checkAdsFactory(ctx, report);
  checkTrackingOrder(ctx, report);
  checkSourceRules(ctx, report);
  checkIdsImport(ctx, report);
  checkContentRating(ctx, contract.data, report);
  checkAdapterContent(ctx, report);
  checkRewardedStatus(ctx, report);
  checkPluginEntry(ctx, report);
  checkUnitsExtra(ctx, report);
  checkSkadnetwork(ctx, report);
  checkAppIds(ctx, report);
  checkPolicyNumbers(ctx, contract.data, report);
  checkBanners(ctx, contract.data, report);
  checkBreakRecorded(ctx, report);
  checkConsentMoment(ctx, report);
  checkPortCalls(ctx, report);
  checkExtraBinaryGuard(ctx, report);
  checkSmokeFolder(ctx, report);
  checkFreeAllowance(ctx, report);
  return report.finish({ checked: ctx.runtime.length + ctx.config.length, unit: 'files' });
});
