#!/usr/bin/env node
// check-tags.mjs: checks release tags. An upload tag vX.Y.Z+<build> (or vX.Y.Z+ios.<build> and
// vX.Y.Z+android.<build> when the two stores count builds separately) follows every store upload; a
// release tag vX.Y.Z follows the reviewer's "ship". A shipped version has an uploaded build, one app
// keeps one build-number scheme, and build numbers never repeat or go backwards. When multi-package,
// each tag starts with the app's workspace folder name: <app>/vX.Y.Z+<build>.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-tags.mjs .              (reads the repo's tags and their tagger dates)
//      node ${CLAUDE_SKILL_DIR}/scripts/check-tags.mjs . --list tags.txt

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { createReporter, fail, globToRegExp, parseArgs, readWorkspaces, requireDir, requireFile, run } from './check-lib.mjs';

const SPEC = {
  name: 'check-tags',
  summary: 'Checks release tags: the format, the app prefix (multi-package), an upload tag behind every release tag, one build-number scheme per app, and build numbers that only go up.',
  usage: '[repo-root] [options]',
  options: {
    list: { type: 'string', value: 'file', help: 'Tags to check, one per line, optionally "<tag> <unix seconds tagged>" (default: the tags of the repo with the tagger date of each annotated tag)' },
    match: { type: 'string', multiple: true, value: 'glob', help: 'Check only tags matching this glob (repeatable, for example "v*"); other tags are ignored. Default: every tag' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Tag forms (X.Y.Z is the app version, <build> the store build number):',
    '  vX.Y.Z+<build>                 upload tag, one build number shared by both stores',
    '  vX.Y.Z+ios.<build>             upload tag when iOS and Android count builds separately',
    '  vX.Y.Z+android.<build>         (EAS remote versioning keeps one counter per platform)',
    '  vX.Y.Z                         release tag: the reviewer said "ship" for this version',
    '  <app>/...                      the same with the workspace folder name, when multi-package',
    '',
    'Rules:',
    '  tag-format              a tag is none of the forms above',
    '  tag-unknown-app         the <app>/ prefix names no workspace folder (package.json workspaces), or a',
    '                          single-app repo uses a prefix',
    '  release-without-build   vX.Y.Z exists without any upload tag of the same version (nothing was uploaded)',
    '  build-scheme-mixed      one app has both shared (+<build>) and per-platform (+ios.<build>) upload tags',
    '  build-number-reused     one app and platform uses the same build number for two tags',
    '  build-number-order      a higher version has a lower build number than an earlier version, or (when every',
    '                          tag of that app and platform has a tagging date) a build tagged later has a lower',
    '                          number, also within one version',
    '',
    'The tag namespace belongs to releases by default: every tag must parse, so a stray marker tag',
    '(backup-before-rebase) is caught. A repo that also tags other things (changesets tags such as',
    '@org/pkg@1.2.0) passes --match for its release tags, for example --match "v*" (multi-package:',
    '--match "*/v*"); a tag outside every glob is ignored, a tag inside one must still parse.',
    '',
    'Tagging dates: the repo mode reads %(taggerdate), which only an annotated tag has (git tag -a). A',
    'lightweight tag has none (its creatordate is the commit\'s date, which says nothing about when it was',
    'tagged), so the time order is checked only when every tag of the app and platform is annotated.',
  ].join('\n'),
};

const TAG = /^(?:(?<app>[a-z0-9]+(?:-[a-z0-9]+)*)\/)?v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:\+(?:(?<platform>ios|android)\.)?(?<build>\d+))?$/;
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function readTags(root, list) {
  if (list) return readFileSync(requireFile(list, 'tag list'), 'utf8');
  const result = spawnSync('git', ['-C', root, 'for-each-ref', 'refs/tags', '--format=%(refname:strip=2) %(taggerdate:unix)'], { encoding: 'utf8' });
  if (result.status !== 0) fail(`git for-each-ref refs/tags failed: ${(result.stderr || '').trim()}`, 'Run inside the git repository or pass --list <file>.');
  return result.stdout;
}

