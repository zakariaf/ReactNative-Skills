#!/usr/bin/env node
// capture-app.mjs: puts the app on one design frame through the parity launch, waits until the
// screen is still, takes the screenshot and dumps element bounds with maestro hierarchy, on this
// session's own iOS simulator or Android emulator.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, run, sha256 } from './check-lib.mjs';
import { THEMES, describeFacts, describeReference, deviceOf, directionOf, referenceName, requireParity, variantFor } from './lib/contract.mjs';
import { launchMarker, parseMaestroHierarchy, systemAlertIn } from './lib/hierarchy.mjs';
import { sameScreen, tryDecode } from './lib/images.mjs';
import { RUN_FILES, defaultRunDir } from './lib/runs.mjs';
import { driverPortOf, findSimulators, freePort, maestroArgs, makeAdb, makeMaestro, makeSimctl, sleep } from './lib/tools.mjs';

const SPEC = {
  name: 'capture-app',
  summary:
    'Launches the app straight into one design frame on this session\'s parity device (iOS: the launch argument ' +
    '-parity "<query>" plus -AppleLanguages/-AppleLocale; Android: the link <scheme>://debug/parity?<query> sent to the ' +
    'named package), waits until two screenshots in a row are the same, saves app.png, dumps app.hier.json with maestro ' +
    'hierarchy, checks the screen did not change meanwhile, that no system alert is up and that the frame\'s root testID ' +
    'is on screen, and writes run.json. A frame with reference variants picks its reference from the app\'s facts; a ' +
    'probed frame first launches once with probe=<region> to read the rectangle the app reports. Every Maestro call names ' +
    'the device and this run\'s own driver port before the command, and every launch carries a fresh nonce the ' +
    'dump must contain (the marker parity.launch.<nonce>): a dump without it came from another device (exit 2).',
  usage: '[repo-root] --frame <key> --theme light|dark --lang <code> [--device <id>] [options]',
  options: {
    frame: { type: 'string', value: 'key', help: 'Design frame key (a screen-contract state reference without .png)' },
    device: { type: 'string', value: 'id', help: 'Device profile id (default: the only one in the contract)' },
    theme: { type: 'string', value: 'light|dark', help: 'Theme' },
    lang: { type: 'string', value: 'code', help: 'Language, one of the contract\'s languages' },
    scroll: { type: 'string', value: 'pt', help: 'Scroll offset for tall frames (passed as scrollY)', default: '0' },
    'app-id': { type: 'string', value: 'id', help: 'The iOS bundle identifier or Android application id of the build that is captured (default: contract launch.ios / launch.android)' },
    scheme: { type: 'string', value: 'scheme', help: 'Android: the URL scheme of that build (default: contract launch.scheme)' },
    name: { type: 'string', value: 'name', help: "The simulator or AVD name of this session (default: the profile's simulatorName or avd.name)" },
    udid: { type: 'string', value: 'udid', help: 'iOS: the simulator UDID (default: found by --name)' },
    serial: { type: 'string', value: 'serial', help: 'Android: the emulator serial (default: the running emulator whose AVD is --name)' },
    out: { type: 'string', value: 'dir', help: 'Exact run folder (default: <runsDir>/<device>/<frame>/<theme>-<lang>[-y<scroll>])' },
    'settle-ms': { type: 'string', value: 'ms', help: "Longest wait for a still screen (default: the frame's settleMs or 8000)" },
    'no-hierarchy': { type: 'boolean', help: 'Skip maestro hierarchy (then write app.layout.json from an in-app reporter yourself)' },
    xcrun: { type: 'string', value: 'path', help: 'xcrun to use (default: xcrun on PATH)' },
    adb: { type: 'string', value: 'path', help: 'adb to use (default: the Android SDK\'s platform-tools/adb)' },
    maestro: { type: 'string', value: 'path', help: 'maestro to use (default: PATH, then ~/.maestro/bin/maestro)' },
    'driver-port': { type: 'string', value: 'port', help: "Maestro's driver host port for this session, iOS and Android (default: a free port for this run)" },
    'region-cache': { type: 'string', value: 'file', help: 'Region rectangles already probed in this run (run-parity passes one per run)' },
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Install the build first (iOS: a Release simulator build of a development or preview variant, ios-simulator-build;',
    'Android: the matching emulator build, android-emulator-build). Maestro needs Java 17. The first iOS hierarchy call',
    'installs Maestro\'s driver (about 20 s), later ones take about 11 s.',
    'iOS never gets a deep link: simctl openurl raises an "Open in ...?" alert that hides the app. Android gets the link',
    'with the package named, which opens no chooser; the shell command is quoted twice so the device shell keeps every',
    'parameter (an unquoted & cuts the URL).',
    'One parity device serves one session at a time: each session uses its own (setup-parity-device.mjs --name',
    '<project>-parity-<key>). run.json records the device, the driver port and the nonces.',
    '',
    'Examples:',
    '  node capture-app.mjs . --frame tasks-default --device iphone-16-pro --theme dark --lang ar --name tasks-parity-a',
    '  node capture-app.mjs . --frame lists-default --device android-parity --theme light --lang en --scroll 240',
  ].join('\n'),
};

const STATUS_ARGS = (o) => [
  '--time', o.time, '--dataNetwork', o.dataNetwork, '--wifiMode', o.wifiMode, '--wifiBars', o.wifiBars,
  '--cellularMode', o.cellularMode, '--cellularBars', o.cellularBars, '--operatorName', o.operatorName,
  '--batteryState', o.batteryState, '--batteryLevel', o.batteryLevel,
];

/** The emulator serial whose AVD is `name`, among the devices adb lists. */
function findEmulator(adb, name) {
  const serials = adb.devices().stdout.split('\n').map((l) => /^(emulator-\d+)\s+device$/.exec(l.trim())?.[1]).filter(Boolean);
  return serials.find((serial) => adb(serial, 'emu', 'avd', 'name').stdout.split('\n')[0].trim() === name) ?? null;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const missing = ['frame', 'theme', 'lang'].filter((k) => !options[k]);
  if (missing.length) fail(`nothing to capture: pass ${missing.map((k) => `--${k}`).join(', ')}`, 'Run: node capture-app.mjs --help');
  const parity = requireParity(root, { contract: options.contract ?? null });
  if (!THEMES.includes(options.theme) || !parity.contract.themes.includes(options.theme)) fail(`theme "${options.theme}" is not in the contract's themes (${parity.contract.themes.join(', ')})`, 'Use one of them.');
  if (!parity.contract.languages.includes(options.lang)) fail(`language "${options.lang}" is not in the contract's languages (${parity.contract.languages.join(', ')})`, 'Use one of them, or add it to the contract (and render its references).');
  const scrollY = Number(options.scroll);
  // Whole points: the harness's parser refuses anything else (and would show its error view).
  if (!Number.isInteger(scrollY) || scrollY < 0) fail(`--scroll must be whole points >= 0, got "${options.scroll}"`, 'Pass e.g. --scroll 240.');
  const device = deviceOf(parity, options.device);
  const frame = parity.frames.get(options.frame);
  if (!frame) fail(`unknown frame "${options.frame}"`, `Use one of: ${[...parity.frames.keys()].join(', ')}`);
  const variant = variantFor(frame, parity.appFacts, parity.designFacts);
  const settleMs = Number(options['settle-ms'] ?? frame.settleMs ?? 8000);
  const ios = device.platform === 'ios';
  const appId = options['app-id'] ?? parity.contract.launch?.[device.platform];
  if (!appId) fail(`no app id for ${device.platform}`, `Pass --app-id, or set launch.${device.platform} in the contract (the ${ios ? 'bundle identifier' : 'application id'} of the build that is captured).`);
  const scheme = options.scheme ?? parity.contract.launch?.scheme;
  if (!ios && !scheme) fail('no URL scheme for the Android launch link', "Pass --scheme, or set launch.scheme in the contract (the captured variant's scheme).");
  const report = createReporter({ name: 'capture-app' });
  const outDir = resolve(options.out ?? defaultRunDir(parity, { device: device.id, frame: frame.key, theme: options.theme, lang: options.lang, scrollY }));
  mkdirSync(outDir, { recursive: true });
  const file = relative(process.cwd(), join(outDir, RUN_FILES.app)) || RUN_FILES.app;
  const problem = (rule, message, fix) => report.problem({ file, rule, message, fix });
  const step = (text) => report.note(`step  ${text}`);
  report.note(`reference ${describeReference(frame.key, variant)}${Object.keys(parity.appFacts).length ? ` (app facts: ${describeFacts(parity.appFacts)})` : ''}`);

  // 1. This session's device, by UDID or serial; never "booted", never the only device.
  const simctl = ios ? makeSimctl(options.xcrun) : null;
  const adb = ios ? null : makeAdb(options.adb);
  let id;
  let deviceName;
  let driverPort = null;
  if (ios) {
    deviceName = options.name ?? device.simulatorName;
    if (options.udid) {
      // A stale UDID would launch and capture on another session's simulator.
      if (!findSimulators(simctl, deviceName).some((f) => f.device.udid === options.udid)) fail(`--udid ${options.udid} is not the ${deviceName} simulator`, `Pass the UDID setup-parity-device.mjs printed for --name ${deviceName}, or leave --udid out to find it by name.`);
      id = options.udid;
    } else {
      const sim = findSimulators(simctl, deviceName).find((f) => f.runtime === device.runtime && f.device.state === 'Booted');
      if (!sim) fail(`the ${deviceName} simulator is not booted`, `Run: node <skill>/scripts/setup-parity-device.mjs . --device ${device.id} --appearance ${options.theme} --name ${deviceName}`);
      id = sim.device.udid;
    }
    driverPort = driverPortOf(options['driver-port']) ?? (await freePort());
    report.note(`simulator ${deviceName} ${id}, Maestro driver port ${driverPort}${options['driver-port'] ? ' (given)' : ' (free port for this run)'}`);
  } else {
    deviceName = options.name ?? device.avd.name;
    if (options.serial) {
      const avd = adb(options.serial, 'emu', 'avd', 'name');
      const running = avd.status === 0 ? avd.stdout.split('\n')[0].trim() : null;
      if (running !== deviceName) fail(`--serial ${options.serial} ${running ? `runs the AVD ${running}` : 'is not a running emulator'}, not ${deviceName}`, `Pass the serial setup-parity-device.mjs printed for --name ${deviceName}, or leave --serial out to find it by name.`);
    }
    id = options.serial ?? findEmulator(adb, deviceName);
    if (!id) fail(`no running emulator of the AVD ${deviceName}`, `Run: node <skill>/scripts/setup-parity-device.mjs . --device ${device.id} --appearance ${options.theme} --name ${deviceName}`);
    driverPort = driverPortOf(options['driver-port']) ?? (await freePort());
    report.note(`emulator ${deviceName} ${id}, Maestro driver port ${driverPort}${options['driver-port'] ? ' (given)' : ' (free port for this run)'}`);
  }

  // 2. The right appearance and a clean status bar.
  if (ios) {
    if (simctl('ui', id, 'appearance').stdout.trim() !== options.theme) {
      step(`appearance ${options.theme}`);
      simctl('ui', id, 'appearance', options.theme);
    }
    if (device.statusBarOverride && !simctl('status_bar', id, 'list').stdout.includes(device.statusBarOverride.time)) {
      step('re-applying the status bar override (a reboot clears it)');
      simctl('status_bar', id, 'override', ...STATUS_ARGS(device.statusBarOverride));
    }
    // Nothing else in front (another app adds a "back to" breadcrumb). Maestro's driver stays: stopping
    // it makes the next hierarchy call reinstall it (20 s).
    const running = simctl('spawn', id, 'launchctl', 'list').stdout;
    for (const m of running.matchAll(/UIKitApplication:([A-Za-z0-9.-]+)\[/g)) {
      if (m[1] !== appId && !m[1].startsWith('dev.mobile.maestro-driver')) simctl('terminate', id, m[1]);
    }
  } else {
    const night = adb(id, 'shell', 'cmd', 'uimode', 'night').stdout;
    const want = options.theme === 'dark' ? 'yes' : 'no';
    if (!night.includes(`Night mode: ${want}`)) {
      step(`night mode ${want}`);
      adb(id, 'shell', 'cmd', 'uimode', 'night', want);
    }
    // Demo mode: a fixed clock, full bars and battery, no notification icons.
    adb(id, 'shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1');
    for (const extra of [['enter'], ['clock', '-e', 'hhmm', device.demoMode?.clock ?? '0941'], ['battery', '-e', 'level', '100', '-e', 'plugged', 'false'], ['network', '-e', 'wifi', 'show', '-e', 'level', '4'], ['notifications', '-e', 'visible', 'false']]) {
      adb(id, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', ...extra);
    }
  }

  // 3. The parity launch, with a fresh nonce per launch: the dump that follows must contain its marker.
  let fixtureDay = null;
  try {
    fixtureDay = existsSync(join(root, parity.paths.fixture)) ? JSON.parse(readFileSync(join(root, parity.paths.fixture), 'utf8')).day ?? null : null;
  } catch {
    fixtureDay = null;
  }
  const launchWith = (extra) => {
    const nonce = randomBytes(6).toString('hex');
    const query = new URLSearchParams({ frame: frame.key, theme: options.theme, lang: options.lang, ...(fixtureDay ? { date: fixtureDay } : {}), motion: 'still', ...extra, nonce }).toString();
    if (ios) {
      const langArgs = device.languages?.[options.lang] ?? { appleLanguages: `(${options.lang})`, appleLocale: options.lang };
      // Each argument is its own word (no shell), so "(ar)" arrives intact.
      const args = ['-AppleLanguages', langArgs.appleLanguages, '-AppleLocale', langArgs.appleLocale, '-parity', query];
      step(`launch ${appId} on ${id} ${args.join(' ')}`);
      const launched = simctl('launch', '--terminate-running-process', id, appId, ...args);
      if (launched.status !== 0) fail(`the app did not launch: ${(launched.stderr || launched.stdout).trim().split('\n')[0]}`, `Install the build first: xcrun simctl install ${id} <path to the .app> (and check --app-id).`);
      return { launch: { args }, nonce };
    }
    const url = `${scheme}://debug/parity?${query}`;
    adb(id, 'shell', 'am', 'force-stop', appId);
    adb(id, 'shell', 'cmd', 'locale', 'set-app-locales', appId, '--locales', options.lang);
    // One shell string, the URL quoted again inside it: the device shell would cut it at "&".
    const command = `am start -W -a android.intent.action.VIEW -d "${url}" ${appId}`;
    step(`launch on ${id}: ${command}`);
    const launched = adb(id, 'shell', command);
    if (launched.status !== 0 || /Error|does not exist/i.test(launched.stdout)) fail(`the app did not launch: ${(launched.stderr || launched.stdout).trim().split('\n').slice(-1)[0]}`, `Install the build first: adb -s ${id} install <path to the .apk> (and check --app-id and --scheme).`);
    return { launch: { url }, nonce };
  };

  // 4. A still screen: two screenshots in a row, 300 ms apart, the same outside the OS-drawn areas and
  // within 3/255 per channel (shadow dithering changes on a redraw).
  const masks = device.masks.map((m) => ({ x0: m.x * device.scale, y0: m.y * device.scale, x1: (m.x + m.width) * device.scale, y1: (m.y + m.height) * device.scale }));
  const same = (bufA, bufB) => bufA.equals(bufB) || sameScreen(tryDecode(bufA), tryDecode(bufB), masks, 3);
  const shot = (path) => {
    const take = () => {
      if (ios) return simctl('io', id, 'screenshot', '--type=png', path);
      const r = adb.raw(id, 'exec-out', 'screencap', '-p');
      if (r.status === 0 && r.stdout.length > 8) writeFileSync(path, r.stdout);
      return { status: r.status, stderr: r.stderr };
    };
    let r = take();
    if (r.status !== 0 || !existsSync(path)) r = take();
    if (r.status !== 0 || !existsSync(path)) {
      const lines = String(r.stderr || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(Note:|Detected file type)/.test(l));
      fail(`the screenshot failed twice (exit ${String(r.status)}): ${lines.join(' ').slice(0, 300) || 'no error text'}`, 'Check that the device is booted and not showing a crash dialog.');
    }
    return readFileSync(path);
  };
  const tmp = (n) => join(outDir, `.capture-${n}.png`);
  const settle = async (first) => {
    const began = Date.now();
    let previous = first ?? shot(tmp(0));
    for (let n = 1; Date.now() - began < settleMs; n += 1) {
      await sleep(300);
      const current = shot(tmp(n % 2));
      if (same(current, previous)) return { stable: current, previous };
      previous = current;
    }
    return { stable: null, previous };
  };
  const cleanTmp = () => ['0', '1', 'after'].forEach((n) => rmSync(tmp(n), { force: true }));
  const unstable = (last) => {
    cleanTmp();
    problem('unstable', `the screen never held still for 300 ms within ${settleMs} ms (an animation, a timer or a loading state is running)`, 'A parity launch holds motion still through the one reduce-motion path; route the loop through useReduceMotion() (never a capture-only branch), stop timers, and raise --settle-ms only for a slow first launch.');
    writeFileSync(join(outDir, RUN_FILES.app), last);
    return report.finish({ checked: 1, unit: 'captures' });
  };
  const maestro = options['no-hierarchy'] ? null : makeMaestro(options.maestro);
  const target = { platform: device.platform, id, driverPort };
  if (!options['no-hierarchy'] && !maestro) fail('Maestro is not installed', 'Install Maestro and Java 17 (e2e-maestro), or pass --maestro <path>.');
  const unitScale = ios ? 1 : device.scale;
  // A dump belongs to this launch only when it holds the launch's nonce marker: without it, the
  // driver that answered serves another device. A driver can also answer once with only the status
  // bar, before the app's tree is attached, so a dump without the marker is read again after a short
  // wait; only MARKER_DUMPS dumps in a row without it stop the capture.
  const MARKER_DUMPS = 3;
  const dumpHierarchy = async (nonce) => {
    for (let dump = 1; ; dump += 1) {
      let r = maestro(...maestroArgs(target, 'hierarchy', ...(ios ? ['--no-reinstall-driver'] : [])));
      if (r.status !== 0 && ios) r = maestro(...maestroArgs(target, 'hierarchy'));
      let json;
      try {
        json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
      } catch {
        cleanTmp();
        return fail(`maestro hierarchy did not print JSON (exit ${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-1)[0]}`, maestro.javaHome ? 'Run the same command by hand to see the error.' : 'Maestro needs Java 17: set JAVA_HOME.');
      }
      const parsed = parseMaestroHierarchy(json, { unitScale });
      if (parsed.elements.has(launchMarker(nonce))) return json;
      if (dump < MARKER_DUMPS) {
        step(`the dump has no ${launchMarker(nonce)} yet (${parsed.elements.size} elements; the app's tree may not be attached): reading it again in 2 s`);
        await sleep(2000);
        continue;
      }
      cleanTmp();
      writeFileSync(join(outDir, 'rejected.hier.json'), `${JSON.stringify(json, null, 1)}\n`);
      return fail(
        `hierarchy from another device: the dump has no ${launchMarker(nonce)}, the marker of this launch on ${id}${driverPort ? ` (driver port ${driverPort})` : ''}, in ${MARKER_DUMPS} dumps in a row; the last was kept as rejected.hier.json`,
        "Give this session its own device (--name <project>-parity-<key>) and let capture-app pick a free driver port. If the app never shows the marker, its parity root or a modal root lacks ParityLaunchMarker (check-harness.mjs, rule harness-launch-marker).",
      );
    }
  };

  // 3b. A probed frame masks a region the app draws itself (a canvas, a map). A first launch with
  // probe=<region> opens no frame state and makes the app render the probe element (parity.probe.<region> by default) with its
  // rectangle; it is cached per device, theme and language for the rest of the run.
  let region = null;
  if (frame.probe) {
    const cacheKey = `${device.id}|${options.theme}|${options.lang}|${frame.probe.region}`;
    const cachePath = options['region-cache'] ? resolve(options['region-cache']) : null;
    let cache = {};
    try {
      cache = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
    } catch {
      cache = {};
    }
    if (cache[cacheKey]) {
      region = { ...cache[cacheKey], cached: true };
      step(`region rectangle from this run's probe: ${JSON.stringify(region.rect)}`);
    } else if (maestro) {
      const probeLaunch = launchWith({ probe: frame.probe.region });
      await sleep(1000);
      const probeSettled = await settle(null);
      if (!probeSettled.stable) return unstable(probeSettled.previous);
      step('maestro hierarchy of the probe launch');
      const probed = parseMaestroHierarchy(await dumpHierarchy(probeLaunch.nonce), { unitScale });
      const text = probed.elements.get(frame.probe.testID)?.label ?? null;
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      // { x, y, width, height }, or a canvas probe's { x, y, layout: { width, height } }.
      const rect = parsed ? { x: parsed.x, y: parsed.y, w: parsed.width ?? parsed.layout?.width, h: parsed.height ?? parsed.layout?.height } : null;
      const ok = rect && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(rect[k])) && rect.w > 0 && rect.h > 0;
      if (!ok) {
        cleanTmp();
        problem('region-probe', `the probe launch showed no usable ${frame.probe.testID} (${text ? `text ${text.slice(0, 80)}` : 'not on screen'}), so the region cannot be masked`,
          `In a probe launch the app must render ${frame.probe.testID} with the region's rectangle in points as its label ({"x","y","width","height"}, or a canvas probe's {"x","y","layout":{...}}); the probe opens no frame state (references/parity-harness.md).`);
        return report.finish({ checked: 1, unit: 'captures' });
      }
      region = { rect, source: `probe=${frame.probe.region}`, probedAt: new Date().toISOString(), nonce: probeLaunch.nonce };
      step(`region rectangle ${JSON.stringify(region.rect)}`);
      if (cachePath) writeFileSync(cachePath, `${JSON.stringify({ ...cache, [cacheKey]: region }, null, 1)}\n`);
    }
  }

  const { launch, nonce } = launchWith(scrollY ? { scrollY: String(scrollY) } : {});
  const started = Date.now();
  await sleep(1000);
  let settled = await settle(null);
  if (!settled.stable) return unstable(settled.previous);
  let stable = settled.stable;
  step(`screen still after ${Date.now() - started} ms`);

  // 5. Element bounds, and proof that the screen did not change while they were read. A launch screen
  // or a late data load can hold still for 300 ms, so a change during the dump means: settle again and
  // dump again (3 attempts).
  let hierarchy = null;
  let systemAlert = null;
  if (maestro) {
    let accepted = false;
    for (let attempt = 1; attempt <= 3 && !accepted; attempt += 1) {
      step(`maestro hierarchy, attempt ${attempt}`);
      hierarchy = await dumpHierarchy(nonce);
      const after = shot(tmp('after'));
      if (same(after, stable)) {
        accepted = true;
        break;
      }
      if (attempt === 3) break;
      step('the screen changed while the hierarchy was read: settling again');
      settled = await settle(after);
      if (!settled.stable) return unstable(settled.previous);
      stable = settled.stable;
    }
    if (!accepted) problem('changed-during-capture', 'the screen changed while the hierarchy was read, 3 times in a row, so bounds and pixels may not match', 'Stop timers and animations in a parity launch (motion is held still through useReduceMotion), then capture again.');
    writeFileSync(join(outDir, RUN_FILES.hier), `${JSON.stringify(hierarchy, null, 1)}\n`);
    const parsed = parseMaestroHierarchy(hierarchy, { unitScale });
    systemAlert = systemAlertIn(parsed);
    if (systemAlert) problem('system-alert', `a system alert is on screen: "${systemAlert}"`, 'Nothing may ask the system in a parity launch: no permission, tracking or consent prompt, and no deep link on iOS. Find what asked, dismiss it, and capture again.');
    const reached = frame.root && (parsed.elements.has(frame.root) || (frame.modal && parsed.elements.has(frame.modal.reachedBy)));
    if (frame.root && !reached) {
      const known = frame.elements.filter((el) => parsed.elements.has(el.testID)).length;
      const labels = parsed.labels.filter(Boolean).slice(0, 5).map((l) => `"${l}"`).join(', ');
      problem('screen-not-reached', `the root testID ${frame.root} is not on screen (${known} of the frame's testIDs found; the screen shows ${labels || 'no labels'})`, 'Check that the parity harness plans this frame and its state opener runs, and that no system alert is up; then capture again.');
    } else {
      step(`${frame.elements.filter((el) => parsed.elements.has(el.testID)).length} of ${frame.elements.length} frame testIDs on screen`);
    }
  }
  cleanTmp();
  writeFileSync(join(outDir, RUN_FILES.app), stable);
  const width = stable.readUInt32BE(16);
  const height = stable.readUInt32BE(20);
  const fullHeight = frame.kind === 'state-card' ? height <= device.pixels.height : height === device.pixels.height;
  if (width !== device.pixels.width || !fullHeight) {
    problem('capture-size', `the screenshot is ${width} x ${height}, not ${device.pixels.width} x ${device.pixels.height}`, `Capture on a device of profile ${device.id} (${device.name}); run setup-parity-device.mjs.`);
  }
  const info = {
    version: 1,
    source: 'capture-app',
    frame: frame.key,
    variant: variant?.id ?? null,
    referenceName: referenceName(frame.key, variant?.id),
    kind: frame.kind,
    device: device.id,
    platform: device.platform,
    theme: options.theme,
    lang: options.lang,
    direction: directionOf(parity, options.lang),
    scrollY,
    bundleId: appId,
    target: ios ? { name: deviceName, udid: id, runtime: device.runtime, driverPort } : { name: deviceName, serial: id, driverPort },
    launch,
    nonce,
    ...(maestro ? { hierarchyNonce: launchMarker(nonce), systemAlert } : {}),
    ...(Object.keys(parity.appFacts).length ? { facts: parity.appFacts } : {}),
    ...(region ? { region } : {}),
    capturedAt: new Date().toISOString(),
    appSha256: sha256(stable),
  };
  const infoPath = join(outDir, RUN_FILES.info);
  writeFileSync(`${infoPath}.tmp`, `${JSON.stringify(info, null, 1)}\n`);
  renameSync(`${infoPath}.tmp`, infoPath);
  rmSync(join(outDir, RUN_FILES.report), { force: true });
  report.note(`run   ${relative(process.cwd(), outDir) || '.'} (next: check-parity.mjs on this folder)`);
  return report.finish({ checked: 1, unit: 'captures' });
});
