// scripts/audit/audit-network.ts
// `npm run audit:network [-- --skip-export]`: the network audit of the production build, iOS and
// Android. It exports the release bundles into dist-audit/ (as the production variant, the same
// export audit:licenses reads), attributes every shipped module that can open a connection, scans
// every autolinked native module, reads the production config and, after a prebuild, the trunk
// pods. First-party code may connect only through the seams contracts/privacy.json allows; every
// third-party capability belongs to an SDK the contract declares (or a package that SDK installs,
// sdk-packages.ts) or has a reasoned entry in
// contracts/network-baseline.json. STALE entries and a skipped pods layer are notes, never failures.
// Layer A (source) is ESLint plus the skill's audit-repo.mjs; layer F (runtime) is e2e-maestro's
// socket sampler, run with the policy of contracts/e2e.json "network", and the JS network guard.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { readBundleModules } from './bundle-modules.ts';
import { compareToBaseline } from './network-baseline.ts';
import { configProblems } from './network-config-layer.ts';
import { jsNetworkFindings } from './network-js-layer.ts';
import { nativeModuleRoots, nativeNetworkFindings } from './network-native-layer.ts';
import { podProblems } from './network-pods-layer.ts';
import {
  declaredPods,
  declaredSdkNames,
  networkSeams,
  readPrivacyContract,
  urlSeams,
} from './privacy-contract.ts';
import { sdkPackages } from './sdk-packages.ts';

import type { NetworkBaseline } from './network-baseline.ts';
import type { ExpoConfigLike } from './network-config-layer.ts';
import type { PrivacyContract } from './privacy-contract.ts';

const ROOT = process.cwd();
const EXPORT_DIR = path.join(ROOT, 'dist-audit');
const PRODUCTION_ENV = {
  ...process.env,
  APP_VARIANT: 'production',
  EXPO_PUBLIC_APP_VARIANT: 'production',
};

type Result = { readonly failures: string[]; readonly notes: string[] };

function exportBundles(): void {
  const args = ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--source-maps'];
  execFileSync('npx', [...args, '--output-dir', EXPORT_DIR], {
    cwd: ROOT,
    env: PRODUCTION_ENV,
    stdio: 'ignore',
  });
}

function jsLayer(contract: PrivacyContract, baseline: NetworkBaseline): Result {
  const seams = { network: networkSeams(contract), urls: urlSeams(contract) };
  const { findings, firstParty } = jsNetworkFindings(readBundleModules(EXPORT_DIR), seams);
  const compared = compareToBaseline(
    findings,
    baseline.js,
    sdkPackages(ROOT, declaredSdkNames(contract)),
  );
  const own = firstParty.map((hit) => `first-party network code outside the seams: ${hit}`);
  return { failures: [...own, ...compared.failures], notes: compared.notes };
}

function nativeLayer(contract: PrivacyContract, baseline: NetworkBaseline): Result {
  const findings = nativeNetworkFindings(nativeModuleRoots(ROOT));
  return compareToBaseline(
    findings,
    baseline.native,
    sdkPackages(ROOT, declaredSdkNames(contract)),
  );
}

function configLayer(contract: PrivacyContract): Result {
  const json = execFileSync('npx', ['expo', 'config', '--json', '--type', 'prebuild'], {
    cwd: ROOT,
    env: PRODUCTION_ENV,
    encoding: 'utf8',
  });
  return {
    failures: configProblems(JSON.parse(json) as ExpoConfigLike, contract.profile),
    notes: [],
  };
}

function podsLayer(contract: PrivacyContract): Result {
  const lock = path.join(ROOT, 'ios', 'Podfile.lock');
  if (!existsSync(lock)) {
    return {
      failures: [],
      notes: ['SKIPPED pods layer: no ios/Podfile.lock (run npx expo prebuild)'],
    };
  }
  return { failures: podProblems(readFileSync(lock, 'utf8'), declaredPods(contract)), notes: [] };
}

function main(argv: readonly string[]): number {
  const contract = readPrivacyContract(ROOT);
  const baselineFile = path.join(ROOT, 'contracts', 'network-baseline.json');
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as NetworkBaseline;
  if (!argv.includes('--skip-export')) {
    exportBundles();
  }
  const results = [
    jsLayer(contract, baseline),
    nativeLayer(contract, baseline),
    configLayer(contract),
    podsLayer(contract),
  ];
  for (const note of results.flatMap((result) => result.notes)) {
    console.log(`audit:network: ${note}`);
  }
  const failures = results.flatMap((result) => result.failures);
  for (const failure of failures) {
    console.error(`audit:network: FAIL ${failure}`);
  }
  console.log(`audit:network: ${String(failures.length)} failure(s), profile ${contract.profile}`);
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
