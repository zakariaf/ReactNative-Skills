// scripts/quality/check-quality-gates.ts
// device-only: covered by npm run verify (the guardrail step) on every push
// The guardrail: the configs the tools RESOLVE must equal quality-gates.json. A mismatch means a gate
// was weakened (or quality-gates.json is stale): restore the gate, never edit the JSON to match.
// Tools run through `npx --no --`, which runs the repo's installed copy and never downloads one.
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { deviceOnlyCoveragePatterns } from './device-only.ts';
import { addedKeys, diffContains, diffSubset, type Json, withRootDirTag } from './gate-diff.ts';

type JsonObject = Readonly<Record<string, Json>>;
type Gates = {
  readonly eslint: {
    readonly linterOptions: Json;
    /** Named sets of resolved rule values: "logic", "component", "test". */
    readonly ruleSets: Readonly<Record<string, JsonObject>>;
    /** Probe file path (it need not exist) -> the rule set it must resolve to. */
    readonly probes: Readonly<Record<string, string>>;
  };
  readonly typescript: {
    readonly shared: JsonObject;
    /** tsconfig path or glob -> the options it must resolve to on top of `shared`. */
    readonly projects: Readonly<Record<string, JsonObject>>;
  };
  readonly jest: {
    readonly coverageThreshold: JsonObject;
    /** The resolved coverage scope: no new "!" exclusion, no narrowed source glob. */
    readonly collectCoverageFrom: Json;
    /** Jest project name -> its resolved test scope (testMatch, roots, ignore patterns). */
    readonly projects: Readonly<Record<string, JsonObject>>;
  };
  readonly npmScripts: Json;
  readonly claudeSettings: Json;
  readonly knip: Json;
  readonly lefthook: Json;
  readonly npmrcLines: readonly string[];
};

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SETTINGS = '.claude/settings.json';
const LOCAL_SETTINGS = '.claude/settings.local.json';
/** lefthook keys that switch a hook or a job off (or narrow its files) when a local file adds them. */
const LEFTHOOK_SWITCHES = ['skip', 'only', 'exclude', 'exclude_tags'];
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** A tool that could not start or did not print its config: reported as one line with the fix, never a stack trace. */
class ToolError extends Error {}

/** The first three non-empty lines a failed tool wrote (stderr, else stdout, else the error message), joined. */
function errorSummary(error: unknown): string {
  const stream = (key: string): string =>
    error instanceof Error && key in error
      ? String((error as unknown as Record<string, unknown>)[key])
      : '';
  const text =
    [stream('stderr'), stream('stdout')].find((output) => output.trim() !== '') ??
    (error instanceof Error ? error.message : String(error));
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.length === 0 ? 'no output' : lines.slice(0, 3).join(' / ');
}

