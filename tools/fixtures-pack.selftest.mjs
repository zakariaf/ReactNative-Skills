#!/usr/bin/env node
// fixtures-pack.selftest.mjs: the self-test of fixtures-pack.mjs on a small synthetic skill: mutation.json,
// DELETE.txt, loose and overlay/ files (a dot-gitignore renamed), ARGS.txt and plant.json all move into
// CASES.json; a case that another case uses as a base layer stays; a dry run writes nothing; the packed
// suite's self-test outcomes stay identical; --expect folds each EXPECT.txt in and removes the emptied
// folders; a skill whose check-lib cannot read CASES.json is exit 2.
//   node tools/fixtures-pack.selftest.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, makeTempDir, parseArgs, removeTempDir, run } from './shared/scripts/check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, 'fixtures-pack.mjs');
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

/** A skill whose checker reports every "BUG <rule>" line in .ts/.json/.gitignore files, and a --mark note. */
function makeSkill(dir) {
  const skill = join(dir, 'demo-skill');
  write(join(skill, 'SKILL.md'), '---\nname: demo-skill\ndescription: x\n---\n');
  cpSync(CHECK_LIB, join(skill, 'scripts', 'check-lib.mjs'));
  write(join(skill, 'scripts', 'check-bugs.mjs'), `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReporter, parseArgs, requireDir, run, walk } from './check-lib.mjs';
run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), { name: 'check-bugs', usage: '[repo-root]', options: { mark: { type: 'string', help: 'a note' } }, positionals: { min: 0, max: 1 } });
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-bugs' });
  if (options.mark) report.note('mark=' + options.mark);
  const list = walk(root, { include: ['*.ts', '*.json', '.gitignore', '*.md'] });
  for (const rel of list) readFileSync(join(root, rel), 'utf8').split('\\n').forEach((line, i) => { const m = /BUG (\\S+)/.exec(line); if (m) report.problem({ file: rel, line: i + 1, rule: m[1], message: 'planted' }); });
  if (!list.includes('src/required.ts')) report.problem({ file: 'src/required.ts', rule: 'required', message: 'missing' });
  return report.finish({ checked: list.length });
});
`);
  write(join(skill, 'scripts', 'selftest.mjs'), "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [{ script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] }]);\n");
  const suite = join(skill, 'tests', 'fixtures', 'check-bugs');
  write(join(suite, 'SUITE.json'), '{ "base": "good" }\n');
  write(join(suite, 'good', 'src', 'required.ts'), 'export const required = 1;\n');
  write(join(suite, 'good', 'src', 'a.ts'), 'export const a = 1;\n');
  write(join(suite, 'bad-mutation', 'EXPECT.txt'), 'src/a.ts:1 [rule-a]\n');
  write(join(suite, 'bad-mutation', 'mutation.json'), '[{ "replace": { "file": "src/a.ts", "find": "export const a = 1;", "with": "BUG rule-a" } }]\n');
  write(join(suite, 'bad-delete-and-overlay', 'EXPECT.txt'), '[required]\n.gitignore:1 [rule-ignore]\nsrc/b.ts:1 [rule-b]\nmark=packed\n');
  write(join(suite, 'bad-delete-and-overlay', 'DELETE.txt'), '# the required file goes\nsrc/required.ts\n');
  write(join(suite, 'bad-delete-and-overlay', 'overlay', 'dot-gitignore'), 'BUG rule-ignore\n');
  write(join(suite, 'bad-delete-and-overlay', 'src', 'b.ts'), 'BUG rule-b\n');
  write(join(suite, 'bad-delete-and-overlay', 'ARGS.txt'), '{dir}\n--mark packed\n');
  write(join(suite, 'bad-planted', 'EXPECT.txt'), 'notes/handover.md:1 [rule-plant]\n');
  write(join(suite, 'bad-planted', 'plant.json'), '{ "notes/handover.md": "BUG rule-plant\\n" }\n');
  // bad-layer's overlay/ is the base of bad-on-layer: it stays as it is.
  write(join(suite, 'bad-layer', 'EXPECT.txt'), 'src/layer.ts:1 [rule-layer]\n');
  write(join(suite, 'bad-layer', 'overlay', 'src', 'layer.ts'), 'BUG rule-layer\n');
  write(join(suite, 'bad-on-layer', 'EXPECT.txt'), 'src/layer.ts:1 [rule-layer]\n');
  write(join(suite, 'bad-on-layer', 'mutation.json'), '{ "base": ["good", "bad-layer/overlay"], "extends": null, "ops": [] }\n');
  return skill;
}

