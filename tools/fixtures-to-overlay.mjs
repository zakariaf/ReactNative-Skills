#!/usr/bin/env node
// fixtures-to-overlay.mjs: converts a skill's full-copy fixture cases into overlay cases (DECISIONS §7).
//
// For every fixture suite of the skill (a folder under tests/ that holds good/ and at least one
// bad-*/), each bad-*, pass-* and error-* case that is a complete copy of a repo becomes the minimal
// difference from the suite's good/: replace ops in mutation.json for small text edits, overlay files
// (in the case's overlay/ folder) for new or rewritten files, copy ops for files identical to another
// base file, and DELETE.txt for files the case lacks. A repo file named like a control file
// (mutation.json, DELETE.txt, plant.json) that good/ holds too is data and moves under overlay/. EXPECT.txt, ARGS.txt and the case names stay. good/ stays a complete tree;
// SUITE.json ({ "base": "good" }) makes check-lib's runSelftest assemble the cases. Files named
// .gitignore or metadata.json are stored as dot-gitignore / dot-metadata.json (assembly renames them).
//
// Safety: every converted case is assembled with check-lib's engine and compared byte for byte with
// the original case before anything is written (a mismatch is a problem, nothing is changed).
// --verify also runs the skill's scripts/selftest.mjs before and after and restores the original
// fixtures unless every case's outcome (exit code and printed EXPECT lines) is identical.
//
//   node tools/fixtures-to-overlay.mjs <skill-dir> [--dry-run] [--verify] [--suite <rel>]... [--png-ops] [--shared-base]

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  CASE_LOCAL_FILES,
  DELETE_FILE,
  FIXTURE_CONTROL_FILES,
  HYGIENE_RENAMES,
  MUTATION_FILE,
  OVERLAY_DIR,
  SUITE_FILE,
  UsageError,
  assembleSuiteCases,
  createReporter,
  decodePng,
  isBinary,
  makeTempDir,
  parseArgs,
  pngSize,
  readSuiteSpec,
  removeTempDir,
  requireDir,
  run,
  selftestCaseKind,
  sha256,
  toPosix,
} from './shared/scripts/check-lib.mjs';

const SPEC = {
  name: 'fixtures-to-overlay',
  summary: "Converts a skill's full-copy fixture cases (bad-*/pass-*/error-*) into overlay cases relative to each suite's good/ (mutation.json, overlay files, DELETE.txt, SUITE.json), after proving every converted case assembles to exactly the original files.",
  usage: '<skill-dir> [options]',
  options: {
    'dry-run': { type: 'boolean', help: 'Report what would change (files and bytes before and after); write nothing' },
    verify: { type: 'boolean', help: "Run the skill's selftest before and after; restore the fixtures unless every case's outcome and printed EXPECT lines are identical" },
    suite: { type: 'string', multiple: true, value: 'rel', help: 'Convert only this suite folder (relative to the skill)' },
    'png-ops': { type: 'boolean', help: 'With --verify: replace PNG files by generated png ops of the same size when the outcomes stay identical (else keep them and say so)' },
    'shared-base': { type: 'boolean', help: "Express a suite's good/ as an overlay on another suite's good/ when they share most files" },
    json: { type: 'boolean', help: 'Also print the per-suite numbers as JSON' },
  },
  positionals: { min: 1, max: 1 },
  details: [
    'A suite is skipped (with the reason) when it already has SUITE.json, when a case holds a reserved',
    `file at its root (${FIXTURE_CONTROL_FILES.join(', ')}) that good/ does not hold (an older assembler\'s case), or`,
    'when good/ holds both a dot-file and its dot- name. Suites that tests/build-fixtures.mjs regenerates',
    'are converted too, but the builder would write full copies again: convert the builder as well.',
    'A suite whose overlay form is not smaller (no fewer files and under 20% fewer bytes) is left as it is.',
    'Run it on a scratch copy first; sync the canonical check-lib into the skill before --verify.',
  ].join('\n'),
};

const REVERSE_RENAMES = Object.fromEntries(Object.entries(HYGIENE_RENAMES).map(([stored, real]) => [real, stored]));

