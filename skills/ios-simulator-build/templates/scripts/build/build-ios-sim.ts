// scripts/build/build-ios-sim.ts
// CLI: npm run build:ios:sim -- [--variant development|preview|production] [--sim <purpose>]
//      [--app-dir <dir>] [--link <path> --wait-for <testID> [--driver-port <n>]]   (--help: usage)
// Preflight (every npm script the build runs exists; exit 2 before anything is touched), DerivedData
// from another folder dropped, the pinned Xcode selected through DEVELOPER_DIR, the variant exported
// once for the whole run, a clean prebuild, the post-prebuild scripts, a Release simulator build (no
// signing), then install, launch, wait until ready and screenshot on <prefix>-<purpose> by UDID. With
// --link it opens a deep link through a Maestro sub-flow (iOS answers `simctl openurl` with an "Open
// in ...?" prompt nobody accepts) and screenshots that screen too. Every step logs to
// build/ios-sim/logs/<step>.log; the first failing step stops the run (exit 1).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  dropStaleDerivedData,
  findWorkspace,
  keepPackageJson,
  readPlistValue,
  runStep,
  waitAndScreenshot,
  type StepContext,
} from './build-steps.ts';
import { isHelpRequest, parseSimBuildArgs, SIM_BUILD_USAGE } from './sim-build-args.ts';
import { readSimBuildConfig } from './sim-build-config.ts';
import {
  buildScriptProblems,
  builtAppPath,
  linkProblems,
  linkScreenshotPath,
  linkSetupArgs,
  LOG_DIR,
  maestroEnvOf,
  PREBUILD_ARGS,
  schemeOf,
  screenshotPath,
  xcodebuildSimArgs,
} from './sim-build-plan.ts';
import { variantEnv } from '../../src/config/app-variant.ts';
import { freeDriverPort } from '../e2e/maestro-args.ts';
import {
  bootForScreenshots,
  createSimctl,
  ensureSimulator,
  installAndLaunch,
  simulatorName,
  type AppOnDisk,
  type Simctl,
} from '../ios/simulators.ts';
import { IOS_RUNTIME, selectXcode } from '../ios/toolchain.ts';

import type { SimBuildOptions } from './sim-build-args.ts';
import type { SimBuildConfig } from './sim-build-config.ts';

/** The repo is not ready for a build (exit 2): nothing was prebuilt, built or launched. */
class PreflightError extends Error {}

type Run = { readonly options: SimBuildOptions; readonly config: SimBuildConfig };
type Launched = AppOnDisk & { readonly udid: string; readonly env: NodeJS.ProcessEnv };

function preflight({ options, config }: Run): void {
  if (!existsSync(join(options.appDir, 'app.config.ts'))) {
    throw new PreflightError(`${options.appDir}/app.config.ts not found: run from the repo root`);
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    readonly scripts?: Record<string, string>;
  };
  const exists = (path: string): boolean => existsSync(path);
  const problems = [
    ...buildScriptProblems(pkg.scripts ?? {}, config.postPrebuild, exists),
    ...linkProblems(options, config, exists),
  ];
  if (problems.length > 0) {
    throw new PreflightError(`preflight failed, nothing was built:\n  ${problems.join('\n  ')}`);
  }
}

function buildApp({ config }: Run, context: StepContext, udid: string): AppOnDisk {
  const packageJson = join(context.appDir, 'package.json');
  const before = readFileSync(packageJson, 'utf8');
  runStep('prebuild', { file: 'npx', args: PREBUILD_ARGS }, context);
  keepPackageJson(packageJson, before);
  for (const name of config.postPrebuild) {
    runStep(
      name.replaceAll(':', '-'),
      { file: 'npm', args: ['run', '-s', name], atRoot: true },
      context,
    );
  }
  const workspace = findWorkspace(context.appDir);
  const scheme = schemeOf(workspace);
  const args = xcodebuildSimArgs({ workspace, scheme, udid });
  runStep('xcodebuild', { file: 'xcodebuild', args }, context);
  const path = builtAppPath(context.appDir, scheme);
  return { path, bundleId: readPlistValue(join(path, 'Info.plist'), 'CFBundleIdentifier') };
}

function javaHome(): string {
  const found = spawnSync('/usr/libexec/java_home', ['-v', '17'], { encoding: 'utf8' });
  if (found.status !== 0) throw new Error('--link needs Java 17 for Maestro (set JAVA_HOME)');
  return found.stdout.trim();
}

async function openLinkAndScreenshot(
  simctl: Simctl,
  app: Launched,
  { options, config }: Run,
): Promise<void> {
  if (options.link === null) return;
  const scheme = readPlistValue(
    join(app.path, 'Info.plist'),
    'CFBundleURLTypes.0.CFBundleURLSchemes.0',
  );
  const driverPort = options.driverPort ?? (await freeDriverPort());
  const outDir = join(options.appDir, LOG_DIR, 'link');
  const args = linkSetupArgs({
    ...app,
    driverPort,
    scheme,
    link: options.link,
    flow: config.linkFlow,
    outDir,
  });
  console.log(`build:ios:sim: maestro on ${app.udid}, driver port ${String(driverPort)}`);
  const context = { appDir: options.appDir, env: maestroEnvOf(app.env, javaHome) };
  runStep('link', { file: config.maestroBin, args, atRoot: true }, context);
  const out = linkScreenshotPath(options);
  waitAndScreenshot(simctl, { udid: app.udid, bundleId: app.bundleId, marker: null }, out);
  console.log(`build:ios:sim: link screenshot ${out}; open it and look at it`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (isHelpRequest(argv)) {
    console.log(SIM_BUILD_USAGE);
    return 0;
  }
  const run: Run = { options: parseSimBuildArgs(argv), config: readSimBuildConfig('.') };
  const { options, config } = run;
  preflight(run);
  dropStaleDerivedData(options.appDir);
  // One environment for every step: prebuild, the Constants phase and Metro all read the variant.
  const env = { ...selectXcode(process.env), ...variantEnv(options.variant) };
  const simctl = createSimctl(env);
  const name = simulatorName(config.simulatorPrefix, options.purpose);
  const udid = ensureSimulator(simctl, {
    name,
    deviceType: config.deviceType,
    runtime: IOS_RUNTIME,
  });
  const app = buildApp(run, { appDir: options.appDir, env }, udid);
  bootForScreenshots(simctl, udid);
  installAndLaunch(simctl, udid, app);
  const out = screenshotPath(options);
  const reason = waitAndScreenshot(
    simctl,
    { udid, bundleId: app.bundleId, marker: config.readyMarker },
    out,
  );
  console.log(`build:ios:sim: ${options.variant} app ${app.path}`);
  console.log(`build:ios:sim: ready (${reason}) on ${name} ${udid}; screenshot ${out}`);
  console.log(
    'build:ios:sim: open the screenshot and look at it: white or black means the app failed.',
  );
  await openLinkAndScreenshot(simctl, { ...app, udid, env }, run);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  console.error(`build:ios:sim: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof PreflightError ? 2 : 1;
}
