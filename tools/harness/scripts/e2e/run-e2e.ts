// scripts/e2e/run-e2e.ts
// `npm run e2e:ios` / `npm run e2e:android` (node scripts/e2e/run-e2e.ts --platform <p> ...; --help
// prints every option, e2e-cli.ts). Refuses a Debug or production build before it touches a device
// (build-guard.ts), installs the pinned Maestro, then, while one socket sampler per device of the run
// watches the app's sockets (sample-sockets.ts; contracts/e2e.json "network"), on the repo's own
// devices (<prefix>-e2e-phone and -tablet, or this session's --sim <purpose>):
// 1. flows: every .maestro/flows/<area>/*.yaml (Maestro runs only a folder's top level, so each file
//    is listed), quarantined and a11y flows excluded;
// 2. large text: the a11y flows at the largest text size in each contracts/e2e.json largeText locale,
//    on the phone and the tablet.
// Every Maestro run names its device and a driver port of its own before the command (maestro-run.ts).
// At the end it proves every sampler watched until then (sampler-evidence.ts: network-samplers.json).
// Writes reports/e2e/<platform>/{junit.xml, network.txt, network-samplers.json, run.json,
// large-text/<device>-<locale>/}.
// Exit 0 when everything passed, 1 for a failed flow, a disallowed socket or a sampler that was not
// watching, 2 for bad input.
import { spawn } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { E2E_USAGE, parseE2eCli, type E2eOptions } from './e2e-cli.ts';
import { readE2eConfig, type E2eConfig } from './e2e-config.ts';
import { devicePurpose, type BuiltApp, type E2eDevice } from './e2e-device.ts';
import { appEnv, devicePorts, installMaestro, reportArgs, runMaestro } from './maestro-run.ts';
import { openDevice, readCheckedBuild } from './open-device.ts';
import { proveSamplersAlive, trackSampler, type RunningSampler } from './sampler-evidence.ts';

const SOCKET_SAMPLER = join('scripts', 'e2e', 'sample-sockets.ts');
const FLOWS = join('.maestro', 'flows', '*', '*.yaml');
const A11Y_FLOWS = join('.maestro', 'flows', 'a11y', '*.yaml');
/** Long enough for two more samples (one a second): a live sampler's count grows meanwhile. */
const LIVENESS_WAIT_MS = 2500;

type Run = {
  readonly options: E2eOptions;
  readonly config: E2eConfig;
  readonly app: BuiltApp;
  readonly phone: E2eDevice;
  readonly out: string;
  /** The driver port of a device for this run (devicePorts). */
  readonly portOf: (deviceId: string) => Promise<number>;
  /** Records a device of this run and starts its socket sampler (the tablet of step 2). */
  readonly watch: (device: E2eDevice) => void;
};

/**
 * One sampler per device, each naming its device: other sessions run the same app on theirs.
 * `stop` proves each one watched until the end, then stops them; it returns the failure lines.
 */
function socketSamplers(app: BuiltApp, config: E2eConfig, network: string) {
  const samplers: RunningSampler[] = [];
  const devices: { readonly name: string; readonly id: string }[] = [];
  return {
    devices,
    watch: (device: E2eDevice): void => {
      devices.push({ name: device.name, id: device.id });
      if (config.network.mode === 'off') return;
      const hosts = config.network.allowHosts.join(',');
      const args = [
        SOCKET_SAMPLER,
        device.platform,
        config.network.mode,
        device.id,
        app.executable,
        network,
        hosts,
      ];
      const child = spawn(process.execPath, args, { stdio: 'inherit' });
      samplers.push(trackSampler(device, child));
    },
    stop: async (): Promise<string[]> => {
      if (config.network.mode === 'off') return [];
      return proveSamplersAlive(samplers, network, () => delay(LIVENESS_WAIT_MS));
    },
  };
}

const deviceTarget = async (run: Run, device: E2eDevice) => ({
  id: device.id,
  driverPort: await run.portOf(device.id),
});

/** Step 1: every flow of .maestro/flows/<area>/, except quarantined and a11y ones. */
async function runFlows(run: Run): Promise<string[]> {
  const flows = globSync(FLOWS).sort();
  if (flows.length === 0) return [`flows: no flow in ${FLOWS}`];
  const filter =
    run.options.includeTags === null ? [] : ['--include-tags', run.options.includeTags];
  // Again right before Maestro: a freshly booted emulator's SystemUI can drop the first demo broadcasts.
  run.phone.pinStatusBar();
  const status = await runMaestro(run.config.maestroBin, await deviceTarget(run, run.phone), [
    ...['test', ...flows, ...reportArgs(run.out)],
    ...['--exclude-tags', 'quarantine,a11y', ...filter, ...appEnv(run.app)],
  ]);
  return status === 0 ? [] : [`flows: maestro test exited ${String(status)}, see ${run.out}`];
}

