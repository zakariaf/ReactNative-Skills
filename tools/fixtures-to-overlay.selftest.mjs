#!/usr/bin/env node
// fixtures-to-overlay.selftest.mjs: the self-test of fixtures-to-overlay.mjs on a small synthetic skill:
// changed, deleted and added files, a .gitignore, a data file named mutation.json that good/ holds too,
// a dry run that writes nothing, a converted suite whose self-test outcomes stay identical, the keep
// rule for a suite that would grow, and the skip of an older assembler's suite.
//   node tools/fixtures-to-overlay.selftest.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, makeTempDir, parseArgs, removeTempDir, run } from './shared/scripts/check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, 'fixtures-to-overlay.mjs');
const CHECK_LIB = join(HERE, 'shared', 'scripts', 'check-lib.mjs');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const node = (args) => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', last: (result.stdout ?? '').trim().split('\n').at(-1) };
};
const files = (dir) => {
  const out = [];
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(abs, entry.name), childRel);
      else out.push(childRel);
    }
  };
  visit(dir, '');
  return out.sort();
};

const BIG = Array.from({ length: 80 }, (_, i) => `export const value${i} = ${i};`).join('\n');

/** A skill whose checker reports every "BUG <rule>" line in .ts/.json/.gitignore files. */
function makeSkill(dir) {
  const skill = join(dir, 'demo-skill');
  write(join(skill, 'SKILL.md'), '---\nname: demo-skill\ndescription: x\n---\n');
  cpSync(CHECK_LIB, join(skill, 'scripts', 'check-lib.mjs'));
  write(join(skill, 'scripts', 'check-bugs.mjs'), `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReporter, parseArgs, requireDir, run, walk } from './check-lib.mjs';
run(async () => {
  const { positionals } = parseArgs(process.argv.slice(2), { name: 'check-bugs', usage: '[repo-root]', positionals: { min: 0, max: 1 } });
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-bugs' });
  const list = walk(root, { include: ['*.ts', '*.json', '.gitignore'] });
  for (const rel of list) readFileSync(join(root, rel), 'utf8').split('\\n').forEach((line, i) => { const m = /BUG (\\S+)/.exec(line); if (m) report.problem({ file: rel, line: i + 1, rule: m[1], message: 'planted' }); });
  if (!list.includes('src/required.ts')) report.problem({ file: 'src/required.ts', rule: 'required', message: 'missing' });
  return report.finish({ checked: list.length });
});
`);
  write(join(skill, 'scripts', 'selftest.mjs'), "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [\n  { script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] },\n  { script: 'check-bugs.mjs', fixtures: '../tests/fixtures/tiny', args: (dir) => [dir] },\n]);\n");
  const suite = join(skill, 'tests', 'fixtures', 'check-bugs');
  const good = (rel, text) => {
    for (const name of ['good', 'bad-changed', 'bad-deleted', 'bad-added', 'pass-ignore']) write(join(suite, name, rel), text);
  };
  good('src/big.ts', `${BIG}\n`);
  good('src/required.ts', 'export {};\n');
  good('src/other.ts', 'export const other = 1;\n');
  good('mutation.json', '{ "schemaVersion": "1" }\n');
  good('.gitignore', 'node_modules\n');
  write(join(suite, 'bad-changed', 'src', 'big.ts'), `${BIG.replace('export const value40 = 40;', 'BUG rule-changed')}\n`);
  write(join(suite, 'bad-changed', 'EXPECT.txt'), 'src/big.ts:41 [rule-changed]\n');
  writeFileSync(join(suite, 'bad-deleted', 'src', 'required.ts'), '');
  writeFileSync(join(suite, 'bad-deleted', 'EXPECT.txt'), '[required]\n');
  write(join(suite, 'bad-added', 'src', 'new.ts'), 'BUG rule-added\n');
  write(join(suite, 'bad-added', 'mutation.json'), '{ "schemaVersion": "1" }\nBUG rule-data\n');
  write(join(suite, 'bad-added', 'EXPECT.txt'), 'src/new.ts:1 [rule-added]\nmutation.json:2 [rule-data]\n');
  write(join(suite, 'pass-ignore', '.gitignore'), 'node_modules\nbuild\n');
  write(join(suite, 'pass-ignore', 'EXPECT.txt'), 'check-bugs: 5 files checked, 0 problems\n');
  // A tiny suite whose overlay form would not be smaller.
  write(join(skill, 'tests', 'fixtures', 'tiny', 'good', 'src', 'required.ts'), 'export {};\n');
  write(join(skill, 'tests', 'fixtures', 'tiny', 'bad-x', 'src', 'a.ts'), 'BUG x\n');
  write(join(skill, 'tests', 'fixtures', 'tiny', 'bad-x', 'EXPECT.txt'), '[x]\n');
  return skill;
}