/** Every file under dir: Map rel -> Buffer (sorted). */
function readTree(dir) {
  const files = new Map();
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(abs, entry.name), childRel);
      else if (entry.isFile()) files.set(childRel, readFileSync(join(abs, entry.name)));
      else throw new Error(`${childRel} is not a plain file (symlinks cannot be converted)`);
    }
  };
  if (existsSync(dir)) visit(dir, '');
  return files;
}

function treeSize(dir) {
  let files = 0;
  let bytes = 0;
  const visit = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        files += 1;
        bytes += statSync(path).size;
      }
    }
  };
  if (existsSync(dir)) visit(dir);
  return { files, bytes };
}

/** The stored name of a repo path: .gitignore -> dot-gitignore (each segment). */
const storedPath = (rel) => rel.split('/').map((segment) => REVERSE_RENAMES[segment] ?? segment).join('/');

/** The real (assembled) name of a stored path: dot-gitignore -> .gitignore. */
const realPath = (rel) => rel.split('/').map((segment) => HYGIENE_RENAMES[segment] ?? segment).join('/');

const isRootCaseLocal = (rel) => !rel.includes('/') && CASE_LOCAL_FILES.includes(rel);

// ---------------------------------------------------------------------------------------------
// Text diff -> replace ops
// ---------------------------------------------------------------------------------------------

const splitLines = (text) => (text === '' ? [] : text.match(/[^\n]*\n|[^\n]+$/g));

/** Overlapping occurrence count (a unique find string can then only match one place). */
function countOverlapping(text, find) {
  let count = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) count += 1;
  return count;
}

/** Hunks [{ aStart, aEnd, bStart, bEnd }] between two line arrays (LCS on the trimmed middle). */
function diffHunks(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > 4_000_000) return [{ aStart: start, aEnd: endA, bStart: start, bEnd: endB }];
  const n = midA.length;
  const m = midB.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const hunks = [];
  let i = 0;
  let j = 0;
  let open = null;
  const close = () => {
    if (open) hunks.push({ aStart: start + open.i, aEnd: start + i, bStart: start + open.j, bEnd: start + j });
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      close();
      i += 1;
      j += 1;
    } else {
      if (!open) open = { i, j };
      if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) j += 1;
      else i += 1;
    }
  }
  close();
  // Merge hunks separated by one unchanged line: fewer, readable ops.
  const merged = [];
  for (const hunk of hunks) {
    const last = merged.at(-1);
    if (last && hunk.aStart - last.aEnd <= 1) {
      last.aEnd = hunk.aEnd;
      last.bEnd = hunk.bEnd;
    } else merged.push({ ...hunk });
  }
  return merged;
}

/** Replace ops that turn oldText into newText (applied in order by check-lib), or null when none fit. */
function textOps(file, oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const hunks = diffHunks(a, b);
  let current = a.slice();
  const ops = [];
  for (const hunk of [...hunks].reverse()) {
    let lo = hunk.aStart;
    let hi = hunk.aEnd;
    const text = () => current.slice(lo, hi).join('');
    let grow = 0;
    while (text() === '' || countOverlapping(current.join(''), text()) !== 1) {
      if (lo === 0 && hi >= current.length) return null;
      if ((grow % 2 === 0 && lo > 0) || hi >= current.length) lo -= 1;
      else hi += 1;
      grow += 1;
      if (grow > 40) return null;
    }
    const find = text();
    const replacement = current.slice(lo, hunk.aStart).join('') + b.slice(hunk.bStart, hunk.bEnd).join('') + current.slice(hunk.aEnd, hi).join('');
    ops.push({ replace: { file, find, with: replacement } });
    current = [...current.slice(0, hunk.aStart), ...b.slice(hunk.bStart, hunk.bEnd), ...current.slice(hunk.aEnd)];
  }
  if (current.join('') !== newText) return null;
  return ops;
}

// ---------------------------------------------------------------------------------------------
// One case and one suite
// ---------------------------------------------------------------------------------------------

