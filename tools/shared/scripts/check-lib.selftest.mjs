#!/usr/bin/env node
// check-lib.selftest.mjs: the self-test of check-lib.mjs. Every area has its own test: globs, walk and
// the repo-scan ignores (with SKILL.md pruning and package.json workspaces), resolveLayout (single
// app, tsconfig paths with extends, workspaces, rn-skills.config.json), notYetCreated, the SKIP /
// NOT APPLICABLE / ERROR output contract, every runSelftest case kind, the overlay engine (every op,
// a stale op failing loudly, extends, suite ops, ARGS.txt modes, --materialize, --case), the older
// assembler forms, writePng/readPng, the pinned-package helpers and the deprecated shims.
//   node check-lib.selftest.mjs
// Prints one "ok" line per test, a FAIL line per failed test, and the RESULT line.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  AGENT_SKILL_FOLDERS,
  HYGIENE_RENAMES,
  LAYOUT_DEFAULTS,
  OverlayError,
  REPO_SCAN_IGNORES,
  SELFTEST_CASES,
  UsageError,
  applyMutation,
  assembleFixtures,
  assembleSuite,
  createReporter,
  decodePng,
  encodePng,
  globToRegExp,
  importPackage,
  isRepoScanIgnored,
  makeTempDir,
  matchGlob,
  notYetCreated,
  packageInstallFix,
  parseArgs,
  parseColor,
  parseJsonc,
  pngSize,
  readPng,
  readProjectConfig,
  readTsconfigPaths,
  readWorkspaces,
  removeTempDir,
  renderPng,
  repoScanIgnores,
  resolveAlias,
  resolveLayout,
  resolveToolingDir,
  run,
  selftestCaseKind,
  toolingEnvVar,
  walk,
  walkRepo,
  writePng,
} from './check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK_LIB = join(HERE, 'check-lib.mjs');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function write(path, content = 'x\n') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function node(script, args = [], cwd = dirname(script)) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  const stdout = result.stdout ?? '';
  return { status: result.status, stdout, output: `${stdout}${result.stderr ?? ''}`, last: stdout.trim().split('\n').at(-1) ?? '' };
}

function withTemp(prefix, fn) {
  const dir = makeTempDir(prefix);
  try {
    return fn(dir);
  } finally {
    removeTempDir(dir);
  }
}

function tree(dir) {
  const out = {};
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(abs, entry.name), childRel);
      else if (entry.isSymbolicLink()) out[childRel] = '<symlink>';
      else out[childRel] = readFileSync(join(abs, entry.name), 'utf8');
    }
  };
  visit(dir, '');
  return out;
}

/** A skill folder with check-lib and a tiny checker: FAIL for every line "BUG <rule>" in its files. */
function makeSkill(dir) {
  const skill = join(dir, 'skill');
  write(join(skill, 'SKILL.md'), '---\nname: skill\ndescription: x\n---\n');
  cpSync(CHECK_LIB, join(skill, 'scripts', 'check-lib.mjs'));
  write(join(skill, 'scripts', 'check-bugs.mjs'), `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReporter, notYetCreated, parseArgs, requireDir, run, walk } from './check-lib.mjs';
const SPEC = { name: 'check-bugs', summary: 'Reports BUG lines.', usage: '[repo-root] [options]', options: { strict: { type: 'boolean', help: 'Also report WARN lines' }, mark: { type: 'string', help: 'Print a note' } }, positionals: { min: 0, max: 1 } };
run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-bugs' });
  if (options.mark) report.note('mark=' + options.mark);
  const files = walk(root, { include: ['*.txt', '*.ts', '*.tsx', '.gitignore', '*.json'], ignore: ['ARGS.txt'] });
  for (const rel of files) {
    const lines = readFileSync(join(root, rel), 'utf8').split('\\n');
    lines.forEach((line, index) => {
      const bug = /^BUG (\\S+)/.exec(line);
      if (bug) report.problem({ file: rel, line: index + 1, rule: bug[1], message: 'planted bug', fix: 'Remove it.' });
      if (options.strict && line.startsWith('WARN')) report.problem({ file: rel, line: index + 1, rule: 'warn', message: 'warning', fix: 'Remove it.' });
    });
  }
  const reason = notYetCreated(root, { file: 'src/later.ts', owner: 'later-skill' });
  if (reason) report.skip({ file: 'src/later.ts', rule: 'later-rule', message: reason });
  return report.finish({ checked: files.length, unit: 'files' });
});
`);
  return skill;
}

// ---------------------------------------------------------------------------------------------
// Globs, walk and repo scans
// ---------------------------------------------------------------------------------------------

