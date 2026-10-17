#!/usr/bin/env node
// tests/verify-templates.selftest.mjs: proves tools/verify-templates.mjs catches what it exists to catch.
// It generates sample skills at run time (nothing named SKILL.md is committed under tools/): a good one
// that must pass, and planted-bad ones that must fail with exactly the planted rule (a type error, a
// lint error, a failing test, a template without its first-line path, an unformatted file), plus
// placeholders, NOT APPLICABLE, a missing harness (exit 2), harness drift and --sync-harness, adopted
// template copies (tools/harness/adopted.json: stale, refreshed, adapted, a broken manifest, "$scripts"),
// and a stale installed harness. The pure helpers (placement, placeholders, globs, canonical-file
// discovery, the harness knip.json layout, the message-catalog merge) are tested directly.
// Needs an installed harness: tools/harness with node_modules, or $RN_SKILLS_HARNESS (see
// tools/harness/README.md). Takes about two minutes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, parseArgs, run } from '../shared/scripts/check-lib.mjs';
import { canonicalFiles, defaultValue, extendsTemplate, fillPlaceholders, globToRegExp, harnessKnipText, mergeCatalogText, placementOf } from '../verify-templates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(HERE, '..');
const TOOL = join(TOOLS, 'verify-templates.mjs');
const HARNESS_SOURCE = join(TOOLS, 'harness');
const HARNESS_ENV = 'RN_SKILLS_HARNESS';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function verify(args, env = {}) {
  const result = spawnSync(process.execPath, [TOOL, ...args], { cwd: TOOLS, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  const stdout = result.stdout ?? '';
  return { status: result.status, stdout, output: `${stdout}${result.stderr ?? ''}`, lines: stdout.split('\n').filter(Boolean), last: stdout.split('\n').filter(Boolean).at(-1) ?? '' };
}

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

/** A sample skill folder (no SKILL.md: verify-templates only needs templates/ and assets/). */
function skill(name, files) {
  const dir = join(WORK, name);
  writeTree(dir, files);
  return dir;
}

function expectLine(result, pattern, label) {
  assert.ok(result.lines.some((line) => pattern.test(line)), `${label}: no line matches ${pattern}\n--- output ---\n${result.output.slice(-3000)}`);
}

function expectFail(result, label) {
  assert.equal(result.status, 1, `${label}: exit ${result.status}, want 1\n${result.output.slice(-3000)}`);
  assert.match(result.last, /^RESULT: FAIL \(\d+ problems\)$/, label);
}

function expectPass(result, label) {
  assert.equal(result.status, 0, `${label}: exit ${result.status}, want 0\n${result.output.slice(-3000)}`);
  assert.equal(result.last, 'RESULT: PASS', label);
}

const FAST = ['--no-jest', '--no-lint', '--no-prettier'];

// ---------------------------------------------------------------------------------------------
// Sample templates
// ---------------------------------------------------------------------------------------------

const GOOD = {
  'assets/template-placeholders.json': '{ "__FEATURE__": "notes", "__ENTITY_PASCAL__": "Note" }\n',
  'templates/src/features/__FEATURE__/note-title.ts': [
    '// src/features/__FEATURE__/note-title.ts',
    '',
    '/** One __ENTITY_PASCAL__ as the list shows it. */',
    'export type __ENTITY_PASCAL__ = { readonly id: string; readonly title: string };',
    '',
    '/** A title trimmed to at most `max` characters, with an ellipsis when it was cut. */',
    'export function shortTitle(note: __ENTITY_PASCAL__, max: number): string {',
    '  const title = note.title.trim();',
    '  return title.length <= max ? title : `${title.slice(0, Math.max(0, max - 1))}…`;',
    '}',
    '',
  ].join('\n'),
  'templates/src/features/__FEATURE__/note-title.test.ts': [
    '// src/features/__FEATURE__/note-title.test.ts',
    "import { shortTitle } from './note-title';",
    '',
    "describe('shortTitle', () => {",
    "  it('keeps a short title', () => {",
    "    expect(shortTitle({ id: 'note-1', title: '  Milk ' }, 10)).toBe('Milk');",
    '  });',
    '',
    "  it('cuts a long title with an ellipsis', () => {",
    "    expect(shortTitle({ id: 'note-2', title: 'Groceries for the week' }, 6)).toBe('Groce…');",
    '  });',
    '});',
    '',
  ].join('\n'),
  'templates/src/features/__FEATURE__/components/note-badge.tsx': [
    '// src/features/__FEATURE__/components/note-badge.tsx',
    "import { StyleSheet, View } from 'react-native';",
    '',
    "import { AppText } from '@/ui/app-text';",
    '',
    'export type NoteBadgeProps = { readonly label: string };',
    '',
    'export function NoteBadge({ label }: NoteBadgeProps): React.JSX.Element {',
    '  return (',
    '    <View testID="notes.badge" style={styles.badge}>',
    '      <AppText>{label}</AppText>',
    '    </View>',
    '  );',
    '}',
    '',
    'const styles = StyleSheet.create({',
    '  badge: { paddingHorizontal: 8, paddingVertical: 4 },',
    '});',
    '',
  ].join('\n'),
  'templates/contracts/notes.json': '{\n  "screen": "notes",\n  "testIDs": ["notes.badge"]\n}\n',
  'templates/maestro/notes-smoke.yaml': '# .maestro/flows/notes-smoke.yaml\nappId: com.example.harness.dev\n---\n- launchApp\n',
};

const ONE_FILE = (rel, lines) => ({ [`templates/${rel}`]: `${lines.join('\n')}\n` });

let WORK = '';
let INSTALLED = '';

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

test('an adapted harness copy extends a template only when it holds every template line', () => {
  const template = "// src/test-only-entry.ts\nexport const S = 'X';\n\nexport { a } from './a';\n";
  assert.equal(extendsTemplate("// src/test-only-entry.ts\nexport const S = 'X';\nexport { a } from './a';\nexport { b } from './b';\n", template), true);
  assert.equal(extendsTemplate("// src/test-only-entry.ts\nexport const S = 'Y';\nexport { a } from './a';\n", template), false, 'a changed line is not an extension');
  assert.equal(extendsTemplate("// src/test-only-entry.ts\nexport const S = 'X';\n", template), false, 'a dropped line is not an extension');
});

test('placement reads line 1 for code and YAML, the folder path for JSON', () => {
  assert.deepEqual(placementOf('x/a.ts', '// src/features/tasks/a.ts\n', {}), { path: 'src/features/tasks/a.ts' });
  assert.deepEqual(placementOf('x/a.ts', '// src/x/a.ts — what this file does\n', {}), { path: 'src/x/a.ts' });
  assert.deepEqual(placementOf('flow.yaml', '# .maestro/flows/flow.yaml\n', {}), { path: '.maestro/flows/flow.yaml' });
  assert.deepEqual(placementOf('run.sh', '#!/usr/bin/env bash\n# scripts/run.sh\n', {}), { path: 'scripts/run.sh' });
  assert.deepEqual(placementOf('contracts/screens.json', '{}', {}), { path: 'contracts/screens.json' });
  assert.deepEqual(placementOf('dot-gitignore', 'node_modules/\n', {}), { path: '.gitignore' });
  assert.deepEqual(placementOf('t/__FEATURE__.ts', '// src/features/__FEATURE__/__FEATURE__-screen.ts\n', { FEATURE: 'tasks' }), { path: 'src/features/tasks/tasks-screen.ts' });
});

test('placement rejects a missing, escaping or mismatched first-line path', () => {
  assert.match(placementOf('a.ts', "import x from 'y';\n", {}).error, /line 1 must name the repo path/);
  assert.match(placementOf('a.ts', '// ../outside/a.ts\n', {}).error, /leaves the repo/);
  assert.match(placementOf('a.ts', '// /abs/a.ts\n', {}).error, /leaves the repo/);
  assert.match(placementOf('a.ts', '// node_modules/x/a.ts\n', {}).error, /inside node_modules/);
  assert.match(placementOf('a.ts', '// src/a.tsx\n', {}).error, /template is a \.ts file/);
  assert.match(placementOf('flow.yaml', 'appId: x\n', {}).error, /"# <path>"/);
});

test('placeholders use declared values, then deterministic defaults; __DEV__ is left alone', () => {
  const filled = fillPlaceholders('__FEATURE__ __WIDGET_NAME__ __ENTITY_PASCAL__ __ENTITY_CAMEL__ __LIMIT_CONST__ __DEV__', { FEATURE: 'tasks' });
  assert.equal(filled.text, 'tasks widget-name Entity entity LIMIT __DEV__');
  assert.deepEqual(filled.defaulted.sort(), ['ENTITY_CAMEL', 'ENTITY_PASCAL', 'LIMIT_CONST', 'WIDGET_NAME']);
  assert.equal(fillPlaceholders('no placeholders here', {}).changed, false);
  assert.equal(defaultValue('APP_SLUG'), 'app-slug');
  assert.equal(defaultValue('TASK_LIST_PASCAL'), 'TaskList');
});

test('the synced harness knip.json is the canonical text plus Prettier-shaped ignoreDependencies', () => {
  const canonical = '{\n  "entry": ["src/app/**/*.{ts,tsx}"],\n  "rules": { "files": "error" }\n}\n';
  assert.equal(harnessKnipText(canonical, undefined), canonical);
  assert.equal(harnessKnipText(canonical, ['zustand']), '{\n  "entry": ["src/app/**/*.{ts,tsx}"],\n  "rules": { "files": "error" },\n  "ignoreDependencies": ["zustand"]\n}\n');
  const long = Array.from({ length: 12 }, (_, index) => `expo-module-${index}`);
  assert.match(harnessKnipText(canonical, long), /"ignoreDependencies": \[\n {4}"expo-module-0",\n/);
  assert.equal(
    harnessKnipText(canonical, { ignoreBinaries: ['plutil'], ignoreDependencies: ['zustand'], ignoreIssues: { 'vendor/**': ['exports'] } }),
    '{\n  "entry": ["src/app/**/*.{ts,tsx}"],\n  "rules": { "files": "error" },\n  "ignoreDependencies": ["zustand"],\n  "ignoreBinaries": ["plutil"],\n  "ignoreIssues": {\n    "vendor/**": ["exports"]\n  }\n}\n',
    'the harness keys keep their fixed order and Prettier layout',
  );
});

test('canonical files: root configs, root mocks and every file of the single-app trees, never a legacy placeholder path', () => {
  const root = join(WORK, 'canonical-discovery');
  writeTree(root, {
    'eslint.config.mjs': '',
    '__mocks__/expo-iap.ts': '',
    'src/core/result.ts': '',
    'src/tsconfig.json': '{}',
    'test/render-with-providers.tsx': '',
    'test/goldens/boards/__GAME_ID__-board.golden.test.ts': '',
    'scripts/quality/device-only.ts': '',
    'design/tokens.json': '{}',
    'packages/ui/src/use-is-app-active.ts': '',
  });
  const paths = canonicalFiles(root).map(({ to }) => to);
  for (const path of ['eslint.config.mjs', '.prettierrc.json', '.npmrc', '.claude/settings.json', 'contracts/contrast.json', 'contracts/dependency-policy.json', '__mocks__/expo-iap.ts', 'src/core/result.ts', 'test/render-with-providers.tsx', 'design/tokens.json', 'scripts/quality/device-only.ts']) {
    assert.ok(paths.includes(path), `canonical files lack ${path}`);
  }
  assert.equal(paths.filter((path) => path === 'src/tsconfig.json').length, 1, 'a listed root config was discovered twice');
  assert.ok(!paths.some((path) => path.includes('__GAME_ID__') || path.startsWith('packages/')), 'a placeholder template or a path outside the canonical trees is canonical');
});

test('a template message catalog adds its keys to the app catalog; anything else is replaced', () => {
  const app = '{\n  "crash.title": "Something went wrong",\n  "tasks.list.title": "My tasks"\n}\n';
  const template = '{\n  "app.name": "Tasks",\n  "tasks.list.title": "Tasks"\n}\n';
  assert.equal(mergeCatalogText(app, template), '{\n  "app.name": "Tasks",\n  "crash.title": "Something went wrong",\n  "tasks.list.title": "Tasks"\n}\n');
  assert.equal(mergeCatalogText('{ "mode": "tables", "protectedTables": [] }', template), null, 'a contract is not a catalog');
  assert.equal(mergeCatalogText(app, '{ "screens": { "tasks": "a" } }'), null, 'a nested template is not a catalog');
  assert.equal(mergeCatalogText(app, 'not json'), null);
  assert.equal(mergeCatalogText('{}', template), null, 'an empty object is not a catalog');
});

test('--only globs match paths under templates/', () => {
  assert.ok(globToRegExp('src/**/*.ts').test('src/features/tasks/a.ts'));
  assert.ok(globToRegExp('**/*.test.{ts,tsx}').test('src/a.test.tsx'));
  assert.ok(!globToRegExp('src/*.ts').test('src/features/a.ts'));
});

// ---------------------------------------------------------------------------------------------
// The tool, end to end in the harness
// ---------------------------------------------------------------------------------------------

test('a good sample skill passes every check, with its placeholders filled in', () => {
  const dir = skill('good-notes', GOOD);
  const result = verify([dir, '--keep']);
  expectPass(result, 'good');
  expectLine(result, /^verify-templates: good-notes: 5 of 5 templates copied into /, 'good');
  expectLine(result, /^verify-templates: good-notes: 2 related tests ran$/, 'good');
  expectLine(result, /^verify-templates: 5 templates checked, 0 problems$/, 'good');
  const kept = result.lines.find((line) => line.startsWith('kept: '))?.slice(6);
  assert.ok(kept && existsSync(kept), 'good: --keep printed no existing folder');
  try {
    assert.match(readFileSync(join(kept, 'src/features/notes/note-title.ts'), 'utf8'), /export type Note = /);
    assert.ok(existsSync(join(kept, '.maestro/flows/notes-smoke.yaml')), 'good: YAML template not placed by its first line');
    assert.ok(existsSync(join(kept, 'contracts/notes.json')), 'good: JSON template not placed by its folder path');
  } finally {
    rmSync(kept, { recursive: true, force: true });
  }
});

test('a type error fails [tsc] at the template line', () => {
  const dir = skill('bad-tsc', ONE_FILE('src/features/bad/bad-types.ts', ['// src/features/bad/bad-types.ts', '', "export const count: number = 'three';"]));
  const result = verify([dir, ...FAST]);
  expectFail(result, 'tsc');
  expectLine(result, /^FAIL bad-tsc\/templates\/src\/features\/bad\/bad-types\.ts:3 \[tsc\] src\/features\/bad\/bad-types\.ts: TS2322 .* Fix: /, 'tsc');
});

test('a lint error fails [eslint] with the rule id', () => {
  const dir = skill('bad-eslint', ONE_FILE('src/features/bad/bad-export.ts', ['// src/features/bad/bad-export.ts', '', 'const answer = 42;', '', 'export default answer;']));
  const result = verify([dir, '--no-jest', '--no-prettier']);
  expectFail(result, 'eslint');
  expectLine(result, /^FAIL bad-eslint\/templates\/src\/features\/bad\/bad-export\.ts:5 \[eslint\] src\/features\/bad\/bad-export\.ts: import\/no-default-export /, 'eslint');
});

test('a failing test fails [jest] with the test name', () => {
  const dir = skill('bad-jest', {
    ...ONE_FILE('src/features/bad/sum.ts', ['// src/features/bad/sum.ts', '', 'export function sum(first: number, second: number): number {', '  return first - second;', '}']),
    ...ONE_FILE('src/features/bad/sum.test.ts', ['// src/features/bad/sum.test.ts', "import { sum } from './sum';", '', "describe('sum', () => {", "  it('adds two numbers', () => {", '    expect(sum(2, 3)).toBe(5);', '  });', '});']),
  });
  const result = verify([dir, '--no-lint', '--no-prettier']);
  expectFail(result, 'jest');
  expectLine(result, /^FAIL bad-jest\/templates\/src\/features\/bad\/sum\.test\.ts \[jest\] src\/features\/bad\/sum\.test\.ts: "sum adds two numbers" failed: /, 'jest');
});

test('a template without its first-line path fails [placement]; the others still run', () => {
  const dir = skill('bad-placement', {
    ...ONE_FILE('src/features/bad/no-path.ts', ['export const value = 1;']),
    ...ONE_FILE('src/features/bad/twin-a.ts', ['// src/features/bad/twin.ts', 'export const twin = 1;']),
    ...ONE_FILE('src/features/bad/twin-b.ts', ['// src/features/bad/twin.ts', 'export const twin = 2;']),
  });
  const result = verify([dir, ...FAST]);
  expectFail(result, 'placement');
  expectLine(result, /^FAIL bad-placement\/templates\/src\/features\/bad\/no-path\.ts:1 \[placement\] line 1 must name the repo path as "\/\/ <path>"/, 'placement');
  expectLine(result, /^FAIL bad-placement\/templates\/src\/features\/bad\/twin-b\.ts:1 \[placement\] names src\/features\/bad\/twin\.ts, which bad-placement\/templates\/src\/features\/bad\/twin-a\.ts names too/, 'placement');
  expectLine(result, /^verify-templates: bad-placement: 1 of 3 templates copied/, 'placement');
});

test('an unformatted template fails [prettier]', () => {
  const dir = skill('bad-prettier', ONE_FILE('src/features/bad/quotes.ts', ['// src/features/bad/quotes.ts', '', 'export const greeting = "hello"']));
  const result = verify([dir, '--no-jest', '--no-lint']);
  expectFail(result, 'prettier');
  expectLine(result, /^FAIL bad-prettier\/templates\/src\/features\/bad\/quotes\.ts \[prettier\] src\/features\/bad\/quotes\.ts: not formatted/, 'prettier');
});

test('an undeclared placeholder gets a default and a WARN line', () => {
  const dir = skill('warn-placeholder', ONE_FILE('src/features/__WIDGET_NAME__/widget-label.ts', ['// src/features/__WIDGET_NAME__/widget-label.ts', '', "export const WIDGET_LABEL = '__WIDGET_NAME__';"]));
  const result = verify([dir, ...FAST]);
  expectPass(result, 'placeholder');
  expectLine(result, /^WARN warn-placeholder\/templates\/src\/features\/__WIDGET_NAME__\/widget-label\.ts placeholder __WIDGET_NAME__ has no value in assets\/template-placeholders\.json; used "widget-name"$/, 'placeholder');
});

test('a skill without templates is NOT APPLICABLE', () => {
  const dir = skill('no-templates', { 'references/notes.md': '# Notes\n' });
  const result = verify([dir]);
  expectPass(result, 'not applicable');
  expectLine(result, /^NOT APPLICABLE: no-templates has no templates\/ folder$/, 'not applicable');
});

test('an --only glob that matches no template is bad input (exit 2)', () => {
  const result = verify([join(WORK, 'good-notes'), '--only', 'nothing/**', ...FAST]);
  assert.equal(result.status, 2, result.output);
  expectLine(result, /^ERROR \[bad-input\] no template of good-notes matches --only nothing\/\*\* Fix: /, 'only');
});

test('no installed harness is bad input (exit 2) with the install fix', () => {
  const empty = join(WORK, 'empty-harness');
  mkdirSync(empty, { recursive: true });
  const result = verify([join(WORK, 'good-notes'), '--harness', empty]);
  assert.equal(result.status, 2, result.output);
  expectLine(result, /^ERROR \[bad-input\] --harness .*empty-harness has no installed node_modules Fix: Install the harness once: npm ci --prefix /, 'no harness');
});

test('harness drift fails [harness-drift]; --sync-harness fixes it and keeps knip ignoreDependencies', () => {
  const copy = join(WORK, 'drifted-harness');
  cpSync(HARNESS_SOURCE, copy, { recursive: true, filter: (path) => !path.includes('/node_modules') });
  appendFileSync(join(copy, 'eslint.config.mjs'), '// drift\n');
  const knipPath = join(copy, 'knip.json');
  const knip = JSON.parse(readFileSync(knipPath, 'utf8'));
  const ignored = knip.ignoreDependencies;
  knip.rules.exports = 'warn';
  writeFileSync(knipPath, `${JSON.stringify(knip, null, 2)}\n`);
  const drifted = verify(['--harness-source', copy]);
  expectFail(drifted, 'drift');
  expectLine(drifted, /\[harness-drift\] differs from the canonical tools\/shared\/repo-templates\/eslint\.config\.mjs Fix: Run: node tools\/verify-templates\.mjs --sync-harness/, 'drift');
  expectLine(drifted, /drifted-harness\/knip\.json \[harness-drift\]/, 'drift');
  const synced = verify(['--harness-source', copy, '--sync-harness']);
  expectPass(synced, 'sync');
  expectLine(synced, /^sync  .*drifted-harness\/eslint\.config\.mjs$/, 'sync');
  assert.deepEqual(JSON.parse(readFileSync(knipPath, 'utf8')).ignoreDependencies, ignored, 'sync dropped the harness knip ignoreDependencies');
  assert.equal(readFileSync(knipPath, 'utf8'), readFileSync(join(HARNESS_SOURCE, 'knip.json'), 'utf8'), 'synced knip.json differs from the committed harness copy');
  expectPass(verify(['--harness-source', copy]), 'after sync');
});

/**
 * A drift-only harness copy (no node_modules) whose adopted.json is `manifest` (plus the committed manifest's
 * "$scripts", which the harness package.json needs), and a skills root with one sample skill.
 */
function adoptedFixture(name, manifest) {
  const copy = join(WORK, `${name}-harness`);
  cpSync(HARNESS_SOURCE, copy, { recursive: true, filter: (path) => !path.includes('/node_modules') });
  const committed = JSON.parse(readFileSync(join(HARNESS_SOURCE, 'adopted.json'), 'utf8'));
  manifest = { $scripts: committed.$scripts, ...manifest };
  const skillsRoot = join(WORK, `${name}-skills`);
  writeTree(join(skillsRoot, 'notes-kit'), {
    'assets/template-placeholders.json': GOOD['assets/template-placeholders.json'],
    'templates/src/features/__FEATURE__/note-title.ts': GOOD['templates/src/features/__FEATURE__/note-title.ts'],
    'templates/contracts/notes.json': GOOD['templates/contracts/notes.json'],
  });
  const filled = fillPlaceholders(GOOD['templates/src/features/__FEATURE__/note-title.ts'], { FEATURE: 'notes', ENTITY_PASCAL: 'Note' }).text;
  writeTree(copy, { 'src/features/notes/note-title.ts': filled, 'contracts/notes.json': '{\n  "screen": "notes",\n  "testIDs": []\n}\n', 'adopted.json': `${JSON.stringify(manifest, null, 2)}\n` });
  const args = ['--harness-source', copy, '--skills-root', skillsRoot];
  return { copy, skillsRoot, filled, args };
}

const TITLE_TEMPLATE = 'notes-kit/templates/src/features/__FEATURE__/note-title.ts';
const NOTES_ADAPTED = { template: 'notes-kit/templates/contracts/notes.json', adapted: 'holds this app facts: no testID yet' };

test('adopted copies: a stale copy fails [harness-adopted]; --sync-harness refreshes it and leaves an adapted copy alone', () => {
  const { copy, skillsRoot, args } = adoptedFixture('adopted', { 'src/features/notes/note-title.ts': TITLE_TEMPLATE, 'contracts/notes.json': NOTES_ADAPTED });
  expectPass(verify(args), 'adopted copies in sync');
  const templatePath = join(skillsRoot, 'notes-kit', 'templates', 'src', 'features', '__FEATURE__', 'note-title.ts');
  appendFileSync(templatePath, '\n/** The longest title the list shows. */\nexport const MAX_TITLE = 40;\n');
  const stale = verify(args);
  expectFail(stale, 'stale adopted copy');
  expectLine(stale, /adopted-harness\/src\/features\/notes\/note-title\.ts \[harness-adopted\] differs from its skill template notes-kit\/templates\/src\/features\/__FEATURE__\/note-title\.ts \(stale adopted copy\) Fix: Run: node tools\/verify-templates\.mjs --sync-harness/, 'stale adopted copy');
  const notesBefore = readFileSync(join(copy, 'contracts', 'notes.json'), 'utf8');
  const synced = verify([...args, '--sync-harness']);
  expectPass(synced, 'adopted sync');
  expectLine(synced, /^sync  .*adopted-harness\/src\/features\/notes\/note-title\.ts \(adopted from notes-kit\/templates\/src\/features\/__FEATURE__\/note-title\.ts\)$/, 'adopted sync');
  assert.match(readFileSync(join(copy, 'src', 'features', 'notes', 'note-title.ts'), 'utf8'), /export const MAX_TITLE = 40;\n$/, 'sync did not refresh the adopted copy');
  assert.equal(readFileSync(join(copy, 'contracts', 'notes.json'), 'utf8'), notesBefore, 'sync touched an adapted copy');
});

test('the adopted manifest: a gone template, a key off the placement path, an adapted copy equal to its template, a canonical path, a bad shape', () => {
  const { copy, args } = adoptedFixture('manifest', {
    'src/gone.ts': 'notes-kit/templates/src/gone.ts',
    'src/wrong-place.ts': TITLE_TEMPLATE,
    'src/features/notes/note-title.ts': { template: TITLE_TEMPLATE, adapted: 'claims a change it does not have' },
    'eslint.config.mjs': 'notes-kit/templates/eslint.config.mjs',
    'contracts/notes.json': { template: 'notes-kit/templates/contracts/notes.json', adapted: 'short' },
  });
  writeTree(copy, { 'src/wrong-place.ts': '' });
  const result = verify(args);
  expectFail(result, 'manifest');
  expectLine(result, /manifest-harness\/adopted\.json \[harness-adopted\] "src\/gone\.ts": its template notes-kit\/templates\/src\/gone\.ts no longer exists/, 'gone template');
  expectLine(result, /\[harness-adopted\] "src\/wrong-place\.ts": notes-kit\/templates\/src\/features\/__FEATURE__\/note-title\.ts lands at src\/features\/notes\/note-title\.ts, not at the key/, 'wrong key');
  expectLine(result, /\[harness-adopted\] "src\/features\/notes\/note-title\.ts" is marked adapted .* but equals notes-kit\/templates/, 'adapted but equal');
  expectLine(result, /\[harness-adopted\] "eslint\.config\.mjs" is a canonical file/, 'canonical path');
  expectLine(result, /\[harness-adopted\] entry "contracts\/notes\.json": "adapted" must say why/, 'bad shape');
});

test('a harness npm script package-scripts.json lacks fails [harness-drift] unless adopted.json "$scripts" names it', () => {
  const { copy, args } = adoptedFixture('scripts', { 'src/features/notes/note-title.ts': TITLE_TEMPLATE });
  const packagePath = join(copy, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  pkg.scripts['notes:export'] = 'node scripts/notes/export.ts';
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  const unlisted = verify(args);
  expectFail(unlisted, 'unlisted script');
  expectLine(unlisted, /scripts-harness\/package\.json \[harness-drift\] script "notes:export" is not the canonical null/, 'unlisted script');
  const manifestPath = join(copy, 'adopted.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.$scripts = { ...manifest.$scripts, 'notes:export': 'notes-kit: exports the notes; not canonical yet', 'notes:gone': 'notes-kit: a script the harness dropped' };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const listed = verify(args);
  expectFail(listed, 'stale $scripts entry');
  assert.ok(!listed.lines.some((line) => line.includes('"notes:export" is not the canonical')), `a "$scripts" entry did not allow its script\n${listed.output.slice(-2000)}`);
  expectLine(listed, /\[harness-adopted\] "\$scripts"\."notes:gone" names a script tools\/harness\/package\.json does not have/, 'stale $scripts entry');
});

test('an installed harness from another lockfile fails [harness-stale]', () => {
  const copy = join(WORK, 'stale-harness');
  cpSync(HARNESS_SOURCE, copy, { recursive: true, filter: (path) => !path.includes('/node_modules') });
  appendFileSync(join(copy, 'package-lock.json'), '\n');
  const result = verify([join(WORK, 'good-notes'), '--harness-source', copy, '--harness', INSTALLED, '--only', 'contracts/*.json', ...FAST]);
  expectFail(result, 'stale');
  expectLine(result, /\[harness-stale\] the installed harness was installed from a different package-lock\.json/, 'stale');
});

// ---------------------------------------------------------------------------------------------

function installedHarness() {
  const ok = (dir) => existsSync(join(dir, 'node_modules', 'typescript', 'package.json'));
  if (ok(HARNESS_SOURCE)) return HARNESS_SOURCE;
  const fromEnv = process.env[HARNESS_ENV];
  if (fromEnv && ok(fromEnv)) return fromEnv;
  return null;
}

run(async () => {
  parseArgs(process.argv.slice(2), {
    name: 'verify-templates.selftest',
    summary: 'Self-test of tools/verify-templates.mjs: generated good and planted-bad sample skills run through the reference Expo app. Needs an installed harness (tools/harness with node_modules, or $RN_SKILLS_HARNESS).',
    usage: '',
    positionals: { min: 0, max: 0 },
  });
  INSTALLED = installedHarness();
  if (INSTALLED === null) {
    console.log(`ERROR [bad-input] no installed harness: tools/harness has no node_modules and $${HARNESS_ENV} is not set Fix: npm ci --prefix tools/harness (or set ${HARNESS_ENV} to an installed copy)`);
    console.log('RESULT: FAIL (1 problems)');
    return 2;
  }
  WORK = mkdtempSync(join(tmpdir(), 'verify-templates-selftest-'));
  const report = createReporter({ name: 'verify-templates selftest' });
  try {
    for (const { name, fn } of tests) {
      const started = Date.now();
      try {
        await fn();
        console.log(`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      } catch (error) {
        report.problem({ file: 'tools/tests/verify-templates.selftest.mjs', rule: 'verify-templates-test', message: `${name}: ${error.message}`, fix: 'Fix verify-templates.mjs (or the case), then rerun.' });
      }
    }
  } finally {
    rmSync(WORK, { recursive: true, force: true });
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
