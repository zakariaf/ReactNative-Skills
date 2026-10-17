// scripts/deps/check-deps.ts
// The dependency gate of `npm run verify`: the .npmrc policy (release age with dated excludes,
// engine-strict, exact saves, strict install scripts, no key that switches a guard off), the config
// npm actually runs with (no NPM_CONFIG_* variable or ~/.npmrc line that overrides the project
// file), the root package.json engines that make engine-strict mean something, banned packages (the
// list in the dependency policy, contracts/dependency-policy.json unless rn-skills.config.json moves
// it), one specifier per package across workspaces (when multi-package), Expo alignment (expo
// install --check and expo-doctor in each Expo app), reviewed install scripts and approvals pinned
// to a version. An Expo patch mismatch whose expected version is younger than the .npmrc
// min-release-age (7 days or more) is a WARN line with the day it becomes due (installing it now
// would break the policy); from that day on it fails. It needs the network (npm and Expo's API):
// offline, verify fails here. Its npm and npx children run without the npm_config_loglevel that
// `npm run -s` exports (a silent npm breaks expo-doctor's npm explain calls).
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findBannedPackages, inventoryFromLockfile, type Lockfile } from './banned-packages.ts';
import { bannedRulesOf, readDependencyPolicy } from './dependency-policy.ts';
import {
  childProcessEnv,
  EFFECTIVE_KEYS,
  effectiveConfigProblems,
  parseConfigGet,
} from './effective-npm-config.ts';
import { enginesProblems, type EnginesManifest } from './engines-floor.ts';
import {
  judgeMismatches,
  parseDoctor,
  parseInstallCheck,
  parsePublishTimes,
  youngPatchWarnings,
  type VersionMismatch,
} from './expo-patch-age.ts';
import {
  checkReleaseAgeExcludes,
  excludePatternsOf,
  releaseAgeDaysOf,
} from './release-age-excludes.ts';
import { unpinnedApprovals, type AllowScripts } from './unpinned-approvals.ts';
import { findLockstepDrift, type Manifest } from './workspace-lockstep.ts';
import { todayIso } from '../clock/system-clock.ts';

const NO_PENDING = 'No packages with unreviewed install scripts.';

type RootManifest = Manifest &
  EnginesManifest & {
    readonly workspaces?: readonly string[];
    readonly allowScripts?: AllowScripts;
  };
type Run = { readonly ok: boolean; readonly output: string; readonly stdout: string };
type Findings = { readonly problems: readonly string[]; readonly warnings: readonly string[] };

/** Each child runs without the npm_config_loglevel that `npm run -s` exports (childProcessEnv). */
const CHILD_ENV = childProcessEnv(process.env);

