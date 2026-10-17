#!/usr/bin/env node
// tests/selftest.mjs: the maintainer tools' own self-test. check-lib has its own self-test
// (tools/shared/scripts/check-lib.selftest.mjs), which selftest-all runs next to this one.
//  1. The validator: every case build-cases.mjs generates (into a temporary folder) fails with exactly
//     the rule it plants, good cases pass, and every rule has a planted case; --rule, --summary and
//     --standard; the frontmatter parser; the project-reference, runtime-variable and device detectors;
//     the skills-folder layout; overlay fixtures.
//  2. sync-shared and selftest-all (--shard, CI annotations, an installed copy, shared self-test discovery).
//  3. check-repo-hygiene in a plain folder and in a git repo, and its .gitignore evaluator.
//  4. check-stack-pins: versions and ranges, statement forms, the context rules, markers, the CLI.
//  5. build-catalog: placeholders, generated blocks, the marketplace entries, --check.
//  6. The repo itself: no committed SKILL.md under tools/, no committed validator cases.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASE_TABLE, SHARED, baseScripted, baseBasic, buildCases } from './build-cases.mjs';
import { parseYamlSubset, splitFrontmatter } from '../lib/frontmatter.mjs';
import { listSkillDirs, resolveRoots } from '../lib/library.mjs';
import { RULES, findImplicitDeviceCalls, findProjectRefs, findRuntimeEnv } from '../validate-skills.mjs';
import { annotation, collectRows, parseShard } from '../selftest-all.mjs';
import { createIgnoreMatcher, gitignorePatternToRegExp } from '../check-repo-hygiene.mjs';
import { checkText, compileMatchers as compile, consistent, loadStack, parseVersion, rangeInterval, statementsInLine } from '../check-stack-pins.mjs';
import { MARKERS, PLUGINS, PLUGIN_META, splitDescription } from '../build-catalog.mjs';
import { createReporter, makeTempDir, parseArgs, removeTempDir, run, walk } from '../shared/scripts/check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(HERE, '..');
const VALIDATOR = join(TOOLS, 'validate-skills.mjs');
const STANDARD = JSON.parse(readFileSync(join(TOOLS, 'standard.json'), 'utf8'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function node(script, args = [], cwd = TOOLS, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  const stdout = result.stdout ?? '';
  return { status: result.status, stdout, output: `${stdout}${result.stderr ?? ''}`, last: stdout.split('\n').filter(Boolean).at(-1) ?? '' };
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) if (content !== null) write(join(root, rel), content);
}

function validatorJson(result) {
  const json = result.stdout.split('\n').find((line) => line.startsWith('{"skills"'));
  assert.ok(json, `no JSON line in validator output:\n${result.output.slice(-2000)}`);
  return JSON.parse(json);
}

function rulesOf(result) {
  const data = validatorJson(result);
  return [...new Set([...data.skills.flatMap((skill) => skill.problems), ...data.layout].map((problem) => problem.rule))].sort();
}

// ---------------------------------------------------------------------------------------------
// 1. Validator
// ---------------------------------------------------------------------------------------------

test('validator: every generated case fails with exactly its rule (good cases pass) and every rule has a case', () => {
  const tmp = makeTempDir('selftest-cases-');
  try {
    const cases = buildCases(tmp);
    assert.equal(cases.length, CASE_TABLE.length);
    const seen = new Set();
    for (const item of cases) {
      const result = node(VALIDATOR, ['--json', '--skills-root', item.skillsRoot, '--shared', SHARED], tmp);
      const got = rulesOf(result);
      const want = [...item.rules].sort();
      want.forEach((rule) => seen.add(rule));
      assert.deepEqual(got, want, `case ${item.id}: expected rules [${want}] got [${got}]\n${result.stdout.slice(0, 3000)}`);
      assert.equal(result.status, want.length ? 1 : 0, `case ${item.id}: exit ${result.status}`);
      assert.match(result.last, want.length ? /^RESULT: FAIL \(\d+ problems\)$/ : /^RESULT: PASS$/, `case ${item.id}`);
    }
    const untested = Object.keys(RULES).filter((rule) => !seen.has(rule));
    assert.deepEqual(untested, [], `rules without a planted-bug case: ${untested.join(', ')}`);
    for (const good of ['good-basic', 'good-scripted', 'good-runbook', 'good-overlay']) assert.ok(cases.some((item) => item.id === good && item.rules.length === 0), good);
  } finally {
    removeTempDir(tmp);
  }
});

test('validator: --rule filters, --summary counts per rule, unknown rules are bad input', () => {
  const tmp = makeTempDir('selftest-summary-');
  try {
    const skills = join(tmp, 'skills');
    writeTree(join(skills, 'alpha'), baseBasic('alpha'));
    writeTree(join(skills, 'beta'), { ...baseBasic('beta'), 'references/guide.md': 'It is IMPORTANT.\nRun node tools/sync-shared.mjs first.\n' });
    const all = node(VALIDATOR, ['--no-run', '--json', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.deepEqual(rulesOf(all), ['no-project-ref', 'no-shouting']);
    const only = node(VALIDATOR, ['--no-run', '--json', '--rule', 'no-shouting', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.deepEqual(rulesOf(only), ['no-shouting']);
    assert.equal(only.last, 'RESULT: FAIL (1 problems)');
    const summary = node(VALIDATOR, ['--no-run', '--summary', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.equal(summary.status, 1);
    assert.match(summary.stdout, /^PASS {2}alpha$/m);
    assert.match(summary.stdout, /^FAIL {2}beta \(2 problems\)$/m);
    assert.doesNotMatch(summary.stdout, /\[no-shouting\]/, 'the summary prints counts, not problem lines');
    assert.match(summary.stdout, /^no-shouting\s+1\s+1$/m);
    assert.match(summary.stdout, /^fixture-budget\s+0\s+0$/m);
    assert.match(summary.stdout, /^descriptions: 2 read, average \d+ characters \(target 250, limit 300\)/m);
    const bad = node(VALIDATOR, ['--rule', 'no-such-rule', '--skills-root', skills], tmp);
    assert.equal(bad.status, 2);
    assert.match(bad.stdout, /unknown rule "no-such-rule"/);
  } finally {
    removeTempDir(tmp);
  }
});

test('validator: the constants come from standard.json (--standard overrides them)', () => {
  const tmp = makeTempDir('selftest-standard-');
  try {
    const skills = join(tmp, 'skills');
    writeTree(join(skills, 'good-scripted'), baseScripted('good-scripted'));
    const custom = structuredClone(STANDARD);
    custom.description.maxChars = 40;
    custom.fixtures.budget.testsMaxFiles = 2;
    custom.skillMd.sections = custom.skillMd.sections.map((title) => (title === 'Anti-patterns' ? 'Pitfalls' : title));
    write(join(tmp, 'standard.json'), JSON.stringify(custom));
    const normal = node(VALIDATOR, ['--no-run', '--json', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.deepEqual(rulesOf(normal), [], normal.output);
    const result = node(VALIDATOR, ['--no-run', '--json', '--standard', join(tmp, 'standard.json'), '--skills-root', skills, '--shared', SHARED], tmp);
    assert.deepEqual(rulesOf(result), ['desc-length', 'fixture-budget', 'sections']);
    assert.match(result.stdout, /description is \d+ characters \(limit 40; aim for 250\)/);
    assert.match(result.stdout, /tests\/ holds 3 files \(limit 2\)/);
    assert.match(result.stdout, /missing section "## Pitfalls"/);
  } finally {
    removeTempDir(tmp);
  }
});

test('frontmatter: YAML subset parser', () => {
  const lines = (text) => text.split('\n').map((line, i) => ({ text: line, line: i + 2 }));
  const good = parseYamlSubset(lines('name: a-b\ndescription: "Builds: things # really"\narguments: [screen, "route"]\nmetadata:\n  version: "1.0"\n  internal: true\n# comment'));
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.data, { name: 'a-b', description: 'Builds: things # really', arguments: ['screen', 'route'], metadata: { version: '1.0', internal: 'true' } });
  const bad = parseYamlSubset(lines("description: Builds x. Use when: y\nlicense: |\n  MIT\nname: 'open\nname: again\n\tkey: tab\ncompatibility: a #b"));
  const messages = bad.errors.map((error) => error.message).join('\n');
  assert.match(messages, /colon followed by a space/);
  assert.match(messages, /block scalars/);
  assert.match(messages, /not closed/);
  assert.match(messages, /duplicate key "name"/);
  assert.match(messages, /tab indentation/);
  assert.match(messages, /starts a YAML comment/);
  assert.equal(splitFrontmatter('\n---\nname: x\n---\n').line1Ok, false);
  assert.equal(splitFrontmatter('\ufeff---\nname: x\n---\n').line1Ok, false);
  assert.equal(splitFrontmatter('---\nname: x\n').closed, false);
});

test('validator: project-reference detector (generalized ban list)', () => {
  const flagged = (line, options) => findProjectRefs(line, options).length > 0;
  for (const line of [
    '/Users/someone/x', 'see /home/dev/notes.md', 'C:\\Users\\dev\\x', 'C:/Users/dev/x', 'the scratchpad', '/private/tmp/x', '/tmp/claude-501/y',
    '.claude/skills/other-skill/SKILL.md', '.agents/skills/other-skill/references/a.md', 'skills/other-skill/references/a.md',
    'skills/_library/shared/fonts/x.ttf', 'node skills/_library/validate-skills.mjs', 'node tools/validate-skills.mjs', 'tools/standard.json', 'tools/shared/scripts/check-lib.mjs', 'tools/new-tool.mjs',
  ]) assert.ok(flagged(line), `should flag: ${line}`);
  for (const line of [
    'packages/ui/src/design/tokens.ts', 'see docs/05-ui.md', 'read design/tokens.html', 'spec.txt section 5', 'the idea-hunt notes', 'src/app/home/index.tsx', 'apps/x/docs/notes.md',
    'https://docs.expo.dev/versions/latest/', 'https://github.com/x/y/blob/main/tools/a.mjs', '${CLAUDE_SKILL_DIR}/scripts/check.mjs', '.claude/settings.json', 'the skills/ folder', 'const re = /docs\\//;',
    'tools/maestro/bin/maestro test', '.agents/skills/<name>/SKILL.md', 'src/tools/format.ts',
  ]) assert.ok(!flagged(line), `should not flag: ${line}`);
  assert.ok(flagged('see [x](../y.md)', { markdownProse: true }));
  assert.ok(!flagged("import { a } from '../theme';"));
  assert.ok(flagged("readFileSync('../../assets/x')", { script: true }));
  assert.ok(!flagged("new URL('../assets/x', import.meta.url)", { script: true }));
});

test('validator: runtime-variable detector', () => {
  const hits = (line, options) => findRuntimeEnv(line, options).map((hit) => hit.what.split(' ')[0]);
  assert.deepEqual(hits('Read ${CLAUDE_PLUGIN_ROOT}/data.json'), ['CLAUDE_PLUGIN_ROOT']);
  assert.deepEqual(hits('cd "$CLAUDE_PROJECT_DIR"'), ['CLAUDE_PROJECT_DIR']);
  assert.deepEqual(hits("const dir = process.env.CLAUDE_SKILL_DIR;", { script: true }), ['a']);
  assert.deepEqual(hits("const dir = process.env['CLAUDE_CONFIG'];", { script: true }), ['a']);
  assert.deepEqual(hits('node ${CLAUDE_SKILL_DIR}/scripts/check.mjs .'), []);
  assert.deepEqual(hits("fix: 'Run node ${CLAUDE_SKILL_DIR}/scripts/check.mjs .'", { script: true }), []);
  assert.deepEqual(hits("const dir = process.env.CLAUDE_SKILL_DIR;"), [], 'markdown may mention the variable; only scripts must not read it');
});

test('validator: device-explicit finds maestro, simctl, xcodebuild and adb calls that do not name their device', () => {
  const md = (text) => findImplicitDeviceCalls(text, { kind: 'md' }).map((hit) => `${hit.line} ${hit.what}`);
  const script = (text) => findImplicitDeviceCalls(text, { kind: 'script' }).map((hit) => `${hit.line} ${hit.what}`);
  assert.deepEqual(md('```sh\nmaestro test flows/a.yaml\n```'), ['2 "maestro test" without --device <udid> before the command']);
  assert.deepEqual(md('```sh\nmaestro test .maestro/a11y --udid "$UDID" \\\n  --include-tags a11y\n```'), ['2 "maestro test" without --device <udid> before the command']);
  assert.deepEqual(md('Dump it: `maestro --driver-host-port 7001 hierarchy --no-reinstall-driver`'), ['1 "maestro hierarchy" without --device <udid> before the command']);
  assert.deepEqual(md('Run `xcrun simctl io booted screenshot a.png`.'), ['1 "simctl io booted" targets whichever simulator is booted']);
  assert.deepEqual(md('If it hangs, run `xcrun simctl shutdown all`, then the setup again.'), ['1 "simctl shutdown all" targets every simulator on the Mac']);
  assert.deepEqual(md("```sh\nxcodebuild build -workspace A.xcworkspace \\\n  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'\n```"), ['2 xcodebuild -destination "platform=iOS Simulator,name=iPhone 17 Pro" does not name the simulator by id=']);
  assert.deepEqual(md('```sh\nadb shell am start -n com.example/.Main\n```'), ['2 "adb shell" without -s <serial> before the command']);
  assert.deepEqual(md('Clear it: `adb shell pm clear com.example.app`.'), ['1 "adb shell" without -s <serial> before the command']);
  assert.deepEqual(md('```sh\n$ANDROID_HOME/platform-tools/adb -d install app.apk\n```'), ['2 "adb install" without -s <serial> before the command']);
  for (const text of [
    '```sh\nmaestro --device "$UDID" --driver-host-port "$PORT" test flows/a.yaml\n```',
    'The runner calls `maestro test` once per flow; `maestro hierarchy` lists on-screen elements.',
    'Never `xcrun simctl shutdown all`: other sessions use other simulators.',
    '## Anti-patterns\n\n- **`xcrun simctl erase all` to start fresh.** Reset only your own simulator.',
    '`xcrun simctl boot "$UDID"` then `xcrun simctl bootstatus $UDID -b`; `xcrun simctl list devices booted -j`',
    "```sh\nxcodebuild -workspace A.xcworkspace -destination id=$UDID build\nxcodebuild archive -destination 'generic/platform=iOS' -archivePath build/A.xcarchive\n```",
    '```sh\nadb -s emulator-5554 shell am start -n com.example/.Main\nadb devices -l\nANDROID_SERIAL=emulator-5554 adb logcat -d\n```',
    'The `adb shell` command opens a shell on the device.',
    'Never `adb shell rm -rf /sdcard` on a shared device.',
  ]) assert.deepEqual(md(text), [], text);
  assert.deepEqual(script("const r = maestro('hierarchy', '--no-reinstall-driver');"), ['1 a maestro "hierarchy" call without "--device", <udid> before the command']);
  assert.deepEqual(script("spawnSync('maestro', ['test', flow, '-e', env]);"), ['1 a maestro "test" call without "--device", <udid> before the command']);
  assert.deepEqual(script("simctl('io', 'booted', 'screenshot', path);"), ['1 a simctl "io" call on "booted"']);
  assert.deepEqual(script("execFileSync('adb', ['shell', 'input', 'tap', x, y]);"), ['1 an adb "shell" call without "-s", <serial> before the command']);
  assert.deepEqual(script("exec('xcodebuild', ['-workspace', ws, '-destination', 'platform=iOS Simulator,OS=latest']);"), ['1 xcodebuild -destination "platform=iOS Simulator,OS=latest" does not name the simulator by id=']);
  for (const text of [
    "let r = maestro('--device', udid, 'hierarchy', '--no-reinstall-driver');",
    "spawnSync(tool, [...maestroGlobalArgs({ udid, driverPort }), 'test', flow]);",
    "execFileSync('adb', ['-s', serial, 'shell', 'input', 'tap', x, y]);",
    "execFileSync('adb', [...adbArgs(serial), 'shell', 'pm', 'clear', id]);",
    "const maestro = makeMaestro(options.maestro, { udid, driverPort });\nlet r = maestro('hierarchy', '--no-reinstall-driver');",
    "const adb = createAdbRunner({ serial });\nadb('shell', 'pm', 'clear', id);",
  ]) assert.deepEqual(script(text), [], text);
  assert.deepEqual(script("const maestro = makeMaestro(options.maestro);\nlet r = maestro('hierarchy');"), ['2 a maestro "hierarchy" call without "--device", <udid> before the command']);
});

test('validator: library-layout flags everything in the skills folder that is not a skill folder', () => {
  const tmp = makeTempDir('selftest-layout-');
  try {
    const skills = join(tmp, 'skills');
    writeTree(join(skills, 'alpha'), baseBasic('alpha'));
    const clean = node(VALIDATOR, ['--no-run', '--json', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.equal(clean.status, 0, clean.output);
    write(join(skills, 'notes.txt'), 'stray');
    write(join(skills, 'README.md'), '# Skills');
    write(join(skills, 'half-made', 'references', 'notes.md'), 'no SKILL.md');
    write(join(skills, '_library', 'README.md'), 'old tooling');
    write(join(skills, '.DS_Store'), '');
    symlinkSync(join(skills, 'alpha'), join(skills, 'alpha-link'));
    const dirty = node(VALIDATOR, ['--no-run', '--json', '--rule', 'library-layout', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.equal(dirty.status, 1);
    const layout = validatorJson(dirty).layout.map((problem) => `${problem.file}: ${problem.message.split(' (')[0]}`).sort();
    assert.deepEqual(layout, [
      'README.md: stray file in the skills folder',
      '_library: folder names starting with "_" or "." are not skill names',
      'alpha-link: is a symlink inside the skills folder',
      'notes.txt: stray file in the skills folder',
    ]);
    // A folder without SKILL.md is validated as a skill and fails skill-md (not library-layout).
    const halfMade = node(VALIDATOR, ['--no-run', '--json', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.deepEqual(validatorJson(halfMade).skills.find((skill) => skill.skill === 'half-made').problems.map((problem) => problem.rule), ['skill-md']);
    // Discovery skips nothing but non-directories: _library/ and half-made/ are validated as skills too.
    assert.deepEqual(listSkillDirs(skills).map((target) => target.name), ['_library', 'alpha', 'alpha-link', 'half-made']);
    const empty = join(tmp, 'empty');
    mkdirSync(empty);
    assert.equal(node(VALIDATOR, ['--skills-root', empty], tmp).status, 2, 'no skills at all must exit 2');
  } finally {
    removeTempDir(tmp);
  }
});

test('validator: fixtures understand overlay cases and suites with a base instead of good/', () => {
  const tmp = makeTempDir('selftest-overlay-');
  try {
    const skills = join(tmp, 'skills');
    const files = { ...baseScripted('over'), 'tests/fixtures/good/hello.txt': null, 'tests/bases/greetings/hello.txt': 'Hello, Ada\n' };
    files['tests/fixtures/good/hello.txt'] = null;
    writeTree(join(skills, 'over'), files);
    write(join(skills, 'over', 'tests/fixtures/bad-op-form/EXPECT.txt'), 'greeting\n');
    write(join(skills, 'over', 'tests/fixtures/bad-op-form/mutation.json'), JSON.stringify({ ops: [{ op: 'replace', file: 'hello.txt', find: 'Hello', with: 'Bye' }, { png: { file: 'a.png', width: 2, height: 2 } }] }));
    write(join(skills, 'over', 'tests/fixtures/error-args/EXPECT.txt'), 'ERROR [bad-input]\n');
    write(join(skills, 'over', 'tests/fixtures/error-args/ARGS.txt'), 'no-such-folder\n');
    write(join(skills, 'over', 'tests/fixtures/pass-overlay/EXPECT.txt'), 'check-greeting: 1 greetings checked\n');
    write(join(skills, 'over', 'tests/fixtures/pass-overlay/overlay/extra.md'), 'not a greeting\n');
    // The base tree is the skill's tests/bases/, so the suite needs no good/ folder; add a row for it.
    writeFileSync(join(skills, 'over', 'SKILL.md'), readFileSync(join(skills, 'over', 'SKILL.md'), 'utf8').replace('| `tests/fixtures/` |', '| `tests/bases/` | The base tree overlay cases start from | When adding a case |\n| `tests/fixtures/` |'));
    const ok = node(VALIDATOR, ['--no-run', '--json', '--rule', 'fixtures', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.equal(ok.status, 0, ok.output);
    write(join(skills, 'over', 'tests/fixtures/bad-broken/EXPECT.txt'), 'greeting\n');
    write(join(skills, 'over', 'tests/fixtures/bad-broken/mutation.json'), '{ "file": "x" }');
    write(join(skills, 'over', 'tests/fixtures/bad-broken/DELETE.txt'), '../outside.txt\n');
    write(join(skills, 'over', 'tests/fixtures/pass-empty/EXPECT.txt'), '\n');
    const bad = node(VALIDATOR, ['--no-run', '--json', '--rule', 'fixtures', '--skills-root', skills, '--shared', SHARED], tmp);
    const messages = validatorJson(bad).skills[0].problems.map((problem) => `${problem.file.replace('over/', '')} ${problem.message}`).sort();
    assert.deepEqual(messages.map((line) => line.split(' (')[0]), [
      'tests/fixtures/bad-broken/DELETE.txt "../outside.txt" leaves the case folder',
      'tests/fixtures/bad-broken/mutation.json is not a list of overlay ops',
      'tests/fixtures/pass-empty/EXPECT.txt missing or empty',
    ]);
    // Without tests/bases/ (and no base in selftest.mjs) a suite with no good/ has nothing to assemble from.
    rmSync(join(skills, 'over', 'tests', 'bases'), { recursive: true });
    const noBase = node(VALIDATOR, ['--no-run', '--json', '--rule', 'fixtures', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.match(noBase.stdout, /the suite has no good\/ case and declares no base tree/);
    // A SUITE.json declares the base (check-lib's runSelftest assembles the cases); it must hold one object.
    write(join(skills, 'over', 'tests/fixtures/SUITE.json'), '[1]');
    const suite = node(VALIDATOR, ['--no-run', '--json', '--rule', 'fixtures', '--skills-root', skills, '--shared', SHARED], tmp);
    assert.doesNotMatch(suite.stdout, /declares no base tree/);
    assert.match(suite.stdout, /tests\/fixtures\/SUITE\.json \[fixtures\] must hold one object/);
  } finally {
    removeTempDir(tmp);
  }
});

// ---------------------------------------------------------------------------------------------
// 2. sync-shared and selftest-all
// ---------------------------------------------------------------------------------------------

test('sync-shared: copies, mirrors folders, detects drift, rejects bad manifests', () => {
  const tmp = makeTempDir('selftest-sync-');
  try {
    const skills = join(tmp, 'skills');
    const shared = join(tmp, 'shared');
    write(join(shared, 'data.json'), '{"a":1}\n');
    write(join(shared, 'mocks', 'a.ts'), 'A');
    write(join(shared, 'mocks', 'sub', 'b.ts'), 'B');
    write(join(skills, 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n');
    write(join(skills, 'alpha', 'assets', 'shared.json'), JSON.stringify([{ from: 'data.json', to: 'assets/data.json' }, { from: 'mocks/', to: 'templates/mocks/' }]));
    write(join(skills, 'beta', 'SKILL.md'), '---\nname: beta\n---\n');
    const sync = join(TOOLS, 'sync-shared.mjs');
    const args = ['--skills-root', skills, '--shared', shared];
    const before = node(sync, ['--check', ...args], tmp);
    assert.equal(before.status, 1);
    assert.match(before.stdout, /alpha\/assets\/data\.json \[shared-drift\] missing copy/);
    assert.match(before.stdout, /Run: node tools\/sync-shared\.mjs/);
    const first = node(sync, args, tmp);
    assert.equal(first.status, 0, first.output);
    assert.match(first.stdout, /skip {2}beta/);
    assert.equal(readFileSync(join(skills, 'alpha', 'templates', 'mocks', 'sub', 'b.ts'), 'utf8'), 'B');
    assert.equal(node(sync, ['--check', ...args], tmp).status, 0);
    write(join(skills, 'alpha', 'assets', 'data.json'), '{"a":2}\n');
    write(join(skills, 'alpha', 'templates', 'mocks', 'extra.ts'), 'X');
    const drift = node(sync, ['--check', 'alpha', ...args], tmp);
    assert.equal(drift.status, 1);
    assert.match(drift.stdout, /data\.json \[shared-drift\] differs/);
    assert.match(drift.stdout, /extra\.ts \[shared-drift\] extra file/);
    assert.equal(node(sync, args, tmp).status, 0);
    assert.ok(!existsSync(join(skills, 'alpha', 'templates', 'mocks', 'extra.ts')));
    for (const manifest of ['{not json', '{"from":"x"}', '[{"from":"../x","to":"a"}]', '[{"from":"mocks/","to":"assets/mocks"}]', '[{"from":"missing.json","to":"assets/m.json"}]', '[{"from":"data.json","to":"SKILL.md"}]']) {
      write(join(skills, 'beta', 'assets', 'shared.json'), manifest);
      const bad = node(sync, ['beta', ...args], tmp);
      assert.equal(bad.status, 1, `manifest ${manifest} should fail`);
      assert.match(bad.stdout, /\[shared-json\]/);
    }
  } finally {
    removeTempDir(tmp);
  }
});

test('selftest-all: runs skill self-tests, fails a missing one, shards, annotates in CI, runs an installed copy', () => {
  const tmp = makeTempDir('selftest-all-');
  try {
    const skills = join(tmp, 'skills');
    writeTree(join(skills, 'alpha'), baseScripted('alpha'));
    writeTree(join(skills, 'gamma'), baseScripted('gamma'));
    write(join(skills, 'plain', 'SKILL.md'), '---\nname: plain\n---\n');
    const all = join(TOOLS, 'selftest-all.mjs');
    const good = node(all, ['--skip-library', '--skills-root', skills], tmp);
    assert.equal(good.status, 0, good.output);
    assert.match(good.stdout, /alpha\s+scripts\/selftest\.mjs\s+PASS/);
    assert.match(good.stdout, /plain\s+-\s+SKIP/);
    // Shards split the rows round-robin: alpha, gamma, plain -> 1/2 = alpha + plain, 2/2 = gamma.
    const first = node(all, ['--skip-library', '--skills-root', skills, '--shard', '1/2'], tmp);
    assert.match(first.stdout, /^shard 1\/2: 2 rows$/m);
    assert.match(first.stdout, /^alpha\s/m);
    assert.doesNotMatch(first.stdout, /^gamma\s/m);
    const second = node(all, ['--skip-library', '--skills-root', skills, '--shard', '2/2'], tmp);
    assert.match(second.stdout, /^gamma\s/m);
    assert.equal(node(all, ['--skip-library', '--skills-root', skills, '--shard', '3/2'], tmp).status, 2);
    assert.throws(() => parseShard('0/4'), /not i\/n/);
    assert.deepEqual(parseShard('4/4'), { index: 3, count: 4 });
    // A skill with scripts but no self-test fails, with a GitHub annotation when CI is set.
    rmSync(join(skills, 'alpha', 'scripts', 'selftest.mjs'));
    const bad = node(all, ['--skip-library', '--skills-root', skills], tmp, { CI: 'true' });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /alpha \[selftest-missing\]/);
    assert.match(bad.stdout, /^::error file=.*alpha\/scripts,title=selftest-missing%3A alpha::has scripts but no scripts\/selftest\.mjs$/m);
    assert.doesNotMatch(node(all, ['--skip-library', '--skills-root', skills], tmp, { CI: '' }).stdout, /::error/);
    assert.equal(annotation({ file: 'a,b.mjs', title: 'x: y', message: '50% done\nnext' }), '::error file=a%2Cb.mjs,title=x%3A y::50%25 done%0Anext');
    // An installed copy: .claude/skills/<n> links to .agents/skills/<n>, as the skills CLI makes them.
    const app = join(tmp, 'app');
    cpSync(join(skills, 'gamma'), join(app, '.agents', 'skills', 'gamma'), { recursive: true });
    mkdirSync(join(app, '.claude', 'skills'), { recursive: true });
    symlinkSync('../../.agents/skills/gamma', join(app, '.claude', 'skills', 'gamma'));
    const installed = node(all, ['--skills-root', join(app, '.claude', 'skills'), '--skip-library'], tmp);
    assert.equal(installed.status, 0, installed.output);
    assert.match(installed.stdout, /gamma\s+scripts\/selftest\.mjs\s+PASS/);
    // Without --skip-library the rows start with the tools' self-test and every shared/scripts/**/*.selftest.mjs.
    const shared = join(tmp, 'shared');
    write(join(shared, 'scripts', 'a.selftest.mjs'), '');
    write(join(shared, 'scripts', 'lib', 'b.selftest.mjs'), '');
    write(join(shared, 'scripts', 'lib', 'c.mjs'), '');
    const rows = collectRows({ roots: resolveRoots({ 'skills-root': skills, shared }) });
    assert.deepEqual(rows.slice(0, 3).map((row) => row.shown), ['tools/tests/selftest.mjs', 'shared/scripts/a.selftest.mjs', 'shared/scripts/lib/b.selftest.mjs']);
    assert.deepEqual(collectRows({ roots: resolveRoots({ 'skills-root': skills, shared }), skipLibrary: true }).map((row) => row.label), ['alpha', 'gamma', 'plain']);
  } finally {
    removeTempDir(tmp);
  }
});

// ---------------------------------------------------------------------------------------------
// 3. check-repo-hygiene
// ---------------------------------------------------------------------------------------------

test('check-repo-hygiene: the .gitignore evaluator follows git\'s rules', () => {
  assert.ok(gitignorePatternToRegExp('reports').test('a/b/reports'));
  assert.ok(gitignorePatternToRegExp('reports').test('reports'));
  assert.ok(!gitignorePatternToRegExp('/reports').test('a/reports'));
  assert.ok(gitignorePatternToRegExp('a/*.log').test('a/x.log'));
  assert.ok(!gitignorePatternToRegExp('a/*.log').test('b/a/x.log'), 'a pattern with a slash is anchored');
  assert.ok(gitignorePatternToRegExp('**/build').test('x/y/build'));
  assert.ok(gitignorePatternToRegExp('doc/**/*.pdf').test('doc/a/b/c.pdf'));
  assert.ok(gitignorePatternToRegExp('doc/**/*.pdf').test('doc/c.pdf'));
  assert.ok(gitignorePatternToRegExp('logs/**').test('logs/a/b'));
  assert.ok(gitignorePatternToRegExp('file?.txt').test('file1.txt'));
  assert.ok(gitignorePatternToRegExp('[ab].md').test('b.md'));
  const matcher = createIgnoreMatcher([
    { base: '', source: '.gitignore', text: '*.log\n!/skills/**/*.log\nnode_modules/\n/coverage/\n# comment\n\\#hash\n' },
    { base: 'skills/x/tests/fixtures/good', source: 'skills/x/tests/fixtures/good/.gitignore', text: 'build/\n' },
  ]);
  assert.ok(matcher.ignoredBy('debug.log'));
  assert.ok(matcher.ignoredBy('tools/x/debug.log'));
  assert.equal(matcher.ignoredBy('skills/x/tests/fixtures/good/history.log'), null, 'the negation re-includes fixture logs');
  assert.ok(matcher.ignoredBy('a/node_modules/p/index.js'), 'a file inside an ignored folder is ignored');
  assert.equal(matcher.ignoredBy('node_modules', false), null, 'a dir-only rule does not match a file');
  assert.ok(matcher.ignoredBy('coverage/lcov.info'));
  assert.equal(matcher.ignoredBy('skills/x/tests/fixtures/good/coverage/lcov.info'), null, 'an anchored rule matches only at its base');
  assert.ok(matcher.ignoredBy('#hash'));
  const nested = matcher.ignoredBy('skills/x/tests/fixtures/good/build/out.js');
  assert.equal(nested?.source, 'skills/x/tests/fixtures/good/.gitignore');
  assert.equal(matcher.ignoredBy('skills/x/tests/fixtures/bad/build/out.js'), null, 'a nested .gitignore applies only below its folder');
});

test('check-repo-hygiene: plain folder and git repo report the same planted problems', () => {
  const tmp = makeTempDir('selftest-hygiene-');
  try {
    const hygiene = join(TOOLS, 'check-repo-hygiene.mjs');
    const makeRepo = (dir) => {
      write(join(dir, '.gitignore'), '*.log\nnode_modules/\n.attic/\n');
      writeTree(join(dir, 'skills', 'alpha'), baseBasic('alpha'));
      // A git-ignored local folder is outside every rule: no budget, no .DS_Store finding.
      write(join(dir, '.attic', '.DS_Store'), '');
      write(join(dir, '.attic', 'notes', 'SKILL.md'), '---\nname: notes\n---\n');
      write(join(dir, 'tools', 'x.mjs'), '// tool\n');
      write(join(dir, 'README.md'), '# Repo\n');
    };
    const repo = join(tmp, 'plain');
    makeRepo(repo);
    const clean = node(hygiene, [repo], tmp);
    assert.equal(clean.status, 0, clean.output);
    assert.match(clean.stdout, /not a git repo: evaluating 1 \.gitignore file\(s\)/);
    const plant = (dir) => {
      write(join(dir, 'skills', 'alpha', 'tests', 'fixtures', 'good', 'run.log'), 'log');
      write(join(dir, 'skills', 'alpha', 'tests', 'fixtures', 'good', '.gitignore'), 'out/\n');
      write(join(dir, 'skills', 'alpha', 'tests', 'fixtures', 'good', 'out', 'a.txt'), 'x');
      write(join(dir, 'skills', 'alpha', 'scripts', 'node_modules', 'p', 'index.js'), 'installed packages are skipped');
      write(join(dir, 'tools', 'tests', 'case', 'SKILL.md'), '---\nname: case\n---\n');
      write(join(dir, 'docs', 'SKILL.md'), '# no\n');
      write(join(dir, 'skills', 'alpha', '.DS_Store'), '');
      symlinkSync(join(dir, 'README.md'), join(dir, 'skills', 'alpha', 'references', 'link.md'));
    };
    plant(repo);
    const expected = [
      'skills/alpha/tests/fixtures/good/out/a.txt [ignored-under-skills]',
      'skills/alpha/tests/fixtures/good/run.log [ignored-under-skills]',
      'docs/SKILL.md [skill-md-misplaced]',
      'tools/tests/case/SKILL.md [skill-md-misplaced]',
      'skills/alpha/references/link.md [skills-symlink]',
      'skills/alpha/.DS_Store [ds-store]',
    ].sort();
    const found = (result) => result.stdout.split('\n').filter((line) => line.startsWith('FAIL ')).map((line) => line.replace(/^FAIL (\S+?)(?::\d+)? (\[[\w-]+\]).*$/, '$1 $2')).sort();
    const plain = node(hygiene, [repo], tmp);
    assert.equal(plain.status, 1);
    assert.deepEqual(found(plain), expected, plain.output);
    // The same tree as a git repo: git check-ignore must agree (git init only; nothing is committed).
    const gitRepo = join(tmp, 'git');
    makeRepo(gitRepo);
    plant(gitRepo);
    const init = spawnSync('git', ['init', '-q', gitRepo], { encoding: 'utf8' });
    if (init.status === 0) {
      const viaGit = node(hygiene, [gitRepo], tmp, { GIT_CONFIG_GLOBAL: '/dev/null' });
      assert.match(viaGit.stdout, /git repo: asking git check-ignore/);
      assert.deepEqual(found(viaGit), expected, viaGit.output);
    }
    // The budget comes from standard.json.
    const custom = structuredClone(STANDARD);
    custom.repo.maxTrackedFiles = 3;
    custom.repo.maxTrackedBytes = 10;
    write(join(tmp, 'standard.json'), JSON.stringify(custom));
    const budget = node(hygiene, [join(tmp, 'git'), '--standard', join(tmp, 'standard.json')], tmp, { GIT_CONFIG_GLOBAL: '/dev/null' });
    assert.match(budget.stdout, /\[repo-budget\] the repo would commit \d+ bytes \(limit 10\)/);
    assert.match(budget.stdout, /\[repo-budget\] the repo would commit \d+ files \(limit 3\)/);
  } finally {
    removeTempDir(tmp);
  }
});

// ---------------------------------------------------------------------------------------------
// 4. check-stack-pins
// ---------------------------------------------------------------------------------------------

const TEST_STACK = {
  verified: '2026-10-03',
  contrastWords: ['not', 'never', 'beta', 'upgrade', 'rollback'],
  packages: {
    expo: { version: '57.0.26', range: '~57.0.26', spec: '~57.0.26', names: ['expo', 'Expo'], how: 'test', verified: '2026-10-03', reverify: 'npm view expo@sdk-57 version' },
    'expo-sdk': { version: '57', range: '57.x', package: false, names: ['Expo SDK', 'SDK'], notAfter: ['iOS', 'Android'], how: 'test', verified: '2026-10-03', reverify: 'x' },
    'expo-sqlite': { version: '57.0.3', range: '~57.0.3', spec: '~57.0.3', names: ['expo-sqlite'], how: 'test', verified: '2026-10-03', reverify: 'x' },
    zustand: { version: '5.0.15', range: '5.0.15', spec: '5.0.15', names: ['Zustand', 'zustand'], how: 'test', verified: '2026-10-03', reverify: 'x' },
    'react-native': { version: '0.86.3', range: '0.86.3', spec: '0.86.3', names: ['React Native', 'react-native', 'RN'], how: 'test', verified: '2026-10-03', reverify: 'x' },
    react: { version: '19.2.3', range: '19.2.3', spec: '19.2.3', names: ['React', 'react'], how: 'test', verified: '2026-10-03', reverify: 'x' },
  },
  toolchain: {
    node: { version: '26.4.0', range: '>=22.18.0', package: false, jsonKeys: ['node'], names: ['Node', 'node'], assign: true, how: 'test', verified: '2026-10-03', reverify: 'node --version' },
    xcode: { version: '26.6', range: '~26.6.0', package: false, names: ['Xcode', 'XCODE_VERSION'], assign: true, how: 'test', verified: '2026-10-03', reverify: 'xcodebuild -version' },
    'android-compile-sdk': { version: '36', range: '36.x', package: false, names: ['compileSdkVersion'], assign: true, how: 'test', verified: '2026-10-03', reverify: 'x' },
  },
};

test('check-stack-pins: versions, ranges and consistency', () => {
  assert.deepEqual(parseVersion('57.0.26'), { parts: [57, 0, 26], partial: false });
  assert.deepEqual(parseVersion('57.0.x'), { parts: [57, 0], partial: true });
  assert.equal(parseVersion('latest'), null);
  assert.deepEqual(rangeInterval('~57.0.3'), { lo: [57, 0, 3], hi: [57, 1, 0] });
  assert.deepEqual(rangeInterval('^0.10.1'), { lo: [0, 10, 1], hi: [0, 11, 0] });
  assert.deepEqual(rangeInterval('^5.0.15'), { lo: [5, 0, 15], hi: [6, 0, 0] });
  assert.deepEqual(rangeInterval('>=22.18.0'), { lo: [22, 18, 0], hi: null });
  assert.deepEqual(rangeInterval('57.x'), { lo: [57, 0, 0], hi: [58, 0, 0] });
  assert.deepEqual(rangeInterval('0.86.3'), { lo: [0, 86, 3], hi: [0, 86, 4] });
  const tmp = makeTempDir('selftest-stack-');
  try {
    write(join(tmp, 'stack.json'), JSON.stringify(TEST_STACK));
    const { entries } = loadStack(join(tmp, 'stack.json'));
    const is = (key, op, version, form = 'prose') => consistent({ op, version: parseVersion(version), form }, entries.get(key));
    assert.ok(is('expo', '', '57.0.26'));
    assert.ok(!is('expo', '', '57.0.25'), 'a stale patch');
    assert.ok(is('expo', '', '57'), 'a partial version overlaps');
    assert.ok(!is('expo', '~', '57.0.25', 'json'), 'a package.json floor must lie in the range');
    assert.ok(is('expo', '~', '57.0.25', 'npm'), 'elsewhere a range only has to overlap');
    assert.ok(is('expo-sdk', '', '57'));
    assert.ok(!is('expo-sdk', '', '58'));
    assert.ok(is('node', '+', '22'), 'Node 22+ is fine for a >=22.18 minimum');
    assert.ok(!is('node', '>=', '20'), 'Node >= 20 undercuts the minimum');
    assert.ok(is('expo', '>=', '47'), 'a lower bound the verified version meets');
    assert.ok(!is('react-native', '', '0.87'));
    write(join(tmp, 'bad-stack.json'), JSON.stringify({ contrastWords: [], packages: { x: { version: '1.0.0', range: '~2.0.0', names: [], how: '', verified: '', reverify: '' } } }));
    assert.throws(() => loadStack(join(tmp, 'bad-stack.json')), /outside its own range|names must list|spec is missing/);
  } finally {
    removeTempDir(tmp);
  }
});

test('check-stack-pins: statement forms, context rules and markers', () => {
  const tmp = makeTempDir('selftest-stack-text-');
  try {
    write(join(tmp, 'stack.json'), JSON.stringify(TEST_STACK));
    const { data, entries } = loadStack(join(tmp, 'stack.json'));
    const check = (text, options = {}) => checkText(text, compile(entries), { contrastWords: data.contrastWords, markdown: true, ...options }).map((item) => `${item.line} ${item.verdict}${item.why ? ` (${item.why})` : ''} ${item.statement.entry.key} ${item.statement.versionText}`);
    assert.deepEqual(check('Built on expo 57.0.25 and React Native 0.86.3.'), ['1 mismatch expo 57.0.25', '1 ok react-native 0.86.3']);
    assert.deepEqual(check('Use Expo SDK 57 with `react` 19.2.3.'), ['1 ok expo-sdk 57', '1 ok react 19.2.3']);
    assert.deepEqual(check('"zustand": "^5.0.15",\n"expo-sqlite": "~57.0.2",\n"expo-sqlite": "~57.0.3"'), ['1 spec zustand 5.0.15', '2 mismatch expo-sqlite 57.0.2', '3 ok expo-sqlite 57.0.3']);
    assert.deepEqual(check('npm install zustand@5.0.14 expo@~57.0.26'), ['1 mismatch zustand 5.0.14', '1 ok expo 57.0.26']);
    assert.deepEqual(check('npm view zustand@5.0.14 version'), [], 'queries are not statements');
    assert.deepEqual(check('Node 20+ works.\nNode 22+ is required.'), ['1 mismatch node 20', '2 ok node 22']);
    assert.deepEqual(check('Node 22+ is required; Node 20+ is too old.'), ['1 ok node 22', '1 skipped (the line also states the verified version (a comparison)) node 20']);
    assert.deepEqual(check('"engines": { "node": ">=22.18" }'), ['1 ok node 22.18']);
    assert.deepEqual(check("export const XCODE_VERSION = '26.6';\ncompileSdkVersion = 35"), ['1 ok xcode 26.6', '2 mismatch android-compile-sdk 35']);
    assert.deepEqual(check('The iOS SDK 26 and Android SDK 36 are not Expo SDKs.'), []);
    assert.deepEqual(check('Expo SDK 58 arrives later.'), ['1 skipped (names a newer version (upcoming or held back)) expo-sdk 58']);
    assert.deepEqual(check('Expo SDK 58 arrives later.', { strict: true }), ['1 mismatch expo-sdk 58']);
    assert.deepEqual(check('Do not pin expo 57.0.20 (it is not the verified patch).'), ['1 skipped (contrast wording in the same clause) expo 57.0.20']);
    assert.deepEqual(check('RN 0.86.3 replaced RN 0.85 here'), ['1 ok react-native 0.86.3', '1 skipped (the line also states the verified version (a comparison)) react-native 0.85']);
    assert.deepEqual(check('## Anti-patterns\n\n- Pinning expo 57.0.1 by hand.'), ['3 skipped (Anti-patterns section) expo 57.0.1']);
    assert.deepEqual(check('expo 57.0.1 <!-- stack-pin-ignore -->\n<!-- stack-pin-ignore-next-line -->\nexpo 57.0.2\nexpo 57.0.3').map((line) => line.split(' ').slice(0, 2).join(' ')), ['1 skipped', '3 skipped', '4 mismatch']);
    assert.deepEqual(check('{ "$comment": "stack-pin-ignore-file" }\n"expo": "~56.0.0"'), []);
    assert.deepEqual(statementsInLine('see https://docs.expo.dev/versions/v57.0.0/ and @testing-library/react-native 14', compile(entries)).map((item) => item.entry.key), [], 'URLs and longer package names are not statements');
    // The CLI on a planted skills folder.
    const skills = join(tmp, 'skills');
    writeTree(join(skills, 'alpha'), { 'SKILL.md': '# A\n\nBuilt on expo 57.0.25 and Expo SDK 57.\n', 'templates/package.json': '{\n  "dependencies": { "zustand": "5.0.15", "expo-sqlite": "57.0.3" }\n}\n', 'templates/a.test.ts': "// expo 57.0.1 is test data\n", 'tests/fixtures/bad/SKILL.md': 'expo 57.0.1\n' });
    writeTree(join(skills, 'beta'), { 'SKILL.md': '# B\n\nNo versions here.\n' });
    const pins = join(TOOLS, 'check-stack-pins.mjs');
    const result = node(pins, ['--stack', join(tmp, 'stack.json'), '--skills-root', skills], tmp);
    assert.equal(result.status, 1, result.output);
    assert.deepEqual(result.stdout.split('\n').filter((line) => line.startsWith('FAIL')).map((line) => line.split(' Fix:')[0].split(' "')[0]), ['FAIL alpha/SKILL.md:3 [stack-version]', 'FAIL alpha/templates/package.json:2 [stack-spec]']);
    const summary = node(pins, ['--stack', join(tmp, 'stack.json'), '--skills-root', skills, '--summary'], tmp);
    assert.match(summary.stdout, /^expo\s+1\s+1$/m);
    assert.match(summary.stdout, /^alpha\s+2$/m);
    assert.equal(summary.last, 'RESULT: FAIL (2 problems)');
    assert.equal(node(pins, ['--stack', join(tmp, 'stack.json'), '--skills-root', skills, 'beta'], tmp).status, 0);
  } finally {
    removeTempDir(tmp);
  }
});

test('check-stack-pins: the real tools/stack.json loads and every entry re-verifies with a command', () => {
  const { entries } = loadStack(join(TOOLS, 'stack.json'));
  for (const key of ['expo', 'react-native', 'react', 'typescript', 'expo-router', 'react-native-reanimated', 'react-native-worklets', 'react-native-gesture-handler', '@shopify/react-native-skia', 'react-native-safe-area-context', 'react-native-screens', 'zustand', '@tanstack/react-query', 'valibot', 'react-hook-form', '@hookform/resolvers', 'react-intl', 'expo-sqlite', 'expo-secure-store', 'expo-localization', 'expo-haptics', 'expo-notifications', 'expo-updates', 'expo-image', 'react-native-google-mobile-ads', 'expo-iap', '@sentry/react-native', '@shopify/flash-list', 'react-native-keyboard-controller', 'jest', 'jest-expo', '@testing-library/react-native', 'fast-check', 'eslint', 'typescript-eslint', 'prettier', 'maestro', 'eas-cli', 'node', 'npm', 'xcode', 'ios-sdk', 'jdk', 'android-compile-sdk', 'android-target-sdk']) {
    assert.ok(entries.has(key), `stack.json has no ${key}`);
    // Every entry was verified on the table date or re-verified later (a patch refresh moves single entries).
    const { verified } = entries.get(key);
    assert.match(verified, /^\d{4}-\d{2}-\d{2}$/, key);
    assert.ok(verified >= '2026-10-03', `${key} verified ${verified} is older than the table`);
  }
});

// ---------------------------------------------------------------------------------------------
// 5. build-catalog
// ---------------------------------------------------------------------------------------------

test('build-catalog: writes placeholders, blocks, skills.json, the site data and the two marketplace entries; --check finds staleness', () => {
  const tmp = makeTempDir('selftest-catalog-');
  try {
    const repo = join(tmp, 'repo');
    const catalog = {
      categories: [{ key: 'setup', label: 'Setup' }, { key: 'data', label: 'Data' }, { key: 'games', label: 'Games' }],
      skills: [
        { name: 'alpha-setup', category: 'setup', plugin: 'core', manual: false },
        { name: 'run-greeting-send', category: 'data', plugin: 'core', manual: true },
        { name: 'lights-out-rules', category: 'games', plugin: 'games', manual: false },
        { name: 'not-written-yet', category: 'data', plugin: 'core', manual: false },
      ],
    };
    write(join(repo, 'tools', 'catalog.json'), JSON.stringify(catalog));
    writeTree(join(repo, 'skills', 'alpha-setup'), baseScripted('alpha-setup'));
    writeTree(join(repo, 'skills', 'lights-out-rules'), baseBasic('lights-out-rules'));
    writeTree(join(repo, 'skills', 'run-greeting-send'), { 'SKILL.md': '---\nname: run-greeting-send\ndescription: Sends greetings. Use when asked to send them. Not for writing them (alpha-setup).\ndisable-model-invocation: true\n---\n\n# Send\n' });
    write(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'react-native-skills', owner: { name: 'Zakaria Fatahi', email: 'kept@example.com' }, plugins: [{ name: 'other', source: './other' }, { name: 'react-native', source: './', description: 'kept', category: 'development', skills: ['./skills/stale'] }] }, null, 2));
    const build = join(TOOLS, 'build-catalog.mjs');
    const args = ['--repo', repo];
    const missing = node(build, ['--check', ...args], tmp);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /README\.md \[generated-missing\]/);
    const first = node(build, args, tmp);
    assert.equal(first.status, 0, first.output);
    assert.match(first.stdout, /create README\.md/);
    assert.match(first.stdout, /1 planned in tools\/catalog\.json but not on disk yet: not-written-yet/);
    const skillsJson = JSON.parse(readFileSync(join(repo, 'skills.json'), 'utf8'));
    assert.equal(skillsJson.count, 3);
    assert.equal(skillsJson.planned, 4);
    assert.deepEqual(skillsJson.skills.map((skill) => [skill.name, skill.category, skill.categoryLabel, skill.plugin, skill.manual, skill.rich, skill.path]), [
      ['alpha-setup', 'setup', 'Setup', 'react-native', false, true, 'skills/alpha-setup'],
      ['run-greeting-send', 'data', 'Data', 'react-native', true, false, 'skills/run-greeting-send'],
      ['lights-out-rules', 'games', 'Games', 'react-native-games', false, true, 'skills/lights-out-rules'],
    ]);
    const siteData = readFileSync(join(repo, 'docs', 'skills-data.js'), 'utf8');
    assert.match(siteData, /^\/\/ Generated by tools\/build-catalog\.mjs/);
    assert.deepEqual(JSON.parse(/window\.SKILLS = ([\s\S]*?);\n/.exec(siteData)[1]), skillsJson.skills);
    const market = JSON.parse(readFileSync(join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(market.owner.email, 'kept@example.com');
    assert.deepEqual(market.plugins.map((entry) => entry.name), ['other', 'react-native', 'react-native-games']);
    assert.deepEqual(Object.keys(market.plugins[1]), ['name', 'source', 'description', 'category', 'skills', 'version', 'author', 'homepage', 'repository', 'license', 'keywords']);
    assert.equal(market.plugins[1].category, 'development', 'fields the generator does not own are kept');
    assert.equal(market.plugins[1].description, PLUGINS[0].description, 'the description comes from build-catalog');
    assert.deepEqual(market.plugins[1].skills, ['./skills/alpha-setup', './skills/run-greeting-send']);
    for (const entry of market.plugins.slice(1)) for (const [key, value] of Object.entries(PLUGIN_META)) assert.deepEqual(entry[key], value, `${entry.name}.${key}`);
    assert.deepEqual(market.plugins[2].skills, ['./skills/lights-out-rules']);
    assert.equal(market.plugins[2].source, './');
    const readme = readFileSync(join(repo, 'README.md'), 'utf8');
    assert.ok(readme.includes(MARKERS.skills.start) && readme.includes(MARKERS.skills.end));
    assert.match(readme, /\| \[`alpha-setup`\]\(skills\/alpha-setup\/SKILL\.md\) \| Checks sample greetings for the validator self-test\. \|/);
    assert.match(readme, /`run-greeting-send`.*\*\(runbook, invoked by name\)\*/);
    assert.match(readme, /`lights-out-rules`.*\*\(plugin `react-native-games`\)\*/);
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
    assert.match(agents, /\$\{CLAUDE_SKILL_DIR\}/);
    assert.match(agents, /- `alpha-setup`: use when testing the skill validator\./);
    assert.match(agents, /- `run-greeting-send` \(runbook: only when asked by name\): use when asked to send them\./);
    assert.equal(node(build, ['--check', ...args], tmp).status, 0);
    // Hand edits outside the markers survive a rebuild; inside them they are replaced.
    writeFileSync(join(repo, 'README.md'), readme.replace('## Skills', '## Skills\n\nHand-written intro.').replace('**3 skills**', '**99 skills**'));
    const stale = node(build, ['--check', ...args], tmp);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /README\.md \[generated-stale\]/);
    assert.equal(node(build, args, tmp).status, 0);
    const rebuilt = readFileSync(join(repo, 'README.md'), 'utf8');
    assert.ok(rebuilt.includes('Hand-written intro.') && rebuilt.includes('**3 skills**'));
    // Problems: a skill folder missing from the catalogue, a manual flag that disagrees, a root plugin.json.
    writeTree(join(repo, 'skills', 'stray-skill'), baseBasic('stray-skill'));
    write(join(repo, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'react-native', skills: ['./skills/'] }));
    writeFileSync(join(repo, 'skills', 'run-greeting-send', 'SKILL.md'), readFileSync(join(repo, 'skills', 'run-greeting-send', 'SKILL.md'), 'utf8').replace('disable-model-invocation: true\n', ''));
    const problems = node(build, ['--check', ...args], tmp);
    assert.equal(problems.status, 1);
    for (const rule of ['skill-uncatalogued', 'manual-mismatch', 'plugin-json-present']) assert.match(problems.stdout, new RegExp(`\\[${rule}\\]`));
    assert.deepEqual(splitDescription('Builds x. Use when y happens. Not for z (other).', STANDARD), { lead: 'Builds x.', useWhen: 'y happens', notFor: 'Not for z (other).' });
  } finally {
    removeTempDir(tmp);
  }
});

// ---------------------------------------------------------------------------------------------
// 6. The repo itself
// ---------------------------------------------------------------------------------------------

test('repo: no SKILL.md is committed under tools/, and the validator cases are generated, not committed', () => {
  assert.deepEqual(walk(TOOLS, { include: ['SKILL.md'] }), []);
  assert.ok(!existsSync(join(HERE, 'cases')), 'tools/tests/cases/ must not exist: build-cases.mjs generates the cases at test time');
});

// ---------------------------------------------------------------------------------------------

run(async () => {
  parseArgs(process.argv.slice(2), {
    name: 'selftest',
    summary: 'The maintainer tools\' own self-test: the validator (every planted-bug case), sync-shared, selftest-all, check-repo-hygiene, check-stack-pins and build-catalog.',
    usage: '',
    positionals: { min: 0, max: 0 },
  });
  const report = createReporter({ name: 'tools selftest' });
  for (const { name, fn } of tests) {
    const started = Date.now();
    try {
      await fn();
      console.log(`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (error) {
      report.problem({ file: 'tools/tests/selftest.mjs', rule: 'tools-test', message: `${name}: ${error.message}`, fix: 'Fix the tool (or the case) this test exercises, then rerun.' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
