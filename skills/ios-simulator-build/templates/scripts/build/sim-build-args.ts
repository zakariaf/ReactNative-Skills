// scripts/build/sim-build-args.ts
// The command line of `npm run build:ios:sim`. The variant is parsed by the app's own resolver
// (src/config/app-variant.ts, owned by app-variants-and-environment), so a typo never builds.
import { parseAppVariant, type AppVariant } from '../../src/config/app-variant.ts';

/** --link: the deep link opened after launch, and the testID that proves its screen is shown. */
export type LinkRequest = { readonly path: string; readonly waitFor: string };

/** One build request. */
export type SimBuildOptions = {
  readonly variant: AppVariant;
  /** The simulator is <prefix>-<purpose> (default smoke). */
  readonly purpose: string;
  /** The app folder (holds app.config.ts and gets ios/); '.' for a single app. */
  readonly appDir: string;
  readonly link: LinkRequest | null;
  /** --driver-port: this session's own Maestro driver port for --link (else a free one). */
  readonly driverPort: number | null;
};

/** Printed by --help and with every argument error. */
export const SIM_BUILD_USAGE = [
  'usage: npm run build:ios:sim -- [--variant development|preview|production] [--sim <purpose>]',
  '         [--app-dir <dir>] [--link <path> --wait-for <testID> [--driver-port <n>]]',
  '  --variant      preview (default: the testers build, test-only code included), production',
  '                 (the store build) or development (the dev client, built Release)',
  '  --sim          the dedicated simulator <prefix>-<purpose> (default smoke)',
  "  --app-dir      the app folder when the repo holds several packages (default '.')",
  '  --link         after the launch screenshot, open <scheme>://<path> through the Maestro sub-flow',
  '                 (it accepts iOS\'s "Open in ...?" prompt), wait for --wait-for, screenshot again',
  '  --wait-for     the testID that proves the linked screen is shown (required with --link)',
  '  --driver-port  the Maestro driver port of --link (default: a free port of this run)',
  '  --help, -h     print this and exit',
].join('\n');

const FLAGS = new Set(['--variant', '--sim', '--app-dir', '--link', '--wait-for', '--driver-port']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LINK_PATH = /^[A-Za-z0-9][\w\-./?=&%]*$/;
const MIN_PORT = 1024;
const MAX_PORT = 65_535;

/** --help or -h anywhere: print SIM_BUILD_USAGE and build nothing. */
export function isHelpRequest(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function readFlags(argv: readonly string[]): ReadonlyMap<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] ?? '';
    const value = argv[index + 1];
    if (!FLAGS.has(flag) || value === undefined || value.startsWith('--')) {
      throw new Error(`unexpected argument "${flag}"\n${SIM_BUILD_USAGE}`);
    }
    flags.set(flag, value);
  }
  return flags;
}

function linkOf(flags: ReadonlyMap<string, string>): LinkRequest | null {
  const path = flags.get('--link');
  if (path === undefined) return null;
  if (!LINK_PATH.test(path)) {
    throw new Error(`--link ${path}: pass the path after <scheme>://, such as 'tasks/42'`);
  }
  const waitFor = flags.get('--wait-for');
  if (waitFor === undefined) throw new Error(`--link ${path} needs --wait-for <testID>`);
  return { path, waitFor };
}

function portOf(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`--driver-port ${raw}: pass a port from ${String(MIN_PORT)} to 65535`);
  }
  return port;
}

/** Parses the CLI; an unknown variant, flag, purpose or port throws before anything runs. */
export function parseSimBuildArgs(argv: readonly string[]): SimBuildOptions {
  const flags = readFlags(argv);
  const purpose = flags.get('--sim') ?? 'smoke';
  if (!KEBAB.test(purpose)) throw new Error(`--sim ${purpose}: pass a kebab-case purpose`);
  return {
    variant: parseAppVariant(flags.get('--variant') ?? 'preview'),
    purpose,
    appDir: flags.get('--app-dir') ?? '.',
    link: linkOf(flags),
    driverPort: portOf(flags.get('--driver-port')),
  };
}
