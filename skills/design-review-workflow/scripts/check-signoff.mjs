#!/usr/bin/env node
// check-signoff.mjs: the release gate of the design review. A release of version X ships only when the
// newest review of X is SIGNED OFF, its record holds up (findings, on-device pass, one fix round,
// sign-off), the plan and the screen contract are unchanged since, and no app code, asset or config
// that changes what people see moved between the signed commit and the release commit. Reads only
// committed files (the record, not the captures), so it runs in CI. A ship gate: it never skips.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-signoff.mjs [repo-root] [--version <x.y.z>] [--commit <sha>]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, parseArgs, resolveLayout, run, sha256, toPosix, UsageError } from './check-lib.mjs';
import { appFacts, globToRegExp, jsonLine, loadPlan, planShapeProblems, sweptScreens } from './lib/review-plan.mjs';
import { buildProblems, checkDevicePass, checkFindings, checkFixRound, checkSignoff, loadReview, recordShapeProblems, reviewIds } from './lib/review-record.mjs';

const SPEC = {
  name: 'check-signoff',
  summary: 'Release gate: the newest design review of this version is SIGNED OFF, still matches the plan and the screens, and nothing people see changed after the signed commit.',
  usage: '[repo-root] [options]',
  options: {
    version: { type: 'string', value: 'x.y.z', help: 'The version being released (default: "version" of the app config)' },
    commit: { type: 'string', value: 'sha', help: 'The release commit (default: HEAD)' },
    'changed-from': { type: 'string', value: 'file', help: 'The changes since the signed commit, for CI clones without that history: `git diff -U0 <signed>..<release>` output (build-number bumps pass), or one path per line' },
    plan: { type: 'string', value: 'file', help: 'The plan file (default: <contractsDir>/design-review.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: signoff-missing, signoff-stale, signoff-ui-changed, and the record rules review-record, review-findings,',
    'review-floor, review-device-pass, review-fix-round, review-signoff. No SKIP and no NOT APPLICABLE: a ship gate.',
    'Watched paths: src/, assets/, the root entry index.*, app.config.*, app.json, every file app.config.* imports by a',
    'relative path, package.json and the lockfiles, babel.config.*, metro.config.*, eas.json, plugins/, patches/, .env*',
    '(not *.example); test files, snapshots and __mocks__ excluded. The plan\'s optional "signoff": { "watch": [globs],',
    '"ignore": [globs] } extends or narrows the list. An app config whose only changed lines are build counters',
    '(const IOS_BUILD_NUMBER / ANDROID_VERSION_CODE = <n>; a literal buildNumber or versionCode) counts as unchanged;',
    '--changed-from then needs the git diff -U0 output (a name list counts every app config change).',
    'Exit 2 when the plan, the app config or the git history (or --changed-from) is missing.',
  ].join('\n'),
};

/**
 * Paths whose change after the signed commit can change what people see: the app code and assets, the
 * entry that loads before the router (polyfills), the app config, the dependency set (a lockfile-only
 * bump is how transitive updates land), the build transforms (React Compiler, Reanimated), the build
 * profiles and their EXPO_PUBLIC_* values, local config plugins, patched packages and env files.
 */
const WATCHED = [
  /^src\//,
  /^assets\//,
  /^index\.[cm]?[jt]sx?$/,
  /^app\.config\.[cm]?[jt]s$/,
  /^app\.json$/,
  /^package\.json$/,
  /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /^babel\.config\.[cm]?[jt]s$/,
  /^metro\.config\.[cm]?[jt]s$/,
  /^eas\.json$/,
  /^plugins\//,
  /^patches\//,
  /^\.env(\.[^/]+)?$/,
];
const NOT_UI = [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)__tests__\//, /(^|\/)__snapshots__\//, /\.snap$/, /(^|\/)__mocks__\//, /^\.env(\.[^/]+)?\.example$/];

/**
 * The user-facing test: the built-in list, the files the app config imports and the plan's
 * signoff.watch, minus its signoff.ignore.
 */
function uiPathTest(plan, imports) {
  const watch = (plan.signoff?.watch ?? []).map(globToRegExp);
  const ignore = (plan.signoff?.ignore ?? []).map(globToRegExp);
  return (path) => {
    if (ignore.some((re) => re.test(path)) || NOT_UI.some((re) => re.test(path))) return false;
    return WATCHED.some((re) => re.test(path)) || imports.has(path) || watch.some((re) => re.test(path));
  };
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { error: result.error.message };
  if (result.status !== 0) return { error: (result.stderr || '').trim() || `git ${args.join(' ')} failed` };
  return { out: result.stdout };
}

/** The app config files: a change there is user-facing unless every changed line is a build counter. */
const CONFIG_FILE = /^(app\.config\.[cm]?[jt]s|app\.json)$/;
/**
 * Lines a release lane bumps before every store build, which change no pixel: the local lanes' counters
 * (ios-release-testflight's `const IOS_BUILD_NUMBER = <n>;`, android-release-play's
 * `const ANDROID_VERSION_CODE = <n>;`, an older shared `const BUILD_NUMBER = <n>;`) and a literal
 * `buildNumber` / `versionCode` value in app.config.* or app.json.
 */
const COUNTER_LINES = [
  /^\s*(?:export\s+)?const\s+(?:IOS_BUILD_NUMBER|ANDROID_VERSION_CODE|BUILD_NUMBER)(?:\s*:\s*number)?\s*=\s*\d+\s*;?\s*$/,
  /^\s*(?:buildNumber|"buildNumber")\s*:\s*(['"])\d+(?:\.\d+){0,2}\1\s*,?\s*$/,
  /^\s*(?:versionCode|"versionCode")\s*:\s*\d+\s*,?\s*$/,
];
const isCounterLine = (line) => COUNTER_LINES.some((re) => re.test(line));

const stripDiffPath = (raw) => raw.trim().replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');

/**
 * A unified diff (`git diff -U0 <signed>..<release>`) as Map<path, { changed: string[], binary }>:
 * every added ("+...") or removed ("-...") line of each file, read only inside its hunks (so a removed line starting
 * with "--" is never taken for a header). A rename lists both paths.
 */
function parseUnifiedDiff(text) {
  const files = new Map();
  let current = null;
  let inHunk = false;
  const open = (paths) => {
    current = { changed: [], binary: false };
    for (const path of paths) if (path && path !== '/dev/null') files.set(path, current);
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length);
      const half = (rest.length - 1) / 2;
      const same = Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3);
      open(same ? [stripDiffPath(rest.slice(0, half))] : rest.split(' b/').length === 2 ? [stripDiffPath(rest.split(' b/')[0]), rest.split(' b/')[1]] : []);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (!inHunk) {
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        const path = stripDiffPath(line.slice(4));
        if (path !== '/dev/null' && !files.has(path)) files.set(path, current);
      } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) current.binary = true;
      else if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+') || line.startsWith('-')) current.changed.push(line);
  }
  return files;
}

