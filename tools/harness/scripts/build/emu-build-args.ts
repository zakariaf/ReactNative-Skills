// scripts/build/emu-build-args.ts
// The command line of `npm run build:android:emu`. The variant is parsed by the app's own resolver
// (src/config/app-variant.ts, owned by app-variants-and-environment), so a typo never builds.
import { parseAppVariant, type AppVariant } from '../../src/config/app-variant.ts';

import type { AndroidAbi } from '../android/toolchain.ts';

/** One build request. */
export type EmuBuildOptions = {
  readonly variant: AppVariant;
  /** The emulator is the AVD <prefix>-<purpose> (default smoke). */
  readonly purpose: string;
  /** The app folder (holds app.config.ts and gets android/); '.' for a single app. */
  readonly appDir: string;
  /** --abi: the one ABI Gradle builds and the emulator runs; null = the host's (hostAbi). */
  readonly abi: AndroidAbi | null;
  /** --link: the path after <scheme>:// opened after the launch screenshot, or null. */
  readonly link: string | null;
  /** --keep-emulator: leave an emulator this run started running (default: stop it). */
  readonly keepEmulator: boolean;
};

/** Printed by --help and with every argument error. */
export const EMU_BUILD_USAGE = [
  'usage: npm run build:android:emu -- [--variant development|preview|production] [--emu <purpose>]',
  '         [--app-dir <dir>] [--abi arm64-v8a|x86_64] [--link <path>] [--keep-emulator]',
  '  --variant        preview (default: the testers build, test-only code included), production',
  '                   (the store build) or development (the dev client, built Release)',
  '  --emu            the dedicated emulator, the AVD <prefix>-<purpose> (default smoke)',
  "  --app-dir        the app folder when the repo holds several packages (default '.')",
  '  --abi            the one ABI to build and run (default: the host, arm64-v8a on Apple silicon)',
  '  --link           after the launch screenshot, open <scheme>://<path> with an adb VIEW intent',
  '                   addressed to the app, wait until the screen settles, screenshot again',
  '  --keep-emulator  leave the emulator running when this run started it (default: stop it)',
  '  --help, -h       print this and exit',
].join('\n');

const VALUE_FLAGS = new Set(['--variant', '--emu', '--app-dir', '--abi', '--link']);
const BOOLEAN_FLAGS = new Set(['--keep-emulator']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LINK_PATH = /^[A-Za-z0-9][\w\-./?=&%]*$/;
const ABIS: readonly AndroidAbi[] = ['arm64-v8a', 'x86_64'];

/** --help or -h anywhere: print EMU_BUILD_USAGE and build nothing. */
export function isHelpRequest(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function readFlags(argv: readonly string[]): ReadonlyMap<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    if (BOOLEAN_FLAGS.has(flag)) {
      flags.set(flag, 'true');
      continue;
    }
    const value = argv[index + 1];
    if (!VALUE_FLAGS.has(flag) || value === undefined || value.startsWith('--')) {
      throw new Error(`unexpected argument "${flag}"\n${EMU_BUILD_USAGE}`);
    }
    flags.set(flag, value);
    index += 1;
  }
  return flags;
}

function abiOf(raw: string | undefined): AndroidAbi | null {
  if (raw === undefined) return null;
  const abi = ABIS.find((candidate) => candidate === raw);
  if (abi === undefined) throw new Error(`--abi ${raw}: pass arm64-v8a or x86_64`);
  return abi;
}

function linkOf(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!LINK_PATH.test(raw)) {
    throw new Error(`--link ${raw}: pass the path after <scheme>://, such as 'tasks/42'`);
  }
  return raw;
}

/** Parses the CLI; an unknown variant, flag, purpose or ABI throws before anything runs. */
export function parseEmuBuildArgs(argv: readonly string[]): EmuBuildOptions {
  const flags = readFlags(argv);
  const purpose = flags.get('--emu') ?? 'smoke';
  if (!KEBAB.test(purpose)) throw new Error(`--emu ${purpose}: pass a kebab-case purpose`);
  return {
    variant: parseAppVariant(flags.get('--variant') ?? 'preview'),
    purpose,
    appDir: flags.get('--app-dir') ?? '.',
    abi: abiOf(flags.get('--abi')),
    link: linkOf(flags.get('--link')),
    keepEmulator: flags.has('--keep-emulator'),
  };
}
