#!/usr/bin/env node
// setup-parity-device.mjs: creates (once), boots and pins this session's parity device: an iOS
// simulator or an Android emulator of the contract's device profile.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { createReporter, fail, parseArgs, run } from './check-lib.mjs';
import { deviceOf, requireParity } from './lib/contract.mjs';
import { findSimulators, makeAdb, makeAndroidTools, makeSerialAdb, makeSimctl, sleep } from './lib/tools.mjs';

const SPEC = {
  name: 'setup-parity-device',
  summary:
    'Creates (if needed) and boots this session\'s parity device for a device profile of the contract. iOS: a simulator ' +
    'of the profile\'s model and runtime, system locale en_US (so the clock reads 9:41, not 09:41), the status bar ' +
    'overridden (9:41, full bars, 100 % battery, no operator), the appearance, text size (large) and Increase Contrast ' +
    '(off). Android: an AVD of the profile\'s system image, started on its own console port, the display pinned to the ' +
    'profile\'s size and density, night mode for the appearance, font scale 1.0 and demo mode (fixed clock, full bars). ' +
    '--check changes nothing and fails when any of that is not true.',
  usage: '[repo-root] --appearance light|dark [--device <id>] [--name <name>] [--check] [options]',
  options: {
    appearance: { type: 'string', value: 'light|dark', help: 'System appearance to set (match the theme you capture)' },
    device: { type: 'string', value: 'id', help: 'Device profile id (default: the only one in the contract)' },
    name: { type: 'string', value: 'name', help: "This session's simulator or AVD name (default: the profile's, <project>-parity; use <project>-parity-<key> per session)" },
    check: { type: 'boolean', help: 'Change nothing; exit 1 when the device is not ready for parity captures' },
    recreate: { type: 'boolean', help: 'iOS: delete and recreate a same-named simulator that has the wrong model or runtime' },
    xcrun: { type: 'string', value: 'path', help: 'xcrun to use' },
    adb: { type: 'string', value: 'path', help: 'adb to use' },
    avdmanager: { type: 'string', value: 'path', help: 'avdmanager to use' },
    emulator: { type: 'string', value: 'path', help: 'emulator to use' },
    'avd-home': { type: 'string', value: 'dir', help: 'Where the AVDs live (default: $ANDROID_AVD_HOME, else ~/.android/avd)' },
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'It never touches another device: a simulator is found by its name and then used by UDID only; an emulator by its',
    'AVD name and then used by serial only (adb -s). Status bar overrides are cleared by every reboot, so run it again',
    'after one (capture-app.mjs re-applies a missing override too). Prints "udid <UDID>" or "serial <serial>".',
    'Android: a same-named AVD made from another system image fails emu-wrong-image (read from <avd-home>/<name>.avd/',
    'config.ini); the navigation mode is pinned with the systemui navbar overlay (profile avd.navigation, default',
    'gestural: 3-button navigation doubles the bottom inset and moves every bottom-anchored element). Display, density,',
    'insets and demo mode were set from the platform documentation and are not yet verified on an emulator by this',
    'skill; the first capture shows whether the profile\'s masks fit (references/devices-and-capture.md).',
    '',
    'Examples:',
    '  node setup-parity-device.mjs . --device iphone-16-pro --appearance light --name tasks-parity-a',
    '  node setup-parity-device.mjs . --device android-parity --appearance dark --name tasks-parity-a',
    '  node setup-parity-device.mjs . --device iphone-16-pro --appearance dark --check',
  ].join('\n'),
};

const STATUS_ARGS = (o) => [
  '--time', o.time, '--dataNetwork', o.dataNetwork, '--wifiMode', o.wifiMode, '--wifiBars', o.wifiBars,
  '--cellularMode', o.cellularMode, '--cellularBars', o.cellularBars, '--operatorName', o.operatorName,
  '--batteryState', o.batteryState, '--batteryLevel', o.batteryLevel,
];

