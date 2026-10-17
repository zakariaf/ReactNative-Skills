// scripts/release/release-build.ts
// Release steps 3-7: a clean prebuild and the post-prebuild audits, the signed archive, the export,
// and the store-artifact gate on the exported .ipa (before anything reaches Apple).
import { execFileSync } from 'node:child_process';
import { globSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

import { readArtifactFacts } from './artifact-facts.ts';
import { releaseAdsMode } from './release-config.ts';
import { archiveArgs, exportArgs, RELEASE_BUILD_DIR, xcodeAuthArgs } from './release-options.ts';
import { runReleaseStep } from './release-steps.ts';
import { storeGateProblems } from './store-gate.ts';
import { xcodeBuildNumber, XCODE_VERSION } from '../ios/toolchain.ts';

import type { ReleaseConfig } from './release-config.ts';
import type { ReleaseOptions } from './release-options.ts';
import type { Preflight } from './release-preflight.ts';
import type { ReleaseContext } from './release-steps.ts';

export type BuiltIpa = { readonly ipa: string; readonly appDirInIpa: string };

/** The folder the export options files live in (this module's own folder). */
const OPTIONS_DIR = import.meta.dirname;

function workspaceOf(appDir: string): string {
  const found = readdirSync(join(appDir, 'ios')).find((entry) => entry.endsWith('.xcworkspace'));
  if (found === undefined) throw new Error('the prebuild wrote no .xcworkspace: read its log');
  return join('ios', found);
}

/** Step 3: a clean prebuild (ios/ is generated), then the scripts that read ios/Pods. */
function prebuildAndAudit(config: ReleaseConfig, context: ReleaseContext): string {
  runReleaseStep(
    'prebuild',
    { file: 'npx', args: ['expo', 'prebuild', '--platform', 'ios', '--clean'] },
    context,
  );
  for (const script of config.postPrebuild) {
    runReleaseStep(
      `post-prebuild-${script.replaceAll(':', '-')}`,
      { file: 'npm', args: ['run', '-s', script], atRoot: true },
      context,
    );
  }
  return workspaceOf(context.appDir);
}

export type BuildInput = {
  readonly options: ReleaseOptions;
  readonly config: ReleaseConfig;
  readonly pre: Preflight;
};

/** Steps 4-6: archive and export with API-key signing, then unpack the .ipa for the gate. */
export function buildIpa(input: BuildInput, context: ReleaseContext): BuiltIpa {
  const out = join(context.appDir, RELEASE_BUILD_DIR);
  rmSync(join(out, 'export'), { recursive: true, force: true });
  const workspace = prebuildAndAudit(input.config, context);
  const scheme = workspace.slice('ios/'.length, -'.xcworkspace'.length);
  const auth = xcodeAuthArgs(input.pre.keyFile, input.pre.ids);
  runReleaseStep(
    'archive',
    { file: 'xcodebuild', args: archiveArgs({ workspace, scheme }, auth) },
    context,
  );
  const optionsDir = relative(context.appDir, OPTIONS_DIR);
  const target = { scheme, variant: input.options.variant, optionsDir };
  runReleaseStep('export', { file: 'xcodebuild', args: exportArgs(target, auth) }, context);
  const ipa = globSync(join(out, 'export', '*.ipa'))[0];
  if (ipa === undefined)
    throw new Error(`the export wrote no .ipa: read ${join(out, 'logs', 'export.log')}`);
  const unpacked = join(out, 'ipa-check');
  rmSync(unpacked, { recursive: true, force: true });
  execFileSync('unzip', ['-q', ipa, '-d', unpacked]);
  return { ipa, appDirInIpa: globSync(join(unpacked, 'Payload', '*.app'))[0] ?? '' };
}

export type GateInput = BuildInput & {
  readonly built: BuiltIpa;
  readonly buildNumber: number;
  /** Exported test-only sentinels found in the app source (the same ones check-sim-app reads). */
  readonly sentinels: readonly string[];
};

/** Step 7: the store-artifact gate. Any problem stops the release before --validate-app. */
export function runStoreGate(input: GateInput): void {
  const { config, options, pre } = input;
  const facts = readArtifactFacts(input.built.appDirInIpa, {
    bundleStrings: [...input.sentinels, ...config.forbiddenBundleStrings],
    usageStrings: config.usageStrings,
  });
  const hasAds = typeof facts.info['GADApplicationIdentifier'] === 'string';
  // The same resolution as the build env (releaseAdsMode); null means the app's variant default.
  const defaultAds = options.variant === 'production' ? 'live' : 'test';
  const problems = storeGateProblems(facts, {
    variant: options.variant,
    adsMode: hasAds ? (releaseAdsMode(options, config) ?? defaultAds) : null,
    version: pre.app.version,
    buildNumber: input.buildNumber,
    bundleId: pre.app.bundleId,
    xcodeBuild: xcodeBuildNumber(XCODE_VERSION),
    sentinels: input.sentinels,
    forbiddenStrings: config.forbiddenBundleStrings,
    usesNonExemptEncryption: config.usesNonExemptEncryption,
  });
  if (problems.length > 0) {
    throw new Error(
      `store-artifact gate failed for ${input.built.ipa}:\n- ${problems.join('\n- ')}`,
    );
  }
  console.log('release:ios: store-artifact gate passed');
}
