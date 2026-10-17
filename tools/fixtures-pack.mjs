#!/usr/bin/env node
// fixtures-pack.mjs: packs a skill's overlay fixture cases into one CASES.json per suite (DECISIONS §7).
//
// Every bad-*, pass-* and error-* case of an assembled suite moves its mutation.json, ARGS.txt, DELETE.txt,
// plant.json and overlay files into the suite's CASES.json (a leading delete op, write ops, the case's ops,
// a trailing plant op, and "args"); the case folder keeps only its EXPECT.txt. With --expect the EXPECT.txt
// moves too (as "expect": its lines) and the emptied case folder is removed, so a case is one CASES.json
// entry. A case that another case or SUITE.json names as a base layer, a case with a symlink, a binary
// overlay file over 4 KB, and good/ stay as they are.
//
// Safety: the skill's self-test materializes every assembled case before and after; the trees must be
// byte-identical (ARGS.txt compared by words; files under .git/ are skipped, git-built bases are not
// reproducible). With --verify the self-test also runs before and after and every case's outcome must be the
// same. Any difference restores the original tests/ folder.
//
//   node tools/fixtures-pack.mjs <skill-dir> [--dry-run] [--verify] [--expect] [--suite <rel>]... [--json]

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { CASES_FILE, HYGIENE_RENAMES, SUITE_FILE, UsageError, createReporter, isBinary, makeTempDir, parseArgs, removeTempDir, requireDir, run, selftestCaseKind, toPosix } from './shared/scripts/check-lib.mjs';

const SPEC = {
  name: 'fixtures-pack',
  summary: "Packs a skill's overlay fixture cases into one CASES.json per suite (each case folder keeps only EXPECT.txt), after proving every assembled case is unchanged.",
  usage: '<skill-dir> [options]',
  options: {
    'dry-run': { type: 'boolean', help: 'Report what would be packed (files before and after); write nothing' },
    verify: { type: 'boolean', help: "Also run the skill's self-test before and after; restore the fixtures unless every case's outcome is identical" },
    expect: { type: 'boolean', help: 'Also move each packed case\'s EXPECT.txt into CASES.json ("expect") and remove the emptied case folder' },
    suite: { type: 'string', multiple: true, value: 'rel', help: 'Pack only this suite folder (relative to the skill)' },
    json: { type: 'boolean', help: 'Also print the per-suite numbers as JSON' },
  },
  positionals: { min: 1, max: 1 },
  details: [
    'A suite is packed when the self-test assembles it (its --materialize output lists it): SUITE.json, a base/',
    'folder, or a base in selftest.mjs. Suites whose cases run in place are reported and left alone (convert',
    'them with fixtures-to-overlay first, or add SUITE.json by hand). Sync the canonical check-lib into the',
    'skill first: CASES.json needs check-lib with CASES_FILE.',
  ].join('\n'),
};

const CONTROL = new Set(['EXPECT.txt', 'ARGS.txt', 'DELETE.txt', 'mutation.json', 'plant.json']);
const MAX_BINARY = 4096;

/** Every file under dir as sorted posix paths; throws on a symlink. */
function listFiles(dir, rel = '', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`holds a symlink (${childRel})`);
    if (entry.isDirectory()) listFiles(join(dir, entry.name), childRel, out);
    else out.push(childRel);
  }
  return out;
}

function treeCount(dir) {
  let files = 0;
  let bytes = 0;
  const visit = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) visit(child);
      else {
        files += 1;
        bytes += lstatSync(child).size;
      }
    }
  };
  if (existsSync(dir)) visit(dir);
  return { files, bytes };
}

