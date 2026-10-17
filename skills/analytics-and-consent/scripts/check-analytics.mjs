#!/usr/bin/env node
// check-analytics.mjs: static checks of product analytics behind a port. The contract, the files, the
// SDK inventory and its one importer, lazy creation inside createAnalytics({ createSdk }), the SDK's
// privacy options, the event catalog (names, property kinds, no personal data, a purpose each), every
// track() call, screen names, identity, the tracking profile, the audience, the store declarations,
// the app.config.ts wiring, keys, test isolation and the consent UI.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-analytics.mjs [repo-root]

import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, requireFile, run } from './check-lib.mjs';
import { loadAnalyticsRepo } from './lib/analytics-repo.mjs';
import {
  checkAudience,
  checkCatalog,
  checkClearStorage,
  checkConsentCovers,
  checkConsentSource,
  checkConsentUi,
  checkContract,
  checkDeclarations,
  checkFiles,
  checkIdentify,
  checkImports,
  checkInventory,
  checkKeys,
  checkLazy,
  checkOptions,
  checkPrivacySync,
  checkTestIsolation,
  checkTracking,
  checkTrackCalls,
  checkRootKit,
  checkWiring,
  hasNoVendor,
} from './lib/analytics-rules.mjs';

const SPEC = {
  name: 'check-analytics',
  summary: 'Checks that product analytics is consent-gated, typed, anonymous by default and declared.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details:
    'Rules: contract, files, sdk-inventory, sdk-import, sdk-lazy, sdk-clear, sdk-options, event-catalog, event-name, ' +
    'event-props, event-pii, event-purpose, track-literal, screen-pathname, identify, tracking, ' +
    'child-directed, declarations, manifest-wiring, privacy-sync, key-literal, test-isolation, consent-ui, ' +
    'consent-source, consent-covers, root-kit (the registry src/services/create-root-kits.ts creates the port and ' +
    'registers createAnalyticsKit). With contract sdk "none" (no vendor yet: nothing can leave the device) ' +
    'manifest-wiring and consent-ui wait for the vendor and a note says so. A missing repo root or package.json exits 2. ' +
    'NOT APPLICABLE when the app has no src/services/analytics/, no contracts/analytics.json and no ' +
    'analytics SDK in package.json; only sdk-inventory runs when the one analytics fact is an SDK that starts ' +
    'itself (expo-insights, expo-observe). rn-skills.config.json layout keys (srcDir, servicesDir, configDir, ' +
    'scriptsDir, contractsDir) move the paths.',
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  requireFile(join(root, 'package.json'), "the app's package.json (pass the app folder in a multi-package repo)");
  const repo = loadAnalyticsRepo(root, { srcDir: options['src-dir'] });
  const report = createReporter({ name: SPEC.name, json: options.json });
  if (!repo.present) {
    return report.notApplicable('no src/services/analytics/, no contracts/analytics.json and no analytics SDK in package.json');
  }
  if (repo.onlyAutoStart) {
    // No analytics of the app's own: only the SDK that starts itself is reported.
    checkInventory(repo, report);
    return report.finish({ checked: 1, unit: 'package files' });
  }
  checkContract(repo, report);
  checkFiles(repo, report);
  checkInventory(repo, report);
  checkImports(repo, report);
  checkTestIsolation(repo, report);
  checkLazy(repo, report);
  checkRootKit(repo, report);
  checkClearStorage(repo, report);
  checkOptions(repo, report);
  const names = checkCatalog(repo, report);
  checkTrackCalls(repo, report, names);
  checkIdentify(repo, report);
  checkTracking(repo, report);
  checkAudience(repo, report);
  checkDeclarations(repo, report, names);
  if (hasNoVendor(repo)) report.note('note: contracts/analytics.json sdk is "none" (no vendor, nothing leaves the device): manifest-wiring and consent-ui apply once a vendor is chosen');
  checkWiring(repo, report);
  checkKeys(repo, report);
  checkConsentUi(repo, report);
  checkConsentSource(repo, report);
  checkConsentCovers(repo, report);
  checkPrivacySync(repo, report);
  return report.finish({ checked: repo.sources.length, unit: 'files' });
});