/** The overlay form of one case relative to a base tree (Maps of real rel -> Buffer). */
function planCase(name, baseFiles, caseFiles) {
  const keep = new Map();
  const overlay = new Map();
  const ops = [];
  const deletes = [];
  const byHash = new Map();
  for (const [rel, buffer] of baseFiles) {
    const hash = sha256(buffer);
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(rel);
  }
  const unchanged = (rel) => caseFiles.has(rel) && baseFiles.has(rel) && caseFiles.get(rel).equals(baseFiles.get(rel));
  for (const [rel, buffer] of caseFiles) {
    if (isRootCaseLocal(rel)) {
      keep.set(rel, buffer);
      continue;
    }
    const base = baseFiles.get(rel);
    if (base && base.equals(buffer)) continue;
    // Identical to a base file the case keeps unchanged: a copy op (exact, no bytes stored).
    const twin = (byHash.get(sha256(buffer)) ?? []).find((candidate) => candidate !== rel && unchanged(candidate));
    if (twin && !base) {
      ops.push({ copy: { from: twin, to: rel } });
      continue;
    }
    if (base && !isBinary(base) && !isBinary(buffer)) {
      const replace = textOps(rel, base.toString('utf8'), buffer.toString('utf8'));
      if (replace && Buffer.byteLength(JSON.stringify(replace)) < buffer.length) {
        ops.push(...replace);
        continue;
      }
    }
    overlay.set(rel, buffer);
  }
  const missing = [...baseFiles.keys()].filter((rel) => !caseFiles.has(rel) && !isRootCaseLocal(rel));
  // Collapse to the highest folder whose base files are all missing and that the case does not hold.
  const missingSet = new Set(missing);
  const covered = new Set();
  for (const rel of missing) {
    if (covered.has(rel)) continue;
    const segments = rel.split('/');
    let chosen = rel;
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join('/');
      const inBase = [...baseFiles.keys()].filter((path) => path.startsWith(`${folder}/`));
      const inCase = [...caseFiles.keys()].some((path) => path.startsWith(`${folder}/`));
      if (!inCase && inBase.every((path) => missingSet.has(path))) {
        chosen = folder;
        break;
      }
    }
    deletes.push(chosen);
    for (const path of missing) if (path === chosen || path.startsWith(`${chosen}/`)) covered.add(path);
  }
  return { name, base: null, keep, overlay, ops, deletes: [...new Set(deletes)].sort() };
}

/** The stored cost of a plan: bytes written, plus a per-file charge (fewer files read better). */
function planCost(plan) {
  let bytes = JSON.stringify(plan.ops).length + plan.deletes.join('\n').length;
  for (const buffer of plan.overlay.values()) bytes += buffer.length;
  return bytes + 200 * (plan.overlay.size + (plan.ops.length > 0 || plan.base ? 1 : 0) + (plan.deletes.length > 0 ? 1 : 0));
}

/** Write one planned case into an (empty) folder in its stored form. */
function writeCase(dir, plan) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, buffer] of plan.keep) writeFileSync(join(dir, rel), buffer);
  for (const [rel, buffer] of plan.overlay) {
    const path = join(dir, OVERLAY_DIR, storedPath(rel));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
  }
  if (plan.base) writeFileSync(join(dir, MUTATION_FILE), `${JSON.stringify({ base: plan.base, ops: plan.ops }, null, 2)}\n`);
  else if (plan.ops.length > 0) writeFileSync(join(dir, MUTATION_FILE), `${JSON.stringify(plan.ops, null, 2)}\n`);
  if (plan.deletes.length > 0) writeFileSync(join(dir, DELETE_FILE), `${plan.deletes.join('\n')}\n`);
}

/** Write a complete tree (good/) in stored form; a data file named like a control file goes under overlay/. */
function writeFullTree(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, buffer] of files) {
    const reserved = !rel.includes('/') && (FIXTURE_CONTROL_FILES.includes(rel) || rel === OVERLAY_DIR);
    const path = join(dir, ...(reserved ? [OVERLAY_DIR] : []), storedPath(rel));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
  }
}

function sameTree(expected, actual) {
  const problems = [];
  for (const [rel, buffer] of expected) {
    if (!actual.has(rel)) problems.push(`missing ${rel}`);
    else if (!actual.get(rel).equals(buffer)) problems.push(`differs ${rel}`);
  }
  for (const rel of actual.keys()) if (!expected.has(rel)) problems.push(`extra ${rel}`);
  return problems;
}

