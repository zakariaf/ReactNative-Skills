#!/usr/bin/env node
// selftest.mjs: proves rebaseline.mjs and check-rebaseline.mjs against tests/fixtures/. Both suites start
// from tests/bases/before/ (a small Tasks app with data and pixel goldens), lay node_modules from its
// lockfile, generate the baseline PNGs and record before.json with the real `rebaseline.mjs --start`, so
// the recorded hashes always match the base. The checker suite then lays tests/bases/after/ (the
// re-accepted goldens) and tests/bases/evidence/ (the Jest results and the inspection record) on top; the
// runner suite adds tests/bases/runner/ (a fake Jest that rebaseline.mjs runs through --jest). A case's
// ENV.txt (NAME=value lines) sets environment variables for that case only.
// Run: node scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelftest, writePng } from './check-lib.mjs';
import { PROOF_GOLDENS, TRACK_OBSOLETE_VAR, loadSetup, takeInventory } from './lib/rebaseline-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const bases = join(here, '..', 'tests', 'bases');
/** before.json's startedAt in the checker suite: the evidence timestamps follow it (+10 s per step). */
const STARTED_AT = 1791900000000;
const REASON = 'Tasks progress redesign: the ring stroke goes 6 to 8 px and the digest header shows the open count';
const RING = ['narrow', 'phone', 'tablet'];
const ORPHAN = 'test/goldens/__image_snapshots__/old-badge-golden-test-ts-draws-the-badge-1-snap.png';
const SCREENSHOT = '.maestro/baselines/ios/iphone-17/en-light/tasks.png';

function ringPng(dir, name, stroke) {
  writePng(join(dir, `test/goldens/__image_snapshots__/progress-ring-${name}.png`), {
    width: 24,
    height: 24,
    fill: '#ffffff',
    rects: [{ x: 4, y: 4, width: 16, height: stroke, fill: '#208aef' }],
  });
}

/** node_modules exactly as the lockfile says (optional and platform packages stay absent). */
function installFromLock(dir) {
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/') || entry.optional) continue;
    mkdirSync(join(dir, key), { recursive: true });
    writeFileSync(join(dir, key, 'package.json'), `${JSON.stringify({ name: key.split('node_modules/').pop(), version: entry.version })}\n`);
  }
}

function startRebaseline(dir) {
  const status = join(dir, '..', `${Date.now()}-status.txt`);
  writeFileSync(status, '');
  const result = spawnSync(process.execPath, [join(here, 'rebaseline.mjs'), dir, '--start', '--reason', REASON, '--git-status', status], { encoding: 'utf8' });
  rmSync(status, { force: true });
  if (result.status !== 0) throw new Error(`rebaseline.mjs --start failed while building the base:\n${result.stdout}${result.stderr}`);
}

function buildBefore(dir) {
  cpSync(join(bases, 'before'), dir, { recursive: true });
  installFromLock(dir);
  for (const name of RING) ringPng(dir, name, 6);
  writePng(join(dir, ORPHAN), { width: 24, height: 24, fill: '#208aef' });
  writePng(join(dir, SCREENSHOT), { width: 40, height: 80, fill: '#f4f4f4', rects: [{ x: 4, y: 8, width: 32, height: 6, fill: '#111111' }] });
  startRebaseline(dir);
}

/** The state after a clean rebaseline: re-accepted goldens, the orphan deleted, the evidence written. */
async function buildAfter(dir) {
  buildBefore(dir);
  const beforeFile = join(dir, 'reports/rebaseline/before.json');
  const record = JSON.parse(readFileSync(beforeFile, 'utf8'));
  writeFileSync(beforeFile, `${JSON.stringify({ ...record, startedAt: STARTED_AT }, null, 2)}\n`);
  cpSync(join(bases, 'after'), dir, { recursive: true, filter: (src) => !src.endsWith('removed.txt') });
  rmSync(join(dir, 'removed.txt'), { force: true });
  for (const line of readFileSync(join(bases, 'after', 'removed.txt'), 'utf8').split('\n')) {
    if (line.trim() !== '' && !line.startsWith('#')) rmSync(join(dir, line.trim()));
  }
  ringPng(dir, 'phone', 8);
  ringPng(dir, 'tablet', 8);
  cpSync(join(bases, 'evidence'), join(dir, 'reports/rebaseline'), { recursive: true });
  // What --proof records: the goldens as they are now, written after the last proof run.
  const lastProof = Math.max(...['proof-01.json', 'proof-02.json'].map((name) => JSON.parse(readFileSync(join(dir, 'reports/rebaseline', name), 'utf8')).startTime));
  const { goldens } = takeInventory(dir, loadSetup(dir));
  writeFileSync(join(dir, 'reports/rebaseline', PROOF_GOLDENS), `${JSON.stringify({ writtenAt: lastProof + 5000, goldens }, null, 2)}\n`);
}

/** The variables a case may set in ENV.txt; every other case runs with them unset. */
const CASE_ENV = [TRACK_OBSOLETE_VAR];

/** Apply the case's ENV.txt (runSelftest spawns each case right after args()) and remove the copy it laid. */
function caseEnv(dir) {
  for (const name of CASE_ENV) delete process.env[name];
  const file = join(dir, 'ENV.txt');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match && CASE_ENV.includes(match[1])) process.env[match[1]] = match[2];
  }
  rmSync(file, { force: true });
}

async function buildRunner(dir) {
  buildBefore(dir);
  cpSync(join(bases, 'runner'), dir, { recursive: true });
  for (const name of ['assertions.json', 'triage.json']) cpSync(join(bases, 'evidence', name), join(dir, 'reports/rebaseline', name));
  if (!existsSync(join(dir, 'fake-jest.mjs'))) throw new Error('tests/bases/runner/fake-jest.mjs is missing');
}

await runSelftest(import.meta.url, [
  {
    script: 'check-rebaseline.mjs',
    fixtures: '../tests/fixtures/check-rebaseline',
    // ARGS.txt words follow the repo root; the copy runSelftest lays in the case folder is removed
    // first, since any file added after --start is a source-changed finding.
    args: (dir) => {
      rmSync(join(dir, 'ARGS.txt'), { force: true });
      caseEnv(dir);
      return [dir];
    },
    base: [{ build: buildAfter }],
    argsFile: 'append',
  },
  {
    script: 'rebaseline.mjs',
    fixtures: '../tests/fixtures/rebaseline',
    args: (dir) => {
      rmSync(join(dir, 'ARGS.txt'), { force: true });
      caseEnv(dir);
      return ['.', '--jest', 'node fake-jest.mjs'];
    },
    base: [{ build: buildRunner }],
    argsFile: 'append',
  },
]);