function checkOrder(add, label, builds, createdAt) {
  const seen = new Map();
  for (const build of builds) {
    if (seen.has(build.build)) add(build.tag, 'build-number-reused', `reuses build ${build.build} (also ${seen.get(build.build)})`, 'Never reuse a build number; a rebuilt binary takes the next number and a new upload tag.');
    seen.set(build.build, build.tag);
  }
  const sorted = [...builds].sort((a, b) => compare(a.version, b.version) || a.build - b.build);
  for (let i = 1; i < sorted.length; i += 1) {
    if (compare(sorted[i].version, sorted[i - 1].version) > 0 && sorted[i].build < sorted[i - 1].build) add(sorted[i].tag, 'build-number-order', `build ${sorted[i].build} is lower than ${sorted[i - 1].tag}`, `Build numbers only go up for ${label}, across versions (Google Play refuses a lower versionCode).`);
  }
  if (!builds.every((build) => Number.isFinite(createdAt.get(build.tag)))) return;
  const byTime = [...builds].sort((a, b) => createdAt.get(a.tag) - createdAt.get(b.tag) || a.build - b.build);
  for (let i = 1; i < byTime.length; i += 1) {
    if (byTime[i].build < byTime[i - 1].build) add(byTime[i].tag, 'build-number-order', `was tagged after ${byTime[i - 1].tag} but has a lower build number`, 'Build numbers only go up in upload order, also within one version; the next upload takes the next number.');
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  // "<tag>" or "<tag> <unix seconds>": the tagging date orders builds within one version. A lightweight
  // tag prints no date (empty %(taggerdate)), so its row has none.
  const rows = readTags(root, options.list).split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [tag, created] = line.split(/\s+/);
    return { tag, createdAt: created === undefined ? null : Number(created) };
  });
  const globs = (options.match ?? []).map((glob) => globToRegExp(glob));
  const ignored = globs.length === 0 ? [] : rows.filter((row) => !globs.some((glob) => glob.test(row.tag)));
  if (ignored.length > 0) rows.splice(0, rows.length, ...rows.filter((row) => !ignored.includes(row)));
  if (rows.length === 0) fail(ignored.length > 0 ? `no tag matches --match ${options.match.join(', ')}` : 'there are no tags to check', 'Tags appear after the first store upload; pass --list <file> to check planned names.');
  const createdAt = new Map(rows.map((row) => [row.tag, row.createdAt]));
  const workspaces = readWorkspaces(root).map((workspace) => basename(workspace.dir));
  const report = createReporter({ name: 'check-tags', json: options.json });
  const add = (tag, rule, message, fix) => report.problem({ file: tag, line: 0, rule, message, fix });
  const byApp = new Map();
  for (const { tag } of rows) {
    const match = TAG.exec(tag);
    if (!match) {
      add(tag, 'tag-format', 'is not vX.Y.Z, vX.Y.Z+<build> or vX.Y.Z+<ios|android>.<build> (with <app>/ first when multi-package)', 'Tags come from the release step after an upload, with the build number the upload reported; never invent, rename or move one by hand.');
      continue;
    }
    const { app = '', major, minor, patch, platform, build } = match.groups;
    if (app && !workspaces.includes(app)) add(tag, 'tag-unknown-app', workspaces.length ? `names "${app}", which is not a workspace folder (${workspaces.join(', ')})` : `has the prefix "${app}/" but this repo is a single app`, workspaces.length ? 'Use the folder name of the app the build came from.' : 'A single-app repo tags vX.Y.Z+<build> without a prefix.');
    const entry = byApp.get(app) ?? { releases: [], builds: [] };
    const version = [Number(major), Number(minor), Number(patch)];
    if (build === undefined) entry.releases.push({ tag, version });
    else entry.builds.push({ tag, version, build: Number(build), stream: platform ?? 'shared' });
    byApp.set(app, entry);
  }
  for (const [app, { releases, builds }] of byApp) {
    const prefix = app ? `${app}/` : '';
    for (const release of releases) {
      if (!builds.some((build) => compare(build.version, release.version) === 0)) add(release.tag, 'release-without-build', 'has no upload tag for the same version', `A version is shipped only after an upload; expect ${prefix}v${release.version.join('.')}+<build> first.`);
    }
    const streams = new Set(builds.map((build) => build.stream));
    if (streams.has('shared') && streams.size > 1) {
      const first = builds.find((build) => build.stream !== 'shared');
      add(first.tag, 'build-scheme-mixed', `${prefix || 'the app'} has shared (+<build>) and per-platform (+ios./+android.) upload tags`, 'Keep one scheme: one build number for both stores, or one counter per platform (EAS remote versioning); the order rules compare numbers only within one scheme.');
    }
    for (const stream of streams) checkOrder(add, `${prefix || 'the app'} (${stream})`, builds.filter((build) => build.stream === stream), createdAt);
  }
  if (ignored.length > 0) console.log(`check-tags: ${ignored.length} tags outside --match ignored`);
  return report.finish({ checked: rows.length, unit: 'tags' });
});
