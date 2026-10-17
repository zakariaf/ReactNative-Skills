#!/usr/bin/env node
// check-screenshot.mjs: checks simulator screenshots for the failures a glance must catch: the wrong
// device size, a blank screen (all black, all white or one colour: the app crashed, is still loading
// or drew nothing) and a light system banner (a notification) over the top of the app. It never
// replaces looking at the PNG; it catches the obvious.
// The expected model is --device, else the contract's deviceType (the model build:ios:sim creates its
// simulator with), else iPhone 17 Pro Max. Unlike the repo checkers, the positionals are the PNGs or
// their folders; the repo root (for the contract) is --root, default the current folder.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-screenshot.mjs reports/ios-sim/
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, readPng, requireDir, resolveLayout, run, toPosix } from './check-lib.mjs';
import { dominantColour, lightBannerRows } from './lib/screen-measure.mjs';
import { readSimContract } from './lib/sim-contract.mjs';

// Pixel sizes (portrait) read from the simulator device-type profiles (mainScreenWidth/Height) that
// ship with Xcode 26.6, verified 2026-10-04. Other devices (an Android emulator): pass --size.
const DEVICES = {
  'iPhone 17 Pro Max': [1320, 2868],
  'iPhone 17 Pro': [1206, 2622],
  'iPhone 17': [1206, 2622],
  'iPhone Air': [1260, 2736],
  'iPhone 17e': [1170, 2532],
  'iPhone 16 Pro': [1206, 2622],
  'iPhone 16e': [1170, 2532],
  'iPad Pro 13-inch (M5)': [2064, 2752],
  'iPad Pro 11-inch (M5)': [1668, 2420],
  'iPad Air 13-inch (M3)': [2048, 2732],
  'iPad (A16)': [1640, 2360],
};
// iOS always draws the status bar (about 62 pt of 874-956 pt), so it is left out of the blank test.
const STATUS_BAR_SHARE = 0.08;
// A real screen has text, controls or art; 99% of one colour means nothing was drawn. The black frame
// with a spinner iOS shows right after boot measures 99.9%; a flat splash with a logo stays below 99%.
const BLANK_SHARE = 0.99;
// A notification banner leaves at least this many clean rows (about 7 pt at 3x) in the top band.
const BANNER_MIN_ROWS = 20;
const DEFAULT_DEVICE = 'iPhone 17 Pro Max';

const SPEC = {
  name: 'check-screenshot',
  summary: 'Checks simulator screenshots: the pixel size of the simulator model, no blank screen (one colour over 99% below the status bar) and no light system banner over the top of the app.',
  usage: '[options] <png-or-folder>...',
  options: {
    device: { type: 'string', value: 'model', help: `Simulator model whose size is expected (default: the contract deviceType, else ${DEFAULT_DEVICE}; known: ${Object.keys(DEVICES).join(', ')})` },
    size: { type: 'string', value: 'WxH', help: 'Expected size in pixels instead of --device (for example 1080x2400 for an Android emulator)' },
    root: { type: 'string', value: 'dir', default: '.', help: 'Repo root whose contracts/ios-sim-build.json deviceType is the default --device' },
    'no-banner-check': { type: 'boolean', help: "Skip the system-banner heuristic (only after opening the PNG: the light band is the app's own)" },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'Rules:',
    '  png-size       the image has the pixel size of the simulator model it was taken on',
    '  blank-screen   below the status bar, no single colour covers 99% of the image',
    '  system-banner  a light system banner (a notification) covers the top of the app: rows in the top band that are',
    "                 light grey from 2.5% to 97.5% of the width but not at the edges (a heuristic tuned on iOS's light",
    "                 notifications; --no-banner-check after reading the PNG when the light band is the app's own)",
    '',
    'A folder argument checks every .png inside it (not recursive). The expected model is --device, else the',
    'deviceType of contracts/ios-sim-build.json under --root (default: the current folder), else iPhone 17 Pro Max.',
    'Example: node check-screenshot.mjs reports/ios-sim --device "iPhone 17 Pro Max"',
  ].join('\n'),
};

