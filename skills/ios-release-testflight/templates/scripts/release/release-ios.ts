// scripts/release/release-ios.ts
// CLI: npm run release:ios -- --variant preview|production [--ads off|test|live]
//        [--notes "what testers should check"]... [--known-issue "..."]... [--resume build|processing]
// The local lane (no EAS): preflight -> build number +1 (committed) -> clean prebuild + audits ->
// signed archive -> export -> store-artifact gate -> validate -> upload -> wait for VALID -> What
// to Test -> annotated upload tag. Stops on the first failure; a human stop prints one message and
// is never retried. The printed "Resume:" line says how to rerun (same number or a new one).
// Uploading leaves the machine: run it only with the developer's word in this session.
import { buildTag } from './build-number.ts';
import { buildIpa, runStoreGate } from './release-build.ts';
import { appPrefix, readReleaseConfig, releaseAdsMode } from './release-config.ts';
import { parseReleaseArgs } from './release-options.ts';
import { bumpAndCommit, preflight } from './release-preflight.ts';
import { describeAndTag, validateAndUpload, waitUntilValid } from './release-upload.ts';
import {
  appSourceDirs,
  findTestOnlyGate,
  readProjectConfig,
  releaseSentinels,
  sentinelGapProblem,
} from './test-only-sentinels.ts';
import { variantEnv } from '../../src/config/app-variant.ts';
import { selectXcode } from '../ios/toolchain.ts';

import type { ReleaseConfig } from './release-config.ts';
import type { ReleaseOptions } from './release-options.ts';
import type { ReleaseContext } from './release-steps.ts';

function releaseContext(options: ReleaseOptions, config: ReleaseConfig): ReleaseContext {
  // The variant variables stay exported for every step: prebuild, the Constants phase and Metro.
  const mode = releaseAdsMode(options, config);
  const ads = mode === null ? {} : { ADS_MODE: mode };
  const env = { ...selectXcode(process.env), ...variantEnv(options.variant), ...ads };
  return { appDir: config.appDir, env };
}

/** What the final report prints besides the variant. */
type ReleaseReport = {
  readonly tag: string;
  readonly whatToTest: string;
  readonly humanSteps: readonly string[];
};

function report(options: ReleaseOptions, { tag, whatToTest, humanSteps }: ReleaseReport): void {
  const kind =
    options.variant === 'production' ? 'store build' : 'preview build (internal testers only)';
  console.log(
    `release:ios: ${tag} uploaded, processed (VALID) and available in TestFlight as a ${kind}.`,
  );
  console.log(`release:ios: What to Test:\n${whatToTest}`);
  for (const step of humanSteps) console.log(`release:ios: human step (not blocking): ${step}`);
  if (options.variant === 'production') {
    console.log('release:ios: ask the developer to try it and answer "ship" or "don\'t ship".');
  }
}

async function main(): Promise<number> {
  const options = parseReleaseArgs(process.argv.slice(2));
  const config = readReleaseConfig('.');
  const context = releaseContext(options, config);
  const pre = await preflight({ options, config, context });
  // Before the bump: a test-only gate the store gate cannot judge stops here, not after the upload.
  const projectConfig = readProjectConfig('rn-skills.config.json');
  const srcDirs = appSourceDirs(config.appDir, projectConfig);
  const sentinels = releaseSentinels(srcDirs, projectConfig);
  const gap = sentinelGapProblem(findTestOnlyGate(srcDirs), sentinels);
  if (gap !== null) throw new Error(gap);
  const buildNumber = bumpAndCommit(options, config);
  // --resume processing: the upload of this build number already reached Apple.
  if (options.resume !== 'processing') {
    const built = buildIpa({ options, config, pre }, context);
    runStoreGate({ options, config, pre, built, buildNumber, sentinels });
    validateAndUpload({ ipa: built.ipa, pre, buildNumber }, context);
  }
  const restId = await waitUntilValid(pre, buildNumber, context.env);
  const prefix = appPrefix(config);
  const tagInput = { pre, prefix, variant: options.variant, buildNumber, restId };
  const text = await describeAndTag(tagInput, context.env);
  const tag = buildTag(prefix, pre.app.version, buildNumber);
  report(options, { tag, whatToTest: text, humanSteps: pre.humanSteps });
  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  console.error(`release:ios: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
