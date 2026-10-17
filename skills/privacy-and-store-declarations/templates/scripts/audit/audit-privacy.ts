// scripts/audit/audit-privacy.ts
// `npm run audit:privacy` after `npx expo prebuild --platform ios --clean` (prebuild runs pod
// install; macOS). Fails when the app's manifest lacks a reason a pod declares, when a pod that no
// tracking SDK of contracts/privacy.json brings declares tracking, when the app's own manifest
// declares tracking or tracking domains, when a development pod's manifest cannot be read, or when
// nothing is prebuilt. Prints the required reasons and the data the pods collect: the input for the
// App Privacy answers (the skill's audit-privacy-manifest.mjs compares it with the contract).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { readPrivacyContract, trackingPods } from './privacy-contract.ts';
import {
  collectedLines,
  localPodManifestPaths,
  mergeReasons,
  privacyProblems,
  readManifest,
} from './privacy-manifest.ts';

import type { PodManifest, PrivacyManifest } from './privacy-manifest.ts';

const ROOT = process.cwd();
const IOS = path.join(ROOT, 'ios');

function podManifests(): { pods: PodManifest[]; unreadable: string[] } {
  const podsDir = path.join(IOS, 'Pods');
  const trunk = readdirSync(podsDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('PrivacyInfo.xcprivacy'))
    .map((file) => ({ pod: file.split(path.sep)[0] ?? file, path: path.join(podsDir, file) }));
  const local = localPodManifestPaths(IOS);
  const unreadable = local
    .filter((entry) => !existsSync(entry.path))
    .map((entry) => `pod ${entry.pod} bundles ${entry.path}, which the audit cannot read`);
  const found = [...trunk, ...local.filter((entry) => existsSync(entry.path))];
  return {
    pods: found.map((entry) => ({ ...entry, manifest: readManifest(entry.path) })),
    unreadable,
  };
}

function appManifest(): PrivacyManifest {
  const json = execFileSync('npx', ['expo', 'config', '--json', '--type', 'public'], {
    cwd: ROOT,
    env: { ...process.env, APP_VARIANT: 'production', EXPO_PUBLIC_APP_VARIANT: 'production' },
    encoding: 'utf8',
  });
  const config = JSON.parse(json) as { ios?: { privacyManifests?: PrivacyManifest } };
  return config.ios?.privacyManifests ?? {};
}

function main(): number {
  if (!existsSync(path.join(IOS, 'Pods'))) {
    console.error(
      'audit:privacy: no ios/Pods (run npx expo prebuild --platform ios --clean first)',
    );
    return 1;
  }
  const contract = readPrivacyContract(ROOT);
  const { pods, unreadable } = podManifests();
  for (const [category, reasons] of mergeReasons(pods.map(({ manifest }) => manifest))) {
    console.log(`audit:privacy: required ${category}: ${[...reasons].sort().join(', ')}`);
  }
  for (const line of collectedLines(pods)) {
    console.log(`audit:privacy: collected ${line}`);
  }
  const problems = [...privacyProblems(pods, appManifest(), trackingPods(contract)), ...unreadable];
  for (const problem of problems) {
    console.error(`audit:privacy: FAIL ${problem}`);
  }
  console.log(
    `audit:privacy: ${String(pods.length)} pod manifests, ${String(problems.length)} problem(s)`,
  );
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
