#!/usr/bin/env node
// new-review.mjs: starts a design review and keeps its record in step with the captures. Without
// --refresh it writes design-review/<review-id>/review.json from the plan (every cell and video with
// a null hash, the on-device pass per hardware with an empty result per step, no findings, the plan
// and screen-contract hashes, the build facts) and makes the capture folders. With --refresh it
// follows the plan again (adds new cells, drops gone ones), stores for each finding the hash of every
// cell and video it was seen on (once per name), then hashes every capture present; when the plan or
// the screens changed it drops the sign-off, which no longer covers them. It never invents a result,
// a grade or a verdict.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/new-review.mjs [repo-root] [--id <review-id>] [--refresh]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, resolveLayout, run, sha256, toPosix, UsageError } from './check-lib.mjs';
import { appFacts, isObject, KEBAB, loadPlan, localToday, planCells, planShapeProblems, planVideos, sweptScreens } from './lib/review-plan.mjs';
import { formatJson, loadReview, RECORD_FILE } from './lib/review-record.mjs';

const SPEC = {
  name: 'new-review',
  summary: 'Writes a new design-review record from the plan, or (--refresh) brings an existing record in step with the plan and the captures.',
  usage: '[repo-root] [options]',
  options: {
    id: { type: 'string', value: 'review-id', help: 'The review id, <YYYY-MM-DD>-<slug> (default: today and the app version; with --refresh: the newest review)' },
    refresh: { type: 'boolean', help: 'Update an existing record: cells and videos from the plan, seen hashes of findings, capture hashes' },
    plan: { type: 'string', value: 'file', help: 'The plan file (default: <contractsDir>/design-review.json)' },
  },
  positionals: { min: 0, max: 1 },
  details: 'Rule: plan-invalid (the plan must be readable before a record is written). Exit 2 when the plan, the screen contract or the app config is missing, or the review id is taken (without --refresh).',
};

const REVIEW_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;

function headCommit(root) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function captureHash(root, file) {
  const abs = join(root, file);
  return existsSync(abs) ? sha256(readFileSync(abs)) : null;
}

function videoFile(root, capturesDir, name) {
  return ['mp4', 'mov'].map((ext) => toPosix(join(capturesDir, 'motion', `${name}.${ext}`))).find((f) => existsSync(join(root, f))) ?? null;
}

function freshRecord({ id, loaded, swept, facts, root, cells, videos, today }) {
  const { plan } = loaded;
  const devicePass = {};
  for (const hardware of plan.devicePass.hardware) {
    devicePass[hardware.id] = {
      model: hardware.model,
      os: '',
      date: '',
      results: Object.fromEntries(plan.devicePass.steps.map((step) => [step.id, {}])),
    };
  }
  return {
    $comment: 'A design review (design-review-workflow). new-review.mjs writes and refreshes the inventory; people write the results, findings, the fix round and the sign-off. check-review.mjs checks it with the captures, check-signoff.mjs gates the release.',
    version: 1,
    id,
    startedOn: today,
    plan: { file: loaded.rel, sha256: loaded.sha256 },
    screens: { file: swept.rel, sha256: swept.sha256 },
    build: { variant: plan.build.variant, appVersion: facts.version ?? '', commit: headCommit(root), verify: '' },
    cells: Object.fromEntries(cells.map((c) => [c.name, null])),
    videos: Object.fromEntries(videos.map((v) => [v, null])),
    devicePass,
    findings: {},
    fixRound: null,
    signoff: null,
  };
}

