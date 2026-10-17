#!/usr/bin/env node
// check-review.mjs: proves one design review (design-review/<review-id>/review.json and its captures
// under reports/design-review/<review-id>/) is complete and honest: every cell of the plan captured as
// a real, non-blank screenshot of its device, no axis silently not applied (light and dark, two
// locales or two text sizes giving the same picture), every motion video recorded, every finding
// graded with the floor as BLOCKER, the on-device pass answered on real hardware in plan order, one fix
// round with every fix re-shot, and a dated sign-off that matches what was found.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-review.mjs [repo-root] [--review <id>] [--in-progress]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, decodePng, parseArgs, resolveLayout, run, sha256, toPosix, UsageError } from './check-lib.mjs';
import { jsonLine, loadPlan, planCells, planShapeProblems, planVideos, sweptScreens } from './lib/review-plan.mjs';
import { buildProblems, checkDevicePass, checkFindings, checkFixRound, checkSignoff, loadReview, recordShapeProblems } from './lib/review-record.mjs';

const SPEC = {
  name: 'check-review',
  summary: 'Checks one design review: the captured matrix, the motion videos, the graded findings, the on-device pass, the one fix round and the dated sign-off.',
  usage: '[repo-root] [options]',
  options: {
    review: { type: 'string', value: 'id', help: 'The review folder under design-review/ (default: the newest)' },
    plan: { type: 'string', value: 'file', help: 'The plan file (default: <contractsDir>/design-review.json)' },
    'in-progress': { type: 'boolean', help: 'Do not require the sign-off yet (everything else stays strict)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: review-record, review-stale, review-cells, review-capture, review-axis, review-videos,',
    'review-findings, review-floor, review-device-pass, review-fix-round, review-signoff.',
    'Exit 2 when the plan, the screen contract or the record is missing or invalid (run check-review-plan.mjs first).',
  ].join('\n'),
};

/**
 * A blank frame (a white flash, a black first frame, an empty window) is one flat colour, or two (a
 * fill and a flat block). A real screen has anti-aliased text and icons, so many colours, even when
 * it is sparse: a title, an icon and one line on a tablet leave one colour on more than 99 % of the
 * pixels, so the share of the main colour never decides (references/failure-messages.md, limits).
 */
const BLANK_MAX_COLOURS = 2;
/** The status bar at the top and the home indicator, navigation bar or taskbar at the bottom. */
const SYSTEM_BAR_SHARE = 0.08;
const MIN_VIDEO_BYTES = 1024;
const AXES = { theme: 'themes', locale: 'locales', text: 'text sizes' };

/**
 * The colours between the system bars, sampled on a grid: how many distinct ones, and the share of
 * the most common (1.0 = one flat colour).
 */
function colourSample({ width, height, data }) {
  const counts = new Map();
  let total = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120));
  const bottom = Math.max(1, Math.ceil(height * (1 - SYSTEM_BAR_SHARE)));
  for (let y = Math.floor(height * SYSTEM_BAR_SHARE); y < bottom; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const key = (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  return { colours: counts.size, share: total === 0 ? 1 : Math.max(...counts.values()) / total };
}

function checkStale(root, review, loaded, swept, report) {
  const { record, rel, text } = review;
  if (record.plan.sha256 !== loaded.sha256) {
    report.problem({ file: rel, line: jsonLine(text, '"plan"'), rule: 'review-stale', message: `${loaded.rel} changed after the review started`, fix: 'Run new-review.mjs --refresh (it adds the new cells and drops a sign-off), capture what is new, and look again.' });
  }
  if (record.screens.sha256 !== swept.sha256) {
    report.problem({ file: rel, line: jsonLine(text, '"screens"'), rule: 'review-stale', message: `${swept.rel} changed after the review started (a screen, state or element changed)`, fix: 'Run new-review.mjs --refresh, capture the changed screens and look again.' });
  }
}

function checkCells(root, review, plan, cells, report) {
  const { record, rel, text } = review;
  const dir = toPosix(join(review.capturesDir, 'cells'));
  const shots = new Map();
  const sizes = new Map();
  const wanted = new Set(cells.map((c) => c.name));
  for (const name of Object.keys(record.cells)) {
    if (!wanted.has(name)) report.problem({ file: rel, line: jsonLine(text, '"cells"', `"${name}"`), rule: 'review-cells', message: `cell "${name}" is not in the plan`, fix: 'Run new-review.mjs --refresh: the inventory follows the plan.' });
  }
  if (existsSync(join(root, dir))) {
    for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith('.png'))) {
      if (!wanted.has(file.slice(0, -4))) report.problem({ file: `${dir}/${file}`, rule: 'review-cells', message: 'a capture that is no cell of the plan', fix: 'Delete it (a stale shot misleads the review), or fix its name.' });
    }
  }
  for (const cell of cells) {
    const file = `${dir}/${cell.name}.png`;
    if (!(cell.name in record.cells)) {
      report.problem({ file: rel, line: jsonLine(text, '"cells"'), rule: 'review-cells', message: `cell "${cell.name}" is missing from the inventory`, fix: 'Run new-review.mjs --refresh.' });
      continue;
    }
    if (!existsSync(join(root, file))) {
      report.problem({ file, rule: 'review-cells', message: 'not captured', fix: 'Capture the cell on its own device and settings (references/capture-recipes.md); every cell of the matrix is a file.' });
      continue;
    }
    const buffer = readFileSync(join(root, file));
    const sha = sha256(buffer);
    shots.set(cell.name, sha);
    if (record.cells[cell.name] !== sha) {
      report.problem({ file, rule: 'review-cells', message: record.cells[cell.name] === null ? 'captured but not in the inventory yet' : 'the capture changed since the inventory was written', fix: 'Run new-review.mjs --refresh, then look at the new shot; a refresh after the sign-off drops it, so sign again once the new shot was looked at.' });
    }
    let png;
    try {
      png = decodePng(buffer);
    } catch (error) {
      report.problem({ file, rule: 'review-capture', message: `not a readable PNG (${error.message})`, fix: 'Capture again with xcrun simctl io <udid> screenshot or adb -s <serial> exec-out screencap -p.' });
      continue;
    }
    checkCapture(file, cell, png, plan, sizes, report);
  }
  return shots;
}

