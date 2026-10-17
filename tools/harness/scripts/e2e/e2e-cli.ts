// scripts/e2e/e2e-cli.ts
// The e2e:ios / e2e:android command line, pure: --help and -h print the usage with every option and
// run nothing; a bad command line is a usage error (run-e2e.ts prints the message and the usage
// line and exits 2, without a stack). Maestro's tag filter (--include-tags, while iterating) is
// passed on to maestro test, and the run then records that it is not evidence.
import { isPlatform, type Platform } from './e2e-device.ts';

export const E2E_USAGE = [
  'usage: node scripts/e2e/run-e2e.ts --platform <ios|android> [--sim <purpose>] [--driver-port <n>] [--app-path <path>] [--include-tags <tags>] [--skip-large-text]',
  '  --platform         ios (a simulator, by UDID) or android (an emulator, by adb serial)',
  "  --sim              this session's own devices: <prefix>-<purpose> (phone) and <prefix>-<purpose>-tablet",
  '                     (default <prefix>-e2e-phone and <prefix>-e2e-tablet)',
  '  --driver-port      one Maestro driver port for every run of this session (default: a free port',
  '                     per run); every run names its device and its port before the command',
  '  --app-path         the Release build to test (default: the .app or .apk the contract names)',
  '  --include-tags     passed to maestro test: only the flows with these tags (while iterating; such a',
  '                     run is recorded as filtered and is never evidence)',
  '  --skip-large-text  skip the large-text step (while iterating; never evidence)',
  '  --help, -h         print this and exit',
  'Needs a Release build of a test variant (development or preview), never production.',
  'Reports: reports/e2e/<platform>/ (junit.xml, network.txt, run.json, large-text/).',
].join('\n');

export type E2eOptions = {
  readonly platform: Platform;
  /** --sim <purpose>: <prefix>-<purpose> and <prefix>-<purpose>-tablet (undefined: the defaults). */
  readonly sim: string | undefined;
  readonly driverPort: number | undefined;
  readonly appPath: string | undefined;
  /** Maestro's --include-tags value, or null for the full (evidence) run. */
  readonly includeTags: string | null;
  readonly isSkippingLargeText: boolean;
};

export type E2eCliParse =
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'run'; readonly options: E2eOptions };

const VALUE_OPTIONS = ['--platform', '--sim', '--driver-port', '--app-path', '--include-tags'];
const FLAG_OPTIONS = ['--skip-large-text'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Read = { readonly values: Map<string, string>; readonly flags: Set<string> };

/** Every option and its value, or the first problem. */
function readArgs(argv: readonly string[]): Read | string {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (FLAG_OPTIONS.includes(arg)) {
      flags.add(arg);
      continue;
    }
    if (!VALUE_OPTIONS.includes(arg)) {
      return arg.startsWith('-') ? `unknown option ${arg}` : `unexpected argument ${arg}`;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) return `${arg} needs a value`;
    values.set(arg, value);
    index += 1;
  }
  return { values, flags };
}

/** A port number from 1024 to 65535, undefined when not given, or the problem. */
export function driverPortOf(text: string | undefined): number | undefined | string {
  if (text === undefined) return undefined;
  const port = /^\d{4,5}$/.test(text) ? Number(text) : Number.NaN;
  return port >= 1024 && port <= 65_535 ? port : `--driver-port ${text} is not a port number`;
}

function simOf(text: string | undefined): string | undefined | { readonly error: string } {
  if (text === undefined || KEBAB.test(text)) return text;
  return { error: `--sim ${text}: pass a kebab-case purpose such as --sim my-e2e` };
}

export function parseE2eCli(argv: readonly string[]): E2eCliParse {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  const read = readArgs(argv);
  if (typeof read === 'string') return { kind: 'error', message: read };
  const platform = read.values.get('--platform');
  if (platform === undefined || !isPlatform(platform)) {
    return { kind: 'error', message: 'pass --platform ios or --platform android' };
  }
  const driverPort = driverPortOf(read.values.get('--driver-port'));
  if (typeof driverPort === 'string') return { kind: 'error', message: driverPort };
  const sim = simOf(read.values.get('--sim'));
  if (typeof sim === 'object') return { kind: 'error', message: sim.error };
  return {
    kind: 'run',
    options: {
      platform,
      sim,
      driverPort,
      appPath: read.values.get('--app-path'),
      includeTags: read.values.get('--include-tags') ?? null,
      isSkippingLargeText: read.flags.has('--skip-large-text'),
    },
  };
}