test('dry run reports and writes nothing; --verify converts with identical outcomes', () => {
  const dir = makeTempDir('f2o-');
  try {
    const skill = makeSkill(dir);
    // bad-deleted: the file is really missing (an empty file still counts as present).
    const suite = join(skill, 'tests', 'fixtures', 'check-bugs');
    spawnSync('rm', [join(suite, 'bad-deleted', 'src', 'required.ts')]);
    const baseline = node([join(skill, 'scripts', 'selftest.mjs')]);
    assert.equal(baseline.last, 'RESULT: PASS', `the synthetic skill must pass before conversion:\n${baseline.stdout}`);
    const before = files(join(skill, 'tests'));
    const dry = node([TOOL, skill, '--dry-run']);
    assert.equal(dry.status, 0, dry.stdout);
    assert.match(dry.stdout, /^plan tests\/fixtures\/check-bugs: 5 cases, /m);
    assert.match(dry.stdout, /^keep tests\/fixtures\/tiny: the overlay form is not smaller/m);
    assert.deepEqual(files(join(skill, 'tests')), before, 'a dry run writes nothing');
    const real = node([TOOL, skill, '--verify']);
    assert.equal(real.status, 0, real.stdout);
    assert.match(real.stdout, /^verify: identical outcomes for all 7 cases and --help runs \("RESULT: PASS"\)$/m);
    assert.deepEqual(JSON.parse(readFileSync(join(suite, 'SUITE.json'), 'utf8')), { base: 'good' });
    assert.deepEqual(files(join(suite, 'good')), ['dot-gitignore', 'overlay/mutation.json', 'src/big.ts', 'src/other.ts', 'src/required.ts']);
    assert.deepEqual(files(join(suite, 'bad-changed')), ['EXPECT.txt', 'mutation.json']);
    assert.equal(JSON.parse(readFileSync(join(suite, 'bad-changed', 'mutation.json'), 'utf8'))[0].replace.with, 'BUG rule-changed\n');
    assert.deepEqual(files(join(suite, 'bad-deleted')), ['DELETE.txt', 'EXPECT.txt']);
    assert.equal(readFileSync(join(suite, 'bad-deleted', 'DELETE.txt'), 'utf8'), 'src/required.ts\n');
    assert.deepEqual(files(join(suite, 'bad-added')), ['EXPECT.txt', 'overlay/mutation.json', 'overlay/src/new.ts'], 'the data file named mutation.json goes under overlay/');
    assert.ok(!existsSync(join(suite, 'pass-ignore', '.gitignore')));
    assert.deepEqual(files(join(suite, 'pass-ignore')), ['EXPECT.txt', 'overlay/dot-gitignore'], 'a changed .gitignore is stored as dot-gitignore');
    assert.ok(existsSync(join(skill, 'tests', 'fixtures', 'tiny', 'bad-x', 'src', 'a.ts')), 'the tiny suite is kept as it is');
    const after = node([join(skill, 'scripts', 'selftest.mjs')]);
    assert.equal(after.last, 'RESULT: PASS', after.stdout);
    const again = node([TOOL, skill, '--dry-run']);
    assert.match(again.stdout, /skip tests\/fixtures\/check-bugs: already an overlay suite \(SUITE\.json\)/);
  } finally {
    removeTempDir(dir);
  }
});

test('an older assembler suite is skipped; a skill without the overlay engine is exit 2; --png-ops needs --verify', () => {
  const dir = makeTempDir('f2o-skip-');
  try {
    const skill = makeSkill(dir);
    const suite = join(skill, 'tests', 'fixtures', 'check-bugs');
    write(join(suite, 'bad-legacy', 'mutation.json'), '[{ "replace": { "file": "a", "find": "b", "with": "c" } }]\n');
    write(join(suite, 'bad-legacy', 'EXPECT.txt'), 'x\n');
    spawnSync('rm', [join(suite, 'good', 'mutation.json')]);
    const skipped = node([TOOL, skill, '--dry-run']);
    assert.match(skipped.stdout, /skip tests\/fixtures\/check-bugs: bad-[a-z]+\/ holds mutation\.json at its root and good\/ does not/);
    writeFileSync(join(skill, 'scripts', 'check-lib.mjs'), '// an older check-lib\n');
    const old = node([TOOL, skill, '--verify']);
    assert.equal(old.status, 2);
    assert.match(old.stdout, /has no overlay engine/);
    const png = node([TOOL, skill, '--png-ops']);
    assert.equal(png.status, 2);
    assert.match(png.stdout, /--png-ops needs --verify/);
    assert.equal(node([TOOL, join(dir, 'nope')]).status, 2);
  } finally {
    removeTempDir(dir);
  }
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'fixtures-to-overlay.selftest', summary: 'Self-test of fixtures-to-overlay.mjs.', usage: '' });
  const report = createReporter({ name: 'fixtures-to-overlay.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'fixtures-to-overlay.mjs', rule: 'selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix fixtures-to-overlay.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