function refreshRecord({ record, loaded, swept, root, capturesDir, cells, videos, report }) {
  const before = isObject(record.cells) ? record.cells : {};
  const videosBefore = isObject(record.videos) ? record.videos : {};
  let seenAdded = 0;
  for (const finding of Object.values(isObject(record.findings) ? record.findings : {})) {
    if (!isObject(finding)) continue;
    // Each named cell and video gets its hash once, from the inventory as it was when the finding was
    // written (before this refresh hashes the re-shot captures); a hash already stored never changes.
    const named = [
      ...(Array.isArray(finding.cells) ? finding.cells : []).map((name) => [name, before[name]]),
      ...(Array.isArray(finding.videos) ? finding.videos : []).map((name) => [name, videosBefore[name]]),
    ];
    const seen = isObject(finding.seen) ? finding.seen : {};
    const fresh = named.filter(([name, hash]) => typeof hash === 'string' && seen[name] === undefined);
    if (fresh.length > 0) {
      finding.seen = { ...seen, ...Object.fromEntries(fresh) };
      seenAdded += 1;
    }
  }
  record.cells = Object.fromEntries(cells.map((c) => [c.name, captureHash(root, toPosix(join(capturesDir, 'cells', `${c.name}.png`)))]));
  record.videos = Object.fromEntries(videos.map((v) => {
    const file = videoFile(root, capturesDir, v);
    return [v, file ? captureHash(root, file) : null];
  }));
  const changed = record.plan?.sha256 !== loaded.sha256 || record.screens?.sha256 !== swept.sha256;
  record.plan = { file: loaded.rel, sha256: loaded.sha256 };
  record.screens = { file: swept.rel, sha256: swept.sha256 };
  // A capture swapped after the sign-off was never looked at by the person who signed.
  const swapped = [
    ...Object.entries(record.cells).filter(([name, hash]) => typeof before[name] === 'string' && hash !== before[name]).map(([name]) => name),
    ...Object.entries(record.videos).filter(([name, hash]) => typeof videosBefore[name] === 'string' && hash !== videosBefore[name]).map(([name]) => name),
  ];
  if (changed && record.signoff) {
    record.signoff = null;
    report.note('the plan or the screen contract changed: the sign-off was dropped (it no longer covers what the plan asks)');
  } else if (swapped.length > 0 && record.signoff) {
    record.signoff = null;
    report.note(`${swapped.length} capture(s) changed after the sign-off (${swapped.slice(0, 3).join(', ')}${swapped.length > 3 ? ', ...' : ''}): the sign-off was dropped; look at them and sign again`);
  }
  const added = cells.filter((c) => !(c.name in before)).length;
  const dropped = Object.keys(before).filter((name) => !cells.some((c) => c.name === name)).length;
  report.note(`refreshed: ${added} cells added, ${dropped} dropped, ${seenAdded} findings got their seen hashes`);
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const layout = resolveLayout(root);
  const loaded = loadPlan(root, layout, options.plan);
  const report = createReporter({ name: 'new-review' });
  const shape = planShapeProblems(loaded);
  if (shape.length > 0) {
    for (const problem of shape) report.problem(problem);
    return report.finish({ checked: 1, unit: 'plan' });
  }
  const swept = sweptScreens(root, loaded);
  if (swept.missing || swept.error) throw new UsageError(`cannot read the screen contract ${swept.rel}`, 'Run check-review-plan.mjs first (screen-contracts owns the contract).');
  const facts = appFacts(root);
  if (!facts) throw new UsageError('nothing to check: no app.config.ts, app.config.js or app.json', 'Run from the app repo root.');
  const cells = planCells(loaded.plan, swept.screens);
  const videos = planVideos(loaded.plan);
  const today = localToday();
  if (options.refresh) {
    const review = loadReview(root, loaded, options.id);
    const { record } = review;
    if (!isObject(record)) throw new UsageError(`${review.rel} is not a JSON object`, 'Fix it, or start a new review.');
    refreshRecord({ record, loaded, swept, root, capturesDir: review.capturesDir, cells, videos, report });
    writeFileSync(join(root, review.rel), formatJson(record));
    const captured = Object.values(record.cells).filter(Boolean).length;
    report.note(`wrote ${review.rel}: ${captured}/${cells.length} cells and ${Object.values(record.videos).filter(Boolean).length}/${videos.length} videos captured`);
    return report.finish({ checked: cells.length + videos.length, unit: 'captures' });
  }
  const slug = (facts.version ?? 'review').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const id = options.id ?? `${today}-${slug || 'review'}`;
  if (!REVIEW_ID.test(id) || !KEBAB.test(id)) throw new UsageError(`review id "${id}" is not <YYYY-MM-DD>-<slug>`, 'Use the day and a kebab-case slug, for example 2026-10-14-1-2-0.');
  const rel = toPosix(join(loaded.reviewsDir, id, RECORD_FILE));
  if (existsSync(join(root, rel))) throw new UsageError(`${rel} exists`, 'Pass --refresh to update it, or another --id.');
  const record = freshRecord({ id, loaded, swept, facts, root, cells, videos, today });
  const capturesDir = toPosix(join(loaded.capturesDir, id));
  mkdirSync(join(root, loaded.reviewsDir, id), { recursive: true });
  mkdirSync(join(root, capturesDir, 'cells'), { recursive: true });
  mkdirSync(join(root, capturesDir, 'motion'), { recursive: true });
  writeFileSync(join(root, rel), formatJson(record));
  report.note(`wrote ${rel}: ${cells.length} cells, ${videos.length} videos, ${loaded.plan.devicePass.hardware.length} hardware x ${loaded.plan.devicePass.steps.length} steps`);
  report.note(`captures go to ${capturesDir}/cells/<cell>.png and ${capturesDir}/motion/<video>.mp4`);
  if (!record.build.commit) report.note('build.commit is empty (not a git repository): write the commit of the swept build');
  return report.finish({ checked: cells.length + videos.length, unit: 'captures' });
});