/** Step 2 on one device: the a11y flows at the largest text size, once per locale. */
async function largeTextOn(
  run: Run,
  device: E2eDevice,
  flows: readonly string[],
): Promise<string[]> {
  const failures: string[] = [];
  device.setTextSize('largest');
  device.pinStatusBar();
  for (const locale of run.config.largeTextLocales) {
    const dir = join(
      run.out,
      'large-text',
      `${device === run.phone ? 'phone' : 'tablet'}-${locale}`,
    );
    mkdirSync(dir, { recursive: true });
    const status = await runMaestro(run.config.maestroBin, await deviceTarget(run, device), [
      ...['test', ...flows, ...reportArgs(dir), '--include-tags', 'a11y'],
      ...['--exclude-tags', 'quarantine', ...appEnv(run.app), '-e', `LANG=${locale}`],
    ]);
    if (status !== 0) failures.push(`large text: ${device.name} ${locale} failed, see ${dir}`);
  }
  device.setTextSize('default');
  return failures;
}

/** Step 2: the phone, then the tablet (created on first use). */
async function runLargeText(run: Run): Promise<string[]> {
  const flows = globSync(A11Y_FLOWS).sort();
  if (flows.length === 0) return [];
  if (run.config.largeTextLocales.length === 0) {
    return ['large text: a11y flows exist but contracts/e2e.json largeText.locales is empty'];
  }
  const failures = await largeTextOn(run, run.phone, flows);
  run.phone.terminate(run.app);
  const purpose = devicePurpose('e2e', 'tablet', run.options.sim);
  const tablet = await openDevice(run.options.platform, run.config, {
    purpose,
    formFactor: 'tablet',
  });
  run.watch(tablet);
  tablet.install(run.app);
  tablet.pinStatusBar();
  tablet.setAppearance('light');
  failures.push(...(await largeTextOn(run, tablet, flows)));
  tablet.terminate(run.app);
  return failures;
}

/** Checks the build, installs Maestro, prepares the phone and empties reports/e2e/<platform>/. */
async function startRun(options: E2eOptions): Promise<Omit<Run, 'watch' | 'portOf'>> {
  const config = readE2eConfig('.');
  const app = readCheckedBuild(options.platform, config, options.appPath);
  installMaestro();
  const purpose = devicePurpose('e2e', 'phone', options.sim);
  const phone = await openDevice(options.platform, config, { purpose, formFactor: 'phone' });
  phone.install(app);
  phone.pinStatusBar();
  phone.setTextSize('default');
  phone.setAppearance('light');
  const out = join('reports', 'e2e', options.platform);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  console.log(`e2e: ${phone.name} ${phone.id}; every Maestro run names this device`);
  return { options, config, app, phone, out };
}

/** What check-e2e-report needs to judge the run: was it filtered, which policy, which devices. */
function writeRunRecord(
  run: Run,
  devices: readonly { readonly name: string; readonly id: string }[],
  isLargeTextRun: boolean,
): void {
  const record = {
    platform: run.options.platform,
    device: run.phone.name,
    deviceId: run.phone.id,
    devices,
    appId: run.app.id,
    includeTags: run.options.includeTags,
    largeText: isLargeTextRun ? 'ran' : 'skipped',
    networkMode: run.config.network.mode,
  };
  writeFileSync(join(run.out, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
}

async function main(): Promise<number> {
  const parsed = parseE2eCli(process.argv.slice(2));
  if (parsed.kind === 'help') {
    console.log(E2E_USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(
      `e2e: ${parsed.message}\n${E2E_USAGE.split('\n')[0] ?? ''}\n(--help lists every option)`,
    );
    return 2;
  }
  const started = await startRun(parsed.options);
  const network = join(started.out, 'network.txt');
  const samplers = socketSamplers(started.app, started.config, network);
  const run: Run = {
    ...started,
    watch: samplers.watch,
    portOf: devicePorts(started.options.driverPort),
  };
  samplers.watch(run.phone);
  const failures: string[] = [];
  try {
    failures.push(...(await runFlows(run)));
    if (!run.options.isSkippingLargeText) failures.push(...(await runLargeText(run)));
  } finally {
    failures.push(...(await samplers.stop()));
  }
  writeRunRecord(run, samplers.devices, !run.options.isSkippingLargeText);
  if (existsSync(network) && readFileSync(network, 'utf8').trim() !== '') {
    failures.push(`network: the app opened sockets its policy does not allow, see ${network}`);
  }
  for (const failure of failures) console.error(`e2e: ${failure}`);
  return failures.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
