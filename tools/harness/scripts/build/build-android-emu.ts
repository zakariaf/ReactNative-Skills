// scripts/build/build-android-emu.ts
// CLI: npm run build:android:emu -- [--variant development|preview|production] [--emu <purpose>]
//      [--app-dir <dir>] [--abi arm64-v8a|x86_64] [--link <path>] [--keep-emulator]   (--help: usage)
// Preflight (every npm script the build runs exists; exit 2 before anything is touched), JDK 17 and
// the Android SDK selected per process and their packages checked, the variant exported once for the
// whole run, a clean prebuild, the post-prebuild scripts, a Release APK for one ABI (debug-keystore
// signed, no daemon left behind), then the AVD <prefix>-<purpose> found or created and started on a
// free console port, a fresh install, a cold start, a wait until ready and a screenshot, all by
// serial. With --link it opens a deep link with an adb VIEW intent and screenshots that screen too.
// Every step logs to build/android-emu/logs/<step>.log; the first failing step stops the run (exit 1).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EMU_BUILD_USAGE, isHelpRequest, parseEmuBuildArgs } from './emu-build-args.ts';
import { readEmuBuildConfig } from './emu-build-config.ts';
import {
  buildScriptProblems,
  builtApkPath,
  deepLinkArgs,
  gradleReleaseArgs,
  keptApkPath,
  linkScreenshotPath,
  mergedManifestPath,
  PREBUILD_ARGS,
  schemeOf,
  screenshotPath,
} from './emu-build-plan.ts';
import {
  ensureAvd,
  ensureEmulator,
  keepPackageJson,
  runStep,
  waitAndScreenshot,
  type EmuTools,
  type StepContext,
} from './emu-build-steps.ts';
import { variantEnv } from '../../src/config/app-variant.ts';
import {
  avdName,
  createAdb,
  installFresh,
  launchApp,
  prepareForScreenshots,
  stopOwnEmulator,
} from '../android/emulators.ts';
import {
  hostAbi,
  sdkTool,
  selectToolchain,
  systemImageFor,
  type AndroidAbi,
} from '../android/toolchain.ts';

import type { EmuBuildOptions } from './emu-build-args.ts';
import type { EmuBuildConfig } from './emu-build-config.ts';

/** The repo is not ready for a build (exit 2): nothing was prebuilt, built or launched. */
class PreflightError extends Error {}

type Run = {
  readonly options: EmuBuildOptions;
  readonly config: EmuBuildConfig;
  readonly abi: AndroidAbi;
};
type Built = { readonly apk: string; readonly packageName: string; readonly manifest: string };

function preflight({ options, config }: Run): void {
  if (!existsSync(join(options.appDir, 'app.config.ts'))) {
    throw new PreflightError(`${options.appDir}/app.config.ts not found: run from the repo root`);
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    readonly scripts?: Record<string, string>;
  };
  const problems = buildScriptProblems(pkg.scripts ?? {}, config.postPrebuild, (path) =>
    existsSync(path),
  );
  if (problems.length > 0) {
    throw new PreflightError(`preflight failed, nothing was built:\n  ${problems.join('\n  ')}`);
  }
}

function applicationIdOf(appDir: string): string {
  const gradle = readFileSync(join(appDir, 'android', 'app', 'build.gradle'), 'utf8');
  const id = /applicationId\s+['"]([^'"]+)['"]/.exec(gradle)?.[1];
  if (id === undefined)
    throw new Error('android/app/build.gradle has no applicationId: see the prebuild log');
  return id;
}

function buildApk({ options, config, abi }: Run, context: StepContext): Built {
  const packageJson = join(context.appDir, 'package.json');
  const before = readFileSync(packageJson, 'utf8');
  runStep('prebuild', { file: 'npx', args: PREBUILD_ARGS }, context);
  keepPackageJson(packageJson, before);
  for (const name of config.postPrebuild) {
    runStep(
      name.replaceAll(':', '-'),
      { file: 'npm', args: ['run', '-s', name], cwd: 'root' },
      context,
    );
  }
  runStep('gradle', { file: './gradlew', args: gradleReleaseArgs(abi), cwd: 'android' }, context);
  const apk = keptApkPath(context.appDir, options.variant);
  mkdirSync(dirname(apk), { recursive: true });
  copyFileSync(builtApkPath(context.appDir), apk);
  const manifest = readFileSync(mergedManifestPath(context.appDir), 'utf8');
  return { apk, packageName: applicationIdOf(context.appDir), manifest };
}

function toolsOf(env: NodeJS.ProcessEnv, androidHome: string): EmuTools {
  const adbPath = sdkTool(androidHome, 'adb');
  return {
    adb: createAdb(adbPath, env),
    adbPath,
    emulatorPath: sdkTool(androidHome, 'emulator'),
    avdmanagerPath: sdkTool(androidHome, 'avdmanager'),
    env,
  };
}

function openLink(tools: EmuTools, run: Run, launched: Built & { readonly serial: string }): void {
  if (run.options.link === null) return;
  const scheme = schemeOf(launched.manifest);
  if (scheme === null) throw new Error('--link: the merged manifest declares no app scheme');
  tools.adb(deepLinkArgs(launched.serial, `${scheme}://${run.options.link}`, launched.packageName));
  const out = linkScreenshotPath(run.options);
  waitAndScreenshot(
    tools,
    { serial: launched.serial, packageName: launched.packageName, readyLog: null },
    out,
  );
  console.log(`build:android:emu: link screenshot ${out}; open it and look at it`);
}

function runOnEmulator(tools: EmuTools, run: Run, built: Built): void {
  const name = avdName(run.config.avdPrefix, run.options.purpose);
  const { serial, isStartedHere } = ensureEmulator(tools, name, run.options.appDir);
  try {
    prepareForScreenshots(tools.adb, serial);
    installFresh(tools.adb, serial, built);
    launchApp(tools.adb, serial, built.packageName);
    const out = screenshotPath(run.options);
    const target = { serial, packageName: built.packageName, readyLog: run.config.readyLog };
    const reason = waitAndScreenshot(tools, target, out);
    console.log(`build:android:emu: ready (${reason}) on ${name} ${serial}; screenshot ${out}`);
    console.log(
      'build:android:emu: open the screenshot and look at it: white or black means the app failed.',
    );
    openLink(tools, run, { ...built, serial });
  } finally {
    if (isStartedHere && !run.options.keepEmulator)
      stopOwnEmulator(tools.adb, serial, run.config.avdPrefix);
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  if (isHelpRequest(argv)) {
    console.log(EMU_BUILD_USAGE);
    return 0;
  }
  const options = parseEmuBuildArgs(argv);
  const run: Run = {
    options,
    config: readEmuBuildConfig('.'),
    abi: options.abi ?? hostAbi(process.arch),
  };
  preflight(run);
  const systemImage = run.config.systemImage ?? systemImageFor(run.abi);
  const toolchain = selectToolchain(process.env, systemImage);
  // One environment for every step: prebuild, the app.config task and Metro all read the variant.
  const env = { ...toolchain.env, ...variantEnv(options.variant) };
  const tools = toolsOf(env, toolchain.androidHome);
  const context = { appDir: options.appDir, env };
  const name = avdName(run.config.avdPrefix, options.purpose);
  ensureAvd(tools, { name, systemImage, device: run.config.device }, context);
  const built = buildApk(run, context);
  console.log(
    `build:android:emu: ${options.variant} APK ${built.apk} (${built.packageName}, ${run.abi})`,
  );
  runOnEmulator(tools, run, built);
  return 0;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  console.error(`build:android:emu: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof PreflightError ? 2 : 1;
}