test('globs', () => {
  assert.ok(globToRegExp('**/node_modules/**').test('a/node_modules/b.js'));
  assert.ok(globToRegExp('**/node_modules/**').test('node_modules'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/c.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/c.ts'));
  assert.ok(globToRegExp('*.{ts,tsx}').test('x.tsx'));
  assert.ok(globToRegExp('file?.md').test('file1.md'));
  assert.ok(!globToRegExp('file?.md').test('file12.md'));
  assert.ok(globToRegExp('[ab].md').test('a.md'));
  assert.ok(globToRegExp('[!ab].md').test('c.md'));
  assert.ok(matchGlob('deep/down/x.png', '*.png'));
  assert.ok(matchGlob('a/node_modules/x/y.js', 'node_modules'));
  assert.ok(matchGlob('docs/a/b.md', 'docs/'));
  assert.ok(!matchGlob('src/docs.md', 'docs/'));
  assert.ok(matchGlob('ios', 'ios/**') && matchGlob('ios/Podfile', 'ios/**') && !matchGlob('src/ios/x.ts', 'ios/**'));
});

test('walk: ignores, includes, symlinks and SKILL.md pruning', () => withTemp('cl-walk-', (dir) => {
  write(join(dir, 'a.ts'));
  write(join(dir, 'b.md'));
  write(join(dir, 'sub', 'c.ts'));
  write(join(dir, 'node_modules', 'x.ts'));
  write(join(dir, 'fix', 'EXPECT.txt'));
  write(join(dir, 'gen', 'd.ts'));
  write(join(dir, 'vendor', 'some-skill', 'SKILL.md'));
  write(join(dir, 'vendor', 'some-skill', 'templates', 'bad.ts'));
  write(join(dir, 'vendor', 'keep.ts'));
  symlinkSync(join(dir, 'a.ts'), join(dir, 'link.ts'));
  const links = [];
  assert.deepEqual(walk(dir, { include: ['*.ts'], ignore: ['gen/**', 'vendor/**'], onSymlink: (rel) => links.push(rel) }), ['a.ts', 'sub/c.ts']);
  assert.deepEqual(links, ['link.ts']);
  assert.deepEqual(walk(dir, { followSymlinks: true, include: ['*.ts'], ignore: ['vendor/**'] }), ['a.ts', 'gen/d.ts', 'link.ts', 'sub/c.ts']);
  assert.ok(walk(dir, { defaultIgnores: false }).includes('fix/EXPECT.txt'));
  assert.ok(!walk(dir).includes('fix/EXPECT.txt'));
  const pruned = [];
  const files = walk(dir, { include: ['*.ts'], pruneDirsContaining: ['SKILL.md'], onPrune: (rel) => pruned.push(rel) });
  assert.ok(files.includes('vendor/keep.ts') && !files.includes('vendor/some-skill/templates/bad.ts'), files.join(' '));
  assert.deepEqual(pruned, ['vendor/some-skill']);
  // The walk root itself is never pruned (a checker pointed at a skill folder still sees it).
  assert.deepEqual(walk(join(dir, 'vendor', 'some-skill'), { pruneDirsContaining: ['SKILL.md'] }), ['SKILL.md', 'templates/bad.ts']);
  assert.throws(() => walk(join(dir, 'missing')), (error) => error instanceof UsageError && /nothing to check/.test(error.message));
}));

test('REPO_SCAN_IGNORES and walkRepo: agent skill folders, generated output, workspaces, same-named source folders', () => withTemp('cl-repo-scan-', (dir) => {
  const kept = ['app.config.ts', 'src/app/index.tsx', 'scripts/build/build-ios.ts', 'src/ios/plist.ts', 'src/build/x.ts', '.maestro/flows/smoke.yaml', 'contracts/screens.json', 'packages/ui/src/build/y.ts', 'packages/ui/src/ios/z.ts'];
  const skipped = [
    'skills/tasks/tests/fixtures/bad-x/a.ts',
    '.agents/skills/tasks/tests/fixtures/bad-x/a.ts',
    '.claude/skills/x/SKILL.md',
    '.cursor/skills/x/a.ts',
    '.codex/a.ts',
    '.windsurf/skills/a.ts',
    '.roo/a.ts',
    '.cline/a.ts',
    '.continue/a.ts',
    '.kiro/a.ts',
    '.skill-tooling/design-review/node_modules/x/index.js',
    'node_modules/x/index.js',
    'ios/Podfile',
    'ios/Pods/Headers/a.h',
    'android/app/build.gradle',
    'build/x.js',
    'out/y.js',
    'dist/bundle.js',
    'web-build/index.html',
    'coverage/lcov.info',
    '.expo/state.json',
    'src/.turbo/cache.json',
    'apps/mobile/ios/Podfile',
    'apps/mobile/android/app/x.java',
    'apps/mobile/build/out.js',
    'apps/mobile/dist/out.js',
    'apps/mobile/.expo/state.json',
    'packages/ui/node_modules/x/index.js',
    'vendor/kit/SKILL.md',
    'vendor/kit/templates/bad.ts',
  ];
  for (const rel of [...kept, ...skipped]) write(join(dir, rel));
  write(join(dir, 'package.json'), JSON.stringify({ name: 'tasks', workspaces: ['apps/*', 'packages/*'] }));
  write(join(dir, 'apps', 'mobile', 'package.json'), JSON.stringify({ name: '@acme/mobile' }));
  write(join(dir, 'packages', 'ui', 'package.json'), JSON.stringify({ name: '@acme/ui' }));
  const listed = walkRepo(dir, { ignore: ['package.json', '*/package.json', '*/*/package.json'] });
  assert.deepEqual(listed, [...kept].sort());
  assert.ok(Object.isFrozen(REPO_SCAN_IGNORES));
  for (const name of AGENT_SKILL_FOLDERS) assert.ok(REPO_SCAN_IGNORES.includes(`${name}/**`), name);
  assert.ok(!REPO_SCAN_IGNORES.some((glob) => glob.startsWith('apps/')), 'no apps/* literals');
  assert.ok(repoScanIgnores(dir).includes('apps/mobile/ios/**') && repoScanIgnores(dir).includes('packages/ui/build/**'));
  for (const rel of skipped) assert.ok(isRepoScanIgnored(rel, dir), `${rel} should be ignored`);
  for (const rel of kept) assert.ok(!isRepoScanIgnored(rel, dir), `${rel} should be scanned`);
  assert.ok(isRepoScanIgnored('./skills/a/b.ts'));
  assert.ok(!isRepoScanIgnored('apps/mobile/ios/Podfile'), 'without the root, workspace folders are unknown');
  // A single-app repo: the same patterns from the root; a planted bug under skills/ stays unseen.
  const single = join(dir, 'single');
  for (const rel of ['src/a.ts', 'ios/b.ts', 'skills/s/c.ts', '.agents/skills/s/d.ts']) write(join(single, rel));
  assert.deepEqual(walkRepo(single), ['src/a.ts']);
}));

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

test('parseJsonc and resolveAlias', () => {
  assert.deepEqual(parseJsonc('{\n // a comment\n "a": "x // not a comment", /* block */ "b": [1, 2,],\n "c": { "d": "/* kept */", },\n}'), { a: 'x // not a comment', b: [1, 2], c: { d: '/* kept */' } });
  assert.deepEqual(parseJsonc('{ "s": "quote \\" , }" , }'), { s: 'quote " , }' });
  assert.throws(() => parseJsonc('{ "a": }'), SyntaxError);
  const aliases = [{ pattern: '@/*', targets: ['src/*'] }, { pattern: '@/ui/*', targets: ['src/ui/*', 'shared/ui/*'] }, { pattern: 'config', targets: ['src/config/index.ts'] }];
  assert.deepEqual(resolveAlias('@/features/tasks', aliases), ['src/features/tasks']);
  assert.deepEqual(resolveAlias('@/ui/app-text', aliases), ['src/ui/app-text', 'shared/ui/app-text']);
  assert.deepEqual(resolveAlias('config', aliases), ['src/config/index.ts']);
  assert.equal(resolveAlias('react-native', aliases), null);
});

test('resolveLayout: single-app defaults and the app/ routes folder', () => withTemp('cl-layout-', (dir) => {
  const layout = resolveLayout(dir);
  assert.equal(layout.mode, 'single');
  assert.equal(layout.root, dir);
  for (const [key, value] of Object.entries(LAYOUT_DEFAULTS)) assert.equal(layout[key], value.replace('{srcDir}', 'src'), key);
  assert.equal(layout.origin.srcDir, 'default');
  assert.deepEqual(layout.aliases, []);
  assert.equal(layout.tsconfig, null);
  assert.deepEqual(layout.workspaces, []);
  assert.ok(Object.isFrozen(layout) && Object.isFrozen(layout.origin));
  write(join(dir, 'app', '_layout.tsx'));
  const detected = resolveLayout(dir);
  assert.equal(detected.routesDir, 'app');
  assert.equal(detected.origin.routesDir, 'detected');
  write(join(dir, 'src', 'app', '_layout.tsx'));
  assert.equal(resolveLayout(dir).routesDir, 'src/app', 'src/app wins when it exists');
}));

test('resolveLayout: tsconfig paths with comments, extends (one level, string or list) and baseUrl', () => withTemp('cl-tsconfig-', (dir) => {
  write(join(dir, 'tsconfig.json'), '{\n  // Expo template\n  "extends": "expo/tsconfig.base",\n  "compilerOptions": {\n    "strict": true,\n    "paths": { "@/*": ["./src/*"], "@assets/*": ["./assets/*",], },\n  },\n}\n');
  assert.deepEqual(resolveLayout(dir).aliases, [{ pattern: '@/*', targets: ['src/*'] }, { pattern: '@assets/*', targets: ['assets/*'] }]);
  assert.equal(resolveLayout(dir).tsconfig, 'tsconfig.json');
  // paths inherited from a relative base, resolved against the base's baseUrl.
  write(join(dir, 'config', 'tsconfig.base.json'), '{ "compilerOptions": { "baseUrl": "..", "paths": { "~/*": ["app-src/*"] } } }');
  write(join(dir, 'tsconfig.json'), '{ "extends": ["expo/tsconfig.base", "./config/tsconfig.base"], "compilerOptions": { "strict": true } }');
  assert.deepEqual(readTsconfigPaths(dir).aliases, [{ pattern: '~/*', targets: ['app-src/*'] }]);
  // The child's paths win and resolve against the inherited baseUrl.
  write(join(dir, 'tsconfig.json'), '{ "extends": "./config/tsconfig.base.json", "compilerOptions": { "paths": { "@/*": ["src/*"] } } }');
  assert.deepEqual(readTsconfigPaths(dir).aliases, [{ pattern: '@/*', targets: ['src/*'] }]);
  write(join(dir, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } ');
  assert.throws(() => resolveLayout(dir), (error) => error instanceof UsageError && /tsconfig\.json is not valid JSON/.test(error.message));
}));

test('resolveLayout: package.json workspaces give monorepo mode, each workspace with its own layout', () => withTemp('cl-workspaces-', (dir) => {
  write(join(dir, 'package.json'), JSON.stringify({ name: 'acme', workspaces: ['apps/*', 'packages/**', '!packages/legacy'] }));
  write(join(dir, 'apps', 'mobile', 'package.json'), JSON.stringify({ name: '@acme/mobile' }));
  write(join(dir, 'apps', 'mobile', 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
  write(join(dir, 'apps', 'notes.md'));
  write(join(dir, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@acme/core' }));
  write(join(dir, 'packages', 'group', 'nested', 'package.json'), JSON.stringify({ name: '@acme/nested' }));
  write(join(dir, 'packages', 'legacy', 'package.json'), JSON.stringify({ name: '@acme/legacy' }));
  write(join(dir, 'packages', 'core', 'node_modules', 'dep', 'package.json'), JSON.stringify({ name: 'dep' }));
  write(join(dir, 'rn-skills.config.json'), JSON.stringify({ workspaces: { 'apps/mobile': { routesDir: 'app' } } }));
  assert.deepEqual(readWorkspaces(dir).map((entry) => `${entry.dir}=${entry.name}`), ['apps/mobile=@acme/mobile', 'packages/core=@acme/core', 'packages/group/nested=@acme/nested']);
  const layout = resolveLayout(dir);
  assert.equal(layout.mode, 'monorepo');
  const mobile = layout.workspaces.find((entry) => entry.dir === 'apps/mobile');
  assert.equal(mobile.name, '@acme/mobile');
  assert.equal(mobile.layout.srcDir, 'apps/mobile/src');
  assert.equal(mobile.layout.routesDir, 'apps/mobile/app');
  assert.equal(mobile.layout.origin.routesDir, 'config');
  assert.deepEqual(mobile.layout.aliases, [{ pattern: '@/*', targets: ['apps/mobile/src/*'] }]);
  assert.equal(layout.workspaces.find((entry) => entry.dir === 'packages/core').layout.featuresDir, 'packages/core/src/features');
  // yarn's object form
  write(join(dir, 'package.json'), JSON.stringify({ name: 'acme', workspaces: { packages: ['apps/*'] } }));
  assert.deepEqual(readWorkspaces(dir).map((entry) => entry.dir), ['apps/mobile']);
}));

test('resolveLayout: rn-skills.config.json and per-script overrides', () => withTemp('cl-config-', (dir) => {
  write(join(dir, 'rn-skills.config.json'), JSON.stringify({ srcDir: 'app-src', e2eDir: 'e2e', contractsDir: 'qa/contracts', screensContract: 'qa/screens.json' }));
  const layout = resolveLayout(dir, { routesDir: 'routes', testDir: undefined });
  assert.equal(layout.srcDir, 'app-src');
  assert.equal(layout.featuresDir, 'app-src/features', 'folders inside srcDir follow it');
  assert.equal(layout.routesDir, 'routes');
  assert.equal(layout.origin.routesDir, 'override');
  assert.equal(layout.origin.srcDir, 'config');
  assert.equal(layout.e2eDir, 'e2e');
  assert.equal(layout.testDir, 'test');
  assert.equal(layout.config.screensContract, 'qa/screens.json', 'skill-specific keys are kept');
  assert.equal(readProjectConfig(dir).contractsDir, 'qa/contracts');
  for (const [content, pattern] of [['{ "srcDir": "../outside" }', /must be a repo-relative folder/], ['[1]', /one JSON object/], ['{ "srcDir": ', /not valid JSON/], ['{ "workspaces": [] }', /"workspaces" must map/]]) {
    write(join(dir, 'rn-skills.config.json'), content);
    assert.throws(() => resolveLayout(dir), (error) => error instanceof UsageError && pattern.test(error.message), content);
  }
  rmSync(join(dir, 'rn-skills.config.json'));
  assert.throws(() => resolveLayout(dir, { srcDir: '/abs' }), UsageError);
}));

// ---------------------------------------------------------------------------------------------
// Incremental adoption and the output contract
// ---------------------------------------------------------------------------------------------

test('notYetCreated', () => withTemp('cl-nyc-', (dir) => {
  assert.equal(notYetCreated(dir, { file: 'src/i18n/catalogs/en.json', owner: 'i18n-strings-and-catalogs' }), 'not yet created (i18n-strings-and-catalogs creates it)');
  write(join(dir, 'src', 'i18n', 'catalogs', 'en.json'), '{}');
  assert.equal(notYetCreated(dir, { file: './src/i18n/catalogs/en.json', owner: 'i18n-strings-and-catalogs' }), null);
  for (const bad of [{ file: '/abs', owner: 'x' }, { file: '../up', owner: 'x' }, { file: 'a', owner: '' }, {}]) assert.throws(() => notYetCreated(dir, bad), /notYetCreated/, JSON.stringify(bad));
}));

test('SKIP, NOT APPLICABLE, ERROR and RESULT lines; exit codes; the --root guess', () => withTemp('cl-contract-', (dir) => {
  cpSync(CHECK_LIB, join(dir, 'check-lib.mjs'));
  const script = join(dir, 'probe.mjs');
  write(script, `import { createReporter, notYetCreated, parseArgs, requireDir, run } from './check-lib.mjs';
const SPEC = { name: 'probe', summary: 'Probe.', usage: '[repo-root] [options]', options: { mode: { type: 'string', default: 'skip' }, json: { type: 'boolean' } }, positionals: { min: 0, max: 1 } };
run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'probe', json: options.json });
  const reason = notYetCreated(root, { file: 'src/i18n/catalogs/en.json', owner: 'i18n-strings-and-catalogs' });
  if (reason) report.skip({ file: 'src/i18n/catalogs/en.json', rule: 'catalog-key', message: reason });
  if (options.mode === 'na') return report.notApplicable('react-native-google-mobile-ads is not in package.json');
  if (options.mode === 'fail') report.problem({ file: 'a.ts', line: 2, rule: 'rule-a', message: 'bad', fix: 'Fix a.' });
  if (options.mode === 'late-na') { report.problem({ rule: 'x', message: 'y' }); return report.notApplicable('z'); }
  return report.finish({ checked: options.mode === 'only-skips' ? 0 : 3, unit: 'files' });
});
`);
  const skipped = node(script, ['.', '--json'], dir);
  assert.equal(skipped.status, 0, skipped.output);
  assert.match(skipped.stdout, /^SKIP src\/i18n\/catalogs\/en\.json \[catalog-key\] not yet created \(i18n-strings-and-catalogs creates it\)$/m);
  assert.match(skipped.stdout, /^probe: 3 files checked, 0 problems, 1 skipped$/m);
  assert.equal(skipped.last, 'RESULT: PASS');
  assert.equal(node(script, ['.', '--mode', 'only-skips'], dir).status, 0, 'only SKIP lines still pass');
  const failing = node(script, ['.', '--mode', 'fail'], dir);
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /^FAIL a\.ts:2 \[rule-a\] bad Fix: Fix a\.$/m);
  assert.equal(failing.last, 'RESULT: FAIL (1 problems)');
  const na = node(script, ['.', '--mode', 'na'], dir);
  assert.equal(na.status, 0, na.output);
  assert.match(na.stdout, /^NOT APPLICABLE: react-native-google-mobile-ads is not in package\.json$/m);
  assert.equal(na.last, 'RESULT: PASS');
  const lateNa = node(script, ['.', '--mode', 'late-na'], dir);
  assert.equal(lateNa.status, 2);
  assert.match(lateNa.stdout, /^ERROR \[crash\] .*notApplicable\(\) after problems/m);
  write(join(dir, 'src', 'i18n', 'catalogs', 'en.json'), '{}');
  assert.equal(node(script, ['.', '--mode', 'only-skips'], dir).status, 2, 'nothing checked and nothing skipped is exit 2');
  const missing = node(script, ['no-such-folder'], dir);
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /^ERROR \[bad-input\] nothing to check: repo root no-such-folder does not exist/m);
  assert.equal(missing.last, 'RESULT: FAIL (1 problems)');
  const guessed = node(script, ['--root', '.'], dir);
  assert.equal(guessed.status, 2);
  assert.match(guessed.stdout, /Unknown option '--root'.*takes the repo root as a positional argument, not --root: node probe\.mjs <repo-root>/);
  const help = node(script, ['--help'], dir);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: node probe\.mjs \[repo-root\] \[options\]/);
  assert.match(help.stdout, /Exit codes: 0 pass, 1 problems found, 2 bad input or environment\./);
}));

test('parseArgs: a --root option also takes the root positionally', () => {
  const spec = { name: 'p', options: { root: { type: 'string', default: '.' } } };
  assert.deepEqual(parseArgs(['sub'], spec).options.root, 'sub');
  assert.deepEqual(parseArgs(['--root', 'sub'], spec).options.root, 'sub');
  assert.throws(() => parseArgs(['--root', 'a', 'b'], spec), /given twice/);
  assert.throws(() => parseArgs(['--nope'], spec), (error) => error instanceof UsageError && /Unknown option '--nope'/.test(error.message));
});

// ---------------------------------------------------------------------------------------------
// runSelftest: the four case kinds on complete fixtures (no overlay)
// ---------------------------------------------------------------------------------------------

test('runSelftest: good, pass-*, bad-* and error-* cases in place', () => withTemp('cl-kinds-', (dir) => {
  assert.equal(selftestCaseKind('good'), 'good');
  assert.equal(selftestCaseKind('pass-x'), 'pass-');
  assert.equal(selftestCaseKind('bad-x'), 'bad-');
  assert.equal(selftestCaseKind('error-x'), 'error-');
  for (const name of ['base', 'pass-', 'bad-', 'error-', 'passing', 'good-2']) assert.equal(selftestCaseKind(name), null, name);
  assert.deepEqual(Object.fromEntries(Object.entries(SELFTEST_CASES).map(([kind, value]) => [kind, value.exit])), { good: 0, 'pass-': 0, 'bad-': 1, 'error-': 2 });
  const skill = makeSkill(dir);
  const fixtures = join(skill, 'tests', 'fixtures', 'check-bugs');
  write(join(fixtures, 'good', 'src', 'a.ts'), 'export const a = 1;\n');
  write(join(fixtures, 'pass-skip-line', 'src', 'a.ts'), 'export const a = 1;\n');
  write(join(fixtures, 'pass-skip-line', 'EXPECT.txt'), 'SKIP src/later.ts [later-rule] not yet created (later-skill creates it)\n');
  write(join(fixtures, 'bad-planted', 'src', 'a.ts'), 'ok\nBUG rule-x\n');
  write(join(fixtures, 'bad-planted', 'EXPECT.txt'), 'src/a.ts:2 [rule-x]\n');
  write(join(fixtures, 'error-no-root', 'ARGS.txt'), 'no-such-folder\n');
  write(join(fixtures, 'error-no-root', 'EXPECT.txt'), 'ERROR [bad-input] nothing to check: repo root no-such-folder\n');
  const selftest = join(skill, 'scripts', 'selftest.mjs');
  write(selftest, "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [{ script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] }]);\n");
  const ok = node(selftest);
  assert.equal(ok.status, 0, ok.output);
  assert.match(ok.stdout, /^ok {3}check-bugs\.mjs --help$/m);
  assert.match(ok.stdout, /^ok {3}check-bugs\.mjs pass-skip-line \(exit 0, found "SKIP src\/later\.ts \[later-rule\] not yet created \(later-skill creates it\)"\)$/m);
  assert.match(ok.stdout, /^ok {3}check-bugs\.mjs bad-planted \(exit 1, found "src\/a\.ts:2 \[rule-x\]"\)$/m);
  assert.match(ok.stdout, /^ok {3}check-bugs\.mjs error-no-root \(exit 2, found "ERROR \[bad-input\] nothing to check: repo root no-such-folder"\)$/m);
  assert.equal(ok.last, 'RESULT: PASS');
  // A missed planted bug fails the self-test.
  write(join(fixtures, 'bad-planted', 'src', 'a.ts'), 'ok\n');
  const missed = node(selftest);
  assert.equal(missed.status, 1);
  assert.match(missed.stdout, /\[selftest-case\] check-bugs\.mjs bad-planted: expected exit 1, got 0/);
  write(join(fixtures, 'bad-planted', 'src', 'a.ts'), 'ok\nBUG rule-x\n');
  // A case kind without EXPECT.txt fails.
  rmSync(join(fixtures, 'bad-planted', 'EXPECT.txt'));
  assert.match(node(selftest).stdout, /\[selftest-expect\] bad-planted has no EXPECT\.txt/);
  write(join(fixtures, 'bad-planted', 'EXPECT.txt'), 'src/a.ts:2 [rule-x]\n');
  // Every runnable case stopping with the same exit-2 error: the environment is not ready (exit 2 once).
  const checker = join(skill, 'scripts', 'check-bugs.mjs');
  const original = readFileSync(checker, 'utf8');
  writeFileSync(checker, original.replace("const files = walk(", "fail('the image package is not installed', 'Run npm ci --prefix scripts.');\n  const files = walk(").replace("import { createReporter,", "import { fail, createReporter,"));
  const env = node(selftest);
  assert.equal(env.status, 2, env.output);
  assert.match(env.stdout, /ERROR \[bad-input\] check-bugs\.mjs cannot run here, every fixture stopped with: the image package is not installed Fix: Run npm ci --prefix scripts\./);
  writeFileSync(checker, original);
  // --case runs a subset.
  const subset = node(selftest, ['--case', 'bad-*']);
  assert.equal(subset.status, 0, subset.output);
  assert.match(subset.stdout, /bad-planted/);
  assert.doesNotMatch(subset.stdout, /pass-skip-line|error-no-root/);
  assert.match(subset.stdout, /^selftest: 2 runs checked, 0 problems$/m);
}));

// ---------------------------------------------------------------------------------------------
// Overlay ops
// ---------------------------------------------------------------------------------------------

function opsDir(files) {
  const dir = makeTempDir('cl-ops-');
  for (const [rel, content] of Object.entries(files)) write(join(dir, rel), content);
  return dir;
}

test('applyMutation: every op applies', () => {
  const dir = opsDir({ 'a.ts': 'one two one\n', 'b.json': '{"scripts":{"test":"jest"},"list":[1,2,3],"keep":true}\n', 'c.txt': 'c\n', 'dir/d.txt': 'd\n', 'raw.json': '{"a":1}' });
  try {
    applyMutation(dir, [
      { replace: { file: 'a.ts', find: 'two', with: '2' } },
      { replace: { file: 'a.ts', find: 'one', with: '1', all: true } },
      { json: { file: 'b.json', path: ['scripts', 'lint'], value: 'eslint .' } },
      { json: { file: 'b.json', path: ['scripts', 'test'], delete: true } },
      { json: { file: 'b.json', path: ['new', 'deep'], value: { x: 1 } } },
      { json: { file: 'b.json', path: ['list', 1], delete: true } },
      { json: { file: 'b.json', path: ['keep'], value: null } },
      { json: { file: 'b.json', path: ['nothing'], literalNull: true } },
      { write: { file: 'w/content.txt', content: 'hello\n' } },
      { write: { file: 'w/data.json', json: { a: [1] } } },
      { write: { file: 'w/lines.txt', lines: ['a', 'b'] } },
      { write: { file: 'w/bin.dat', base64: Buffer.from('bin').toString('base64') } },
      { delete: 'c.txt' },
      { rename: { from: 'dir/d.txt', to: 'moved/d.txt' } },
      { copy: { from: 'moved', to: 'copied' } },
      { png: { files: ['img/a.png', 'img/b.png'], width: 3, height: 2, fill: '#ff0000' } },
      { reformat: { file: 'raw.json', indent: 4 } },
      { mkdir: ['empty/one', 'empty/two'] },
      { symlink: { path: 'link.ts', target: 'a.ts' } },
      { plant: { 'secrets/pasted.md': true, 'secrets/note.txt': 'plain\n' } },
      { $comment: 'a documented op', replace: { file: 'w/content.txt', find: 'h(el)lo', with: 'y$1p', regex: true } },
    ], 'ops');
    const files = tree(dir);
    assert.equal(files['a.ts'], '1 2 1\n');
    assert.deepEqual(JSON.parse(files['b.json']), { scripts: { lint: 'eslint .' }, list: [1, 3], new: { deep: { x: 1 } }, nothing: null });
    assert.equal(files['w/content.txt'], 'yelp\n');
    assert.equal(files['w/data.json'], '{\n  "a": [\n    1\n  ]\n}\n');
    assert.equal(files['w/lines.txt'], 'a\nb\n');
    assert.equal(files['w/bin.dat'], 'bin');
    assert.ok(!('c.txt' in files) && !('dir/d.txt' in files));
    assert.equal(files['moved/d.txt'], 'd\n');
    assert.equal(files['copied/d.txt'], 'd\n');
    assert.deepEqual(pngSize(join(dir, 'img', 'b.png')), { width: 3, height: 2, bitDepth: 8, colorType: 6, interlace: 0 });
    assert.deepEqual([...readPng(join(dir, 'img', 'a.png')).data.slice(0, 4)], [255, 0, 0, 255]);
    assert.equal(files['raw.json'], '{\n    "a": 1\n}\n');
    assert.ok(existsSync(join(dir, 'empty', 'two')));
    assert.ok(lstatSync(join(dir, 'link.ts')).isSymbolicLink());
    assert.match(files['secrets/pasted.md'], /^# Handover\n\nkey:\n-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n$/);
    assert.equal(files['secrets/note.txt'], 'plain\n');
    // occurrence and count
    applyMutation(dir, [{ replace: { file: 'a.ts', find: '1', with: 'X', occurrence: 2 } }], 'ops');
    assert.equal(readFileSync(join(dir, 'a.ts'), 'utf8'), '1 2 X\n');
    applyMutation(dir, [{ replace: { file: 'a.ts', find: ' ', with: '_', count: 2 } }], 'ops');
    assert.equal(readFileSync(join(dir, 'a.ts'), 'utf8'), '1_2_X\n');
  } finally {
    removeTempDir(dir);
  }
});

test('applyMutation: a stale or ambiguous op fails loudly', () => {
  const dir = opsDir({ 'a.ts': 'one one\n', 'b.json': '{"a":{"b":1}}\n', 'c.txt': 'c\n' });
  try {
    const cases = [
      [{ replace: { file: 'a.ts', find: 'three', with: '3' } }, /"three" not found in a\.ts; update its mutation\.json/],
      [{ replace: { file: 'a.ts', find: 'one', with: '1' } }, /"one" occurs 2 times in a\.ts; make "find" unique, or add "all": true, "count": 2 or "occurrence": <n>/],
      [{ replace: { file: 'a.ts', find: 'one', with: '1', count: 3 } }, /occurs 2 times in a\.ts, the op expects 3/],
      [{ replace: { file: 'a.ts', find: 'one', with: '1', occurrence: 3 } }, /the op replaces occurrence 3/],
      [{ replace: { file: 'missing.ts', find: 'x', with: 'y' } }, /missing\.ts does not exist/],
      [{ replace: { file: '../escape.ts', find: 'x', with: 'y' } }, /must be a path inside the case/],
      [{ json: { file: 'b.json', path: ['a', 'zz'], delete: true } }, /b\.json has no "a" > "zz"/],
      [{ json: { file: 'b.json', path: ['x', 'y'], delete: true } }, /b\.json has no "x"/],
      [{ json: { file: 'b.json', path: ['a', 'b'] } }, /json needs "value"/],
      [{ json: { file: 'nope.json', path: ['a'], value: 1 } }, /nope\.json does not exist/],
      [{ delete: 'gone.txt' }, /gone\.txt does not exist/],
      [{ rename: { from: 'c.txt', to: 'a.ts' } }, /a\.ts already exists/],
      [{ copy: { from: 'gone', to: 'x' } }, /gone does not exist/],
      [{ write: { file: 'x.txt', content: 'a', json: 1 } }, /exactly one of/],
      [{ png: { file: 'x.png', width: 0, height: 2 } }, /integer width and height/],
      [{ frobnicate: {} }, /unknown op/],
      [{ write: { file: 'x', content: 'a' }, delete: 'c.txt' }, /unknown op/],
    ];
    for (const [op, pattern] of cases) assert.throws(() => applyMutation(dir, [op], 'case'), (error) => error instanceof OverlayError && pattern.test(error.message), JSON.stringify(op));
    assert.throws(() => applyMutation(dir, { not: 'a list' }, 'case'), OverlayError);
    // legacyOps keeps the older assemblers' behaviour: every occurrence ('all') or the first ('first'),
    // and a json delete of a missing key passes.
    applyMutation(dir, [{ replace: { file: 'a.ts', find: 'one', with: '1' } }, { json: { file: 'b.json', path: ['x', 'y'], value: null } }], 'case', { legacyOps: 'all' });
    assert.equal(readFileSync(join(dir, 'a.ts'), 'utf8'), '1 1\n');
    applyMutation(dir, [{ replace: { file: 'a.ts', find: '1', with: 'one' } }], 'case', { legacyOps: 'first' });
    assert.equal(readFileSync(join(dir, 'a.ts'), 'utf8'), 'one 1\n');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------------------------
// Overlay suites through runSelftest
// ---------------------------------------------------------------------------------------------

test('runSelftest: an overlay suite (SUITE.json) assembles every case, renames dot-files, honours ARGS.txt modes, extends and suite ops', () => withTemp('cl-overlay-', (dir) => {
  const skill = makeSkill(dir);
  const fixtures = join(skill, 'tests', 'fixtures', 'check-bugs');
  // good: the base tree (a dot-gitignore that becomes .gitignore, a JSON file, a file to delete).
  write(join(fixtures, 'good', 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  write(join(fixtures, 'good', 'dot-gitignore'), 'node_modules\n');
  write(join(fixtures, 'good', 'settings.json'), '{ "level": 1 }\n');
  write(join(fixtures, 'good', 'old', 'gone.txt'), 'BUG would-fail-if-kept\n');
  write(join(fixtures, 'good', 'EXPECT.txt'), 'check-bugs: 3 files checked, 0 problems, 1 skipped\n');
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ base: 'good', ops: [{ delete: 'old' }, { png: { file: 'assets/icon.png', width: 2, height: 2, fill: '#00ff00' } }] }));
  // bad-replace: a mutation.json op only.
  write(join(fixtures, 'bad-replace', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/a.ts', find: 'export const b = 2;', with: 'BUG rule-b' } }]));
  write(join(fixtures, 'bad-replace', 'EXPECT.txt'), 'src/a.ts:2 [rule-b]\n');
  // bad-overlay: an overlay file plus DELETE.txt; the overlay dot-gitignore becomes .gitignore.
  write(join(fixtures, 'bad-overlay', 'src', 'b.ts'), 'BUG rule-overlay\n');
  write(join(fixtures, 'bad-overlay', 'dot-gitignore'), 'BUG rule-gitignore\n');
  write(join(fixtures, 'bad-overlay', 'DELETE.txt'), '# planted: the settings file is gone\nsettings.json\n');
  write(join(fixtures, 'bad-overlay', 'EXPECT.txt'), 'src/b.ts:1 [rule-overlay]\n.gitignore:1 [rule-gitignore]\n');
  // pass-args: ARGS.txt replaces args(dir) for a pass case ({dir} is the assembled case folder).
  write(join(fixtures, 'pass-args', 'ARGS.txt'), '{dir} --mark replaced\n');
  write(join(fixtures, 'pass-args', 'EXPECT.txt'), 'mark=replaced\n');
  // bad-json: a json op
  write(join(fixtures, 'bad-json', 'mutation.json'), JSON.stringify([{ json: { file: 'settings.json', path: ['level'], value: 'BUG' } }, { write: { file: 'notes.txt', content: 'BUG rule-json\n' } }]));
  write(join(fixtures, 'bad-json', 'EXPECT.txt'), 'notes.txt:1 [rule-json]\n');
  // error-args: ARGS.txt in an error case
  write(join(fixtures, 'error-args', 'ARGS.txt'), 'no-such-folder\n');
  write(join(fixtures, 'error-args', 'EXPECT.txt'), 'ERROR [bad-input] nothing to check: repo root no-such-folder\n');
  // pass-own-base: a case with its own base (an empty one plus one file), no suite ops.
  write(join(fixtures, 'pass-own-base', 'mutation.json'), JSON.stringify({ base: [], ops: [{ write: { file: 'only.ts', content: 'export {};\n' } }] }));
  write(join(fixtures, 'pass-own-base', 'EXPECT.txt'), 'check-bugs: 1 files checked, 0 problems, 1 skipped\n');
  const selftest = join(skill, 'scripts', 'selftest.mjs');
  write(selftest, "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [{ script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] }]);\n");
  const ok = node(selftest);
  assert.equal(ok.status, 0, ok.output);
  for (const name of ['good', 'bad-replace', 'bad-overlay', 'pass-args', 'bad-json', 'error-args', 'pass-own-base']) assert.match(ok.stdout, new RegExp(`^ok {3}check-bugs\\.mjs ${name} `, 'm'), name);
  // --materialize writes the assembled trees and runs nothing.
  const out = join(dir, 'materialized');
  const materialized = node(selftest, ['--materialize', out]);
  assert.equal(materialized.status, 0, materialized.output);
  assert.match(materialized.stdout, /^ok {3}01-check-bugs: 7 cases -> /m);
  const good = tree(join(out, '01-check-bugs', 'good'));
  assert.deepEqual(Object.keys(good).sort(), ['.gitignore', 'EXPECT.txt', 'assets/icon.png', 'settings.json', 'src/a.ts']);
  const overlay = tree(join(out, '01-check-bugs', 'bad-overlay'));
  assert.deepEqual(Object.keys(overlay).sort(), ['.gitignore', 'EXPECT.txt', 'assets/icon.png', 'src/a.ts', 'src/b.ts']);
  assert.equal(overlay['.gitignore'], 'BUG rule-gitignore\n');
  assert.deepEqual(Object.keys(tree(join(out, '01-check-bugs', 'pass-own-base'))).sort(), ['EXPECT.txt', 'only.ts']);
  assert.equal(node(selftest, ['--materialize', out]).status, 2, 'a non-empty materialize folder is refused');
  // A stale op fails loudly (selftest-assemble, exit 1); the other cases still run.
  write(join(fixtures, 'bad-replace', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/a.ts', find: 'export const c = 3;', with: 'BUG rule-b' } }]));
  const stale = node(selftest);
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.stdout, /^FAIL \.\.\/tests\/fixtures\/check-bugs\/bad-replace \[selftest-assemble\] check-bugs\.mjs bad-replace: bad-replace: mutation\.json op 1: "export const c = 3;" not found in src\/a\.ts; update its mutation\.json/m);
  assert.match(stale.stdout, /^ok {3}check-bugs\.mjs bad-overlay /m);
  write(join(fixtures, 'bad-replace', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/a.ts', find: 'export const b = 2;', with: 'BUG rule-b' } }]));
  // A DELETE.txt line that names nothing fails too.
  write(join(fixtures, 'bad-overlay', 'DELETE.txt'), 'settings.json\nno/such/path\n');
  assert.match(node(selftest).stdout, /\[selftest-assemble\] check-bugs\.mjs bad-overlay: bad-overlay: DELETE\.txt: no\/such\/path does not exist/);
  write(join(fixtures, 'bad-overlay', 'DELETE.txt'), 'settings.json\n');
  // ARGS.txt modes: append adds the words after args(dir); error-only ignores them for a pass case.
  write(join(fixtures, 'pass-args', 'ARGS.txt'), '--mark appended\n');
  write(join(fixtures, 'pass-args', 'EXPECT.txt'), 'mark=appended\n');
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ base: 'good', ops: [{ delete: 'old' }], argsFile: 'append' }));
  // In append mode the error case's words follow args(dir) too: two positionals.
  write(join(fixtures, 'error-args', 'EXPECT.txt'), 'ERROR [bad-input] expected at most 1 argument(s), got 2\n');
  const appended = node(selftest);
  assert.equal(appended.status, 0, appended.output);
  write(join(fixtures, 'error-args', 'EXPECT.txt'), 'ERROR [bad-input] nothing to check: repo root no-such-folder\n');
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ base: 'good', ops: [{ delete: 'old' }], argsFile: 'error-only' }));
  assert.match(node(selftest).stdout, /\[selftest-case\] check-bugs\.mjs pass-args: output does not contain "mark=appended"/);
  // extends: every other case starts from good's assembled tree (with good's own overlay).
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ base: '@tests/bases/app', extends: 'good' }));
  write(join(skill, 'tests', 'bases', 'app', 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  write(join(skill, 'tests', 'bases', 'app', 'settings.json'), '{ "level": 1 }\n');
  rmSync(join(fixtures, 'good'), { recursive: true });
  write(join(fixtures, 'good', 'dot-gitignore'), 'node_modules\n');
  write(join(fixtures, 'good', 'EXPECT.txt'), 'check-bugs: 3 files checked, 0 problems, 1 skipped\n');
  write(join(fixtures, 'pass-args', 'ARGS.txt'), '. --mark replaced\n');
  write(join(fixtures, 'pass-args', 'EXPECT.txt'), 'mark=replaced\n');
  write(join(fixtures, 'pass-own-base', 'EXPECT.txt'), 'check-bugs: 1 files checked, 0 problems, 1 skipped\n');
  const extended = node(selftest);
  assert.equal(extended.status, 0, extended.output);
  const out2 = join(dir, 'materialized-2');
  node(selftest, ['--materialize', out2]);
  assert.deepEqual(Object.keys(tree(join(out2, '01-check-bugs', 'bad-replace'))).sort(), ['.gitignore', 'EXPECT.txt', 'settings.json', 'src/a.ts'], 'bad-replace extends good (with its .gitignore) and has its own EXPECT.txt');
  // A SUITE.json typo is a problem, not a silent pass.
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ bases: 'good' }));
  assert.match(node(selftest).stdout, /\[selftest-assemble\] check-bugs\.mjs check-bugs: SUITE\.json has unknown keys: bases/);
}));

test('overlay details: plant.json, a case leaving the suite extends, custom and disabled renames, optional layers, legacyOps in SUITE.json', () => withTemp('cl-details-', (dir) => {
  const skill = makeSkill(dir);
  const fixtures = join(skill, 'tests', 'fixtures', 'check-bugs');
  write(join(fixtures, 'good', 'src', 'a.ts'), 'one one\n');
  write(join(fixtures, 'good', 'dot-npmrc'), 'save-exact=true\n');
  write(join(fixtures, 'good', 'dot-gitignore'), 'node_modules\n');
  write(join(fixtures, 'bad-plant', 'plant.json'), JSON.stringify({ 'notes/key.txt': true, 'notes/b.txt': 'BUG rule-plant\n' }));
  write(join(fixtures, 'bad-plant', 'EXPECT.txt'), 'notes/b.txt:1 [rule-plant]\n');
  write(join(fixtures, 'pass-own', 'mutation.json'), JSON.stringify({ extends: null, base: ['@tests/bases/tiny'], ops: [] }));
  write(join(fixtures, 'pass-own', 'EXPECT.txt'), 'check-bugs: 1 files checked\n');
  write(join(skill, 'tests', 'bases', 'tiny', 'only.ts'), 'export {};\n');
  write(join(fixtures, 'bad-legacy', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/a.ts', find: 'one', with: 'BUG' } }, { write: { file: 'k.json', json: { a: 1 } } }, { json: { file: 'k.json', path: ['nope', 'deeper'], value: null } }]));
  write(join(fixtures, 'bad-legacy', 'EXPECT.txt'), 'src/a.ts:1 [BUG]\n');
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ base: ['good', { from: '@tests/bases/absent', optional: true }], extends: 'good', legacyOps: 'all', renames: { 'dot-npmrc': '.npmrc' } }));
  const selftest = join(skill, 'scripts', 'selftest.mjs');
  write(selftest, "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [{ script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] }]);\n");
  const ok = node(selftest);
  assert.equal(ok.status, 0, ok.output);
  const out = join(dir, 'm');
  node(selftest, ['--materialize', out]);
  const plant = tree(join(out, '01-check-bugs', 'bad-plant'));
  assert.deepEqual(Object.keys(plant).sort(), ['.gitignore', '.npmrc', 'EXPECT.txt', 'notes/b.txt', 'notes/key.txt', 'src/a.ts']);
  assert.match(plant['notes/key.txt'], /-----BEGIN PRIVATE KEY-----/);
  assert.equal(tree(join(out, '01-check-bugs', 'bad-legacy'))['src/a.ts'], 'BUG BUG\n', 'legacyOps all: every occurrence');
  assert.deepEqual(Object.keys(tree(join(out, '01-check-bugs', 'pass-own'))).sort(), ['EXPECT.txt', 'only.ts'], 'its own base, not the suite extends');
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ base: 'good', renames: false }));
  const out2 = join(dir, 'm2');
  node(selftest, ['--materialize', out2, '--case', 'good']);
  assert.deepEqual(Object.keys(tree(join(out2, '01-check-bugs', 'good'))).sort(), ['dot-gitignore', 'dot-npmrc', 'src/a.ts'], 'renames: false keeps the stored names');
  write(join(fixtures, 'SUITE.json'), JSON.stringify({ base: ['good', '@tests/bases/absent'] }));
  assert.match(node(selftest).stdout, /\[selftest-assemble\] check-bugs\.mjs [a-z-]+: base: base .*bases\/absent does not exist/);
}));

