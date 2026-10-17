#!/usr/bin/env node
// check-repo-hygiene.mjs: whole-repo checks that keep a fresh clone and an installed skill complete
// and small: nothing under skills/ is git-ignored, no SKILL.md under tools/ or docs/, the repo fits its
// size budget, no symlinks under skills/, no .DS_Store. Works in a git repo (git check-ignore) and in a
// plain folder (it evaluates the .gitignore files itself).
// Usage: node tools/check-repo-hygiene.mjs [repo-root] [options]   (see --help)

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, STANDARD_PATH, loadStandard } from './lib/library.mjs';
import { createReporter, parseArgs, requireDir, run, toPosix } from './shared/scripts/check-lib.mjs';

const PROBLEM_CAP = 50;

// ---------------------------------------------------------------------------------------------
// .gitignore evaluation (used when the folder is not a git repo)
// ---------------------------------------------------------------------------------------------

/** One gitignore pattern (already stripped of "!" and the trailing "/") as a RegExp on a base-relative path. */
export function gitignorePatternToRegExp(pattern) {
  let source = pattern;
  const anchored = source.startsWith('/') || source.includes('/');
  if (source.startsWith('/')) source = source.slice(1);
  let re = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '*' && source[i + 1] === '*') {
      const atStart = i === 0 || source[i - 1] === '/';
      const after = source[i + 2];
      if (atStart && after === '/') {
        re += '(?:.*/)?';
        i += 3;
        continue;
      }
      if (atStart && after === undefined) {
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 2;
      continue;
    }
    if (ch === '*') {
      re += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (ch === '[') {
      const end = source.indexOf(']', i + 2);
      if (end === -1) {
        re += '\\[';
        i += 1;
      } else {
        let body = source.slice(i + 1, end);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        re += `[${body.replace(/\\/g, '\\\\')}]`;
        i = end + 1;
      }
    } else if (ch === '\\' && i + 1 < source.length) {
      re += source[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i += 2;
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(anchored ? `^${re}$` : `^(?:.*/)?${re}$`);
}

/** Parse one .gitignore file into rules. base is the folder of the file, relative to the repo root ('' at the root). */
export function parseGitignore(text, base, source) {
  const rules = [];
  text.replace(/\r\n/g, '\n').split('\n').forEach((raw, index) => {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (line === '' || line.startsWith('#')) return;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.replace(/\/+$/, '');
    if (line === '') return;
    rules.push({ negate, dirOnly, re: gitignorePatternToRegExp(line), base, source, line: index + 1, pattern: raw.trim() });
  });
  return rules;
}

/**
 * A matcher over every .gitignore file in the repo (deeper files win over shallower ones, the last
 * matching line wins, and a file in an ignored folder stays ignored). ignoredBy(rel, isDir) returns the
 * rule that ignores the path, or null.
 */
export function createIgnoreMatcher(gitignores) {
  const byBase = new Map();
  for (const { base, text, source } of gitignores) byBase.set(base, [...(byBase.get(base) ?? []), ...parseGitignore(text, base, source)]);
  const single = (rel, isDir) => {
    const segments = rel.split('/');
    let verdict = null;
    for (let depth = 0; depth < segments.length; depth += 1) {
      const base = segments.slice(0, depth).join('/');
      const rules = byBase.get(base);
      if (!rules) continue;
      const local = segments.slice(depth).join('/');
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.re.test(local)) verdict = rule;
      }
    }
    return verdict && !verdict.negate ? verdict : null;
  };
  const cache = new Map();
  const dirIgnored = (dirRel) => {
    if (cache.has(dirRel)) return cache.get(dirRel);
    const slash = dirRel.lastIndexOf('/');
    const parent = slash === -1 ? null : dirIgnored(dirRel.slice(0, slash));
    const result = parent ?? single(dirRel, true);
    cache.set(dirRel, result);
    return result;
  };
  return {
    ignoredBy(rel, isDir = false) {
      const slash = rel.lastIndexOf('/');
      const parent = slash === -1 ? null : dirIgnored(rel.slice(0, slash));
      return parent ?? single(rel, isDir);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// File listing
// ---------------------------------------------------------------------------------------------

/** Every entry under root (posix rel paths) except .git/ and node_modules/: { files, symlinks, gitignores, dsStores }. */
function scan(root) {
  const files = [];
  const symlinks = [];
  const gitignores = [];
  const dsStores = [];
  const visit = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = join(abs, entry.name);
      const rel = toPosix(relative(root, child));
      if (entry.isSymbolicLink()) symlinks.push(rel);
      else if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        files.push(rel);
        if (entry.name === '.gitignore') gitignores.push({ base: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', text: readFileSync(child, 'utf8'), source: rel });
        if (entry.name === '.DS_Store') dsStores.push(rel);
      }
    }
  };
  visit(root);
  return { files, symlinks, gitignores, dsStores };
}

function git(root, args, input) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

/** True when root is the top of a git work tree (a folder inside someone else's repo does not count). */
function isGitRoot(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.error || top.status !== 0) return false;
  try {
    return statSync(top.stdout.trim()).ino === statSync(root).ino;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const SPEC = {
  name: 'check-repo-hygiene',
  summary: 'Checks the whole repository: nothing under skills/ is git-ignored (a fresh clone would lose it), no file named SKILL.md under tools/ or docs/ (an installer\'s deep scan would offer it as a skill), the tracked size and file count fit the budget in tools/standard.json, no symlinks under skills/, and no .DS_Store files.',
  usage: '[repo-root] [options]',
  options: {
    standard: { type: 'string', value: 'file', help: 'Standard constants file (default: tools/standard.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  ignored-under-skills   no file under skills/ matches a .gitignore rule (git check-ignore --no-index in a git repo; the',
    '                         repo\'s .gitignore files evaluated directly otherwise); installed packages in node_modules/ are skipped',
    '  skill-md-misplaced     no file named SKILL.md under the folders standard.json repo.noSkillMdUnder lists (tools/, docs/)',
    '  repo-budget            the files a commit would hold (tracked + untracked, minus ignored) fit repo.maxTrackedBytes and',
    '                         repo.maxTrackedFiles',
    '  skills-symlink         no symlink anywhere under skills/',
    '  ds-store               no .DS_Store file anywhere (outside .git/, node_modules/ and git-ignored folders such as .attic/)',
    '',
    'The repo root defaults to the repository that holds this tools/ folder.',
  ].join('\n'),
};

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? REPO_ROOT, 'repo root');
  const std = loadStandard(options.standard ?? STANDARD_PATH);
  const skillsDir = std.skillsDir ?? 'skills';
  const report = createReporter({ name: 'check-repo-hygiene', json: options.json });
  const { files, symlinks, gitignores, dsStores } = scan(root);
  const inGit = isGitRoot(root);
  const underSkills = (rel) => rel.startsWith(`${skillsDir}/`);

  // 1. Nothing under skills/ is git-ignored.
  const skillFiles = files.filter((rel) => underSkills(rel) && !rel.endsWith('/.DS_Store') && rel !== `${skillsDir}/.DS_Store`);
  const ignored = [];
  if (inGit) {
    report.note(`git repo: asking git check-ignore about ${skillFiles.length} files under ${skillsDir}/`);
    if (skillFiles.length) {
      const result = git(root, ['check-ignore', '--no-index', '--stdin', '-z', '-v'], `${skillFiles.join('\0')}\0`);
      if (result.status !== 0 && result.status !== 1) throw new Error(`git check-ignore failed: ${result.stderr.trim()}`);
      const fields = result.stdout.split('\0');
      for (let i = 0; i + 3 < fields.length; i += 4) {
        const [source, line, pattern, path] = fields.slice(i, i + 4);
        if (pattern.startsWith('!')) continue;
        ignored.push({ rel: path, where: `${source}:${line}`, pattern });
      }
    }
  } else {
    report.note(`not a git repo: evaluating ${gitignores.length} .gitignore file(s) for ${skillFiles.length} files under ${skillsDir}/`);
    const matcher = createIgnoreMatcher(gitignores);
    for (const rel of skillFiles) {
      const rule = matcher.ignoredBy(rel);
      if (rule) ignored.push({ rel, where: `${rule.source}:${rule.line}`, pattern: rule.pattern });
    }
  }
  ignored.slice(0, PROBLEM_CAP).forEach(({ rel, where, pattern }) => report.problem({ file: rel, rule: 'ignored-under-skills', message: `is ignored by ${where} "${pattern}", so a fresh clone (and every installed copy) loses it`, fix: 'Rename the file or narrow the ignore rule (a fixture .gitignore becomes dot-gitignore, renamed when the case is assembled).' }));
  if (ignored.length > PROBLEM_CAP) report.problem({ file: `${skillsDir}/`, rule: 'ignored-under-skills', message: `${ignored.length - PROBLEM_CAP} more ignored files not shown (${ignored.length} in all)`, fix: 'Fix the ones above, then rerun.' });

  // 2. No SKILL.md under tools/ or docs/.
  for (const folder of std.repo.noSkillMdUnder) {
    for (const rel of files.filter((path) => path.startsWith(`${folder}/`) && path.split('/').pop() === 'SKILL.md')) {
      report.problem({ file: rel, rule: 'skill-md-misplaced', message: `a file named SKILL.md under ${folder}/ is offered as a skill by the skills CLI's deep scan`, fix: 'Rename it (SKILL.md.tmpl for a scaffold) or generate it at test time in a temporary folder.' });
    }
  }

  // 3. Repo budget: the files a commit would hold.
  let committed;
  if (inGit) {
    const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
    committed = listed.stdout.split('\0').filter(Boolean).filter((rel) => existsSync(join(root, rel)));
  } else {
    const matcher = createIgnoreMatcher(gitignores);
    committed = files.filter((rel) => !matcher.ignoredBy(rel));
  }
  // Git stores identical content once, so synced shared copies (check-lib in every skill) count once:
  // the budget is on unique blob bytes; the checkout size is reported as a note.
  let bytes = 0;
  let checkoutBytes = 0;
  const seenBlobs = new Set();
  for (const rel of committed) {
    const abs = join(root, rel);
    const size = lstatSync(abs).size;
    checkoutBytes += size;
    const digest = createHash('sha256').update(readFileSync(abs)).digest('hex');
    if (seenBlobs.has(digest)) continue;
    seenBlobs.add(digest);
    bytes += size;
  }
  report.note(`repo budget: ${committed.length} files, ${bytes} unique bytes (${checkoutBytes} bytes checked out; limits ${std.repo.maxTrackedFiles} files, ${std.repo.maxTrackedBytes} unique bytes)`);
  if (bytes > std.repo.maxTrackedBytes) report.problem({ file: '.', rule: 'repo-budget', message: `the repo would commit ${bytes} bytes (limit ${std.repo.maxTrackedBytes})`, fix: 'Shrink fixtures (overlay cases, generated images) and drop design assets; run node tools/validate-skills.mjs --rule fixture-budget --summary to find the heavy skills.' });
  if (committed.length > std.repo.maxTrackedFiles) report.problem({ file: '.', rule: 'repo-budget', message: `the repo would commit ${committed.length} files (limit ${std.repo.maxTrackedFiles})`, fix: 'Move fixture cases to the overlay format (EXPECT.txt plus mutation.json over one base tree).' });

  // 4. No symlinks under skills/.
  for (const rel of symlinks.filter(underSkills)) report.problem({ file: rel, rule: 'skills-symlink', message: 'is a symlink; installers copy or dereference links unpredictably and Windows checkouts break them', fix: 'Replace it with the real file (sync-shared copies shared files).' });

  // 5. No .DS_Store, except inside a git-ignored folder (local-only material such as .attic/ or
  // .skill-tooling/ is never published, so it is outside every rule here).
  const folderMatcher = createIgnoreMatcher(gitignores);
  const publishedDsStores = dsStores.filter((rel) => !rel.includes('/') || !folderMatcher.ignoredBy(rel.slice(0, rel.lastIndexOf('/')), true));
  publishedDsStores.slice(0, PROBLEM_CAP).forEach((rel) => report.problem({ file: rel, rule: 'ds-store', message: 'Finder metadata file', fix: 'Delete it (find . -name .DS_Store -delete); .gitignore keeps it out of commits.' }));
  if (publishedDsStores.length > PROBLEM_CAP) report.problem({ file: '.', rule: 'ds-store', message: `${publishedDsStores.length - PROBLEM_CAP} more .DS_Store files not shown`, fix: 'Run find . -name .DS_Store -delete.' });

  return report.finish({ checked: files.length, unit: 'files' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(main);