function selftest(skillDir, args) {
  const result = spawnSync(process.execPath, [join(skillDir, 'scripts', 'selftest.mjs'), ...args], { cwd: skillDir, encoding: 'utf8', timeout: 900000, maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? '', output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Materialize every assembled case into a new temp folder: { dir, suites: [suite folder name] }. */
function materialize(skillDir, into) {
  const result = selftest(skillDir, ['--materialize', into]);
  if (result.status !== 0) throw new UsageError(`the self-test could not materialize the cases (exit ${result.status}): ${result.output.trim().split('\n').slice(-3).join(' | ')}`, 'Make the self-test pass first.');
  const suites = [...result.stdout.matchAll(/^ok {3}\d+-([^:]+): \d+ cases ->/gm)].map((match) => match[1]);
  return [...new Set(suites)];
}

/** Map rel -> Buffer for a materialized tree, skipping .git/ internals. */
function readTree(dir) {
  const out = new Map();
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) {
        out.set(`${childRel}/`, null);
        visit(join(abs, entry.name), childRel);
      } else out.set(childRel, entry.isSymbolicLink() ? Buffer.from('<symlink>') : readFileSync(join(abs, entry.name)));
    }
  };
  visit(dir, '');
  return out;
}

function compareTrees(a, b) {
  const words = (buffer) => buffer.toString('utf8').trim().split(/\s+/).join(' ');
  const left = readTree(a);
  const right = readTree(b);
  const diffs = [];
  for (const [rel, buffer] of left) {
    if (!right.has(rel)) diffs.push(`only before: ${rel}`);
    else if (buffer !== null) {
      const other = right.get(rel);
      const same = rel.endsWith('/ARGS.txt') || rel === 'ARGS.txt' ? words(buffer) === words(other) : buffer.equals(other);
      if (!same) diffs.push(`differs: ${rel}`);
    }
  }
  for (const rel of right.keys()) if (!left.has(rel)) diffs.push(`only after: ${rel}`);
  return diffs;
}

/** Per case "ok"/"FAIL" outcome lines of a self-test run (temp paths masked). */
function outcomes(stdout) {
  const map = new Map();
  // Two suites may run the same checker on cases of the same name: number repeated keys.
  const unique = (key) => {
    let candidate = key;
    for (let n = 2; map.has(candidate); n += 1) candidate = `${key} #${n}`;
    return candidate;
  };
  for (const line of stdout.split('\n')) {
    const ok = /^ok {3}(\S+) (\S+)(?: \((.*)\))?$/.exec(line);
    if (ok) map.set(unique(`${ok[1]} ${ok[2]}`), `ok ${ok[3] ?? ''}`);
    else if (line.startsWith('FAIL ') || line.startsWith('ERROR ')) map.set(line.replace(/\/(?:private\/)?(?:var|tmp)\/\S*/g, '<tmp>'), 'present');
  }
  map.set('RESULT', stdout.trim().split('\n').at(-1) ?? '');
  return map;
}