function setupIos({ device, options, name, report }) {
  const simctl = makeSimctl(options.xcrun);
  const problem = (rule, message, fix) => report.problem({ file: name, rule, message, fix });
  const step = (text) => report.note(`${options.check ? 'check' : 'setup'} ${text}`);
  const must = (r, what) => {
    if (r.status !== 0) fail(`${what} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`, "Read the simctl message; if this session's simulator is wedged, shut down only it (by its UDID) and run this script again; other sessions' simulators are never touched.");
    return r.stdout;
  };
  const runtimes = simctl.json('list', 'runtimes', '-j').runtimes ?? [];
  const rt = runtimes.find((r) => r.identifier === device.runtime);
  if (!rt || rt.isAvailable === false) fail(`the iOS ${device.runtimeVersion ?? device.runtime} simulator runtime is not installed`, `Human step: install it (Xcode > Settings > Components, or xcodebuild -downloadPlatform iOS -buildVersion ${device.runtimeVersion ?? '<version>'}).`);
  const types = simctl.json('list', 'devicetypes', '-j').devicetypes ?? [];
  if (!types.some((t) => t.identifier === device.deviceType)) fail(`the device type ${device.deviceType} is not available`, 'Update Xcode to the version the toolchain pins (ios-simulator-build).');
  let found = findSimulators(simctl, name);
  const wrong = found.filter((f) => f.runtime !== device.runtime || (f.device.deviceTypeIdentifier && f.device.deviceTypeIdentifier !== device.deviceType));
  if (wrong.length) {
    if (options.recreate && !options.check) {
      for (const w of wrong) {
        step(`deleting ${name} (${w.device.udid}) on ${w.runtime}`);
        simctl('shutdown', w.device.udid);
        must(simctl('delete', w.device.udid), `xcrun simctl delete ${w.device.udid}`);
      }
      found = findSimulators(simctl, name);
    } else {
      for (const w of wrong) problem('sim-wrong-model', `a simulator named ${name} (${w.device.udid}) is ${w.device.deviceTypeIdentifier ?? 'another model'} on ${w.runtime}`, `Run with --recreate, or delete it by its UDID (${w.device.udid}).`);
    }
  }
  let sim = found.find((f) => f.runtime === device.runtime && (!f.device.deviceTypeIdentifier || f.device.deviceTypeIdentifier === device.deviceType));
  if (found.filter((f) => f.runtime === device.runtime).length > 1) problem('sim-duplicate', `${found.length} simulators are named ${name}`, 'Delete the extra ones by UDID so every script talks to the same device.');
  // Never add a second device with the same name next to a wrong or duplicate one.
  if (report.count > 0 && !options.check) return;
  if (!sim) {
    if (options.check) {
      problem('sim-missing', `no ${name} simulator (${device.name})`, `Run: node setup-parity-device.mjs . --device ${device.id} --appearance light --name ${name}`);
      return;
    }
    const udid = must(simctl('create', name, device.deviceType, device.runtime), `xcrun simctl create ${name}`).trim();
    step(`created ${name} ${udid}`);
    sim = findSimulators(simctl, name).find((f) => f.device.udid === udid);
    if (!sim) fail(`created ${udid} but cannot find it again`, 'Run the script again.');
  }
  const udid = sim.device.udid;
  const boot = () => {
    must(simctl('boot', udid), `xcrun simctl boot ${udid}`);
    must(simctl('bootstatus', udid, '-b'), `xcrun simctl bootstatus ${udid}`);
  };
  if (sim.device.state !== 'Booted') {
    if (options.check) problem('sim-not-booted', `${name} is ${sim.device.state}`, `Run: node setup-parity-device.mjs . --device ${device.id} --appearance <theme> --name ${name}`);
    else {
      step(`booting ${udid}`);
      boot();
    }
  }
  if (report.count > 0) return;
  // System locale en_US: with the host's region the status-bar clock reads "09:41".
  const systemLocale = device.systemLocale ?? 'en_US';
  const locale = simctl('spawn', udid, 'defaults', 'read', '-g', 'AppleLocale').stdout.trim();
  if (locale !== systemLocale) {
    if (options.check) problem('sim-locale', `AppleLocale is "${locale || 'unset'}", not ${systemLocale} (the status bar would show 24-hour time)`, 'Run setup-parity-device.mjs without --check (it sets the locale and reboots once).');
    else {
      step(`setting AppleLocale ${systemLocale} (was "${locale}") and rebooting`);
      must(simctl('spawn', udid, 'defaults', 'write', '-g', 'AppleLocale', '-string', systemLocale), 'defaults write AppleLocale');
      must(simctl('spawn', udid, 'defaults', 'write', '-g', 'AppleLanguages', '-array', 'en'), 'defaults write AppleLanguages');
      must(simctl('spawn', udid, 'defaults', 'write', '-g', 'AppleICUForce12HourTime', '-bool', 'true'), 'defaults write AppleICUForce12HourTime');
      must(simctl('shutdown', udid), `xcrun simctl shutdown ${udid}`);
      boot();
    }
  }
  const bar = simctl('status_bar', udid, 'list').stdout;
  const barOk = bar.includes(device.statusBarOverride.time) && /battery/i.test(bar);
  if (!barOk) {
    if (options.check) problem('sim-status-bar', 'the status bar is not overridden (real clock, carrier and battery would show)', 'Run setup-parity-device.mjs without --check.');
    else {
      step(`overriding the status bar (${device.statusBarOverride.time}, full bars, 100 % battery)`);
      must(simctl('status_bar', udid, 'override', ...STATUS_ARGS(device.statusBarOverride)), 'xcrun simctl status_bar override');
    }
  }
  for (const [key, want] of [['appearance', options.appearance], ['content_size', device.contentSize ?? 'large'], ['increase_contrast', 'disabled']]) {
    const now = simctl('ui', udid, key).stdout.trim();
    if (now === want) continue;
    if (options.check) problem(`sim-${key.replace('_', '-')}`, `${key} is "${now}", not "${want}"`, `Run setup-parity-device.mjs --appearance ${options.appearance}.`);
    else {
      step(`${key} ${want} (was "${now}")`);
      must(simctl('ui', udid, key, want), `xcrun simctl ui ${key} ${want}`);
    }
  }
  report.note(`udid ${udid}`);
}

