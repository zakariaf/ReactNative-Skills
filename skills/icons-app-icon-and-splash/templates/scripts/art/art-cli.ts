// scripts/art/art-cli.ts
// Command-line handling shared by the art scripts: --help, clean errors for unknown flags and
// missing values, and the exit codes every repo script uses (0 done, 1 stale output, 2 bad input).
import { parseArgs } from 'node:util';

export type CliOption = {
  readonly type: 'boolean' | 'string';
  /** Shown in the usage line and the option list, e.g. '<file.png>'. */
  readonly value?: string;
  /** Shown without brackets in the usage line; the script itself reports it when missing. */
  readonly isRequired?: boolean;
  readonly help: string;
};

export type CliSpec = {
  /** The run command, e.g. 'node scripts/art/render-app-art.ts'. */
  readonly command: string;
  readonly summary: string;
  readonly options: Readonly<Record<string, CliOption>>;
  /** Extra lines after the option list (examples, what the exit codes mean). */
  readonly notes?: readonly string[];
};

export type CliValues = Readonly<Record<string, string | boolean | undefined>>;

export type CliOutcome =
  | { readonly kind: 'run'; readonly values: CliValues }
  | { readonly kind: 'exit'; readonly code: 0 | 2; readonly text: string };

export const EXIT_BAD_INPUT = 2;

function optionLabel(name: string, option: CliOption): string {
  return option.type === 'string' ? `--${name} ${option.value ?? '<value>'}` : `--${name}`;
}

/** The --help text: usage line, summary, one line per option, notes. */
export function usageOf(spec: CliSpec): string {
  const entries = Object.entries(spec.options);
  const labels = entries.map(([name, option]) => optionLabel(name, option));
  const width = Math.max(...labels.map((label) => label.length), '-h, --help'.length);
  const shapes = entries.map(([, option], index) => {
    const label = labels[index] ?? '';
    return option.isRequired === true ? label : `[${label}]`;
  });
  return [
    `Usage: ${spec.command} ${shapes.join(' ')}`.trimEnd(),
    '',
    spec.summary,
    '',
    'Options:',
    ...entries.map(
      ([, option], index) => `  ${(labels[index] ?? '').padEnd(width)}  ${option.help}`,
    ),
    `  ${'-h, --help'.padEnd(width)}  Show this help and exit`,
    ...(spec.notes === undefined ? [] : ['', ...spec.notes]),
  ].join('\n');
}

/** A bad-input message in the scripts' format, pointing at --help. */
export function badInputText(spec: CliSpec, message: string): string {
  return `ERROR: ${message}\nRun: ${spec.command} --help`;
}

/** The message of a node:util parseArgs error (checked by its code: errors can come from another realm). */
function parseError(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code: unknown = Reflect.get(error, 'code');
  const message: unknown = Reflect.get(error, 'message');
  const isParseError = typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_');
  return isParseError && typeof message === 'string' ? message : null;
}

/** Parses argv strictly: --help exits 0 with the usage, any unknown or malformed flag exits 2. */
export function readCli(spec: CliSpec, argv: readonly string[]): CliOutcome {
  const options = Object.fromEntries(
    Object.entries(spec.options).map(([name, option]) => [name, { type: option.type }]),
  );
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { ...options, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: false,
    });
    if (values.help === true) return { kind: 'exit', code: 0, text: usageOf(spec) };
    // parseArgs returns a null-prototype object; hand back a plain one.
    return { kind: 'run', values: { ...values } };
  } catch (error) {
    const message = parseError(error);
    if (message === null) throw error;
    return { kind: 'exit', code: EXIT_BAD_INPUT, text: badInputText(spec, message) };
  }
}

/** For a script's main(): the parsed values, or null after printing help or the error. */
export function readCliOrExit(spec: CliSpec): CliValues | null {
  const outcome = readCli(spec, process.argv.slice(2));
  if (outcome.kind === 'run') return outcome.values;
  if (outcome.code === 0) console.log(outcome.text);
  else console.error(outcome.text);
  process.exitCode = outcome.code;
  return null;
}

/** Prints a bad-input error (a missing input file, a bad value) and sets exit code 2. */
export function failInput(spec: CliSpec, message: string): void {
  console.error(badInputText(spec, message));
  process.exitCode = EXIT_BAD_INPUT;
}