/** Base-layer names a suite's SUITE.json or a case's mutation.json / CASES.json entry uses. */
function baseLayerNames(suiteDir, names, cases) {
  const out = [];
  const add = (base) => out.push(...[base ?? []].flat().map((layer) => (typeof layer === 'string' ? layer : layer?.from)).filter((item) => typeof item === 'string').map((item) => item.replace(/^\.\//, '')));
  if (existsSync(join(suiteDir, SUITE_FILE))) add(JSON.parse(readFileSync(join(suiteDir, SUITE_FILE), 'utf8')).base);
  for (const name of names) {
    const path = join(suiteDir, name, 'mutation.json');
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (data && !Array.isArray(data)) add(data.base);
    } catch {
      // A broken mutation.json fails in the self-test.
    }
  }
  for (const entry of Object.values(cases)) if (entry && !Array.isArray(entry)) add(entry.base);
  return out;
}

/**
 * JSON in JSON.stringify(v, null, 2) layout, except that an array or object whose spaced one-line form fits
 * in `width` columns stays on one line (most ops do; long `lines` lists still get one line per element).
 */
function stringifyCompact(value, width = 120) {
  const flat = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(flat).join(', ')}]`;
    const keys = Object.keys(v);
    return keys.length === 0 ? '{}' : `{ ${keys.map((key) => `${JSON.stringify(key)}: ${flat(v[key])}`).join(', ')} }`;
  };
  const layout = (v, indent, lead) => {
    const one = flat(v);
    if (v === null || typeof v !== 'object' || indent.length + lead + one.length <= width) return one;
    const inner = `${indent}  `;
    if (Array.isArray(v)) return `[\n${v.map((item) => inner + layout(item, inner, 0)).join(',\n')}\n${indent}]`;
    return `{\n${Object.keys(v).map((key) => `${inner}${JSON.stringify(key)}: ${layout(v[key], inner, JSON.stringify(key).length + 2)}`).join(',\n')}\n${indent}}`;
  };
  return `${layout(value, '', 0)}\n`;
}

/** CASES.json "expect" for an EXPECT.txt: its lines when they rebuild the file exactly, else the exact text. */
function expectValue(text) {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : null;
  return lines !== null && `${lines.join('\n')}\n` === text ? lines : text;
}

/** Pack one suite folder; returns { packed, kept: [reason], removed, text } (writes unless dry). */
function packSuite(suiteDir, dry, foldExpect = false) {
  let renames = { ...HYGIENE_RENAMES };
  if (existsSync(join(suiteDir, SUITE_FILE))) {
    const spec = JSON.parse(readFileSync(join(suiteDir, SUITE_FILE), 'utf8'));
    if (spec.renames === false) renames = {};
    else if (spec.renames && typeof spec.renames === 'object') renames = { ...renames, ...spec.renames };
  }
  const casesPath = join(suiteDir, CASES_FILE);
  const cases = existsSync(casesPath) ? JSON.parse(readFileSync(casesPath, 'utf8')) : {};
  const names = readdirSync(suiteDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && selftestCaseKind(entry.name) !== null && entry.name !== 'good').map((entry) => entry.name).sort();
  const bases = baseLayerNames(suiteDir, names, cases);
  const kept = [];
  let packed = 0;
  let removed = 0;
  for (const name of names) {
    const dir = join(suiteDir, name);
    if (bases.some((base) => base === name || base.startsWith(`${name}/`))) {
      kept.push(`${name} (a base layer)`);
      continue;
    }
    if (name in cases) continue;
    let files;
    try {
      files = listFiles(dir);
    } catch (error) {
      kept.push(`${name} (${error.message})`);
      continue;
    }
    const moved = files.filter((rel) => rel !== 'EXPECT.txt');
    if (moved.length === 0) continue;
    const entry = {};
    const ops = [];
    let problem = null;
    if (files.includes('DELETE.txt')) {
      const paths = readFileSync(join(dir, 'DELETE.txt'), 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
      if (paths.length > 0) ops.push({ delete: paths.length === 1 ? paths[0] : paths });
    }
    // Overlay files: the loose files first, then the overlay/ folder (the assembly order).
    const loose = moved.filter((rel) => (rel.includes('/') ? !rel.startsWith('overlay/') : !CONTROL.has(rel) && rel !== SUITE_FILE));
    const overlay = moved.filter((rel) => rel.startsWith('overlay/'));
    for (const rel of [...loose, ...overlay]) {
      const target = (rel.startsWith('overlay/') ? rel.slice('overlay/'.length) : rel).split('/').map((segment) => renames[segment] ?? segment).join('/');
      const buffer = readFileSync(join(dir, rel));
      if (isBinary(buffer)) {
        if (buffer.length > MAX_BINARY) {
          problem = `binary overlay file ${rel} of ${buffer.length} bytes`;
          break;
        }
        ops.push({ write: { file: target, base64: buffer.toString('base64') } });
      } else ops.push({ write: { file: target, content: buffer.toString('utf8') } });
    }
    if (problem) {
      kept.push(`${name} (${problem})`);
      continue;
    }
    if (files.includes('mutation.json')) {
      const data = JSON.parse(readFileSync(join(dir, 'mutation.json'), 'utf8'));
      if (Array.isArray(data)) ops.push(...data);
      else {
        if (data.$comment !== undefined) entry.$comment = data.$comment;
        if ('base' in data) entry.base = data.base;
        if ('extends' in data) entry.extends = data.extends;
        ops.push(...(data.ops ?? []));
      }
    }
    if (files.includes('plant.json')) ops.push({ plant: JSON.parse(readFileSync(join(dir, 'plant.json'), 'utf8')) });
    if (files.includes('ARGS.txt')) entry.args = readFileSync(join(dir, 'ARGS.txt'), 'utf8').trim().split(/\s+/).filter(Boolean).join(' ');
    const ordered = { ...('$comment' in entry ? { $comment: entry.$comment } : {}), ...('args' in entry ? { args: entry.args } : {}), ...('base' in entry ? { base: entry.base } : {}), ...('extends' in entry ? { extends: entry.extends } : {}) };
    cases[name] = Object.keys(ordered).length === 0 ? ops : { ...ordered, ...(ops.length > 0 ? { ops } : {}) };
    if (!dry) {
      for (const rel of moved.filter((item) => !item.includes('/'))) rmSync(join(dir, rel), { force: true });
      for (const top of new Set(moved.filter((item) => item.includes('/')).map((item) => item.split('/')[0]))) rmSync(join(dir, top), { recursive: true, force: true });
    }
    removed += moved.length;
    packed += 1;
  }
  if (foldExpect) {
    for (const name of names) {
      const dir = join(suiteDir, name);
      if (bases.some((base) => base === name || base.startsWith(`${name}/`)) || !existsSync(dir)) continue;
      let files;
      try {
        files = listFiles(dir);
      } catch {
        continue;
      }
      // After packing the folder must hold only EXPECT.txt (a dry run left the packed files in place: a case
      // that has a CASES.json entry would hold only its EXPECT.txt).
      const onlyExpect = files.length === 1 && files[0] === 'EXPECT.txt';
      if (!(onlyExpect || (dry && name in cases && files.includes('EXPECT.txt')))) continue;
      const entry = cases[name];
      const expect = expectValue(readFileSync(join(dir, 'EXPECT.txt'), 'utf8'));
      if (entry === undefined) cases[name] = { expect };
      else if (Array.isArray(entry)) cases[name] = entry.length > 0 ? { expect, ops: entry } : { expect };
      else {
        const { $comment, ...rest } = entry;
        cases[name] = { ...($comment !== undefined ? { $comment } : {}), expect, ...rest };
      }
      if (!dry) rmSync(dir, { recursive: true, force: true });
      removed += 1;
      packed += 1;
    }
  }
  const sorted = Object.fromEntries(Object.keys(cases).sort((a, b) => (a === '$comment' ? -1 : b === '$comment' ? 1 : a < b ? -1 : 1)).map((key) => [key, cases[key]]));
  const text = stringifyCompact(sorted);
  if (!dry && packed > 0) writeFileSync(casesPath, text);
  return { packed, kept, removed, text };
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const skillDir = resolve(requireDir(positionals[0], 'skill folder'));
  const testsDir = join(skillDir, 'tests');
  const lib = join(skillDir, 'scripts', 'check-lib.mjs');
  if (!existsSync(lib) || !readFileSync(lib, 'utf8').includes('export const CASES_FILE')) {
    throw new UsageError(`${toPosix(relative(process.cwd(), lib))} does not read CASES.json`, "Copy the library's tools/shared/scripts/check-lib.mjs over the skill's scripts/check-lib.mjs first.");
  }
  if (options.expect && !readFileSync(lib, 'utf8').includes('function readInlineCaseNames')) {
    throw new UsageError(`${toPosix(relative(process.cwd(), lib))} does not read a CASES.json "expect"`, "Sync the library's tools/shared/scripts/check-lib.mjs into the skill first (node tools/sync-shared.mjs <skill>).");
  }
  if (!existsSync(join(skillDir, 'scripts', 'selftest.mjs'))) throw new UsageError('the skill has no scripts/selftest.mjs', 'Pack only skills with a self-test.');
  const report = createReporter({ name: 'fixtures-pack', json: options.json });
  const work = makeTempDir('fixtures-pack-');
  const backup = join(work, 'tests');
  cpSync(testsDir, backup, { recursive: true });
  const restore = () => {
    rmSync(testsDir, { recursive: true, force: true });
    cpSync(backup, testsDir, { recursive: true });
  };
  const before = treeCount(testsDir);
  const rows = [];
  let considered = 0;
  try {
    const baseline = options.verify ? outcomes(selftest(skillDir, []).stdout) : null;
    const assembled = materialize(skillDir, join(work, 'before'));
    const wanted = (options.suite ?? []).map((rel) => resolve(skillDir, rel));
    const candidates = assembled.map((name) => join(testsDir, 'fixtures', name)).filter((dir) => existsSync(dir) && statSync(dir).isDirectory() && (wanted.length === 0 || wanted.includes(dir)));
    const notAssembled = wanted.filter((item) => !candidates.includes(item));
    considered = candidates.length + notAssembled.length;
    for (const dir of notAssembled) report.note(`skip ${toPosix(relative(skillDir, dir))}: the self-test does not assemble it (its cases run in place); convert it to an overlay suite first`);
    for (const suiteDir of candidates) {
      const rel = toPosix(relative(skillDir, suiteDir));
      const result = packSuite(suiteDir, options['dry-run'], options.expect);
      rows.push({ suite: rel, packed: result.packed, removed: result.removed, kept: result.kept });
      report.note(`${result.packed > 0 ? 'pack' : 'skip'} ${rel}: ${result.packed} cases${result.packed > 0 ? `, ${result.removed} files into ${CASES_FILE} (${result.text.length} bytes)` : ''}${result.kept.length > 0 ? `; kept ${result.kept.join(', ')}` : ''}`);
    }
    if (!options['dry-run'] && rows.some((row) => row.packed > 0)) {
      materialize(skillDir, join(work, 'after'));
      const diffs = compareTrees(join(work, 'before'), join(work, 'after'));
      if (diffs.length > 0) {
        restore();
        for (const diff of diffs.slice(0, 20)) report.problem({ file: toPosix(relative(process.cwd(), skillDir)), rule: 'pack-identical', message: diff, fix: 'An assembled case changed, so the original fixtures were restored. Pack the other suites with --suite and report this one.' });
        return report.finish({ checked: considered, unit: 'suites' });
      }
      report.note('identical: every assembled case is byte for byte the same');
      if (baseline) {
        const after = outcomes(selftest(skillDir, []).stdout);
        const changed = [...new Set([...baseline.keys(), ...after.keys()])].filter((key) => baseline.get(key) !== after.get(key));
        if (changed.length > 0) {
          restore();
          for (const key of changed.slice(0, 20)) report.problem({ file: toPosix(relative(process.cwd(), skillDir)), rule: 'verify', message: `${key}: before "${baseline.get(key) ?? '(none)'}", after "${after.get(key) ?? '(none)'}"`, fix: 'The outcomes changed, so the original fixtures were restored.' });
          return report.finish({ checked: considered, unit: 'suites' });
        }
        report.note(`verify: identical outcomes for all ${baseline.size - 1} runs ("${after.get('RESULT')}")`);
      }
    }
  } catch (error) {
    restore();
    throw error;
  } finally {
    removeTempDir(work);
  }
  const after = treeCount(testsDir);
  report.note(`tests/: ${before.files} -> ${options['dry-run'] ? before.files - rows.reduce((sum, row) => sum + row.removed, 0) + rows.filter((row) => row.packed > 0).length : after.files} files${options['dry-run'] ? ' (dry run, estimated)' : `, ${before.bytes} -> ${after.bytes} bytes`}`);
  if (options.json) console.log(JSON.stringify({ rows, before, after }));
  return report.finish({ checked: considered, unit: 'suites' });
}

run(main);
