// scripts/asc/print-app-record.ts
// CLI: node scripts/asc/print-app-record.ts [--variant preview|production] [--bundle-id <id>]
// Prints {"id","name"} of the App Store Connect app record of the variant's bundle id (from
// contracts/ios-release.json appId: <appId> for production, <appId>.preview for preview), or exits 2
// when there is none: creating the app record is a human step (no API endpoint creates apps).
import { parseArgs } from 'node:util';

import { loadAscCredentials } from './asc-credentials.ts';
import { createAscJwt } from './asc-jwt.ts';
import { findAppByBundleId } from './find-app.ts';
import { parseAppVariant } from '../../src/config/app-variant.ts';
import { nowEpochSeconds } from '../clock/system-clock.ts';
import { readReleaseConfig, variantBundleId } from '../release/release-config.ts';

const EXIT_NO_APP_RECORD = 2;
const USAGE =
  'usage: node scripts/asc/print-app-record.ts [--variant preview|production] [--bundle-id <id>]';

function bundleIdOf(argv: readonly string[]): string {
  const { values } = parseArgs({
    args: [...argv],
    options: { variant: { type: 'string' }, 'bundle-id': { type: 'string' } },
  });
  if (values['bundle-id'] !== undefined) return values['bundle-id'];
  const variant = parseAppVariant(values.variant ?? 'production');
  return variantBundleId(readReleaseConfig('.').appId, variant);
}

async function main(argv: readonly string[]): Promise<number> {
  let bundleId: string;
  try {
    bundleId = bundleIdOf(argv);
  } catch (error: unknown) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 1;
  }
  const token = createAscJwt(loadAscCredentials(process.env), nowEpochSeconds());
  const app = await findAppByBundleId(token, bundleId);
  if (app === null) {
    console.error(
      `No App Store Connect app record for ${bundleId}. Human step (app record): the developer creates it in App Store Connect (Apps > + > New App).`,
    );
    return EXIT_NO_APP_RECORD;
  }
  process.stdout.write(`${JSON.stringify(app)}\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
