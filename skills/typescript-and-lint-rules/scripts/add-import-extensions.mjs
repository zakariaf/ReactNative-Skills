#!/usr/bin/env node
// add-import-extensions.mjs: rewrites every extensionless relative, alias (@/) and workspace import of
// the app repo's .ts/.tsx files to the file it resolves to (./x -> ./x.ts, @/ui/app-text ->
// @/ui/app-text.tsx, @acme/shared/core/result -> @acme/shared/core/result.ts), the form a workspace
// repo's canonical lint requires (IS_MULTI_PACKAGE). The skills' templates are written in the
// single-app, extensionless style; run this after copying them into a workspace repo.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/add-import-extensions.mjs [repo-root] [options]

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, matchGlob, parseArgs, requireDir, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { importsOf, resolveImport, scanSource } from './lib/source-scan.mjs';

const SPEC = {
  name: 'add-import-extensions',
  summary:
    'Rewrites each extensionless relative, @/ alias and workspace-package import in the repo\'s .ts/.tsx files to ' +
    'the file it resolves to (.ts, .tsx, .json or an index file), as a workspace repo\'s canonical ESLint config ' +
    '(IS_MULTI_PACKAGE, PACKAGE_IMPORT_EXTENSION) and check-source --import-extensions all require. Idempotent; ' +
    're-reads every file it wrote and fails if an extensionless local import is left.',
  usage: '[repo-root] [options]',
  options: {
    path: { type: 'string', multiple: true, value: 'rel', help: 'Only files under this repo-relative folder or this file (repeatable; default: the whole repo)' },
    check: { type: 'boolean', help: 'Write nothing: report each import that needs its extension (exit 1 when any does)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (each refused import stays as written and is a problem):',
    '  import-extension   (--check only) a local import without its extension; the fix is this script without --check',
    '  platform-import    the import resolves to platform files (x.ios.ts, x.android.ts), with or without a plain x.ts:',
    '                     an explicit extension would skip the platform files Metro picks, so it is left for a person',
    '  unresolved-import  the import names no file (a typo, a template copied without its sibling)',
    '',
    'Prints one "rewrote <file>:<line> <old> -> <new>" line per rewrite. Imports that name a package outside the',
    'repo, already carry an extension, or are require() calls are left alone. Aliases come from the tsconfig.json of',
    'the workspace the file lies in (else the root one); workspace package names from package.json "workspaces".',
    'Scans the repo the way check-source does (installed skills, generated and native folders left out).',
    'Example: node add-import-extensions.mjs . --path apps/mobile/src/features/tasks   (after copying a template)',
  ].join('\n'),
};

const HAS_EXTENSION = /\.(ts|tsx|json|js|jsx|mjs|cjs)$/;
const PLATFORMS = ['ios', 'android', 'native', 'web'];
const PLATFORM_SUFFIX = new RegExp(`^(?:/index)?\\.(?:${PLATFORMS.join('|')})\\.(?:ts|tsx|js|jsx)$`);
const EXTRA_IGNORES = ['expo-env.d.ts', 'reports/**', 'dist-audit/**', '.stryker-tmp/**'];

/** The aliases for a file: its workspace's tsconfig paths, else the root ones. */
function aliasesFor(rel, layout) {
  const workspace = layout.workspaces.filter((entry) => rel.startsWith(`${entry.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
  return workspace && workspace.layout.aliases.length > 0 ? workspace.layout.aliases : layout.aliases;
}

/** What the import needs: { kind: 'skip' } | { kind: 'rewrite', to } | { kind: 'platform', path } | { kind: 'unresolved' }. */
function planImport(rel, spec, { root, aliases }) {
  if (HAS_EXTENSION.test(spec)) return { kind: 'skip' };
  const resolved = resolveImport(rel, spec, { root, aliases });
  if (resolved.kind !== 'local') return { kind: 'skip' };
  if (!resolved.exists) return { kind: 'unresolved' };
  const last = spec.split('/').pop();
  const path = resolved.path;
  const at = path.lastIndexOf(`/${last}`) === -1 && path.startsWith(last) ? 0 : path.lastIndexOf(`/${last}`) + 1;
  const suffix = path.slice(at + last.length);
  if (PLATFORM_SUFFIX.test(suffix)) return { kind: 'platform', path };
  if (!/^(?:\/index)?\.(?:ts|tsx|json|js|jsx|mjs|cjs)$/.test(suffix)) return { kind: 'unresolved' };
  // A plain file next to platform files (x.ts beside x.ios.ts): Metro picks the platform file only
  // for the extensionless import.
  const stem = path.slice(0, path.length - suffix.length + (suffix.startsWith('/index') ? '/index'.length : 0));
  const platformFile = PLATFORMS.flatMap((platform) => ['ts', 'tsx'].map((ext) => `${stem}.${platform}.${ext}`)).find((file) => existsSync(join(root, file)));
  if (platformFile !== undefined) return { kind: 'platform', path: platformFile };
  return { kind: 'rewrite', to: `${spec}${suffix}` };
}

/** The repo files to visit: every .ts/.tsx, or those under the --path entries. */
function targetFiles(root, paths) {
  const files = walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: EXTRA_IGNORES });
  if (paths.length === 0) return files;
  const wanted = paths.map((entry) => {
    const rel = posix.normalize(toPosix(entry)).replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (!existsSync(join(root, rel))) fail(`--path ${entry} does not exist under the repo root`, 'Pass a repo-relative folder or file, for example --path apps/mobile/src/features/tasks.');
    return { rel, folder: statSync(join(root, rel)).isDirectory() };
  });
  return files.filter((file) => wanted.some(({ rel, folder }) => (folder ? rel === '.' || file.startsWith(`${rel}/`) || matchGlob(file, `${rel}/**`) : file === rel)));
}

/** Plans and (unless check) applies one file's rewrites; returns the number of local imports still extensionless. */
function fixFile(rel, context, report) {
  const { root, layout, check } = context;
  const text = readFileSync(join(root, rel), 'utf8');
  const aliases = aliasesFor(rel, layout);
  const edits = [];
  for (const entry of importsOf(scanSource(text))) {
    if (entry.form === 'require') continue;
    const plan = planImport(rel, entry.spec, { root, aliases });
    const at = { file: rel, line: entry.line };
    if (plan.kind === 'platform') report.problem({ ...at, rule: 'platform-import', message: `"${entry.spec}" resolves to the platform file ${plan.path}; an explicit extension would skip the platform files Metro picks`, fix: 'Leave it for a person: import a platform-neutral module (a plain x.ts that re-exports per platform through Platform.select), or keep the platform files out of the workspace package.' });
    else if (plan.kind === 'unresolved') report.problem({ ...at, rule: 'unresolved-import', message: `"${entry.spec}" resolves to no file`, fix: 'Fix the path, or copy the template it names (a template imports only templates of its own skill or of a named prerequisite).' });
    else if (plan.kind === 'rewrite') {
      if (check) report.problem({ ...at, rule: 'import-extension', message: `"${entry.spec}" has no file extension (it resolves to "${plan.to}")`, fix: 'Run this script without --check to write the extensions.' });
      else edits.push({ index: entry.index, spec: entry.spec, to: plan.to, line: entry.line });
    }
  }
  if (edits.length === 0) return 0;
  let out = text;
  // The index is the opening quote; rewrite from the end so earlier indexes stay valid.
  for (const edit of [...edits].sort((a, b) => b.index - a.index)) {
    out = `${out.slice(0, edit.index + 1)}${edit.to}${out.slice(edit.index + 1 + edit.spec.length)}`;
  }
  writeFileSync(join(root, rel), out);
  for (const edit of edits) process.stdout.write(`rewrote ${rel}:${edit.line} ${edit.spec} -> ${edit.to}\n`);
  context.rewritten += edits.length;
  // Re-read what was written: every rewrite must now resolve as written.
  const after = importsOf(scanSource(readFileSync(join(root, rel), 'utf8')));
  return after.filter((entry) => entry.form !== 'require' && planImport(rel, entry.spec, { root, aliases }).kind === 'rewrite').length;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root);
  const files = targetFiles(root, options.path);
  if (files.length === 0) fail(`no .ts or .tsx files under ${options.path.length > 0 ? options.path.join(', ') : root}`, 'Run it from the app repo root, after copying the templates (or pass --path to the folder that holds them).');
  const report = createReporter({ name: 'add-import-extensions', json: options.json });
  const context = { root, layout, check: options.check, rewritten: 0 };
  for (const rel of files) {
    const left = fixFile(rel, context, report);
    if (left > 0) report.problem({ file: rel, line: 1, rule: 'import-extension', message: `${left} local import(s) still lack an extension after the rewrite`, fix: 'Report this: the rewrite should leave none.' });
  }
  if (!options.check) process.stdout.write(`add-import-extensions: ${context.rewritten} import(s) rewritten\n`);
  return report.finish({ checked: files.length, unit: 'TypeScript files' });
});