async function setupAndroid({ device, options, name, report }) {
  const adb = makeAdb(options.adb);
  const tools = makeAndroidTools({ avdmanager: options.avdmanager, emulator: options.emulator });
  const problem = (rule, message, fix) => report.problem({ file: name, rule, message, fix });
  const step = (text) => report.note(`${options.check ? 'check' : 'setup'} ${text}`);
  const avds = tools.emulatorList().stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!avds.includes(name)) {
    if (options.check) {
      problem('emu-missing', `no AVD named ${name}`, `Run: node setup-parity-device.mjs . --device ${device.id} --appearance light --name ${name}`);
      return;
    }
    step(`creating the AVD ${name} (${device.avd.device}, ${device.avd.systemImage})`);
    const created = tools.avdmanager('create', 'avd', '--name', name, '--package', device.avd.systemImage, '--device', device.avd.device);
    if (created.status !== 0) fail(`avdmanager could not create ${name}: ${(created.stderr || created.stdout).trim().split('\n').slice(-1)[0]}`, `Human step: install the system image (sdkmanager "${device.avd.systemImage}") and accept its licence, then run this script again.`);
  }
  // A same-named AVD made from another image or API level would be used silently otherwise.
  const avdHome = options['avd-home'] ?? process.env.ANDROID_AVD_HOME ?? join(homedir(), '.android', 'avd');
  const configPath = join(avdHome, `${name}.avd`, 'config.ini');
  const wantImage = `${device.avd.systemImage.split(';').join('/')}/`;
  const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  const image = config === null ? null : (/^image\.sysdir\.1\s*=\s*(.+)$/m.exec(config)?.[1]?.trim().replace(/\/?$/, '/') ?? null);
  if (image !== wantImage) {
    problem('emu-wrong-image', image === null ? `cannot read the system image of the AVD ${name} (${configPath})` : `the AVD ${name} is made from ${image}, not ${wantImage} (${device.avd.systemImage})`, `Delete only this AVD (avdmanager delete avd --name ${name}) and run this script again to create it from ${device.avd.systemImage}; pass --avd-home when the AVDs live elsewhere.`);
    return;
  }
  const serialOf = () => adb.devices().stdout.split('\n').map((l) => /^(emulator-\d+)\s+device$/.exec(l.trim())?.[1]).filter(Boolean).find((s) => adb(s, 'emu', 'avd', 'name').stdout.split('\n')[0].trim() === name) ?? null;
  let serial = serialOf();
  if (!serial) {
    if (options.check) {
      problem('emu-not-running', `the AVD ${name} is not running`, `Run: node setup-parity-device.mjs . --device ${device.id} --appearance <theme> --name ${name}`);
      return;
    }
    const used = new Set(adb.devices().stdout.split('\n').map((l) => Number(/^emulator-(\d+)/.exec(l.trim())?.[1])).filter(Boolean));
    let port = 5580;
    while (used.has(port) && port < 5680) port += 2;
    serial = tools.startEmulator(name, port);
    step(`started ${name} as ${serial}; waiting for the boot`);
    const booting = makeSerialAdb(adb, serial);
    let booted = false;
    for (let i = 0; i < 90 && !booted; i += 1) {
      await sleep(2000);
      booted = booting('shell', 'getprop', 'sys.boot_completed').stdout.trim() === '1';
    }
    if (!booted) fail(`${name} (${serial}) did not finish booting in 180 s`, `Stop only this emulator (adb -s ${serial} emu kill) and run the script again.`);
  }
  // Every call from here on goes to this session's emulator only.
  const onDevice = makeSerialAdb(adb, serial);
  const size = `${device.pixels.width}x${device.pixels.height}`;
  const sizeNow = onDevice('shell', 'wm', 'size').stdout;
  const densityNow = onDevice('shell', 'wm', 'density').stdout;
  const shown = (text) => (/Override \w+: (\S+)/.exec(text) ?? /Physical \w+: (\S+)/.exec(text))?.[1] ?? 'unknown';
  const fix = (rule, what, now, want, apply) => {
    if (now === want) return;
    if (options.check) problem(rule, `${what} is ${now}, not ${want}`, `Run setup-parity-device.mjs --device ${device.id} without --check.`);
    else {
      step(`${what} ${want} (was ${now})`);
      apply();
    }
  };
  fix('emu-display-size', 'the display size', shown(sizeNow), size, () => onDevice('shell', 'wm', 'size', size));
  fix('emu-display-density', 'the display density', shown(densityNow), String(device.avd.density), () => onDevice('shell', 'wm', 'density', String(device.avd.density)));
  const want = options.appearance === 'dark' ? 'yes' : 'no';
  fix('emu-night-mode', 'night mode', /Night mode: (\w+)/.exec(onDevice('shell', 'cmd', 'uimode', 'night').stdout)?.[1] ?? 'unknown', want, () => onDevice('shell', 'cmd', 'uimode', 'night', want));
  fix('emu-font-scale', 'the font scale', onDevice('shell', 'settings', 'get', 'system', 'font_scale').stdout.trim() || 'unset', String(device.fontScale ?? '1.0'), () => onDevice('shell', 'settings', 'put', 'system', 'font_scale', String(device.fontScale ?? '1.0')));
  // The navigation mode: the profile's insets and masks assume it (gestural: a 24 dp bar; 3-button: 48 dp).
  const navigation = device.avd.navigation ?? 'gestural';
  const overlays = onDevice('shell', 'cmd', 'overlay', 'list').stdout;
  const navNow = /^\[x\]\s+com\.android\.internal\.systemui\.navbar\.(\w+)/m.exec(overlays)?.[1] ?? 'unknown';
  fix('emu-navigation', 'the navigation mode', navNow, navigation, () => onDevice('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', `com.android.internal.systemui.navbar.${navigation}`));
  // --check can read only the permission (sysui_demo_allowed survives a reboot; demo mode itself does
  // not, and no setting reports it). So a setup run always sends the demo commands again, and
  // capture-app.mjs sends them before every capture.
  fix('emu-demo-mode', 'demo mode', onDevice('shell', 'settings', 'get', 'global', 'sysui_demo_allowed').stdout.trim() || 'unset', '1', () => {
    onDevice('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1');
  });
  if (!options.check) {
    step('demo mode on (status bar clock, battery, network, no notifications)');
    for (const extra of [['enter'], ['clock', '-e', 'hhmm', device.demoMode?.clock ?? '0941'], ['battery', '-e', 'level', '100', '-e', 'plugged', 'false'], ['network', '-e', 'wifi', 'show', '-e', 'level', '4'], ['notifications', '-e', 'visible', 'false']]) {
      onDevice('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', ...extra);
    }
  }
  report.note(`serial ${serial}`);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (!options.appearance) fail('nothing to do: pass --appearance light or --appearance dark', 'Run: node setup-parity-device.mjs --help');
  if (!['light', 'dark'].includes(options.appearance)) fail(`unknown appearance "${options.appearance}"`, 'Use light or dark.');
  const parity = requireParity(resolve(positionals[0] ?? '.'), { contract: options.contract ?? null });
  const device = deviceOf(parity, options.device);
  const name = options.name ?? (device.platform === 'ios' ? device.simulatorName : device.avd.name);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*-parity(-[a-z0-9]+)*$/.test(name)) fail(`"${name}" is not a parity device name`, 'Name devices <project>-parity or <project>-parity-<session> (lower case), so nobody mistakes one for an everyday simulator.');
  const report = createReporter({ name: 'setup-parity-device' });
  if (device.platform === 'ios') setupIos({ device, options, name, report });
  else await setupAndroid({ device, options, name, report });
  return report.finish({ checked: 1, unit: 'devices' });
});