/** Why a suite cannot be converted, or null. */
function skipReason(suiteDir, caseNames) {
  if (existsSync(join(suiteDir, SUITE_FILE))) return `already an overlay suite (${SUITE_FILE})`;
  // A reserved name at a case root is data only when good/ holds it too (it then moves under overlay/);
  // otherwise it is an older assembler's case.
  const goodRoot = existsSync(join(suiteDir, 'good')) ? readdirSync(join(suiteDir, 'good')) : [];
  for (const name of caseNames) {
    const reserved = [...FIXTURE_CONTROL_FILES, OVERLAY_DIR].filter((file) => existsSync(join(suiteDir, name, file)) && !goodRoot.includes(file));
    if (reserved.length > 0) return `${name}/ holds ${reserved.join(', ')} at its root and good/ does not (an older assembler's case): migrate it by hand`;
  }
  const good = join(suiteDir, 'good');
  for (const [real, stored] of Object.entries(REVERSE_RENAMES)) {
    const both = readTree(good);
    for (const rel of both.keys()) {
      const segments = rel.split('/');
      if (segments.at(-1) === stored) return `good/ already holds a file named ${stored} (${rel}); it would become ${real} at assembly`;
    }
  }
  return null;
}

/** Plan one suite against a base tree; returns { plans, suiteJson } (plans: Map case -> plan). */
function planSuite(suiteDir, caseNames, baseFiles) {
  const plans = new Map();
  for (const name of caseNames.filter((candidate) => candidate !== 'good')) plans.set(name, planCase(name, baseFiles, readTree(join(suiteDir, name))));
  return plans;
}

/** Assemble the planned suite with check-lib and compare every case with the original files. */
function roundTrip(suiteDir, caseNames, plans, suiteJson, goodFiles, sharedBase, skillDir) {
  const scratch = makeTempDir('overlay-roundtrip-');
  try {
    const converted = join(scratch, 'suite');
    if (sharedBase) {
      writeCase(join(converted, 'good'), sharedBase.goodPlan);
    } else writeFullTree(join(converted, 'good'), goodFiles);
    for (const [name, plan] of plans) writeCase(join(converted, name), plan);
    writeFileSync(join(converted, SUITE_FILE), `${JSON.stringify(suiteJson, null, 2)}\n`);
    const into = join(scratch, 'assembled');
    mkdirSync(into);
    const spec = readSuiteSpec(converted, sharedBase ? { base: sharedBase.from } : {});
    const assembled = assembleSuiteCases({ suiteDir: converted, skillDir, into, spec });
    const problems = [];
    for (const entry of assembled) {
      if (entry.error) {
        problems.push(`${entry.name}: ${entry.error}`);
        continue;
      }
      const original = readTree(join(suiteDir, entry.name));
      const diff = sameTree(original, readTree(entry.dir));
      if (diff.length > 0) problems.push(`${entry.name}: ${diff.slice(0, 5).join(', ')}`);
    }
    const missingCases = caseNames.filter((name) => !assembled.some((entry) => entry.name === name));
    for (const name of missingCases) problems.push(`${name}: not assembled`);
    return { problems, size: treeSize(converted) };
  } finally {
    removeTempDir(scratch);
  }
}

/** Find every fixture suite under tests/ (never descending into a case folder). */
function findSuites(testsDir) {
  const suites = [];
  const visit = (dir) => {
    const dirs = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    if (dirs.includes('good') && dirs.some((name) => selftestCaseKind(name) === 'bad-')) suites.push(dir);
    for (const name of dirs) if (selftestCaseKind(name) === null && !name.startsWith('.') && name !== 'node_modules') visit(join(dir, name));
  };
  if (existsSync(testsDir)) visit(testsDir);
  return suites;
}

// ---------------------------------------------------------------------------------------------
// --verify: the skill's self-test outcomes before and after
// ---------------------------------------------------------------------------------------------

