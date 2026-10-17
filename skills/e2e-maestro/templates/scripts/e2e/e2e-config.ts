// scripts/e2e/e2e-config.ts
// The app's own E2E facts, read from contracts/e2e.json (valibot; productionAppIds and network are
// required, every other key is optional and the defaults below apply). The e2e-maestro skill's checkers read the same file,
// including the keys only they use (extraTestIDs, manualFolders, tags), which this reader ignores.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as v from 'valibot';

import { devicePrefixOf } from './e2e-device.ts';

/** The contract file, relative to the repo root. */
export const E2E_CONTRACT = join('contracts', 'e2e.json');
/** ios-simulator-build's contract: its simulatorPrefix is the default device prefix here too. */
const SIM_BUILD_CONTRACT = join('contracts', 'ios-sim-build.json');

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME = v.pipe(v.string(), v.minLength(1));
const NAMES = v.array(NAME);

const CONTRACT_SCHEMA = v.object({
  devicePrefix: v.optional(v.pipe(v.string(), v.regex(KEBAB, 'must be kebab-case'))),
  productionAppIds: v.pipe(NAMES, v.minLength(1, 'must list the production app id')),
  buildExtra: v.optional(v.record(v.string(), v.string())),
  maestroBin: v.optional(NAME),
  ios: v.optional(
    v.object({ phone: v.optional(NAME), tablet: v.optional(NAME), appPath: v.optional(NAME) }),
  ),
  android: v.optional(
    v.object({
      systemImage: v.optional(NAME),
      phoneDevice: v.optional(NAME),
      tabletDevice: v.optional(NAME),
      apkPath: v.optional(NAME),
    }),
  ),
  network: v.pipe(
    v.object({
      mode: v.picklist(['offline-only', 'allowlist', 'off']),
      allowHosts: v.optional(NAMES),
      why: v.optional(NAME),
    }),
    v.check((network) => network.mode !== 'off' || network.why !== undefined, 'off needs a why'),
    v.check(
      (network) => network.mode !== 'allowlist' || (network.allowHosts ?? []).length > 0,
      'allowlist needs allowHosts',
    ),
  ),
  largeText: v.optional(v.object({ locales: NAMES })),
  screenshots: v.optional(
    v.object({ flow: v.optional(NAME), locales: NAMES, devices: v.optional(NAMES) }),
  ),
});

export type NetworkMode = 'offline-only' | 'allowlist' | 'off';

/** Everything the runner and the capture need from the contract, defaults filled in. */
export type E2eConfig = {
  /** Devices are named <devicePrefix>-<purpose> (tasks-e2e-phone); default: the simulator prefix. */
  readonly devicePrefix: string;
  /** A build with one of these ids is a store build: it has no test-only code, so no debug link. */
  readonly productionAppIds: readonly string[];
  /**
   * Values the build's embedded expo.extra must hold, e.g. { adsMode: 'off' } (admob-ads-and-consent):
   * with ads off the app shows no consent form or tracking prompt and opens no ad socket.
   */
  readonly buildExtra: Readonly<Record<string, string>>;
  readonly maestroBin: string;
  readonly iosModels: { readonly phone: string; readonly tablet: string };
  readonly iosAppDir: string;
  readonly androidImage: string;
  readonly androidDevices: { readonly phone: string; readonly tablet: string };
  readonly apkPath: string;
  readonly network: { readonly mode: NetworkMode; readonly allowHosts: readonly string[] };
  readonly largeTextLocales: readonly string[];
  readonly screenshots: {
    readonly flow: string;
    readonly locales: readonly string[];
    readonly devices: readonly string[];
  };
};

const DEFAULTS = {
  /** The same default model as ios-simulator-build's simulators (the 6.9-inch class). */
  iosPhone: 'iPhone 17 Pro Max',
  maestroBin: join('tools', 'maestro', 'bin', 'maestro'),
  iosTablet: 'iPad Pro 13-inch (M5)',
  iosAppDir: join('build', 'ios-sim', 'dd', 'Build', 'Products', 'Release-iphonesimulator'),
  androidImage: 'system-images;android-36;google_apis;arm64-v8a',
  apkPath: join('build', 'android-emu', 'app-preview.apk'),
  matrixFlow: join('.maestro', 'screenshots', 'matrix.yaml'),
} as const;

type Contract = v.InferOutput<typeof CONTRACT_SCHEMA>;

function devicesOf(contract: Contract): Pick<E2eConfig, 'iosModels' | 'androidDevices'> {
  return {
    iosModels: {
      phone: contract.ios?.phone ?? DEFAULTS.iosPhone,
      tablet: contract.ios?.tablet ?? DEFAULTS.iosTablet,
    },
    androidDevices: {
      phone: contract.android?.phoneDevice ?? 'pixel_8',
      tablet: contract.android?.tabletDevice ?? 'pixel_tablet',
    },
  };
}

function toolsOf(
  contract: Contract,
): Pick<E2eConfig, 'maestroBin' | 'iosAppDir' | 'androidImage' | 'apkPath'> {
  return {
    maestroBin: contract.maestroBin ?? DEFAULTS.maestroBin,
    iosAppDir: contract.ios?.appPath ?? DEFAULTS.iosAppDir,
    androidImage: contract.android?.systemImage ?? DEFAULTS.androidImage,
    apkPath: contract.android?.apkPath ?? DEFAULTS.apkPath,
  };
}

function screenshotsOf(contract: Contract): E2eConfig['screenshots'] {
  return {
    flow: contract.screenshots?.flow ?? DEFAULTS.matrixFlow,
    locales: contract.screenshots?.locales ?? [],
    devices: contract.screenshots?.devices ?? ['phone', 'tablet'],
  };
}

/** Validates the parsed contract and fills the defaults; `fallbackPrefix` names the devices. */
export function parseE2eConfig(raw: unknown, fallbackPrefix: string): E2eConfig {
  const result = v.safeParse(CONTRACT_SCHEMA, raw);
  if (!result.success) {
    const where = result.issues.map(
      (issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`,
    );
    throw new Error(`${E2E_CONTRACT} is not valid: ${where.join('; ')}`);
  }
  const contract = result.output;
  return {
    devicePrefix: contract.devicePrefix ?? fallbackPrefix,
    productionAppIds: contract.productionAppIds,
    buildExtra: contract.buildExtra ?? {},
    ...toolsOf(contract),
    ...devicesOf(contract),
    network: { mode: contract.network.mode, allowHosts: contract.network.allowHosts ?? [] },
    largeTextLocales: contract.largeText?.locales ?? [],
    screenshots: screenshotsOf(contract),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** The prefix ios-simulator-build uses, else the package name in kebab case. */
function fallbackPrefixOf(root: string): string {
  const simContract = join(root, SIM_BUILD_CONTRACT);
  if (existsSync(simContract)) {
    const prefix = (readJson(simContract) as { readonly simulatorPrefix?: unknown })
      .simulatorPrefix;
    if (typeof prefix === 'string') return prefix;
  }
  const pkg = readJson(join(root, 'package.json')) as { readonly name?: unknown };
  return devicePrefixOf(typeof pkg.name === 'string' ? pkg.name : '');
}

/** The config of the repo at `root`; the contract file is required (it names the production ids). */
export function readE2eConfig(root: string): E2eConfig {
  const path = join(root, E2E_CONTRACT);
  if (!existsSync(path)) {
    throw new Error(`${E2E_CONTRACT} is missing: copy the e2e-maestro template and fill it`);
  }
  return parseE2eConfig(readJson(path), fallbackPrefixOf(root));
}