test('overlay/ folders, a base/ folder suite without SUITE.json, a data file named mutation.json, the flat op spelling', () => withTemp('cl-overlay-dir-', (dir) => {
  const skill = makeSkill(dir);
  const fixtures = join(skill, 'tests', 'fixtures', 'check-bugs');
  // The suite's base/ folder is the base (no SUITE.json); its overlay/ holds a data file named mutation.json.
  write(join(fixtures, 'base', 'src', 'a.ts'), 'export const a = 1;\n');
  write(join(fixtures, 'base', 'overlay', 'mutation.json'), '{ "schemaVersion": "1", "files": {} }\n');
  write(join(fixtures, 'good', 'EXPECT.txt'), 'check-bugs: 2 files checked, 0 problems, 1 skipped\n');
  write(join(fixtures, 'bad-overlay-dir', 'overlay', 'mutation.json'), '{ "files": "BUG rule-data" }\nBUG rule-data\n');
  write(join(fixtures, 'bad-overlay-dir', 'overlay', 'DELETE.txt'), 'BUG rule-named-delete\n');
  write(join(fixtures, 'bad-overlay-dir', 'EXPECT.txt'), 'mutation.json:2 [rule-data]\nDELETE.txt:1 [rule-named-delete]\n');
  write(join(fixtures, 'bad-flat-op', 'mutation.json'), JSON.stringify([{ op: 'replace', file: 'src/a.ts', find: 'export const a = 1;', with: 'BUG rule-flat' }, { op: 'delete', path: 'mutation.json' }, { op: 'mkdir', paths: ['empty'] }]));
  write(join(fixtures, 'bad-flat-op', 'EXPECT.txt'), 'src/a.ts:1 [rule-flat]\n');
  const selftest = join(skill, 'scripts', 'selftest.mjs');
  write(selftest, "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [{ script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] }]);\n");
  const ok = node(selftest);
  assert.equal(ok.status, 0, ok.output);
  const out = join(dir, 'm');
  node(selftest, ['--materialize', out]);
  assert.deepEqual(Object.keys(tree(join(out, '01-check-bugs', 'good'))).sort(), ['EXPECT.txt', 'mutation.json', 'src/a.ts'], 'the base folder overlay/ lands at the root');
  assert.deepEqual(Object.keys(tree(join(out, '01-check-bugs', 'bad-overlay-dir'))).sort(), ['DELETE.txt', 'EXPECT.txt', 'mutation.json', 'src/a.ts']);
  assert.ok(!Object.keys(tree(join(out, '01-check-bugs', 'bad-flat-op'))).includes('mutation.json'));
  assert.ok(existsSync(join(out, '01-check-bugs', 'bad-flat-op', 'empty')));
}));