/** Why an app config change is user-facing, or null when only build counters moved. */
function configChangeReason(entry) {
  if (!entry) return 'a name list cannot show which lines changed (pass the git diff -U0 output to --changed-from to let build-number bumps through)';
  if (entry.binary || entry.changed.length === 0) return 'the file changed, but not line by line';
  const real = (line) => !isCounterLine(line.slice(1)) && line.slice(1).trim() !== '';
  const other = (entry.changed.find((line) => line.startsWith('+') && real(line)) ?? entry.changed.find(real))?.slice(1);
  return other === undefined ? null : `a line other than a build counter changed: \`${other.trim().slice(0, 80)}\``;
}

/**
 * The paths changed since the signed commit, and for each app config file the changed lines (null when
 * only a name list is known). `--changed-from` takes either a name list or the -U0 diff.
 */
function changedPaths(root, options, signedCommit) {
  if (options['changed-from']) {
    const abs = join(root, options['changed-from']);
    if (!existsSync(abs)) throw new UsageError(`--changed-from ${options['changed-from']} not found`, 'Write the changes since the signed commit into that file first: git diff -U0 <signed>..<release> (or git diff --name-only, which counts every app config change).');
    const text = readFileSync(abs, 'utf8');
    if (/^diff --git /m.test(text)) {
      const diff = parseUnifiedDiff(text);
      return { paths: [...diff.keys()], diff, how: options['changed-from'] };
    }
    return { paths: text.split('\n').map((l) => l.trim()).filter(Boolean), diff: null, how: options['changed-from'] };
  }
  const release = options.commit ?? 'HEAD';
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.error) throw new UsageError('not a git repository, so the changes since the signed commit cannot be listed', 'Run in the app repository, or pass --changed-from <file> with the changes (git diff -U0 <signed>..<release>).');
  const names = git(root, ['diff', '--name-only', `${signedCommit}..${release}`]);
  if (names.error) throw new UsageError(`cannot compare the signed commit ${signedCommit} with ${release}: ${names.error}`, 'Fetch the full history (a shallow CI clone lacks the signed commit: fetch-depth 0), or pass --changed-from <file>.');
  const paths = names.out.split('\n').map((l) => l.trim()).filter(Boolean);
  const configs = paths.filter((p) => CONFIG_FILE.test(p));
  let diff = new Map();
  if (configs.length > 0) {
    const hunks = git(root, ['diff', '-U0', '--no-color', `${signedCommit}..${release}`, '--', ...configs]);
    diff = hunks.error ? null : parseUnifiedDiff(hunks.out);
  }
  return { paths, diff, how: `git diff ${signedCommit.slice(0, 12)}..${release}` };
}

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

