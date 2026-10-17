// scripts/e2e/capture-screenshots.ts
// `npm run screenshots:ios` / `npm run screenshots:android` (--help: screenshots-cli.ts). Captures the
// matrix flow (contracts/e2e.json screenshots.flow) on the repo's own devices for every device x
// light/dark x locale, compares each PNG with .maestro/baselines/<platform>/<device>/<locale>-<theme>
// [-largest]/<screen>.png (screenshot-compare.ts), and writes reports/screenshots/<platform>[-largest]/
// {summary.json, index.html}. That folder is emptied first, so a summary is always this run's, of
// this platform. A device that does not boot or a flow that fails becomes a capture-failed row and the
// next combination still runs. Exit 1 when anything changed or failed. Every capture names its
// device and a driver port of its own. --update writes baselines instead: narrow it, open every PNG,
// commit with Gate-Change.
import { copyFileSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { readE2eConfig, type E2eConfig } from './e2e-config.ts';
import {
  devicePurpose,
  isFormFactor,
  type Appearance,
  type BuiltApp,
  type E2eDevice,
  type FormFactor,
} from './e2e-device.ts';
import { appEnv, devicePorts, installMaestro, runMaestro } from './maestro-run.ts';
import { openDevice, readCheckedBuild } from './open-device.ts';
import { compareScreenshot } from './screenshot-compare.ts';
import {
  parseScreenshotsCli,
  SCREENSHOTS_USAGE,
  type ScreenshotsOptions,
} from './screenshots-cli.ts';
import {
  isChanged,
  isFailed,
  NEW_BASELINE,
  writeGallery,
  type GalleryRow,
} from './write-gallery.ts';

const BASELINES = join('.maestro', 'baselines');
const THEMES = ['light', 'dark'] as const;

type Capture = {
  readonly options: ScreenshotsOptions;
  readonly config: E2eConfig;
  readonly app: BuiltApp;
  readonly locales: readonly string[];
  /** reports/screenshots/<platform>[-largest]: this capture's summary, gallery, raw PNGs and diffs. */
  readonly out: string;
  /** The driver port of a device for this capture (devicePorts). */
  readonly portOf: (deviceId: string) => Promise<number>;
};
type Combo = { readonly device: FormFactor; readonly locale: string; readonly theme: Appearance };

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** <platform>/<device>/<locale>-<theme>[-largest]: one baseline set, and every label's start. */
function setDir(capture: Capture, combo: Combo): string {
  const suffix = capture.options.textSize === 'largest' ? '-largest' : '';
  return join(capture.options.platform, combo.device, `${combo.locale}-${combo.theme}${suffix}`);
}

/** Where Maestro writes one combination's log and screenshots. */
const rawDir = (capture: Capture, combo: Combo): string =>
  join(capture.out, 'raw', combo.device, `${combo.locale}-${combo.theme}`);

function failedRow(capture: Capture, combo: Combo, message: string): GalleryRow {
  const outDir = rawDir(capture, combo);
  const result = { kind: 'capture-failed', message, outDir } as const;
  return { label: setDir(capture, combo), actual: null, baseline: null, result };
}

async function shoot(capture: Capture, device: E2eDevice, combo: Combo): Promise<string[]> {
  const outDir = rawDir(capture, combo);
  rmSync(outDir, { recursive: true, force: true });
  const target = { id: device.id, driverPort: await capture.portOf(device.id) };
  device.pinStatusBar();
  const status = await runMaestro(capture.config.maestroBin, target, [
    ...['test', capture.config.screenshots.flow, '--test-output-dir', outDir],
    ...[...appEnv(capture.app), '-e', `LANG=${combo.locale}`, '-e', `THEME=${combo.theme}`],
  ]);
  if (status !== 0) throw new Error(`maestro exited ${String(status)}, see ${outDir}`);
  const pngs = globSync(join(outDir, '**', 'takeScreenshot', '*.png')).sort();
  if (pngs.length === 0) throw new Error(`maestro passed but took no screenshot, see ${outDir}`);
  return pngs;
}

function judge(capture: Capture, combo: Combo, actual: string): GalleryRow {
  const dir = setDir(capture, combo);
  const baseline = join(BASELINES, dir, basename(actual));
  const label = `${dir}/${basename(actual, '.png')}`;
  if (capture.options.isUpdate) {
    mkdirSync(join(BASELINES, dir), { recursive: true });
    copyFileSync(actual, baseline);
    return { label, actual, baseline, result: NEW_BASELINE };
  }
  const diffPath = join(
    capture.out,
    'diff',
    combo.device,
    `${combo.locale}-${combo.theme}`,
    basename(actual),
  );
  const result = compareScreenshot(readFileSync(actual), { baselinePath: baseline, diffPath });
  return { label, actual, baseline, result };
}

/** One combination's rows: its screenshots, or one capture-failed row. */
async function captureCombo(
  capture: Capture,
  device: E2eDevice,
  combo: Combo,
): Promise<GalleryRow[]> {
  try {
    return (await shoot(capture, device, combo)).map((actual) => judge(capture, combo, actual));
  } catch (error) {
    return [failedRow(capture, combo, errorText(error))];
  }
}

function combosOf(capture: Capture, formFactor: FormFactor): Combo[] {
  return THEMES.flatMap((theme) =>
    capture.locales.map((locale) => ({ device: formFactor, locale, theme })),
  );
}

async function captureDevice(capture: Capture, formFactor: FormFactor): Promise<GalleryRow[]> {
  const purpose = devicePurpose('shots', formFactor, capture.options.sim);
  let device: E2eDevice;
  try {
    device = await openDevice(capture.options.platform, capture.config, { purpose, formFactor });
    device.install(capture.app);
    device.pinStatusBar();
    device.setTextSize(capture.options.textSize);
  } catch (error) {
    const message = `the ${formFactor} device did not start: ${errorText(error)}`;
    return combosOf(capture, formFactor).map((combo) => failedRow(capture, combo, message));
  }
  const rows: GalleryRow[] = [];
  for (const theme of THEMES) {
    device.setAppearance(theme);
    for (const locale of capture.locales) {
      rows.push(...(await captureCombo(capture, device, { device: formFactor, locale, theme })));
    }
  }
  device.setTextSize('default');
  return rows;
}

/** The parsed command line with the contract's defaults, or the exit code (help, usage error). */
function startCapture(): Capture | number {
  const parsed = parseScreenshotsCli(process.argv.slice(2));
  if (parsed.kind !== 'run') {
    if (parsed.kind === 'help') console.log(SCREENSHOTS_USAGE);
    else console.error(`screenshots: ${parsed.message}\n${SCREENSHOTS_USAGE.split('\n')[0] ?? ''}`);
    return parsed.kind === 'help' ? 0 : 2;
  }
  const { options } = parsed;
  const config = readE2eConfig('.');
  const locales = options.locales ?? config.screenshots.locales;
  if (locales.length === 0)
    throw new Error('screenshots: contracts/e2e.json screenshots.locales is empty');
  const app = readCheckedBuild(options.platform, config, options.appPath);
  const folder = `${options.platform}${options.textSize === 'largest' ? '-largest' : ''}`;
  const out = join('reports', 'screenshots', folder);
  return { options, config, app, locales, out, portOf: devicePorts(options.driverPort) };
}

async function main(): Promise<number> {
  const capture = startCapture();
  if (typeof capture === 'number') return capture;
  // This platform's previous summary, gallery, raw PNGs and diffs go first: a capture that stops
  // early must never leave the last run's summary behind as if it were this one's.
  rmSync(capture.out, { recursive: true, force: true });
  mkdirSync(capture.out, { recursive: true });
  installMaestro();
  const devices =
    capture.options.devices ?? capture.config.screenshots.devices.filter(isFormFactor);
  const rows: GalleryRow[] = [];
  for (const device of devices) rows.push(...(await captureDevice(capture, device)));
  writeFileSync(join(capture.out, 'summary.json'), `${JSON.stringify(rows, null, 2)}\n`);
  const changed = rows.filter(({ result }) => isChanged(result)).length;
  const failed = rows.filter(({ result }) => isFailed(result));
  const gallery = writeGallery(capture.out, rows);
  for (const { label, result } of failed) {
    if (isFailed(result)) console.error(`capture failed: ${label}: ${result.message}`);
  }
  const counts = `${String(rows.length - failed.length)} screenshots, ${String(changed)} changed`;
  console.log(`${counts}, ${String(failed.length)} combinations failed; gallery: ${gallery}`);
  return changed === 0 && failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(errorText(error));
    process.exitCode = 2;
  });
