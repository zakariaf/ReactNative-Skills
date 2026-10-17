// scripts/build/sim-build-plan.ts
// The pure parts of `npm run build:ios:sim`: the prebuild and xcodebuild arguments, where the build,
// the logs and the screenshots go, the preflight of every npm script the build runs, and the Maestro
// line of --link.
import { join } from 'node:path';

import { maestroGlobalArgs } from '../e2e/maestro-args.ts';

import type { LinkRequest, SimBuildOptions } from './sim-build-args.ts';
import type { SimBuildConfig } from './sim-build-config.ts';

/** Every build starts from a clean prebuild: ios/ is generated, git-ignored and never edited. */
export const PREBUILD_ARGS = ['expo', 'prebuild', '--platform', 'ios', '--clean'] as const;
/** DerivedData inside the app folder (git-ignored build/, easy to delete). */
export const DERIVED_DATA_DIR = join('build', 'ios-sim', 'dd');
/** One log per step: build/ios-sim/logs/<step>.log. */
export const LOG_DIR = join('build', 'ios-sim', 'logs');
/** Screenshots for the reviewer (git-ignored reports/). */
export const REPORT_DIR = join('reports', 'ios-sim');

/** The npm scripts `expo prebuild` rewrites: 'expo start --ios' becomes 'expo run:ios' (@expo/cli 57). */
const PREBUILD_REWRITTEN_SCRIPTS = new Set(['ios', 'android']);

function withoutRewrittenScripts(text: string): string {
  const pkg = JSON.parse(text) as { readonly scripts?: Readonly<Record<string, string>> };
  const scripts = Object.entries(pkg.scripts ?? {}).filter(
    ([name]) => !PREBUILD_REWRITTEN_SCRIPTS.has(name),
  );
  return JSON.stringify({ ...pkg, scripts: Object.fromEntries(scripts) });
}

/**
 * True when package.json after the prebuild (`after`) differs from `before` only in the ios and
 * android scripts: the build then writes `before` back, so a smoke build leaves the repo clean. Any
 * other change stays for the developer to review.
 */
export function onlyScriptsRewritten(before: string, after: string): boolean {
  return before !== after && withoutRewrittenScripts(before) === withoutRewrittenScripts(after);
}

/** `ios/Tasks.xcworkspace` -> `Tasks` (the scheme comes from expo.name without spaces). */
export function schemeOf(workspaceFile: string): string {
  const name = workspaceFile.split('/').at(-1) ?? '';
  if (!name.endsWith('.xcworkspace')) {
    throw new Error(`${workspaceFile} is not an .xcworkspace`);
  }
  return name.slice(0, -'.xcworkspace'.length);
}

/** What xcodebuild builds, and for which simulator. */
export type SimTarget = {
  readonly workspace: string;
  readonly scheme: string;
  readonly udid: string;
};

/** Release (the embedded Hermes bundle users run), simulator SDK, this UDID, arm64, no signing. */
export function xcodebuildSimArgs(target: SimTarget): string[] {
  return [
    ...['-workspace', target.workspace, '-scheme', target.scheme],
    ...['-configuration', 'Release', '-sdk', 'iphonesimulator'],
    ...['-destination', `id=${target.udid}`, '-derivedDataPath', DERIVED_DATA_DIR],
    ...['ONLY_ACTIVE_ARCH=YES', 'ARCHS=arm64', 'CODE_SIGNING_ALLOWED=NO', 'build'],
  ];
}

/** Where xcodebuild puts the .app of `scheme`. */
export function builtAppPath(appDir: string, scheme: string): string {
  return join(
    appDir,
    DERIVED_DATA_DIR,
    'Build',
    'Products',
    'Release-iphonesimulator',
    `${scheme}.app`,
  );
}

/** reports/ios-sim/<purpose>-<variant>.png */
export function screenshotPath(options: Pick<SimBuildOptions, 'purpose' | 'variant'>): string {
  return join(REPORT_DIR, `${options.purpose}-${options.variant}.png`);
}

/** The screenshot taken after --link, next to the launch screenshot. */
export function linkScreenshotPath(options: Pick<SimBuildOptions, 'purpose' | 'variant'>): string {
  return screenshotPath(options).replace(/\.png$/, '-link.png');
}

/** The repo files an npm script runs: every path-like word ending in .ts, .mts, .js or .mjs. */
export function scriptTargetsOf(command: string): string[] {
  return command
    .split(/\s+/)
    .filter((word) => /^[\w@.-]+(\/[\w@.-]+)+\.(ts|mts|js|mjs)$/.test(word));
}

/**
 * The preflight, before the slow and destructive clean prebuild: every npm script the build runs
 * exists and points at files that exist. One line per problem; empty when the build may start.
 */
export function buildScriptProblems(
  scripts: Readonly<Record<string, string>>,
  names: readonly string[],
  exists: (repoPath: string) => boolean,
): string[] {
  return names.flatMap((name) => {
    const command = scripts[name];
    if (command === undefined) {
      return [`package.json has no "${name}" script, and the build runs it after every prebuild`];
    }
    return scriptTargetsOf(command)
      .filter((target) => !exists(target))
      .map((target) => `"${name}" runs ${target}, which does not exist`);
  });
}

/** What --link needs before the build starts: the Maestro sub-flow (e2e-maestro creates it). */
export function linkProblems(
  options: Pick<SimBuildOptions, 'link'>,
  config: Pick<SimBuildConfig, 'linkFlow'>,
  exists: (path: string) => boolean,
): string[] {
  if (options.link === null || exists(config.linkFlow)) return [];
  return [`--link runs ${config.linkFlow}, which does not exist (e2e-maestro creates it)`];
}

/** Everything the --link Maestro run needs. */
export type LinkRun = {
  readonly udid: string;
  /** This run's own Maestro driver port (freeDriverPort() or --driver-port). */
  readonly driverPort: number;
  readonly bundleId: string;
  readonly scheme: string;
  readonly link: LinkRequest;
  readonly flow: string;
  readonly outDir: string;
};

/** The Maestro arguments: the device and this run's driver port first, then the sub-flow. */
export function linkSetupArgs(run: LinkRun): string[] {
  return [
    ...maestroGlobalArgs({ udid: run.udid, driverPort: run.driverPort }),
    ...['test', run.flow, '--test-output-dir', run.outDir],
    ...['-e', `APP_ID=${run.bundleId}`, '-e', `LINK=${run.scheme}://${run.link.path}`],
    ...['-e', `WAIT_FOR=${run.link.waitFor}`],
  ];
}

/** Maestro with Java 17 and no analytics, update check or analysis prompt. */
export function maestroEnvOf(env: NodeJS.ProcessEnv, javaHome: () => string): NodeJS.ProcessEnv {
  const given: unknown = env['JAVA_HOME'];
  return {
    ...env,
    JAVA_HOME: typeof given === 'string' && given !== '' ? given : javaHome(),
    MAESTRO_CLI_NO_ANALYTICS: 'true',
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    MAESTRO_DISABLE_UPDATE_CHECK: 'true',
  };
}
