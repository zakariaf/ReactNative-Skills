#!/usr/bin/env node
// selftest.mjs: proves every script of the skill against tests/fixtures/. The plan and new-review
// suites start from a small Tasks app (tests/bases/app) with the shipped plan template; the review and
// sign-off suites start from that app after a whole review (built below the way a reviewer works:
// new-review.mjs, a capture per cell, --refresh, results and findings, one re-shot cell and one
// re-recorded video in the fix round, the sign-off),
// so the good case is the real workflow and every bad case plants one bug. The "configured" suites
// start from a review whose plan was set up before it began (an invariant screen, signoff watch and
// ignore globs) and whose iPad cells are real-size sparse screens (2266 x 1488: a title, an icon and
// one line), which must not count as blank. Before the suites, the shipped review-cells.ts template
// must name the same cells as the checkers' own grammar.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runSelftest, sha256, writePng } from './check-lib.mjs';
import { planCells, planVideos } from './lib/review-plan.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SKILL = dirname(SCRIPTS);
const BASE_APP = join(SKILL, 'tests', 'bases', 'app');
const PLAN_TEMPLATE = join(SKILL, 'templates', 'contracts');
const REVIEW_ID = '2026-10-01-1-0-0';
const DAY = '2026-10-01';
const SWEPT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const FIXED = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1';
const FIX_CELL = 'tasks.default--dark--ar--largest--ios-phone-small';
const FIX_VIDEO = 'press--ios--full';

function node(args) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`node ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
}

const colourOf = (hash) => `#${hash.toString(16).padStart(6, '0')}`;

/**
 * A distinct, non-blank screenshot per cell: light or dark ground, a bar whose colour and width follow
 * the name (`seed`: the name with an invariant axis folded, so those shots are identical). With
 * `sparse`, the iPad cells are a real-size sparse screen: a 300 x 48 title, a 96 px icon and one
 * 400 x 16 line on 2266 x 1488, where one colour covers about 99 % of the pixels.
 */
function shoot(file, name, { variant = 0, seed = name, sparse = false } = {}) {
  const hash = parseInt(sha256(`${seed}:${variant}`).slice(0, 6), 16);
  const fill = name.includes('--dark--') ? '#111111' : '#fafafa';
  if (sparse && name.endsWith('--ios-tablet')) {
    writePng(file, {
      width: 2266,
      height: 1488,
      fill,
      rects: [
        { x: 120 + (hash % 200), y: 300, width: 300, height: 48, fill: colourOf(hash) },
        { x: 1085, y: 560, width: 96, height: 96, fill: '#3366ff' },
        { x: 933, y: 700, width: 400, height: 16, fill: '#8a8a8a' },
      ],
    });
    return;
  }
  const size = name.endsWith('--android-tablet') ? [80, 50] : name.endsWith('--ios-tablet') ? [80, 60] : [40, 70];
  writePng(file, {
    width: size[0],
    height: size[1],
    fill,
    rects: [
      { x: 2, y: 10, width: 20, height: 8, fill: colourOf(hash) },
      { x: 4, y: 30, width: (hash % 15) + 3, height: 6, fill: '#3366ff' },
    ],
  });
}

function video(file, name, take = 0) {
  const buffer = Buffer.alloc(2048);
  buffer.write('ftypisom', 4, 'latin1');
  buffer.write(`${name}:${take}`, 16, 'latin1');
  writeFileSync(file, buffer);
}

