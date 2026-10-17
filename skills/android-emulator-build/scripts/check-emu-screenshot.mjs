#!/usr/bin/env node
// check-emu-screenshot.mjs: checks emulator screenshots for the failures a glance must catch: the
// wrong device size (the AVD is not the profile the run asked for) and a blank screen (all black,
// all white or one colour: the app crashed, is still on its splash, or drew nothing). It never
// replaces looking at the PNG; it catches the obvious.
// The expected profile is --device, else the contract's device (the profile build:android:emu creates
// its AVD with), else pixel_8. Unlike the repo checkers, the positionals are the PNGs or their
// folders; the repo root (for the contract) is --root, default the current folder.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-emu-screenshot.mjs reports/android-emu/
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, readPng, requireDir, resolveLayout, run, toPosix } from './check-lib.mjs';
import { readEmuContract } from './lib/emu-contract.mjs';

// Pixel sizes (portrait) of the avdmanager hardware profiles, read from the device definitions of
// Android SDK cmdline-tools 16.0 (sdklib devices.xml / nexus.xml), verified 2026-10-14. adb screencap
// returns the display's current rotation, so a landscape image of the same size passes too.
const DEVICES = {
  pixel_8: [1080, 2400],
  pixel_8a: [1080, 2400],
  pixel_8_pro: [1344, 2992],
  pixel_7: [1080, 2400],
  pixel_7_pro: [1440, 3120],
  pixel_6: [1080, 2400],
  medium_phone: [1080, 2400],
  small_phone: [720, 1280],
  pixel_fold: [1840, 2208],
  pixel_tablet: [1600, 2560],
  medium_tablet: [1600, 2560],
};
// The status bar (24 dp, about 3% of a phone's height) and the gesture bar (about 2%) are drawn by
// System UI over every app, so both bands are left out of the blank test.
const TOP_SHARE = 0.04;
const BOTTOM_SHARE = 0.03;
// A real screen has text, controls or art; 99% of one colour means nothing was drawn. A flat splash
// with a small icon stays just below 99% at 1080 x 2400, so a splash still on screen after the ready
// signal is caught by looking, not by this rule.
const BLANK_SHARE = 0.99;
const DEFAULT_DEVICE = 'pixel_8';
const SAMPLE_STEP = 3;

const SPEC = {
  name: 'check-emu-screenshot',
  summary: 'Checks Android emulator screenshots: the pixel size of the AVD hardware profile and no blank screen (one colour over 99% between the status bar and the gesture bar).',
  usage: '[options] <png-or-folder>...',
  options: {
    device: { type: 'string', value: 'profile', help: `avdmanager hardware profile whose size is expected (default: the contract device, else ${DEFAULT_DEVICE}; known: ${Object.keys(DEVICES).join(', ')})` },
    size: { type: 'string', value: 'WxH', help: 'Expected size in pixels instead of --device (for example 1080x2400)' },
    root: { type: 'string', value: 'dir', default: '.', help: 'Repo root whose contracts/android-emu-build.json device is the default --device' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'Rules:',
    '  png-size      the image has the pixel size of the AVD profile it was taken on (either orientation)',
    '  blank-screen  between the status bar and the gesture bar, no single colour covers 99% of the image',
    '',
    'Example: node check-emu-screenshot.mjs reports/android-emu/',
  ].join('\n'),
};

function expectedSize(options) {
  if (options.size !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(options.size);
    if (!match) fail(`--size ${options.size} is not WxH`, 'Pass the size in pixels, for example --size 1080x2400.');
    return { label: options.size, size: [Number(match[1]), Number(match[2])] };
  }
  const root = requireDir(resolve(options.root), 'repo root (--root)');
  const contract = readEmuContract(root, resolveLayout(root));
  const device = options.device ?? contract.data.device ?? DEFAULT_DEVICE;
  if (!DEVICES[device]) fail(`unknown AVD profile "${device}"${options.device ? '' : ` (from ${contract.rel})`}`, `Pass --size WxH, or one of: ${Object.keys(DEVICES).join(', ')}.`);
  return { label: device, size: DEVICES[device] };
}

function pngFiles(inputs) {
  if (inputs.length === 0) fail('nothing to check: pass screenshots or a folder of them', 'Run node check-emu-screenshot.mjs reports/android-emu/');
  const files = [];
  for (const input of inputs) {
    const path = resolve(input);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      fail(`nothing to check: ${input} does not exist`, 'Pass the screenshot paths build:android:emu printed.');
    }
    if (stat.isDirectory()) files.push(...readdirSync(path).filter((name) => name.endsWith('.png')).sort().map((name) => join(path, name)));
    else files.push(path);
  }
  if (files.length === 0) fail('nothing to check: no .png files in the given folders', 'Run build:android:emu first; it writes reports/android-emu/<purpose>-<variant>.png.');
  return files;
}

/** The share of the most common colour between the system bars, sampled every SAMPLE_STEP pixels. */
function dominantShare({ width, height, data }) {
  const counts = new Map();
  let total = 0;
  for (let y = Math.floor(height * TOP_SHARE); y < Math.ceil(height * (1 - BOTTOM_SHARE)); y += SAMPLE_STEP) {
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const at = (y * width + x) * 4;
      const key = (data[at] << 16) | (data[at + 1] << 8) | data[at + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  let best = 0;
  let colour = 0;
  for (const [key, count] of counts) {
    if (count > best) {
      best = count;
      colour = key;
    }
  }
  return { share: total === 0 ? 0 : best / total, hex: `#${colour.toString(16).padStart(6, '0')}` };
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const files = pngFiles(positionals);
  const { label, size } = expectedSize(options);
  const report = createReporter({ name: 'check-emu-screenshot', json: options.json });
  for (const path of files) {
    const file = toPosix(relative(process.cwd(), path)) || path;
    let image;
    try {
      image = readPng(path);
    } catch (error) {
      fail(`${file} is not a PNG this checker can read (${error.message})`, 'Take screenshots with adb -s <serial> exec-out screencap -p (a binary-safe PNG on stdout).');
    }
    const [w, h] = size;
    const fits = (image.width === w && image.height === h) || (image.width === h && image.height === w);
    if (!fits) report.problem({ file, rule: 'png-size', message: `is ${image.width}x${image.height}, expected ${w}x${h} (${label})`, fix: 'Take the screenshot on the AVD the run created with the contract device profile, or pass --device / --size for another one; a resized or cropped image is not evidence.' });
    const { share, hex } = dominantShare(image);
    if (share >= BLANK_SHARE) report.problem({ file, rule: 'blank-screen', message: `${(share * 100).toFixed(1)}% of the screen is ${hex}: the app drew nothing (crashed, still on its splash, or a blank first screen)`, fix: 'Open the PNG, read the crash buffer (adb -s <serial> logcat -b crash -d) and the step logs in build/android-emu/logs/, fix the cause and rebuild.' });
  }
  return report.finish({ checked: files.length, unit: 'screenshots' });
});