function checkCapture(file, cell, png, plan, sizes, report) {
  const device = plan.devices.find((d) => d.id === cell.device);
  const size = `${png.width}x${png.height}`;
  if (Array.isArray(device.size) && (png.width !== device.size[0] || png.height !== device.size[1])) {
    report.problem({ file, rule: 'review-capture', message: `${size} pixels, but device "${device.id}" is ${device.size.join('x')}`, fix: 'Capture on the device the plan names (another model or a scaled window compares nothing).' });
  } else if (sizes.has(device.id) && sizes.get(device.id).size !== size) {
    report.problem({ file, rule: 'review-capture', message: `${size} pixels, but other captures of "${device.id}" are ${sizes.get(device.id).size} (${sizes.get(device.id).file})`, fix: 'Capture every cell of a device on that one device, in one orientation.' });
  }
  if (!sizes.has(device.id)) sizes.set(device.id, { size, file });
  const landscape = png.width > png.height;
  if (landscape !== (device.orientation === 'landscape')) {
    report.problem({ file, rule: 'review-capture', message: `captured in ${landscape ? 'landscape' : 'portrait'}, the plan sweeps "${device.id}" in ${device.orientation ?? 'portrait'}`, fix: 'Rotate the device to the planned orientation and capture again.' });
  }
  const { colours, share } = colourSample(png);
  if (colours <= BLANK_MAX_COLOURS) {
    report.problem({ file, rule: 'review-capture', message: `blank: ${colours} distinct ${colours === 1 ? 'colour' : 'colours'} between the system bars, one covering ${(share * 100).toFixed(1)}%`, fix: 'The app was not ready (black first frame, white flash, an empty window); wait for the screen root testID and for animations to end, then capture.' });
  }
}

const AXIS_FIX = {
  theme: 'The appearance was not applied (simctl ui appearance / cmd uimode night, or the theme setting left on light); set it and capture again.',
  locale: 'The language was not applied (the lang link parameter or the launch locale); capture again.',
  text: 'The text size was not applied (simctl ui content_size / settings put system font_scale), or the app ignores it (an accessibility-floor BLOCKER); capture again and look.',
};