function npx(args: readonly string[]): unknown {
  const command = `npx --no -- ${args.join(' ')}`;
  try {
    const output = execFileSync('npx', ['--no', '--', ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch (error) {
    throw new ToolError(
      `could not run ${command}: ${errorSummary(error)}. A missing tool: run npm ci (lefthook has no ` +
        '.bin link while its install script is not approved in package.json allowScripts; ' +
        "dependency-management). Otherwise fix the tool's own error (lefthook needs a git repository).",
    );
  }
}

function checkEslint(gates: Gates): readonly string[] {
  return Object.entries(gates.eslint.probes).flatMap(([file, ruleSet]) => {
    const resolved = npx(['eslint', '--print-config', file]) as Record<string, unknown>;
    const rules = gates.eslint.ruleSets[ruleSet] ?? null;
    return [
      ...diffSubset(
        gates.eslint.linterOptions,
        resolved['linterOptions'],
        `eslint(${file}).linterOptions`,
      ),
      ...diffSubset(rules, resolved['rules'], `eslint(${file}).rules`),
    ];
  });
}

function checkTypescript(gates: Gates): readonly string[] {
  // A key may be a glob, so a new program under it is checked without an edit here.
  return Object.entries(gates.typescript.projects).flatMap(([pattern, options]) => {
    const projects = globSync(pattern);
    if (projects.length === 0) {
      return [`tsc(${pattern}): no tsconfig matches this entry`];
    }
    return projects.flatMap((project) => {
      const resolved = npx(['tsc', '-p', project, '--showConfig']) as Record<string, unknown>;
      const expected = { ...gates.typescript.shared, ...options };
      return diffSubset(expected, resolved['compilerOptions'], `tsc(${project})`);
    });
  });
}

function hasSourceFiles(key: string): boolean {
  const pattern = key.endsWith('/') ? `${key}**/*.{ts,tsx}` : key;
  return globSync(pattern).some((file) => !file.includes('.test.'));
}

type JestProject = {
  readonly rootDir: string;
  readonly displayName?: { readonly name: string };
};
type JestConfig = {
  readonly globalConfig: {
    readonly coverageThreshold: unknown;
    readonly collectCoverageFrom: unknown;
  };
  readonly configs: readonly JestProject[];
};

function checkJestThresholds(gates: Gates, resolved: JestConfig): readonly string[] {
  const actual = resolved.globalConfig.coverageThreshold as Readonly<Record<string, unknown>>;
  return Object.entries(gates.jest.coverageThreshold).flatMap(([key, expected]) => {
    // Jest fails on a threshold key that matches no file, so a folder joins once it has code.
    if (actual[key] === undefined && key !== 'global' && !hasSourceFiles(key)) {
      return [];
    }
    return diffSubset(expected, actual[key], `jest.coverageThreshold[${key}]`);
  });
}

/**
 * What Jest collects coverage from and which tests each project finds. A wider exclusion glob or an
 * ignored test path hides code from the gates as surely as a lower threshold. The only way out of
 * coverage is the device-only marker, so coveragePathIgnorePatterns must be exactly its patterns.
 */
function checkJestScope(gates: Gates, resolved: JestConfig): readonly string[] {
  const projects = Object.fromEntries(
    resolved.configs.map((config) => [
      config.displayName?.name ?? '(unnamed)',
      withRootDirTag(config, config.rootDir) as Readonly<Record<string, unknown>>,
    ]),
  );
  const coverage = ['/node_modules/', ...deviceOnlyCoveragePatterns(REPO_ROOT)];
  return [
    ...diffSubset(
      gates.jest.collectCoverageFrom,
      resolved.globalConfig.collectCoverageFrom,
      'jest.collectCoverageFrom',
    ),
    ...Object.keys(projects)
      .filter((name) => !(name in gates.jest.projects))
      .map((name) => `jest project "${name}" is not in quality-gates.json jest.projects`),
    ...diffSubset(gates.jest.projects, projects, 'jest.projects'),
    ...Object.entries(projects).flatMap(([name, config]) =>
      diffSubset(
        coverage,
        config['coveragePathIgnorePatterns'],
        `jest.projects.${name}.coveragePathIgnorePatterns (only device-only files leave coverage)`,
      ),
    ),
  ];
}

function checkJest(gates: Gates): readonly string[] {
  const resolved = npx(['jest', '--showConfig']) as JestConfig;
  return [...checkJestThresholds(gates, resolved), ...checkJestScope(gates, resolved)];
}

/** Hook switches in the merged lefthook config and in Claude Code's git-ignored local settings. */
function checkSwitches(gates: Gates, lefthook: unknown): readonly string[] {
  const local = existsSync(LOCAL_SETTINGS) ? readJson(LOCAL_SETTINGS) : {};
  const hooksOff = ['disableAllHooks'];
  return [
    ...addedKeys(gates.lefthook, lefthook, {
      keys: LEFTHOOK_SWITCHES,
      where: 'lefthook.yml',
    }),
    ...addedKeys(gates.claudeSettings, readJson(SETTINGS), {
      keys: hooksOff,
      where: SETTINGS,
    }),
    ...addedKeys({}, local, { keys: hooksOff, where: LOCAL_SETTINGS }),
  ];
}

function checkFiles(gates: Gates): readonly string[] {
  const packageJson = readJson('package.json') as { scripts?: unknown };
  const npmrc = readFileSync('.npmrc', 'utf8').split('\n');
  // `lefthook dump` merges a local lefthook-local.yml, so a local skip is caught too.
  const lefthook = npx(['lefthook', 'dump', '--format', 'json']);
  return [
    ...diffSubset(gates.npmScripts, packageJson.scripts, 'package.json scripts'),
    // The app keeps its own deny and ask rules and hooks; every gate entry must still be there, exactly.
    ...diffContains(gates.claudeSettings, readJson(SETTINGS), SETTINGS),
    ...diffSubset(gates.knip, readJson('knip.json'), 'knip.json'),
    ...diffSubset(gates.lefthook, lefthook, 'lefthook.yml'),
    ...checkSwitches(gates, lefthook),
    ...gates.npmrcLines
      .filter((line) => !npmrc.includes(line))
      .map((line) => `.npmrc: missing line "${line}"`),
  ];
}

/** Every mismatch, or null when a tool could not run (that one line is printed instead). */
function collectProblems(gates: Gates): readonly string[] | null {
  try {
    return [
      ...checkEslint(gates),
      ...checkTypescript(gates),
      ...checkJest(gates),
      ...checkFiles(gates),
    ];
  } catch (error) {
    if (!(error instanceof ToolError)) {
      throw error;
    }
    console.error(`quality-gates: ${error.message}`);
    return null;
  }
}

function main(): number {
  process.chdir(REPO_ROOT);
  const gates = readJson('quality-gates.json') as Gates;
  const problems = collectProblems(gates);
  if (problems === null) {
    return 1;
  }
  for (const problem of problems) {
    console.error(`quality-gates: ${problem}`);
  }
  if (problems.length > 0) {
    console.error(
      'A gate differs from quality-gates.json. Restore the gate; never edit the JSON to match.',
    );
    return 1;
  }
  console.log('quality-gates: all resolved configs match quality-gates.json');
  return 0;
}

process.exitCode = main();