test('CASES.json: one file holds every case mutation and args; stale keys, doubles and bad shapes fail loudly', () => withTemp('cl-cases-', (dir) => {
  const skill = makeSkill(dir);
  const fixtures = join(skill, 'tests', 'fixtures', 'check-bugs');
  // No SUITE.json: CASES.json alone makes the suite assembled, with good/ as the base.
  write(join(fixtures, 'good', 'src', 'a.ts'), 'export const a = 1;\n');
  write(join(fixtures, 'good', 'src', 'b.ts'), 'export const b = 2;\n');
  write(join(fixtures, 'good', 'EXPECT.txt'), 'check-bugs: 2 files checked, 0 problems, 1 skipped\n');
  write(join(fixtures, 'bad-listed', 'EXPECT.txt'), 'src/a.ts:1 [rule-a]\n');
  write(join(fixtures, 'bad-object', 'EXPECT.txt'), 'src/c.ts:1 [rule-c]\nmark=packed\n');
  write(join(fixtures, 'bad-own-file', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/b.ts', find: 'export const b = 2;', with: 'BUG rule-b' } }]));
  write(join(fixtures, 'bad-own-file', 'EXPECT.txt'), 'src/b.ts:1 [rule-b]\n');
  write(join(fixtures, 'error-args', 'EXPECT.txt'), 'does not exist\n');
  write(join(fixtures, 'CASES.json'), JSON.stringify({
    $comment: 'one entry per case',
    'bad-listed': [{ replace: { file: 'src/a.ts', find: 'export const a = 1;', with: 'BUG rule-a' } }],
    'bad-object': { $comment: 'args and ops', args: '{dir} --mark packed', ops: [{ delete: 'src/b.ts' }, { write: { file: 'src/c.ts', content: 'BUG rule-c\n' } }] },
    'error-args': { args: ['{dir}/missing'] },
  }, null, 2));
  const selftest = join(skill, 'scripts', 'selftest.mjs');
  write(selftest, "import { runSelftest } from './check-lib.mjs';\nawait runSelftest(import.meta.url, [{ script: 'check-bugs.mjs', fixtures: '../tests/fixtures/check-bugs', args: (dir) => [dir] }]);\n");
  const ok = node(selftest);
  assert.equal(ok.status, 0, ok.output);
  assert.match(ok.output, /ok {3}check-bugs\.mjs bad-object \(exit 1/);
  const out = join(dir, 'm');
  node(selftest, ['--materialize', out]);
  assert.deepEqual(tree(join(out, '01-check-bugs', 'bad-object')), { 'ARGS.txt': '{dir} --mark packed\n', 'EXPECT.txt': 'src/c.ts:1 [rule-c]\nmark=packed\n', 'src/a.ts': 'export const a = 1;\n', 'src/c.ts': 'BUG rule-c\n' });
  // A key that names no case folder, a case with both an entry and its own mutation.json, ARGS.txt plus "args", a bad shape.
  const cases = JSON.parse(readFileSync(join(fixtures, 'CASES.json'), 'utf8'));
  const expectFail = (data, pattern, extra = () => {}, undo = () => {}) => {
    write(join(fixtures, 'CASES.json'), JSON.stringify(data));
    extra();
    const failed = node(selftest);
    assert.equal(failed.status, 1, failed.output);
    assert.match(failed.output, pattern);
    undo();
  };
  expectFail({ ...cases, 'bad-gone': [] }, /\[selftest-assemble\].*CASES\.json names bad-gone, which is not a case folder/);
  expectFail({ ...cases, 'bad-own-file': [] }, /bad-own-file: has both mutation\.json and an entry in the suite's CASES\.json/);
  expectFail(cases, /error-args: has both ARGS\.txt and "args"/, () => write(join(fixtures, 'error-args', 'ARGS.txt'), 'x\n'), () => rmSync(join(fixtures, 'error-args', 'ARGS.txt')));
  expectFail({ ...cases, 'bad-listed': { ops: [], argv: 'x' } }, /CASES\.json "bad-listed" has unknown keys: argv/);
  expectFail({ ...cases, notacase: [] }, /CASES\.json key "notacase" is not a case name/);
  expectFail({ ...cases, 'bad-listed': [{ replace: { file: 'src/a.ts', find: 'nope', with: 'x' } }] }, /bad-listed: CASES\.json op 1: "nope" not found in src\/a\.ts/);
  // "expect" inline: a case with no folder at all, written to EXPECT.txt when assembled; never both.
  const inline = { ...cases, 'bad-inline': { expect: ['src/a.ts:1 [rule-a]'], ops: [{ replace: { file: 'src/a.ts', find: 'export const a = 1;', with: 'BUG rule-a' } }] }, 'bad-inline-text': { expect: 'src/b.ts:1 [rule-b]\n', ops: [{ replace: { file: 'src/b.ts', find: 'export const b = 2;', with: 'BUG rule-b' } }] } };
  write(join(fixtures, 'CASES.json'), JSON.stringify(inline));
  const withInline = node(selftest);
  assert.equal(withInline.status, 0, withInline.output);
  assert.match(withInline.output, /ok {3}check-bugs\.mjs bad-inline \(exit 1, found "src\/a\.ts:1 \[rule-a\]"\)/);
  assert.match(withInline.output, /ok {3}check-bugs\.mjs bad-inline-text \(exit 1/);
  const out2 = join(dir, 'm2');
  node(selftest, ['--materialize', out2]);
  assert.equal(tree(join(out2, '01-check-bugs', 'bad-inline'))['EXPECT.txt'], 'src/a.ts:1 [rule-a]\n');
  assert.equal(tree(join(out2, '01-check-bugs', 'bad-inline-text'))['EXPECT.txt'], 'src/b.ts:1 [rule-b]\n');
  expectFail({ ...inline, 'bad-inline': { ...inline['bad-inline'], expect: ['src/b.ts:1 [rule-b]'] } }, /check-bugs\.mjs bad-inline: output does not contain "src\/b\.ts:1 \[rule-b\]"/);
  expectFail({ ...cases, 'bad-listed': { expect: ['x'], ops: [] } }, /bad-listed: has both EXPECT\.txt and "expect"/);
  expectFail({ ...cases, 'bad-listed': { expect: 3 } }, /CASES\.json "bad-listed" "expect" must be a list of lines/);
  write(join(fixtures, 'CASES.json'), JSON.stringify(cases));
}));

test('runSelftest: a JS suite base with { build } and templates placed by their first line, with placeholders filled', () => withTemp('cl-build-', (dir) => {
  const skill = makeSkill(dir);
  write(join(skill, 'templates', 'tasks-screen.tsx'), '// src/features/__FEATURE__/__FEATURE__-screen.tsx\nexport function __PASCAL__Screen() { return null; }\n');
  write(join(skill, 'templates', 'package-scripts.json'), '{ "test": "jest" }\n');
  write(join(skill, 'templates', 'run.mjs'), '#!/usr/bin/env node\n// scripts/run-__FEATURE__.mjs\nconsole.log(1);\n');
  const fixtures = join(skill, 'tests', 'fixtures', 'check-bugs');
  write(join(fixtures, 'good', 'EXPECT.txt'), 'check-bugs: 3 files checked, 0 problems, 1 skipped\n');
  write(join(fixtures, 'bad-template', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/features/tasks/tasks-screen.tsx', find: 'return null;', with: '\nBUG rule-template\n' } }]));
  write(join(fixtures, 'bad-template', 'EXPECT.txt'), 'src/features/tasks/tasks-screen.tsx:3 [rule-template]\n');
  const selftest = join(skill, 'scripts', 'selftest.mjs');
  write(selftest, `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSelftest } from './check-lib.mjs';
await runSelftest(import.meta.url, [{
  script: 'check-bugs.mjs',
  fixtures: '../tests/fixtures/check-bugs',
  args: (dir) => [dir],
  base: [
    { templates: true, firstLinePath: true, fill: { __FEATURE__: 'tasks', __PASCAL__: 'Tasks' }, include: ['*.tsx', '*.mjs'] },
    { from: '@skill/templates/package-scripts.json', to: 'config/' },
    { build: async (dir) => writeFileSync(join(dir, 'generated.json'), '{"ok":true}\\n') },
  ],
}]);
`);
  const ok = node(selftest);
  assert.equal(ok.status, 0, ok.output);
  const out = join(dir, 'm');
  node(selftest, ['--materialize', out]);
  const good = tree(join(out, '01-check-bugs', 'good'));
  assert.deepEqual(Object.keys(good).sort(), ['EXPECT.txt', 'config/package-scripts.json', 'generated.json', 'scripts/run-tasks.mjs', 'src/features/tasks/tasks-screen.tsx']);
  assert.equal(good['src/features/tasks/tasks-screen.tsx'], '// src/features/tasks/tasks-screen.tsx\nexport function TasksScreen() { return null; }\n');
}));

test('the older assembler forms: assembleSuite (options, templates/extraCopies/baseRepo, positional) and assembleFixtures (sync and async)', async () => {
  const dir = makeTempDir('cl-legacy-');
  try {
    write(join(dir, 'templates', 'src', 'a.ts'), 'from templates\n');
    write(join(dir, 'extra', 'deps.ts'), 'extra\n');
    write(join(dir, 'base-repo', 'package.json'), '{"name":"x","scripts":{"a":"1"}}\n');
    const suite = join(dir, 'tests', 'fixtures', 'suite');
    write(join(suite, 'good', 'CASE.txt'), 'the clean repo\n');
    write(join(suite, 'bad-a', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/a.ts', find: 'templates', with: 'X' } }, { json: { file: 'package.json', path: ['scripts', 'gone'], value: null } }]));
    write(join(suite, 'bad-a', 'EXPECT.txt'), 'x\n');
    write(join(suite, 'error-b', 'EXPECT.txt'), 'e\n');
    write(join(suite, 'error-b', 'ARGS.txt'), '--x\n');
    const tmp = assembleSuite({ templates: join(dir, 'templates'), extraCopies: [[join(dir, 'extra'), 'packages/tooling']], baseRepo: join(dir, 'base-repo'), suiteDir: suite, prefix: 'cl-legacy-suite-', legacyOps: 'all' });
    try {
      assert.deepEqual(readdirSync(tmp).sort(), ['bad-a', 'error-b', 'good']);
      assert.deepEqual(Object.keys(tree(join(tmp, 'good'))).sort(), ['CASE.txt', 'package.json', 'packages/tooling/deps.ts', 'src/a.ts']);
      assert.equal(readFileSync(join(tmp, 'bad-a', 'src', 'a.ts'), 'utf8'), 'from X\n');
      assert.ok(existsSync(join(tmp, 'bad-a', 'EXPECT.txt')) && existsSync(join(tmp, 'error-b', 'ARGS.txt')));
      assert.ok(!existsSync(join(tmp, 'bad-a', 'mutation.json')));
    } finally {
      removeTempDir(tmp);
    }
    const positional = assembleSuite([join(dir, 'templates'), join(dir, 'base-repo')], suite);
    try {
      assert.equal(readFileSync(join(positional, 'bad-a', 'src', 'a.ts'), 'utf8'), 'from X\n');
    } catch (error) {
      removeTempDir(positional);
      throw error;
    }
    removeTempDir(positional);
    write(join(suite, 'bad-a', 'mutation.json'), JSON.stringify([{ replace: { file: 'src/a.ts', find: 'nowhere', with: 'X' } }]));
    assert.throws(() => assembleSuite({ base: [join(dir, 'templates')], suiteDir: suite }), (error) => error instanceof OverlayError && /"nowhere" not found/.test(error.message));
    const mutations = join(dir, 'mutations');
    write(join(mutations, 'bad-first', 'mutation.json'), JSON.stringify([{ replace: { file: 'g.txt', find: 'a', with: 'b' } }]));
    write(join(mutations, 'bad-first', 'EXPECT.txt'), 'x\n');
    write(join(mutations, 'pass-all', 'mutation.json'), JSON.stringify([{ replace: { file: 'g.txt', find: 'a', with: 'b', all: true } }]));
    write(join(mutations, 'pass-all', 'EXPECT.txt'), 'x\n');
    const sync = assembleFixtures(mutations, (good) => writeFileSync(join(good, 'g.txt'), 'a a\n'));
    try {
      assert.equal(readFileSync(join(sync, 'bad-first', 'g.txt'), 'utf8'), 'b a\n', 'the older first-occurrence rule');
      assert.equal(readFileSync(join(sync, 'pass-all', 'g.txt'), 'utf8'), 'b b\n');
      assert.deepEqual(readdirSync(sync).sort(), ['bad-first', 'good', 'pass-all']);
    } finally {
      removeTempDir(sync);
    }
    const asyncDir = await assembleFixtures(mutations, async (good) => writeFileSync(join(good, 'g.txt'), 'a a\n'));
    try {
      assert.equal(readFileSync(join(asyncDir, 'bad-first', 'g.txt'), 'utf8'), 'b a\n');
    } finally {
      removeTempDir(asyncDir);
    }
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------------------------

function rawPng({ width, height, colorType, bitDepth, rows, palette = null, trns = null, filters = null }) {
  const crcChunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const body = Buffer.concat([head.subarray(4), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const bpp = Math.max(1, (({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType] * bitDepth) >> 3);
  const encoded = rows.map((row, y) => {
    const filter = filters ? filters[y % filters.length] : 0;
    const prev = y > 0 ? rows[y - 1] : null;
    const out = Buffer.alloc(row.length);
    for (let x = 0; x < row.length; x += 1) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (() => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      })() : 0;
      out[x] = (row[x] - predictor) & 0xff;
    }
    return Buffer.concat([Buffer.from([filter]), out]);
  });
  const chunks = [crcChunk('IHDR', ihdr)];
  if (palette) chunks.push(crcChunk('PLTE', Buffer.from(palette)));
  if (trns) chunks.push(crcChunk('tRNS', Buffer.from(trns)));
  chunks.push(crcChunk('IDAT', deflateSync(Buffer.concat(encoded))), crcChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

test('writePng / readPng round trip, colors, and decoding gray, palette and filtered PNGs', () => withTemp('cl-png-', (dir) => {
  assert.deepEqual(parseColor('#f80'), [255, 136, 0, 255]);
  assert.deepEqual(parseColor('#11223344'), [17, 34, 51, 68]);
  assert.deepEqual(parseColor([1, 2, 3]), [1, 2, 3, 255]);
  assert.throws(() => parseColor('red'), /not a color/);
  const path = writePng(join(dir, 'deep', 'shot.png'), { width: 6, height: 4, fill: '#ffffff', rects: [{ x: 1, y: 1, width: 2, height: 2, fill: '#3366ff' }, { x: 5, y: 3, w: 9, h: 9, color: [0, 0, 0, 0] }] });
  const image = readPng(path);
  assert.equal(image.width, 6);
  assert.equal(image.height, 4);
  const px = (x, y) => [...image.data.slice((y * 6 + x) * 4, (y * 6 + x) * 4 + 4)];
  assert.deepEqual(px(0, 0), [255, 255, 255, 255]);
  assert.deepEqual(px(2, 2), [51, 102, 255, 255]);
  assert.deepEqual(px(5, 3), [0, 0, 0, 0], 'a rect is clipped to the image');
  const painted = decodePng(encodePng(renderPng({ width: 3, height: 3, paint: (x, y) => (x === y ? '#000000' : null), fill: '#ff0000' })));
  assert.deepEqual([...painted.data.slice(16, 20)], [0, 0, 0, 255]);
  assert.deepEqual([...painted.data.slice(4, 8)], [255, 0, 0, 255]);
  // RGB with every filter type, gray, gray+alpha, 2-bit palette with tRNS, 16-bit RGB.
  const rgbRows = Array.from({ length: 5 }, (_, y) => Buffer.from(Array.from({ length: 4 * 3 }, (_, i) => (y * 37 + i * 11) & 0xff)));
  const rgb = decodePng(rawPng({ width: 4, height: 5, colorType: 2, bitDepth: 8, rows: rgbRows, filters: [0, 1, 2, 3, 4] }));
  for (let y = 0; y < 5; y += 1) for (let x = 0; x < 4; x += 1) assert.deepEqual([...rgb.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)], [...rgbRows[y].slice(x * 3, x * 3 + 3), 255], `rgb ${x},${y}`);
  const gray = decodePng(rawPng({ width: 2, height: 1, colorType: 0, bitDepth: 8, rows: [Buffer.from([10, 200])] }));
  assert.deepEqual([...gray.data], [10, 10, 10, 255, 200, 200, 200, 255]);
  const grayAlpha = decodePng(rawPng({ width: 1, height: 1, colorType: 4, bitDepth: 8, rows: [Buffer.from([7, 128])] }));
  assert.deepEqual([...grayAlpha.data], [7, 7, 7, 128]);
  const palette = decodePng(rawPng({ width: 4, height: 1, colorType: 3, bitDepth: 2, rows: [Buffer.from([0b00011011])], palette: [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9], trns: [0] }));
  assert.deepEqual([...palette.data], [255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 255]);
  const deep = decodePng(rawPng({ width: 1, height: 1, colorType: 2, bitDepth: 16, rows: [Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])] }));
  assert.deepEqual([...deep.data], [0x12, 0x56, 0x9a, 255]);
  const broken = Buffer.from(encodePng(renderPng({ width: 1, height: 1 })));
  broken[broken.length - 20] ^= 0xff;
  assert.throws(() => decodePng(broken), /bad CRC|incorrect|invalid/i);
  assert.throws(() => pngSize(Buffer.from('not a png at all, really not a png')), /not a PNG/);
  const sips = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { encoding: 'utf8' });
  if (sips.status === 0) assert.match(sips.stdout, /pixelWidth: 6[\s\S]*pixelHeight: 4/, 'macOS sips reads the generated PNG');
}));

// ---------------------------------------------------------------------------------------------
// Pinned packages
// ---------------------------------------------------------------------------------------------

test('pinned packages: toolingEnvVar, resolveToolingDir, packageInstallFix (.skill-tooling/<skill>), importPackage', async () => {
  const dir = makeTempDir('cl-tooling-');
  const envVar = 'DESIGN_REVIEW_TOOLING_DIR';
  try {
    assert.equal(toolingEnvVar('design-review'), envVar);
    assert.throws(() => toolingEnvVar('Bad Name'), /toolingEnvVar/);
    const scriptsDir = join(dir, 'design-review', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    delete process.env[envVar];
    assert.equal(resolveToolingDir({ scriptsDir, skill: 'design-review' }), scriptsDir);
    process.env[envVar] = join(dir, 'from-env');
    assert.equal(resolveToolingDir({ scriptsDir, skill: 'design-review' }), join(dir, 'from-env'));
    assert.equal(resolveToolingDir({ given: join(dir, 'given'), scriptsDir, skill: 'design-review' }), join(dir, 'given'));
    assert.equal(resolveToolingDir({ scriptsDir }), scriptsDir, 'no variable without envVar or skill');
    assert.throws(() => resolveToolingDir({}), /needs scriptsDir/);
    const fix = packageInstallFix({ scriptsDir, skill: 'design-review' });
    assert.ok(fix.includes(`npm ci --prefix "${scriptsDir}"`), fix);
    assert.ok(fix.includes(`npm ci --prefix <repo>/.skill-tooling/design-review, and pass --tooling <repo>/.skill-tooling/design-review (or set ${envVar}=<repo>/.skill-tooling/design-review)`), fix);
    const derived = packageInstallFix({ scriptsDir });
    assert.ok(derived.includes('<repo>/.skill-tooling/design-review') && !derived.includes('(or set'), derived);
    assert.ok(packageInstallFix({ scriptsDir, envVar: 'X_DIR', repoDir: '.parity/tooling' }).includes('pass --tooling <repo>/.parity/tooling (or set X_DIR=<repo>/.parity/tooling)'));
    const tooling = join(dir, 'repo', '.skill-tooling', 'design-review');
    write(join(tooling, 'node_modules', 'esm-pkg', 'package.json'), JSON.stringify({ name: 'esm-pkg', type: 'module', exports: { '.': { types: './index.d.ts', import: './index.mjs', require: './index.cjs' } } }));
    write(join(tooling, 'node_modules', 'esm-pkg', 'index.mjs'), 'export const kind = "esm";\n');
    write(join(tooling, 'node_modules', '@scope', 'cjs-pkg', 'package.json'), JSON.stringify({ name: '@scope/cjs-pkg', main: './lib/main.js' }));
    write(join(tooling, 'node_modules', '@scope', 'cjs-pkg', 'lib', 'main.js'), 'exports.kind = "cjs";\n');
    assert.equal((await importPackage('esm-pkg', tooling)).kind, 'esm');
    assert.equal((await importPackage('@scope/cjs-pkg', tooling)).default.kind, 'cjs');
    await assert.rejects(() => importPackage('pngjs', tooling, { what: 'pngjs 7.0.0', fix }), (error) => error instanceof UsageError && /pngjs 7\.0\.0 is not installed in .*\/\.skill-tooling\/design-review\/node_modules/.test(error.message) && error.fix === fix);
  } finally {
    delete process.env[envVar];
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------------------------
// Fixture hygiene renames
// ---------------------------------------------------------------------------------------------

test('HYGIENE_RENAMES maps the two fixture names a skill cannot ship as-is', () => {
  assert.deepEqual(Object.keys(HYGIENE_RENAMES).sort(), ['dot-gitignore', 'dot-metadata.json']);
});

// ---------------------------------------------------------------------------------------------

run(async () => {
  parseArgs(process.argv.slice(2), { name: 'check-lib.selftest', summary: 'Self-test of check-lib.mjs: globs, walk, repo-scan ignores, layout, notYetCreated, the output contract, runSelftest and the overlay engine, PNG, pinned packages and the fixture hygiene renames.', usage: '' });
  const report = createReporter({ name: 'check-lib.selftest' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      const at = String(error?.stack ?? '').split('\n').find((line) => line.includes('check-lib.selftest.mjs')) ?? '';
      const where = /:(\d+):\d+\)?$/.exec(at)?.[1];
      report.problem({ file: 'check-lib.selftest.mjs', line: where ? Number(where) : 0, rule: 'check-lib-selftest', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix check-lib.mjs (or this test) until the test passes.' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