function run(command: string, args: readonly string[], cwd: string): Run {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: CHILD_ENV });
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`,
    stdout: result.stdout,
  };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function readManifest(dir: string): RootManifest {
  return readJson(path.join(dir, 'package.json')) as RootManifest;
}

/** Workspace folders from the root package.json "workspaces" (none for a single app). */
function workspaceDirs(): readonly string[] {
  const patterns = readManifest('.').workspaces ?? [];
  const dirs = patterns.flatMap((pattern) => globSync(pattern));
  return [...new Set(dirs)].filter((dir) => existsSync(path.join(dir, 'package.json'))).sort();
}

/** The Expo apps: the root of a single app, or every workspace that depends on expo. */
function expoAppDirs(workspaces: readonly string[]): readonly string[] {
  if (workspaces.length === 0) {
    return ['.'];
  }
  return workspaces.filter((dir) => readManifest(dir).dependencies?.['expo'] !== undefined);
}

function releaseAgeProblems(npmrc: string): readonly string[] {
  const violations = checkReleaseAgeExcludes(npmrc, todayIso());
  return violations.map((violation) =>
    `.npmrc line ${String(violation.line)}: ${violation.problem} ${violation.pattern}`.trim(),
  );
}

/** The config npm runs with, which NPM_CONFIG_* variables and ~/.npmrc can override. */
function effectiveNpmConfigProblems(npmrc: string): readonly string[] {
  const result = run('npm', ['config', 'get', ...EFFECTIVE_KEYS], '.');
  if (!result.ok) {
    return [`npm config get failed\n${result.output}`];
  }
  return effectiveConfigProblems(parseConfigGet(result.stdout), excludePatternsOf(npmrc));
}

function bannedProblems(): readonly string[] {
  try {
    const read = readDependencyPolicy();
    const rules = bannedRulesOf(read.policy, read.file);
    const lockfile = readJson('package-lock.json') as Lockfile;
    return findBannedPackages(inventoryFromLockfile(lockfile), rules).map(
      (hit) => `banned package ${hit.name}: ${hit.reason}`,
    );
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function lockstepProblems(workspaces: readonly string[]): readonly string[] {
  if (workspaces.length === 0) {
    return [];
  }
  const manifests = new Map<string, Manifest>([['.', readManifest('.')]]);
  for (const dir of workspaces) {
    manifests.set(dir, readManifest(dir));
  }
  return findLockstepDrift(manifests);
}

const publishTimes = new Map<string, Readonly<Record<string, string>>>();

/** When npm published name@version (npm view <name> time --json, read once per package). */
function publishedAt(name: string, version: string): string | null {
  if (!publishTimes.has(name)) {
    const result = run('npm', ['view', name, 'time', '--json'], '.');
    publishTimes.set(name, result.ok ? parsePublishTimes(result.stdout) : {});
  }
  return publishTimes.get(name)?.[version] ?? null;
}

const EXPO_CHECKS: readonly {
  readonly label: string;
  readonly args: readonly string[];
  readonly parse: (output: string) => readonly VersionMismatch[] | null;
}[] = [
  { label: 'expo install --check', args: ['expo', 'install', '--check'], parse: parseInstallCheck },
  { label: 'expo-doctor', args: ['expo-doctor'], parse: parseDoctor },
];

function expoFindings(apps: readonly string[], today: string, releaseAgeDays: number): Findings {
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const app of apps) {
    const where = app === '.' ? '' : `${app}: `;
    for (const check of EXPO_CHECKS) {
      const result = run('npx', check.args, app);
      const verdict = result.ok
        ? null
        : judgeMismatches(check.parse(result.output), publishedAt, {
            todayIso: today,
            releaseAgeDays,
          });
      if (verdict?.kind === 'young-patches') {
        const label = `${where}${check.label}`;
        const devDependencies = readManifest(app).devDependencies ?? {};
        const isDevTool = (name: string): boolean => Object.hasOwn(devDependencies, name);
        warnings.push(...youngPatchWarnings(label, verdict.patches, { releaseAgeDays, isDevTool }));
      } else if (verdict?.kind === 'due') {
        problems.push(`${where}${check.label} failed\n${result.output}`);
      }
    }
  }
  return { problems, warnings };
}

function installScriptProblems(): readonly string[] {
  const pending = run('npm', ['approve-scripts', '--allow-scripts-pending'], '.');
  return pending.output.includes(NO_PENDING)
    ? []
    : [
        `install scripts nobody reviewed: read each, then npm approve-scripts <pkg> and npm rebuild <pkg> (or npm deny-scripts <pkg>)\n${pending.output}`,
      ];
}

function main(): number {
  const workspaces = workspaceDirs();
  const npmrc = readFileSync('.npmrc', 'utf8');
  const expo = expoFindings(expoAppDirs(workspaces), todayIso(), releaseAgeDaysOf(npmrc));
  const root = readManifest('.');
  const problems = [
    ...releaseAgeProblems(npmrc),
    ...effectiveNpmConfigProblems(npmrc),
    ...enginesProblems(root),
    ...bannedProblems(),
    ...lockstepProblems(workspaces),
    ...expo.problems,
    ...installScriptProblems(),
    ...unpinnedApprovals(root.allowScripts),
  ];
  for (const warning of expo.warnings) {
    console.warn(`check-deps: ${warning}`);
  }
  for (const problem of problems) {
    console.error(`check-deps: ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
