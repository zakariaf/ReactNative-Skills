// scripts/deps/effective-npm-config.ts
// Pure: the config npm will actually run with keeps the dependency policy. npm reads its config in
// this order of precedence: the command line, NPM_CONFIG_* environment variables, the project
// .npmrc, then ~/.npmrc. So a variable (a CI job, EAS environment variables) beats every line of the
// project .npmrc, and a key the project file leaves unset comes from ~/.npmrc. An exclude list is
// never merged: the highest layer that sets one replaces the dated blocks of the project file.
// allow-scripts must stay unset in every layer: npm 11.17 refuses it from the command line or a
// variable for an install inside the project (EALLOWSCRIPTS), and exports it from any layer to the
// scripts it runs, so an `npm install` started by an npm script (or by a tool npx runs) fails too.
// The caller runs `npm config get <EFFECTIVE_KEYS...>` (one "key=value" line per key) and passes
// its output here, with the exclude patterns of the project .npmrc.
import { MIN_RELEASE_AGE_DAYS } from './release-age-excludes.ts';

export const EFFECTIVE_KEYS = [
  'min-release-age',
  'engine-strict',
  'save-exact',
  'strict-allow-scripts',
  'legacy-peer-deps',
  'force',
  'dangerously-allow-all-scripts',
  'package-lock',
  'before',
  'min-release-age-exclude',
  'allow-scripts',
] as const;

/** The value each key must have; "null" is what npm prints for an unset before. */
const WANTED: Readonly<Record<string, string>> = {
  'engine-strict': 'true',
  'save-exact': 'true',
  'strict-allow-scripts': 'true',
  'legacy-peer-deps': 'false',
  force: 'false',
  'dangerously-allow-all-scripts': 'false',
  'package-lock': 'true',
  before: 'null',
};

/**
 * The environment for the npm and npx processes a dependency check starts: the caller's, without
 * npm_config_loglevel. `npm run -s <script>` (how `npm run verify` runs each step) exports
 * npm_config_loglevel=silent to the script, every child npm inherits it, and a silent npm prints
 * nothing on stdout either: the `npm explain <pkg> --json` calls inside expo-doctor then fail and three
 * doctor checks report "Failed to find dependency tree". Removing the key lets each child read the log
 * level from its own config, as it does from a terminal.
 */
export function childProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const key of Object.keys(copy)) {
    if (key.toLowerCase() === 'npm_config_loglevel') {
      Reflect.deleteProperty(copy, key);
    }
  }
  return copy;
}

/** The "key=value" lines of `npm config get <key> <key>...`. */
export function parseConfigGet(stdout: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const at = line.indexOf('=');
    if (at > 0) {
      values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
  }
  return values;
}

function releaseAgeProblem(values: ReadonlyMap<string, string>): readonly string[] {
  const days = values.get('min-release-age') ?? '';
  const isOk = days !== '' && Number.isFinite(Number(days)) && Number(days) >= MIN_RELEASE_AGE_DAYS;
  return isOk
    ? []
    : [`min-release-age=${days} (the policy needs ${String(MIN_RELEASE_AGE_DAYS)} or more)`];
}

function allowScriptsProblem(values: ReadonlyMap<string, string>): readonly string[] {
  const value = values.get('allow-scripts') ?? '';
  return value === ''
    ? []
    : [
        `npm runs with allow-scripts=${value} (the policy needs it unset): npm refuses it for ` +
          `installs inside the project (EALLOWSCRIPTS) and passes it to every script it runs; ` +
          `unset the NPM_CONFIG_ALLOW_SCRIPTS variable or the allow-scripts line of an .npmrc, ` +
          `and keep reviewed approvals in the root package.json allowScripts`,
      ];
}

function excludeProblem(
  values: ReadonlyMap<string, string>,
  projectExcludes: readonly string[],
): readonly string[] {
  const patterns = (values.get('min-release-age-exclude') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !projectExcludes.includes(part));
  return patterns.length === 0
    ? []
    : [`min-release-age-exclude=${patterns.join(',')} (no line of the project .npmrc names it)`];
}

/**
 * One problem per key npm would run with outside the policy, read from the config npm prints
 * (so it sees NPM_CONFIG_* variables and ~/.npmrc, which the project .npmrc check cannot).
 */
export function effectiveConfigProblems(
  values: ReadonlyMap<string, string>,
  projectExcludes: readonly string[],
): readonly string[] {
  const keyProblems = Object.entries(WANTED).flatMap(([key, wanted]) => {
    const value = values.get(key);
    return value === wanted ? [] : [`${key}=${value ?? ''} (the policy needs ${wanted})`];
  });
  return [...releaseAgeProblem(values), ...keyProblems, ...excludeProblem(values, projectExcludes)]
    .map(
      (problem) =>
        `npm runs with ${problem}: keep the policy line in the project .npmrc and unset the ` +
        `NPM_CONFIG_* variable or ~/.npmrc line that overrides it (a project line beats ~/.npmrc, ` +
        `never a variable)`,
    )
    .concat(allowScriptsProblem(values));
}
