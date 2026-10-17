// scripts/design-review/capture-sweep.ts (example shape, not a template: adapt it to the app's runner)
// The loop of a sweep, built from the two templates. Each device is swept on its own (the devices run
// in parallel: each is its own simulator or emulator with its own Maestro driver port). Per
// combination: the appearance and text size, then the combination link. Per cell: one Maestro run
// that opens the state and waits for its root testID, then the runner's own upright screenshot on the
// named device (screenshotCommands). A device stops at its first failing command, so a half sweep
// never looks complete. Maestro's start-up dominates the time: about 11 to 15 s a cell was measured
// for this shape (references/sweep-matrix.md, the cost of a sweep).
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  appearanceCommand,
  cleanStatusBarCommands,
  maestroOrientation,
  orientationCommands,
  resetOrientationCommands,
  resetStatusBarCommands,
  screenshotCommands,
  textSizeCommand,
  type DeviceCommand,
  type DeviceTarget,
  type Orientation,
} from './device-settings.ts';
import {
  captureCombinations,
  combinationQuery,
  type CaptureCombination,
  type ReviewPlan,
  type SweptScreen,
  VIDEO_QUERY,
} from './review-cells.ts';
import { freeDriverPort, maestroGlobalArgs } from '../e2e/maestro-args.ts';

const execFileAsync = promisify(execFile);

type SweepContext = {
  /** The bundle id or package of the swept (preview) build. */
  readonly appId: string;
  readonly scheme: string;
  readonly reviewId: string;
  /** plan device id -> the simulator UDID or emulator serial this run created. */
  readonly targets: ReadonlyMap<string, DeviceTarget>;
  /** plan device id -> its natural orientation when that is landscape (the medium_tablet AVD). */
  readonly natural: ReadonlyMap<string, Orientation>;
  /** screen id -> the root testID that proves the screen is shown (from contracts/screens.json). */
  readonly roots: ReadonlyMap<string, string>;
  /** The root testID of the first screen, shown after a combination link. */
  readonly homeRoot: string;
};

async function runCommand(command: DeviceCommand): Promise<void> {
  const [file = '', ...args] = command.argv;
  const { stdout } = await execFileAsync(file, args, {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (command.stdoutTo !== undefined) await writeFile(command.stdoutTo, stdout);
}

async function runAll(commands: readonly DeviceCommand[] | null): Promise<void> {
  for (const command of commands ?? []) await runCommand(command);
}

type DeviceRun = {
  readonly context: SweepContext;
  readonly target: DeviceTarget;
  readonly driverPort: number;
  readonly orientation: Orientation;
};

/** One Maestro run: open the link, wait for the root testID and for animations to end. */
async function openAndWait(run: DeviceRun, link: string, root: string): Promise<void> {
  const udid = run.target.platform === 'ios' ? run.target.udid : run.target.serial;
  const env = {
    APP_ID: run.context.appId,
    LINK: link,
    ROOT: root,
    ORIENTATION: maestroOrientation(run.orientation),
  };
  await execFileAsync('maestro', [
    ...maestroGlobalArgs({ udid, driverPort: run.driverPort }),
    'test',
    '.maestro/design-review/open-cell.yaml',
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
  ]);
}

async function sweepDevice(
  combinations: readonly CaptureCombination[],
  context: SweepContext,
): Promise<void> {
  const device = combinations[0]?.device;
  if (device === undefined) return;
  const target = context.targets.get(device.id);
  if (target === undefined) throw new Error(`no device created for ${device.id}`);
  const run: DeviceRun = {
    context,
    target,
    driverPort: await freeDriverPort(),
    orientation: device.orientation ?? 'portrait',
  };
  const link = (open: string): string =>
    open.startsWith('/') ? `${context.scheme}:/${open}` : `${context.scheme}://debug/setup?${open}`;
  await runAll(cleanStatusBarCommands(target));
  await runAll(orientationCommands(target, run.orientation, context.natural.get(device.id)));
  for (const combination of combinations) {
    await runCommand(appearanceCommand(target, combination.theme));
    await runCommand(textSizeCommand(target, combination.textSize));
    await openAndWait(run, link(combinationQuery(combination.locale)), context.homeRoot);
    for (const shot of combination.cells) {
      const root = context.roots.get(shot.cell.screen) ?? '';
      await openAndWait(run, link(shot.open), root);
      await runAll(screenshotCommands(target, shot.file, run.orientation));
    }
  }
  // Before any motion video (recorded after the stills, references/capture-recipes.md): motion back
  // to the system setting, because the stills' motion=still is a saved override; then the full take,
  // then the reduced take with the system's Reduce Motion on (reduceMotionCommands; iOS by hand).
  await openAndWait(run, link(VIDEO_QUERY), context.homeRoot);
  await runAll(resetStatusBarCommands(target));
  await runAll(resetOrientationCommands(target));
}

export async function captureSweep(
  plan: ReviewPlan,
  screens: readonly SweptScreen[],
  context: SweepContext,
): Promise<void> {
  const byDevice = new Map<string, CaptureCombination[]>();
  for (const combination of captureCombinations(plan, screens, context.reviewId)) {
    const id = combination.device.id;
    byDevice.set(id, [...(byDevice.get(id) ?? []), combination]);
  }
  await Promise.all([...byDevice.values()].map((group) => sweepDevice(group, context)));
}