/** { width, height, label }: --size, else --device, else the contract deviceType, else the default model. */
function expectedSize(options) {
  if (options.size) {
    const match = /^(\d+)x(\d+)$/.exec(options.size);
    if (!match) fail(`--size ${options.size} is not WIDTHxHEIGHT`, 'Write it like --size 1320x2868.');
    return { width: Number(match[1]), height: Number(match[2]), label: options.size };
  }
  let device = options.device;
  let source = '--device';
  if (device === undefined) {
    const root = requireDir(resolve(options.root), 'repo root (--root)');
    const contract = readSimContract(root, resolveLayout(root));
    device = contract.data.deviceType ?? DEFAULT_DEVICE;
    source = contract.data.deviceType === undefined ? 'the default' : `${contract.rel} deviceType`;
  }
  const size = DEVICES[device];
  if (!size) fail(`unknown device "${device}" (${source})`, `Use one of: ${Object.keys(DEVICES).join(', ')}, or pass --size WxH.`);
  const label = source === '--device' || source === 'the default' ? device : `${device}, ${source}`;
  return { width: size[0], height: size[1], label };
}

function collect(paths) {
  const files = [];
  for (const path of paths) {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      fail(`nothing to check: ${path} does not exist`, 'Pass the screenshot PNG (or its folder) that build:ios:sim printed.');
    }
    if (stat.isDirectory()) files.push(...readdirSync(path).filter((name) => name.endsWith('.png')).sort().map((name) => join(path, name)));
    else files.push(path);
  }
  return files;
}

function describe(hex) {
  if (hex === '#000000') return 'black';
  if (hex === '#FFFFFF') return 'white';
  // rgb(242, 242, 242) is React Navigation's default light background, which Expo Router's stacks
  // use too: a screen that rendered no content of its own.
  if (hex === '#F2F2F2') return "#F2F2F2 (React Navigation's default background, so the screen rendered no content)";
  return hex;
}

function readImage(file) {
  try {
    return readPng(file);
  } catch (error) {
    return fail(`${file} is not a readable PNG (${error.message})`, 'Pass the PNG xcrun simctl io <udid> screenshot wrote.');
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (positionals.length === 0) fail('nothing to check: no screenshot given', 'Pass the PNG that build:ios:sim printed, e.g. reports/ios-sim/smoke-preview.png.');
  const { width, height, label } = expectedSize(options);
  const report = createReporter({ name: 'check-screenshot', json: options.json });
  const files = collect(positionals);
  for (const file of files) {
    const shown = toPosix(relative(process.cwd(), file)) || file;
    const image = readImage(file);
    if (image.width !== width || image.height !== height) {
      report.problem({ file: shown, rule: 'png-size', message: `is ${image.width}x${image.height}, expected ${width}x${height} (${label})`, fix: 'Take the screenshot on the <prefix>-<purpose> simulator of the expected model (the contract deviceType), or pass the model it was taken on with --device.' });
    }
    const { hex, share } = dominantColour(image, { top: Math.round(image.height * STATUS_BAR_SHARE) });
    if (share >= BLANK_SHARE) {
      report.problem({ file: shown, rule: 'blank-screen', message: `${(share * 100).toFixed(1)}% of the screen is ${describe(hex)}: the app crashed, is still loading or drew nothing`, fix: 'Open the PNG, read build/ios-sim/logs/, relaunch with simctl launch --terminate-running-process <udid>, wait for the ready signal and screenshot again.' });
    }
    const bannerRows = options['no-banner-check'] ? 0 : lightBannerRows(image);
    if (bannerRows >= BANNER_MIN_ROWS) {
      report.problem({ file: shown, rule: 'system-banner', message: `a light system banner (a notification, ${bannerRows} rows) covers the top of the app, so the screenshot does not show the app's own top`, fix: "Dismiss the notification (wait until it slides away, or swipe it up), take the screenshot again and open it. When the light band is really the app's own, rerun with --no-banner-check." });
    }
  }
  return report.finish({ checked: files.length, unit: 'screenshots' });
});
