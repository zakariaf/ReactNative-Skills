// scripts/build/sim-build-config.ts
// The app's own facts for simulator builds, read from contracts/ios-sim-build.json (every key is
// optional; the defaults below apply). The ios-simulator-build skill's checkers read the same file,
// including the keys only they use (appId, usageStrings, infoPlist, ...), which this reader ignores.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as v from 'valibot';

import { DEFAULT_DEVICE_TYPE, simulatorPrefixOf } from '../ios/simulators.ts';

/** The contract file, relative to the repo root. */
export const SIM_BUILD_CONTRACT = join('contracts', 'ios-sim-build.json');
/** The Maestro sub-flow --link runs (e2e-maestro creates it): it opens LINK and accepts iOS's prompt. */
export const DEFAULT_LINK_FLOW = join('.maestro', 'subflows', 'open-link.yaml');

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME = v.pipe(v.string(), v.minLength(1));

const CONTRACT_SCHEMA = v.object({
  simulatorPrefix: v.optional(v.pipe(v.string(), v.regex(KEBAB, 'must be kebab-case'))),
  deviceType: v.optional(NAME),
  postPrebuild: v.optional(v.array(NAME)),
  readyMarker: v.optional(v.nullable(v.object({ file: NAME, contains: NAME }))),
  linkFlow: v.optional(NAME),
  maestroBin: v.optional(NAME),
});

/** A file the test build writes into its data container once the first screen is interactive. */
export type ReadyMarker = { readonly file: string; readonly contains: string };

/** Everything the build script needs from the contract, defaults filled in. */
export type SimBuildConfig = {
  /** Simulators are named <simulatorPrefix>-<purpose>; default: the package name in kebab case. */
  readonly simulatorPrefix: string;
  readonly deviceType: string;
  /** npm scripts run from the repo root right after every prebuild (they may read ios/Pods). */
  readonly postPrebuild: readonly string[];
  readonly readyMarker: ReadyMarker | null;
  readonly linkFlow: string;
  readonly maestroBin: string;
};

/** Validates the parsed contract (or undefined when the file is absent) and fills the defaults. */
export function parseSimBuildConfig(raw: unknown, packageName: string): SimBuildConfig {
  const result = v.safeParse(CONTRACT_SCHEMA, raw ?? {});
  if (!result.success) {
    const where = result.issues.map(
      (issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`,
    );
    throw new Error(`${SIM_BUILD_CONTRACT} is not valid: ${where.join('; ')}`);
  }
  const contract = result.output;
  return {
    simulatorPrefix: contract.simulatorPrefix ?? simulatorPrefixOf(packageName),
    deviceType: contract.deviceType ?? DEFAULT_DEVICE_TYPE,
    postPrebuild: contract.postPrebuild ?? [],
    readyMarker: contract.readyMarker ?? null,
    linkFlow: contract.linkFlow ?? DEFAULT_LINK_FLOW,
    maestroBin: contract.maestroBin ?? 'maestro',
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** The config of the repo at `root`: package.json name plus the optional contract file. */
export function readSimBuildConfig(root: string): SimBuildConfig {
  const pkg = readJson(join(root, 'package.json')) as { readonly name?: unknown };
  const contractPath = join(root, SIM_BUILD_CONTRACT);
  const raw = existsSync(contractPath) ? readJson(contractPath) : undefined;
  return parseSimBuildConfig(raw, typeof pkg.name === 'string' ? pkg.name : '');
}