function editRecord(dir, edit) {
  const file = join(dir, 'design-review', REVIEW_ID, 'review.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  edit(record);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** The plan edits of the configured review, made before it starts (a plan change later is staleness). */
const CONFIGURED_PLAN = {
  invariant: [{ screen: 'not-found', axis: 'locale', why: 'The not-found screen shows one picture and no words in any language.' }],
  signoff: { watch: ['native/'], ignore: ['src/dev-tools/**'] },
};

/** The cell name with every axis the plan declares invariant for its screen folded to "*". */
function seedOf(name, invariant) {
  const [head, theme, locale, text, device] = name.split('--');
  const screen = head.split('.')[0];
  const folded = (axis, value) => (invariant.some((e) => e.screen === screen && e.axis === axis) ? '*' : value);
  return [head, folded('theme', theme), folded('locale', locale), folded('text', text), device].join('--');
}

/** The base app after one whole, signed-off review; `configured` sets the plan up first and shoots real-size iPad cells. */
async function reviewedApp(dir, { configured = false } = {}) {
  cpSync(BASE_APP, dir, { recursive: true });
  cpSync(PLAN_TEMPLATE, join(dir, 'contracts'), { recursive: true });
  const planFile = join(dir, 'contracts', 'design-review.json');
  const invariant = configured ? CONFIGURED_PLAN.invariant : [];
  if (configured) {
    const plan = JSON.parse(readFileSync(planFile, 'utf8'));
    plan.screens.invariant = CONFIGURED_PLAN.invariant;
    plan.signoff = CONFIGURED_PLAN.signoff;
    writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  }
  const newReview = join(SCRIPTS, 'new-review.mjs');
  node([newReview, dir, '--id', REVIEW_ID]);
  const captures = join(dir, 'reports', 'design-review', REVIEW_ID);
  const record = JSON.parse(readFileSync(join(dir, 'design-review', REVIEW_ID, 'review.json'), 'utf8'));
  for (const name of Object.keys(record.cells)) shoot(join(captures, 'cells', `${name}.png`), name, { seed: seedOf(name, invariant), sparse: configured });
  for (const name of Object.keys(record.videos)) video(join(captures, 'motion', `${name}.mp4`), name);
  node([newReview, dir, '--refresh']);
  editRecord(dir, (r) => {
    r.startedOn = DAY;
    r.build = { variant: 'preview', appVersion: '1.0.0', commit: SWEPT, verify: 'pass' };
    for (const [hardware, os] of [['iphone', 'iOS 26.0'], ['android-budget', 'Android 14']]) {
      r.devicePass[hardware].os = os;
      r.devicePass[hardware].date = DAY;
      for (const step of Object.keys(r.devicePass[hardware].results)) {
        r.devicePass[hardware].results[step] = step === 'backup-restore' ? { result: 'n/a', why: 'The app has no export or import of its data yet.' } : { result: 'pass' };
      }
    }
    r.findings.F1 = { grade: 'FIX', lens: 'identity', what: 'The summary line sits 4 pt closer to the list than every other screen.', cells: [FIX_CELL], status: 'open', openedIn: 'sweep' };
    r.findings.F2 = { grade: 'NOTE', lens: 'parity', what: 'The empty-list picture reads colder in dark mode than the design baseline.', screen: 'tasks', status: 'open', openedIn: 'sweep' };
    r.findings.F3 = { grade: 'FIX', lens: 'motion', what: 'The press feedback on iOS overshoots and settles a frame after the finger lifts.', videos: [FIX_VIDEO], status: 'open', openedIn: 'sweep' };
  });
  node([newReview, dir, '--refresh']);
  shoot(join(captures, 'cells', `${FIX_CELL}.png`), FIX_CELL, { variant: 1 });
  video(join(captures, 'motion', `${FIX_VIDEO}.mp4`), FIX_VIDEO, 1);
  node([newReview, dir, '--refresh']);
  editRecord(dir, (r) => {
    r.findings.F1.status = 'fixed';
    r.findings.F1.fix = 'The summary row takes the spacing token instead of a literal.';
    r.findings.F3.status = 'fixed';
    r.findings.F3.fix = 'The press spring takes the motion token with no overshoot.';
    r.findings.F2.status = 'deferred';
    r.findings.F2.backlog = '#42';
    r.fixRound = { commit: FIXED, verify: 'pass', date: DAY };
    r.signoff = { date: DAY, reviewer: 'A. Reviewer', commit: FIXED, verdict: 'SIGNED OFF' };
  });
}

/** The shipped review-cells.ts template and the checkers must name the same cells and videos. */
async function crossCheckGrammar() {
  const plan = JSON.parse(readFileSync(join(PLAN_TEMPLATE, 'design-review.json'), 'utf8'));
  const screens = [{ id: 'tasks', states: ['default', 'empty'] }, { id: 'not-found', states: ['default'] }];
  const template = await import(pathToFileURL(join(SKILL, 'templates', 'scripts', 'design-review', 'review-cells.ts')).href);
  const fromTemplate = template.reviewCells(plan, screens).map((c) => c.name);
  const fromChecker = planCells(plan, screens).map((c) => c.name);
  const videosMatch = JSON.stringify(template.motionVideos(plan)) === JSON.stringify(planVideos(plan));
  if (JSON.stringify(fromTemplate) !== JSON.stringify(fromChecker) || !videosMatch) {
    console.log('FAIL templates/scripts/design-review/review-cells.ts [cell-grammar] the template and scripts/lib/review-plan.mjs name different cells or videos Fix: keep both grammars the same.');
    console.log('RESULT: FAIL (1 problems)');
    process.exit(1);
  }
  console.log(`cell grammar: template and checkers agree on ${fromChecker.length} cells and ${planVideos(plan).length} videos`);
}

await crossCheckGrammar();

const PLANNED_APP = ['@tests/bases/app', { from: '@skill/templates/contracts', to: 'contracts' }];
const REVIEWED_APP = [{ build: async (dir) => reviewedApp(dir) }];
const CONFIGURED_APP = [{ build: async (dir) => reviewedApp(dir, { configured: true }) }];

await runSelftest(import.meta.url, [
  { script: 'check-review-plan.mjs', fixtures: '../tests/fixtures/check-review-plan', args: (dir) => [dir], base: PLANNED_APP },
  { script: 'new-review.mjs', fixtures: '../tests/fixtures/new-review', args: (dir) => [dir], base: PLANNED_APP },
  { script: 'new-review.mjs', fixtures: '../tests/fixtures/new-review-signed', args: (dir) => [dir, '--refresh'], base: REVIEWED_APP },
  { script: 'check-review.mjs', fixtures: '../tests/fixtures/check-review', args: (dir) => [dir], base: REVIEWED_APP },
  { script: 'check-signoff.mjs', fixtures: '../tests/fixtures/check-signoff', args: (dir) => [dir, '--changed-from', 'changed.txt'], base: REVIEWED_APP },
  { script: 'check-review.mjs', fixtures: '../tests/fixtures/check-review-configured', args: (dir) => [dir], base: CONFIGURED_APP },
  { script: 'check-signoff.mjs', fixtures: '../tests/fixtures/check-signoff-configured', args: (dir) => [dir, '--changed-from', 'changed.txt'], base: CONFIGURED_APP },
]);