function runSkillSelftest(skillDir) {
  const result = spawnSync(process.execPath, [join(skillDir, 'scripts', 'selftest.mjs')], { cwd: skillDir, encoding: 'utf8', timeout: 900000, maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? '' };
}

/** Per case: 'ok <exit + found EXPECT lines>' or 'FAIL <rule> <first problem line>'; plus RESULT. */
function outcomes(stdout) {
  const map = new Map();
  for (const line of stdout.split('\n')) {
    const ok = /^ok {3}(\S+) (\S+)(?: \((.*)\))?$/.exec(line);
    if (ok) {
      map.set(`${ok[1]} ${ok[2]}`, `ok ${ok[3] ?? ''}`);
      continue;
    }
    const failed = /^FAIL \S+ \[(selftest-[a-z]+)\] (\S+) (\S+?): (.*)$/.exec(line);
    if (failed) map.set(`${failed[2]} ${failed[3]}`, `FAIL ${failed[1]} ${failed[4].replace(/\/(?:private\/)?(?:var|tmp)\/\S*/g, '<tmp>')}`);
    else if (line.startsWith('FAIL ') || line.startsWith('ERROR ')) map.set(line.replace(/\/(?:private\/)?(?:var|tmp)\/\S*/g, '<tmp>'), 'present');
  }
  map.set('RESULT', stdout.trim().split('\n').at(-1) ?? '');
  return map;
}

function compareOutcomes(before, after) {
  const diffs = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) if (before.get(key) !== after.get(key)) diffs.push(`${key}: before "${before.get(key) ?? '(none)'}", after "${after.get(key) ?? '(none)'}"`);
  return diffs;
}

// ---------------------------------------------------------------------------------------------