test('packs mutation.json, DELETE.txt, overlay files, ARGS.txt and plant.json into CASES.json with identical outcomes; keeps a base layer; dry run writes nothing', () => {
  const dir = makeTempDir('fpack-');
  try {
    const skill = makeSkill(dir);
    const suite = join(skill, 'tests', 'fixtures', 'check-bugs');
    const original = files(suite);
    const dry = node([TOOL, skill, '--dry-run']);
    assert.equal(dry.status, 0, dry.stdout);
    assert.deepEqual(files(suite), original, 'a dry run writes nothing');
    const packed = node([TOOL, skill, '--verify']);
    assert.equal(packed.status, 0, packed.stdout);
    assert.match(packed.stdout, /pack tests\/fixtures\/check-bugs: 4 cases, 7 files into CASES\.json .*kept bad-layer \(a base layer\)/);
    assert.match(packed.stdout, /identical: every assembled case is byte for byte the same/);
    assert.match(packed.stdout, /verify: identical outcomes/);
    assert.deepEqual(files(suite), ['CASES.json', 'SUITE.json', 'bad-delete-and-overlay/EXPECT.txt', 'bad-layer/EXPECT.txt', 'bad-layer/overlay/src/layer.ts', 'bad-mutation/EXPECT.txt', 'bad-on-layer/EXPECT.txt', 'bad-planted/EXPECT.txt', 'good/src/a.ts', 'good/src/required.ts']);
    const cases = JSON.parse(readFileSync(join(suite, 'CASES.json'), 'utf8'));
    assert.deepEqual(cases['bad-delete-and-overlay'], { args: '{dir} --mark packed', ops: [{ delete: 'src/required.ts' }, { write: { file: 'src/b.ts', content: 'BUG rule-b\n' } }, { write: { file: '.gitignore', content: 'BUG rule-ignore\n' } }] });
    assert.deepEqual(cases['bad-planted'], [{ plant: { 'notes/handover.md': 'BUG rule-plant\n' } }]);
    assert.deepEqual(cases['bad-on-layer'], { base: ['good', 'bad-layer/overlay'], extends: null });
    const selftest = node([join(skill, 'scripts', 'selftest.mjs')]);
    assert.equal(selftest.last, 'RESULT: PASS', selftest.stdout);
    const again = node([TOOL, skill]);
    assert.equal(again.status, 0, again.stdout);
    assert.match(again.stdout, /skip tests\/fixtures\/check-bugs: 0 cases/);
    // --expect: each EXPECT.txt moves into CASES.json and the emptied folder goes; the base layer and good/ stay.
    const folded = node([TOOL, skill, '--expect', '--verify']);
    assert.equal(folded.status, 0, folded.stdout);
    assert.match(folded.stdout, /verify: identical outcomes/);
    assert.deepEqual(files(suite), ['CASES.json', 'SUITE.json', 'bad-layer/EXPECT.txt', 'bad-layer/overlay/src/layer.ts', 'good/src/a.ts', 'good/src/required.ts']);
    const foldedCases = JSON.parse(readFileSync(join(suite, 'CASES.json'), 'utf8'));
    assert.deepEqual(foldedCases['bad-mutation'], { expect: ['src/a.ts:1 [rule-a]'], ops: [{ replace: { file: 'src/a.ts', find: 'export const a = 1;', with: 'BUG rule-a' } }] });
    assert.deepEqual(foldedCases['bad-on-layer'], { expect: ['src/layer.ts:1 [rule-layer]'], base: ['good', 'bad-layer/overlay'], extends: null });
    assert.equal(node([join(skill, 'scripts', 'selftest.mjs')]).last, 'RESULT: PASS');
  } finally {
    removeTempDir(dir);
  }
});

test('a skill whose check-lib cannot read CASES.json, or a missing folder, is exit 2; an in-place suite named with --suite is skipped', () => {
  const dir = makeTempDir('fpack-skip-');
  try {
    const skill = makeSkill(dir);
    write(join(skill, 'tests', 'fixtures', 'in-place', 'good', 'src', 'required.ts'), 'export const required = 1;\n');
    write(join(skill, 'tests', 'fixtures', 'in-place', 'bad-x', 'EXPECT.txt'), '[required]\n');
    write(join(skill, 'scripts', 'selftest.mjs'), "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [{ script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] }, { script: 'check-bugs.mjs', fixtures: '../tests/fixtures/in-place', args: (dir) => [dir] }]);\n");
    const skipped = node([TOOL, skill, '--suite', 'tests/fixtures/in-place']);
    assert.equal(skipped.status, 0, skipped.stdout);
    assert.match(skipped.stdout, /skip tests\/fixtures\/in-place: the self-test does not assemble it/);
    writeFileSync(join(skill, 'scripts', 'check-lib.mjs'), '// an older check-lib\n');
    const old = node([TOOL, skill]);
    assert.equal(old.status, 2);
    assert.match(old.stdout, /does not read CASES\.json/);
    assert.equal(node([TOOL, join(dir, 'nope')]).status, 2);
  } finally {
    removeTempDir(dir);
  }
});

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'fixtures-pack.selftest', summary: 'Self-test of fixtures-pack.mjs.', usage: '' });
  const report = createReporter({ name: 'fixtures-pack.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'fixtures-pack.mjs', rule: 'selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix fixtures-pack.mjs (or this test).' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