/**
 * Every repo file the app config imports by a relative path, followed through the files it imports
 * (read from the working tree, the release commit). They set what the config sets: the app name per
 * language, permission texts, the plugin options; scripts/i18n/ is the usual example.
 */
function configImports(root) {
  const found = new Set();
  const queue = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'].filter((f) => existsSync(join(root, f)));
  const seen = new Set(queue);
  while (queue.length > 0 && seen.size < 500) {
    const file = queue.shift();
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const target = posix.normalize(posix.join(posix.dirname(file), match[1]));
      if (target.startsWith('..') || target.startsWith('/')) continue;
      const candidates = [target, ...RESOLVE_EXTS.map((ext) => `${target}${ext}`), ...RESOLVE_EXTS.map((ext) => `${target}/index${ext}`)];
      const hit = candidates.find((c) => existsSync(join(root, c)) && statSync(join(root, c)).isFile());
      if (!hit || seen.has(hit)) continue;
      seen.add(hit);
      found.add(hit);
      if (CODE_FILE.test(hit)) queue.push(hit);
    }
  }
  return found;
}

function newestReviewOf(root, loaded, version) {
  const ids = reviewIds(root, loaded.reviewsDir).reverse();
  for (const id of ids) {
    try {
      const review = loadReview(root, loaded, id);
      if (review.record?.build?.appVersion === version) return review;
    } catch {
      // an unreadable record of another version does not block this one; check-review reports it
    }
  }
  return null;
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const layout = resolveLayout(root);
  const loaded = loadPlan(root, layout, options.plan);
  if (planShapeProblems(loaded).length > 0) throw new UsageError(`${loaded.rel} is not a valid plan`, 'Run check-review-plan.mjs and fix it first.');
  const facts = appFacts(root);
  const version = options.version ?? facts?.version;
  if (!version) {
    const computed = facts?.computed.includes('version');
    throw new UsageError(
      computed ? `no version to release: "version" in ${facts.file} is computed, not a literal or a const of one` : 'no version to release: pass --version or set "version" in the app config',
      computed ? 'Keep it literal (version: APP_VERSION with const APP_VERSION = \'1.2.0\'; works), or pass --version.' : 'The gate needs the version the store build carries.',
    );
  }
  const report = createReporter({ name: 'check-signoff', json: options.json });
  const review = newestReviewOf(root, loaded, version);
  if (!review) {
    report.problem({ file: toPosix(loaded.reviewsDir), rule: 'signoff-missing', message: `no design review of version ${version}`, fix: 'Run the end-of-build review on this version (new-review.mjs, then the sweep, the device pass, the fix round, the sign-off).' });
    return report.finish({ checked: 0, unit: 'reviews' });
  }
  const shape = recordShapeProblems(review);
  for (const problem of shape) report.problem(problem);
  if (shape.length > 0) return report.finish({ checked: 1, unit: 'reviews' });
  const { plan } = loaded;
  buildProblems(review, plan, report);
  checkFindings(review, plan, report);
  checkDevicePass(review, plan, report);
  checkFixRound(review, report);
  const signoff = checkSignoff(review, report, { requireSignoff: true });
  const { record, rel, text } = review;
  if (signoff && signoff.verdict !== 'SIGNED OFF') {
    report.problem({ file: rel, line: jsonLine(text, '"verdict"'), rule: 'signoff-missing', message: `the newest review of ${version} (${review.id}) is ${signoff.verdict}`, fix: 'Resolve the escalation, then run a new review of the fixed build; never ship on a NOT SIGNED OFF record.' });
  }
  if (record.plan.sha256 !== loaded.sha256) {
    report.problem({ file: rel, line: jsonLine(text, '"plan"'), rule: 'signoff-stale', message: `${loaded.rel} changed after the review (${review.id})`, fix: 'The sweep no longer covers what the plan asks; review again (new-review.mjs --refresh drops the sign-off).' });
  }
  const swept = sweptScreens(root, loaded);
  const screensSha = swept.sha256 ?? (existsSync(join(root, loaded.screensContract)) ? sha256(readFileSync(join(root, loaded.screensContract), 'utf8')) : null);
  if (record.screens.sha256 !== screensSha) {
    report.problem({ file: rel, line: jsonLine(text, '"screens"'), rule: 'signoff-stale', message: `${loaded.screensContract} changed after the review (${review.id})`, fix: 'A screen, state or element changed after the sign-off: review the changed screens again.' });
  }
  if (signoff?.verdict === 'SIGNED OFF' && typeof signoff.commit === 'string') {
    const { paths, diff, how } = changedPaths(root, options, signoff.commit);
    const imports = configImports(root);
    const ui = [];
    for (const path of paths.filter(uiPathTest(plan, imports))) {
      if (!CONFIG_FILE.test(path)) {
        ui.push({ path, message: `changed after the signed commit ${signoff.commit.slice(0, 12)} (${how})${imports.has(path) ? '; the app config imports it' : ''}` });
        continue;
      }
      const reason = configChangeReason(diff?.get(path) ?? null);
      if (reason === null) report.note(`${path}: only build-number lines changed since the signed commit (a release lane's bump), so it counts as unchanged`);
      else ui.push({ path, message: `changed after the signed commit ${signoff.commit.slice(0, 12)} (${how}): ${reason}` });
    }
    for (const { path, message } of ui.slice(0, 20)) {
      report.problem({ file: path, rule: 'signoff-ui-changed', message, fix: 'The build people looked at is not the build you ship: revert the change, or re-shoot the affected cells on the new build and sign off again.' });
    }
    if (ui.length > 20) report.note(`... and ${ui.length - 20} more changed paths`);
    report.note(`gate: version ${version}, review ${review.id}, signed ${signoff.date} by ${signoff.reviewer} on ${signoff.commit.slice(0, 12)}; ${paths.length} paths changed since, ${ui.length} of them user-facing`);
  }
  return report.finish({ checked: 1, unit: 'reviews' });
});