const fmt = (n) => n.toLocaleString('en-US');

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const skillDir = requireDir(positionals[0], 'skill folder');
  const testsDir = join(skillDir, 'tests');
  if (options['png-ops'] && !options.verify) throw new UsageError('--png-ops needs --verify: only the self-test outcomes can prove that the checker needs PNG presence, not content', 'Add --verify (or drop --png-ops).');
  const libPath = join(skillDir, 'scripts', 'check-lib.mjs');
  if (!existsSync(libPath) || !readFileSync(libPath, 'utf8').includes('export const SUITE_FILE')) {
    const message = `${toPosix(relative(process.cwd(), libPath))} has no overlay engine (SUITE.json support)`;
    if (options.verify || !options['dry-run']) throw new UsageError(message, 'Sync the canonical check-lib into the skill first (copy the library\'s shared scripts/check-lib.mjs over <skill>/scripts/check-lib.mjs), then rerun.');
  }
  const report = createReporter({ name: 'fixtures-to-overlay', json: options.json });
  const wanted = (options.suite ?? []).map((rel) => resolve(skillDir, rel));
  const suites = findSuites(testsDir).filter((dir) => wanted.length === 0 || wanted.includes(dir));
  if (suites.length === 0) {
    report.note(`no fixture suite (a folder with good/ and bad-*/) under ${toPosix(relative(process.cwd(), testsDir))}${wanted.length ? ' matches --suite' : ''}`);
    return report.finish({ checked: 0, unit: 'suites' });
  }
  if (existsSync(join(testsDir, 'build-fixtures.mjs'))) report.note(`note: tests/build-fixtures.mjs regenerates fixtures as full copies; convert the builder too, or it undoes this conversion`);
  const before = treeSize(testsDir);
  let baseline = null;
  if (options.verify) {
    const result = runSkillSelftest(skillDir);
    baseline = outcomes(result.stdout);
    report.note(`verify: the self-test before conversion ends "${baseline.get('RESULT')}" (${baseline.size - 1} cases and --help runs)`);
  }
  const rows = [];
  const converted = [];
  for (const suiteDir of suites) {
    const rel = toPosix(relative(skillDir, suiteDir));
    const caseNames = readdirSync(suiteDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && selftestCaseKind(entry.name) !== null).map((entry) => entry.name).sort();
    const reason = skipReason(suiteDir, caseNames);
    if (reason) {
      report.note(`skip ${rel}: ${reason}`);
      continue;
    }
    let goodFiles;
    let plans;
    try {
      goodFiles = readTree(join(suiteDir, 'good'));
      const baseFiles = new Map([...goodFiles].filter(([path]) => !isRootCaseLocal(path)));
      plans = planSuite(suiteDir, caseNames, baseFiles);
    } catch (error) {
      report.problem({ file: rel, rule: 'convert', message: error.message, fix: 'Fix the fixture (only plain files can be converted) or skip this suite with --suite.' });
      continue;
    }
    const argsInNonError = caseNames.some((name) => selftestCaseKind(name) !== 'error-' && readdirSync(join(suiteDir, name)).includes('ARGS.txt'));
    const suiteJson = { base: 'good', ...(argsInNonError ? { argsFile: 'error-only' } : {}) };
    const sizeBefore = treeSize(suiteDir);
    const trip = roundTrip(suiteDir, caseNames, plans, suiteJson, goodFiles, null, skillDir);
    if (trip.problems.length > 0) {
      report.problem({ file: rel, rule: 'round-trip', message: `the converted suite does not assemble to the original files: ${trip.problems.slice(0, 5).join('; ')}`, fix: 'This is a converter bug; nothing was written. Report it with the suite.' });
      continue;
    }
    // Small suites whose cases are a few files each can grow in overlay form: leave those as they are.
    if (trip.size.files >= sizeBefore.files && trip.size.bytes >= sizeBefore.bytes * 0.8) {
      report.note(`keep ${rel}: the overlay form is not smaller (${fmt(sizeBefore.files)} -> ${fmt(trip.size.files)} files, ${fmt(sizeBefore.bytes)} -> ${fmt(trip.size.bytes)} bytes)`);
      continue;
    }
    const counts = { replace: 0, copy: 0, overlay: 0, deletes: 0 };
    for (const plan of plans.values()) {
      counts.replace += plan.ops.filter((op) => op.replace).length;
      counts.copy += plan.ops.filter((op) => op.copy).length;
      counts.overlay += plan.overlay.size;
      counts.deletes += plan.deletes.length;
    }
    const row = { suite: rel, cases: caseNames.length, before: sizeBefore, after: trip.size, ...counts };
    rows.push(row);
    converted.push({ suiteDir, rel, caseNames, plans, goodFiles, suiteJson, row });
    report.note(`${options['dry-run'] ? 'plan' : 'ok  '} ${rel}: ${caseNames.length} cases, ${fmt(sizeBefore.files)} -> ${fmt(trip.size.files)} files, ${fmt(sizeBefore.bytes)} -> ${fmt(trip.size.bytes)} bytes (${counts.replace} replace ops, ${counts.copy} copy ops, ${counts.overlay} overlay files, ${counts.deletes} deleted paths)`);
  }

  // --shared-base, step 1: each case starts from the closest complete good/ of any converted suite.
  const usedAsBase = new Set();
  if (options['shared-base'] && converted.length > 1) {
    for (const target of converted) {
      let moved = 0;
      const plans = new Map(target.plans);
      for (const [name, plan] of target.plans) {
        const caseFiles = readTree(join(target.suiteDir, name));
        let best = { plan, cost: planCost(plan), other: null };
        for (const other of converted) {
          if (other === target) continue;
          const candidate = planCase(name, new Map([...other.goodFiles].filter(([path]) => !isRootCaseLocal(path))), caseFiles);
          const cost = planCost(candidate) + 120;
          if (cost < best.cost * 0.8) best = { plan: candidate, cost, other };
        }
        if (best.other) {
          best.plan.base = `@tests/${toPosix(relative(testsDir, join(best.other.suiteDir, 'good')))}`;
          plans.set(name, best.plan);
          moved += 1;
        }
      }
      if (moved === 0) continue;
      const trip = roundTrip(target.suiteDir, target.caseNames, plans, target.suiteJson, target.goodFiles, null, skillDir);
      if (trip.problems.length > 0) {
        report.note(`note ${target.rel}: cases on another suite's base did not round-trip (${trip.problems[0]}); kept them on good/`);
        continue;
      }
      target.plans = plans;
      target.row.after = trip.size;
      for (const plan of plans.values()) if (plan.base) usedAsBase.add(toPosix(relative(skillDir, resolve(testsDir, plan.base.slice('@tests/'.length), '..'))));
      report.note(`ok   ${target.rel}: ${moved} case(s) now start from another suite's good/ (closer base), now ${fmt(trip.size.files)} files, ${fmt(trip.size.bytes)} bytes`);
    }
  }

  // --shared-base, step 2: a suite whose good/ shares most files with another suite's good/ becomes an overlay on it.
  const shared = new Map();
  if (options['shared-base'] && converted.length > 1) {
    for (const target of [...converted].sort((a, b) => a.goodFiles.size - b.goodFiles.size)) {
      if (usedAsBase.has(target.rel)) continue;
      let best = null;
      for (const other of converted) {
        if (other === target || shared.has(other.rel) || usedAsBase.has(target.rel)) continue;
        let same = 0;
        for (const [path, buffer] of target.goodFiles) if (!isRootCaseLocal(path) && other.goodFiles.get(path)?.equals(buffer)) same += 1;
        if (!best || same > best.same) best = { other, same };
      }
      if (!best || best.same < 10 || best.same < target.goodFiles.size * 0.5) continue;
      const baseFiles = new Map([...best.other.goodFiles].filter(([path]) => !isRootCaseLocal(path)));
      const goodPlan = planCase('good', baseFiles, target.goodFiles);
      const fromRel = `@tests/${toPosix(relative(testsDir, join(best.other.suiteDir, 'good')))}`;
      const suiteJson = { base: fromRel, extends: 'good', ...(target.suiteJson.argsFile ? { argsFile: target.suiteJson.argsFile } : {}) };
      const trip = roundTrip(target.suiteDir, target.caseNames, target.plans, suiteJson, target.goodFiles, { goodPlan, from: join(best.other.suiteDir, 'good') }, skillDir);
      if (trip.problems.length > 0) {
        report.note(`note ${target.rel}: a shared base on ${best.other.rel} did not round-trip (${trip.problems[0]}); kept good/ complete`);
        continue;
      }
      shared.set(target.rel, { goodPlan, suiteJson, base: best.other.rel });
      usedAsBase.add(best.other.rel);
      target.row.after = trip.size;
      target.row.sharedBase = best.other.rel;
      report.note(`ok   ${target.rel}: good/ becomes an overlay on ${best.other.rel}/good (${best.same} shared files), now ${fmt(trip.size.files)} files, ${fmt(trip.size.bytes)} bytes`);
    }
  }

  if (options['dry-run']) {
    const saved = rows.reduce((sum, row) => ({ files: sum.files + row.before.files - row.after.files, bytes: sum.bytes + row.before.bytes - row.after.bytes }), { files: 0, bytes: 0 });
    report.note(`dry run: tests/ ${fmt(before.files)} files, ${fmt(before.bytes)} bytes; converting saves ${fmt(saved.files)} files, ${fmt(saved.bytes)} bytes. Nothing was written.`);
    if (options.json) console.log(JSON.stringify({ rows }));
    return report.finish({ checked: suites.length, unit: 'suites' });
  }

  // Write: back up tests/ first, so a failed verification restores it exactly.
  const backup = makeTempDir('overlay-backup-');
  cpSync(testsDir, join(backup, 'tests'), { recursive: true });
  const restore = () => {
    rmSync(testsDir, { recursive: true, force: true });
    cpSync(join(backup, 'tests'), testsDir, { recursive: true });
  };
  try {
    for (const entry of converted) {
      for (const name of entry.caseNames) rmSync(join(entry.suiteDir, name), { recursive: true, force: true });
      const sharedEntry = shared.get(entry.rel);
      if (sharedEntry) writeCase(join(entry.suiteDir, 'good'), sharedEntry.goodPlan);
      else writeFullTree(join(entry.suiteDir, 'good'), entry.goodFiles);
      for (const [name, plan] of entry.plans) writeCase(join(entry.suiteDir, name), plan);
      writeFileSync(join(entry.suiteDir, SUITE_FILE), `${JSON.stringify(sharedEntry?.suiteJson ?? entry.suiteJson, null, 2)}\n`);
    }
    if (options.verify) {
      const after = outcomes(runSkillSelftest(skillDir).stdout);
      const diffs = compareOutcomes(baseline, after);
      if (diffs.length > 0) {
        restore();
        for (const diff of diffs.slice(0, 20)) report.problem({ file: toPosix(relative(process.cwd(), skillDir)), rule: 'verify', message: diff, fix: 'The outcomes changed, so the original fixtures were restored. Convert the failing suite by hand or skip it with --suite.' });
        return report.finish({ checked: suites.length, unit: 'suites' });
      }
      report.note(`verify: identical outcomes for all ${baseline.size - 1} cases and --help runs ("${after.get('RESULT')}")`);
      if (options['png-ops']) await pngOps({ converted, shared, usedAsBase, baseline, skillDir, report });
    }
  } catch (error) {
    restore();
    throw error;
  } finally {
    removeTempDir(backup);
  }
  const after = treeSize(testsDir);
  report.note(`tests/: ${fmt(before.files)} -> ${fmt(after.files)} files, ${fmt(before.bytes)} -> ${fmt(after.bytes)} bytes`);
  if (options.json) console.log(JSON.stringify({ rows, before, after }));
  return report.finish({ checked: suites.length, unit: 'suites' });
}

