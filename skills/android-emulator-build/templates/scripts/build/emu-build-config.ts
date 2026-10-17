// scripts/build/emu-build-config.ts
// The app's own facts for emulator builds, read from contracts/android-emu-build.json (every key is
// optional; the defaults below apply). The android-emulator-build skill's checkers read the same
// file, including the keys only they use (appId, permissions, targetSdk, application, ...), which
// this reader ignores.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as v from 'valibot';

import { avdPrefixOf, DEFAULT_DEVICE_PROFILE } from '../android/emulators.ts';

/** The contract file, relative to the repo root. */
export const EMU_BUILD_CONTRACT = join('contracts', 'android-emu-build.json');

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SYSTEM_IMAGE = /^system-images;android-\d+;[\w-]+;(arm64-v8a|x86_64)$/;
const NAME = v.pipe(v.string(), v.minLength(1));

const CONTRACT_SCHEMA = v.object({
  avdPrefix: v.optional(v.pipe(v.string(), v.regex(KEBAB, 'must be kebab-case'))),
  device: v.optional(NAME),
  systemImage: v.optional(
    v.pipe(v.string(), v.regex(SYSTEM_IMAGE, 'must be system-images;android-<api>;<tag>;<abi>')),
  ),
  postPrebuild: v.optional(v.array(NAME)),
  readyLog: v.optional(v.nullable(v.object({ tag: NAME, contains: NAME }))),
});

/** A logcat line the test build writes once its first screen is interactive. */
export type ReadyLog = { readonly tag: string; readonly contains: string };

/** Everything the build script needs from the contract, defaults filled in. */
export type EmuBuildConfig = {
  /** AVDs are named <avdPrefix>-<purpose>; default: the package name in kebab case. */
  readonly avdPrefix: string;
  /** The avdmanager hardware profile of a newly created AVD. */
  readonly device: string;
  /** A system image other than the pinned one for the host ABI (null: systemImageFor(abi)). */
  readonly systemImage: string | null;
  /** npm scripts run from the repo root right after every prebuild (they may read android/). */
  readonly postPrebuild: readonly string[];
  readonly readyLog: ReadyLog | null;
};

/** Validates the parsed contract (or undefined when the file is absent) and fills the defaults. */
export function parseEmuBuildConfig(raw: unknown, packageName: string): EmuBuildConfig {
  const result = v.safeParse(CONTRACT_SCHEMA, raw ?? {});
  if (!result.success) {
    const where = result.issues.map(
      (issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`,
    );
    throw new Error(`${EMU_BUILD_CONTRACT} is not valid: ${where.join('; ')}`);
  }
  const contract = result.output;
  return {
    avdPrefix: contract.avdPrefix ?? avdPrefixOf(packageName),
    device: contract.device ?? DEFAULT_DEVICE_PROFILE,
    systemImage: contract.systemImage ?? null,
    postPrebuild: contract.postPrebuild ?? [],
    readyLog: contract.readyLog ?? null,
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** The config of the repo at `root`: package.json name plus the optional contract file. */
export function readEmuBuildConfig(root: string): EmuBuildConfig {
  const pkg = readJson(join(root, 'package.json')) as { readonly name?: unknown };
  const contractPath = join(root, EMU_BUILD_CONTRACT);
  const raw = existsSync(contractPath) ? readJson(contractPath) : undefined;
  return parseEmuBuildConfig(raw, typeof pkg.name === 'string' ? pkg.name : '');
}
