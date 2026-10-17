// scripts/e2e/screenshots-cli.ts
// The screenshots:ios / screenshots:android command line, pure: --help prints every option, a bad
// command line is a usage error (exit 2, no stack). --update writes baselines and is meant to be
// narrowed (--devices, --locales) to the sets a change touched; --sim captures on this session's own
// devices instead of the shared <prefix>-shots-phone and <prefix>-shots-tablet.
import { parseArgs } from 'node:util';

import { driverPortOf } from './e2e-cli.ts';
import {
  isFormFactor,
  isPlatform,
  type FormFactor,
  type Platform,
  type TextSize,
} from './e2e-device.ts';

export const SCREENSHOTS_USAGE = [
  'usage: node scripts/e2e/capture-screenshots.ts --platform <ios|android> [--update] [--devices phone,tablet] [--locales en,ar] [--text-size default|largest] [--sim <purpose>] [--app-path <path>] [--driver-port <n>]',
  '  --platform     ios or android (baselines are kept per platform)',
  '  --update       write the captures as the new baselines (open every PNG, commit with Gate-Change:)',
  '  --devices      phone, tablet or both (default: contracts/e2e.json screenshots.devices)',
  '  --locales      the locales (default: contracts/e2e.json screenshots.locales)',
  '  --text-size    default, or largest (the largest accessibility size, its own baseline sets)',
  "  --sim          this session's own devices <prefix>-<purpose> and <prefix>-<purpose>-tablet",
  '  --app-path     the Release build to capture (default: the one the contract names)',
  '  --driver-port  one Maestro driver port for every capture (default: a free port per capture)',
  '  --help, -h     print this and exit',
].join('\n');

export type ScreenshotsOptions = {
  readonly platform: Platform;
  readonly isUpdate: boolean;
  /** Undefined: the contract's devices and locales. */
  readonly devices: readonly FormFactor[] | undefined;
  readonly locales: readonly string[] | undefined;
  readonly textSize: TextSize;
  readonly sim: string | undefined;
  readonly appPath: string | undefined;
  readonly driverPort: number | undefined;
};

export type ScreenshotsCliParse =
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'run'; readonly options: ScreenshotsOptions };

function readValues(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: {
      platform: { type: 'string' },
      update: { type: 'boolean', default: false },
      devices: { type: 'string' },
      locales: { type: 'string' },
      'text-size': { type: 'string', default: 'default' },
      sim: { type: 'string' },
      'app-path': { type: 'string' },
      'driver-port': { type: 'string' },
    },
  }).values;
}

type Values = ReturnType<typeof readValues>;

/** The --devices list, undefined for the contract's, or the problem. */
function devicesOf(text: string | undefined): readonly FormFactor[] | undefined | string {
  const devices = text?.split(',');
  const unknown = devices?.find((device) => !isFormFactor(device));
  return unknown === undefined
    ? devices?.filter(isFormFactor)
    : `unknown device ${unknown} (phone or tablet)`;
}

/** The parts that need checking, or the first problem. */
function checkedParts(
  values: Values,
): Omit<ScreenshotsOptions, 'isUpdate' | 'sim' | 'appPath'> | string {
  if (values.platform === undefined || !isPlatform(values.platform)) {
    return 'pass --platform ios or --platform android';
  }
  const devices = devicesOf(values.devices);
  if (typeof devices === 'string') return devices;
  const textSize = values['text-size'];
  if (textSize !== 'default' && textSize !== 'largest') {
    return `--text-size ${textSize}: default or largest`;
  }
  const driverPort = driverPortOf(values['driver-port']);
  if (typeof driverPort === 'string') return driverPort;
  return {
    platform: values.platform,
    devices,
    locales: values.locales?.split(','),
    textSize,
    driverPort,
  };
}

export function parseScreenshotsCli(argv: readonly string[]): ScreenshotsCliParse {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  let values: Values;
  try {
    values = readValues(argv);
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  const parts = checkedParts(values);
  if (typeof parts === 'string') return { kind: 'error', message: parts };
  return {
    kind: 'run',
    options: { ...parts, isUpdate: values.update, sim: values.sim, appPath: values['app-path'] },
  };
}