/**
 * --png-ops: per converted suite, replace the PNG files of good/ by SUITE.json png ops and the PNG
 * overlay files of cases by case png ops (same width and height, filled with the image's first pixel),
 * then rerun the self-test; when any outcome changes, put the files back and say that content matters.
 */
async function pngOps({ converted, shared, usedAsBase: caseBases, baseline, skillDir, report }) {
  const usedAsBase = new Set([...shared.values()].map((entry) => entry.base));
  for (const rel of caseBases ?? []) usedAsBase.add(rel);
  for (const entry of converted) {
    const goodDir = join(entry.suiteDir, 'good');
    const isShared = shared.has(entry.rel);
    if (usedAsBase.has(entry.rel)) {
      report.note(`note ${entry.rel}: its good/ is another suite's base; PNG files kept`);
      continue;
    }
    const snapshot = makeTempDir('overlay-png-');
    cpSync(entry.suiteDir, join(snapshot, 'suite'), { recursive: true });
    const groups = new Map();
    const goodPngs = [...readTree(goodDir).keys()].filter((rel) => rel.toLowerCase().endsWith('.png'));
    let count = 0;
    const describe = (buffer) => {
      try {
        const { width, height } = pngSize(buffer);
        const { data } = decodePng(buffer);
        const fill = `#${[...data.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        return { width, height, fill };
      } catch {
        return null;
      }
    };
    for (const rel of goodPngs) {
      const info = describe(readFileSync(join(goodDir, rel)));
      if (!info) continue;
      const key = `${info.width}x${info.height}${info.fill}`;
      if (!groups.has(key)) groups.set(key, { ...info, files: [] });
      groups.get(key).files.push(realPath(rel));
      rmSync(join(goodDir, rel));
      count += 1;
    }
    for (const name of entry.caseNames.filter((candidate) => candidate !== 'good')) {
      const caseDir = join(entry.suiteDir, name);
      const pngs = [...readTree(caseDir).keys()].filter((rel) => rel.toLowerCase().endsWith('.png'));
      if (pngs.length === 0) continue;
      const mutationPath = join(caseDir, MUTATION_FILE);
      const ops = existsSync(mutationPath) ? JSON.parse(readFileSync(mutationPath, 'utf8')) : [];
      for (const rel of pngs) {
        const info = describe(readFileSync(join(caseDir, rel)));
        if (!info) continue;
        ops.unshift({ png: { file: realPath(rel), width: info.width, height: info.height, fill: info.fill } });
        rmSync(join(caseDir, rel));
        count += 1;
      }
      writeFileSync(mutationPath, `${JSON.stringify(ops, null, 2)}\n`);
    }
    if (count === 0) {
      removeTempDir(snapshot);
      continue;
    }
    const suiteJsonPath = join(entry.suiteDir, SUITE_FILE);
    const suiteJson = JSON.parse(readFileSync(suiteJsonPath, 'utf8'));
    const suiteOps = [...groups.values()].map(({ files, width, height, fill }) => ({ png: { files, width, height, fill } }));
    if (suiteOps.length > 0) {
      if (isShared) {
        // good/ is an overlay case here: its PNGs go into good's own mutation.json.
        const mutationPath = join(goodDir, MUTATION_FILE);
        const ops = existsSync(mutationPath) ? JSON.parse(readFileSync(mutationPath, 'utf8')) : [];
        writeFileSync(mutationPath, `${JSON.stringify([...suiteOps, ...ops], null, 2)}\n`);
      } else {
        suiteJson.ops = [...(suiteJson.ops ?? []), ...suiteOps];
        writeFileSync(suiteJsonPath, `${JSON.stringify(suiteJson, null, 2)}\n`);
      }
    }
    const after = outcomes(runSkillSelftest(skillDir).stdout);
    const diffs = compareOutcomes(baseline, after);
    if (diffs.length > 0) {
      rmSync(entry.suiteDir, { recursive: true, force: true });
      cpSync(join(snapshot, 'suite'), entry.suiteDir, { recursive: true });
      report.note(`note ${entry.rel}: PNG content matters to the checker (${diffs[0]}); kept the ${count} PNG files`);
    } else {
      report.note(`ok   ${entry.rel}: ${count} PNG files became generated png ops (outcomes identical)`);
    }
    removeTempDir(snapshot);
  }
}

run(main);