function checkAxes(review, cells, shots, plan, report) {
  const invariant = new Set((plan.screens.invariant ?? []).map((e) => `${e.screen}|${e.axis}`));
  for (const axis of Object.keys(AXES)) {
    const groups = new Map();
    for (const cell of cells) {
      if (!shots.has(cell.name) || invariant.has(`${cell.screen}|${axis}`)) continue;
      const key = ['screen', 'state', 'theme', 'locale', 'text', 'device'].filter((a) => a !== axis).map((a) => cell[a]).join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cell);
    }
    for (const group of groups.values()) {
      const first = new Map();
      for (const cell of group) {
        const sha = shots.get(cell.name);
        const earlier = first.get(sha);
        if (!earlier) {
          first.set(sha, cell);
          continue;
        }
        report.problem({
          file: toPosix(join(review.capturesDir, 'cells', `${cell.name}.png`)),
          rule: 'review-axis',
          message: `identical to ${earlier.name}.png: the ${AXES[axis]} "${earlier[axis]}" and "${cell[axis]}" gave the same picture`,
          fix: AXIS_FIX[axis],
        });
      }
    }
  }
}

function checkVideos(root, review, videos, report) {
  const { record, rel, text } = review;
  const dir = toPosix(join(review.capturesDir, 'motion'));
  const wanted = new Set(videos);
  for (const name of Object.keys(record.videos)) {
    if (!wanted.has(name)) report.problem({ file: rel, line: jsonLine(text, '"videos"', `"${name}"`), rule: 'review-videos', message: `video "${name}" is not in the plan`, fix: 'Run new-review.mjs --refresh.' });
  }
  for (const name of videos) {
    const file = ['mp4', 'mov'].map((ext) => `${dir}/${name}.${ext}`).find((f) => existsSync(join(root, f)));
    if (!(name in record.videos)) report.problem({ file: rel, line: jsonLine(text, '"videos"'), rule: 'review-videos', message: `video "${name}" is missing from the inventory`, fix: 'Run new-review.mjs --refresh.' });
    if (!file) {
      report.problem({ file: `${dir}/${name}.mp4`, rule: 'review-videos', message: 'not recorded', fix: 'Record the moment with motion on and reduced, tapping mid-animation once (references/capture-recipes.md).' });
      continue;
    }
    const buffer = readFileSync(join(root, file));
    if (buffer.length < MIN_VIDEO_BYTES || buffer.subarray(4, 8).toString('latin1') !== 'ftyp') {
      report.problem({ file, rule: 'review-videos', message: `not a QuickTime or MP4 movie (${buffer.length} bytes)`, fix: 'Record again (xcrun simctl io <udid> recordVideo, adb -s <serial> shell screenrecord) and pull the finished file.' });
    } else if (record.videos[name] !== sha256(buffer)) {
      report.problem({ file, rule: 'review-videos', message: 'recorded but not in the inventory, or changed since', fix: 'Run new-review.mjs --refresh, then watch it; a refresh after the sign-off drops it, so sign again.' });
    }
  }
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const layout = resolveLayout(root);
  const loaded = loadPlan(root, layout, options.plan);
  if (planShapeProblems(loaded).length > 0) throw new UsageError(`${loaded.rel} is not a valid plan`, 'Run check-review-plan.mjs and fix it first.');
  const swept = sweptScreens(root, loaded);
  if (swept.missing || swept.error) throw new UsageError(`cannot read the screen contract ${swept.rel}`, 'Run check-review-plan.mjs first (screen-contracts owns the contract).');
  const review = loadReview(root, loaded, options.review);
  const report = createReporter({ name: 'check-review', json: options.json });
  const shape = recordShapeProblems(review);
  for (const problem of shape) report.problem(problem);
  if (shape.length > 0) return report.finish({ checked: 1, unit: 'review' });
  const { plan } = loaded;
  const cells = planCells(plan, swept.screens);
  const videos = planVideos(plan);
  buildProblems(review, plan, report);
  checkStale(root, review, loaded, swept, report);
  const shots = checkCells(root, review, plan, cells, report);
  checkAxes(review, cells, shots, plan, report);
  checkVideos(root, review, videos, report);
  checkFindings(review, plan, report);
  checkDevicePass(review, plan, report);
  checkFixRound(review, report);
  const signoff = checkSignoff(review, report, { requireSignoff: !options['in-progress'] });
  const findings = Object.values(review.record.findings);
  const count = (grade) => findings.filter((f) => f?.grade === grade).length;
  report.note(`review ${review.id}: ${shots.size}/${cells.length} cells, ${videos.length} videos, findings ${count('BLOCKER')} BLOCKER / ${count('FIX')} FIX / ${count('NOTE')} NOTE, verdict ${signoff?.verdict ?? 'none yet'}`);
  return report.finish({ checked: cells.length + videos.length, unit: 'captures' });
});
