// scripts/build/build-steps.ts
// The side effects of `npm run build:ios:sim`, one small function each: run a logged step, find the
// generated workspace, read the built Info.plist, drop DerivedData from another folder, poll the app
// until it is ready and take the screenshot. Proven by the simulator build itself (the skill's
// check-sim-app and check-screenshot); the decisions they take live in the tested pure modules.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { isStaleDerivedData, moduleCachePathIn } from './derived-data.ts';
import { READY_MAX_ATTEMPTS, READY_POLL_MS, readyReason } from './ready-signal.ts';
import { DERIVED_DATA_DIR, LOG_DIR, onlyScriptsRewritten } from './sim-build-plan.ts';

import type { ReadyMarker } from './sim-build-config.ts';
import type { Simctl } from '../ios/simulators.ts';

/** Where a step runs and with which environment (one env object for the whole run). */
export type StepContext = { readonly appDir: string; readonly env: NodeJS.ProcessEnv };
/** One child process: the file, its arguments, and whether it runs at the repo root. */
export type Command = {
  readonly file: string;
  readonly args: readonly string[];
  readonly atRoot?: boolean;
};

function tail(file: string, lines: number): string {
  return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
}

/** Runs one step with its output in build/ios-sim/logs/<step>.log; throws with the log's tail. */
export function runStep(name: string, command: Command, context: StepContext): void {
  const logDir = join(context.appDir, LOG_DIR);
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${name}.log`);
  const fd = openSync(logFile, 'w');
  console.log(`build:ios:sim: ${name} ...`);
  const result = spawnSync(command.file, command.args, {
    cwd: command.atRoot === true ? '.' : context.appDir,
    env: context.env,
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  if (result.status !== 0) {
    const status = String(result.status);
    throw new Error(
      `step "${name}" failed (exit ${status}), see ${logFile}:\n${tail(logFile, 30)}`,
    );
  }
}

/** The generated workspace, relative to the app folder (ios/<Scheme>.xcworkspace). */
export function findWorkspace(appDir: string): string {
  const iosDir = join(appDir, 'ios');
  const found = readdirSync(iosDir).find((entry) => entry.endsWith('.xcworkspace'));
  if (found === undefined) {
    throw new Error(`no .xcworkspace in ${iosDir}: the prebuild did not finish, see its log`);
  }
  return join('ios', found);
}

/** One value of a plist, through plutil (keyPath like CFBundleURLTypes.0.CFBundleURLSchemes.0). */
export function readPlistValue(plist: string, keyPath: string): string {
  return execFileSync('plutil', ['-extract', keyPath, 'raw', '-o', '-', plist], {
    encoding: 'utf8',
  }).trim();
}

function recordedDerivedDataPath(dd: string): string | null {
  const info = join(dd, 'info.plist');
  if (existsSync(info)) return readPlistValue(info, 'WorkspacePath');
  const cache = join(dd, 'ModuleCache.noindex');
  const folders = existsSync(cache) ? readdirSync(cache, { withFileTypes: true }) : [];
  for (const folder of folders.filter((entry) => entry.isDirectory())) {
    const pcm = readdirSync(join(cache, folder.name)).find((name) => name.endsWith('.pcm'));
    if (pcm !== undefined) {
      return moduleCachePathIn(readFileSync(join(cache, folder.name, pcm), 'latin1'));
    }
  }
  return null;
}

/** Deletes the app's DerivedData when it names another folder (a copied or moved repo). */
export function dropStaleDerivedData(appDir: string): void {
  const dd = join(appDir, DERIVED_DATA_DIR);
  if (!existsSync(dd)) return;
  const recorded = recordedDerivedDataPath(dd);
  const expected = recorded?.includes('ModuleCache.noindex') === true ? dd : join(appDir, 'ios');
  if (!isStaleDerivedData(recorded, resolve(expected))) return;
  rmSync(dd, { recursive: true, force: true });
  console.log(`build:ios:sim: removed ${dd}: it was built in another folder (${String(recorded)})`);
}

/** Writes package.json back when the prebuild only rewrote its ios and android scripts. */
export function keepPackageJson(path: string, before: string): void {
  const after = readFileSync(path, 'utf8');
  if (!onlyScriptsRewritten(before, after)) return;
  writeFileSync(path, before);
  console.log(
    `build:ios:sim: restored ${path}: the prebuild had rewritten its ios/android scripts`,
  );
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The ready marker's text inside the app's data container, or null. */
export function readMarker(simctl: Simctl, app: MarkerTarget): string | null {
  if (app.marker === null) return null;
  const container = simctl(['get_app_container', app.udid, app.bundleId, 'data']).trim();
  const file = join(container, app.marker.file);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** The running app a ready poll looks at. */
export type MarkerTarget = {
  readonly udid: string;
  readonly bundleId: string;
  readonly marker: ReadyMarker | null;
};

/** Polls every 500 ms (never a fixed sleep), keeps the last screenshot and says why it stopped. */
export function waitAndScreenshot(simctl: Simctl, app: MarkerTarget, out: string): string {
  mkdirSync(dirname(out), { recursive: true });
  let previous = '';
  for (let attempt = 1; attempt <= READY_MAX_ATTEMPTS; attempt += 1) {
    sleep(READY_POLL_MS);
    simctl(['io', app.udid, 'screenshot', out]);
    const current = readFileSync(out).toString('base64');
    const marker = readMarker(simctl, app);
    const contains = app.marker?.contains ?? null;
    const reason = readyReason({
      attempt,
      marker,
      contains,
      screenUnchanged: current === previous,
    });
    if (reason !== null) return reason;
    previous = current;
  }
  const seconds = String((READY_MAX_ATTEMPTS * READY_POLL_MS) / 1000);
  throw new Error(`the app was not ready after ${seconds} s; look at ${out}`);
}
