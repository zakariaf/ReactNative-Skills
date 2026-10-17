#!/usr/bin/env node
// new-skill.mjs: creates <skills-root>/<name>/ from this skill's scaffold (assets/scaffold/): the six
// sections in order, a reference, a working pattern checker with its self-test and fixtures, a
// synced check-lib.mjs and assets/shared.json. Every spot the author must write holds a
// __FILL_...__ placeholder, which check-skill.mjs reports until it is replaced. It refuses bad or
// reserved names and existing folders. --runbook makes a side-effecting run-* runbook.
//   node ${CLAUDE_SKILL_DIR}/scripts/new-skill.mjs <name> --skills-root skills
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, fail, parseArgs, requireDir, run, toPosix, walk } from './check-lib.mjs';
import { isRepoRoot } from './lib/skill-md.mjs';
import { STANDARD_PATH, loadStandard } from './lib/skill-standard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAFFOLD = join(HERE, '..', 'assets', 'scaffold');
const OWN_CHECK_LIB = join(HERE, 'check-lib.mjs');
// Built from parts so this script holds no placeholder token itself.
const TOKEN = (word) => `__${word}__`;

const SPEC = {
  name: 'new-skill',
  summary: 'Creates <skills-root>/<name>/ from the scaffold, with the name and title filled in, check-lib.mjs copied in, and __FILL_...__ placeholders everywhere the author must write. Refuses bad, reserved or taken names.',
  usage: '<name> --skills-root <dir> [options]',
  options: {
    'skills-root': { type: 'string', value: 'dir', help: 'Folder that holds the skill folders (required; usually skills). Created when missing and its parent is a repo root (package.json or .git)' },
    title: { type: 'string', help: 'The H1 title (default: the name in words, first letter capital)' },
    runbook: { type: 'boolean', help: 'A side-effecting run-* runbook: adds disable-model-invocation: true and a stop-and-ask step (the name must start with run-)' },
    shared: { type: 'string', value: 'dir', help: 'A skill library\'s canonical shared folder: copy scripts/check-lib.mjs from there instead of from this skill' },
    standard: { type: 'string', value: 'file', help: 'Standard file with the name rules (default: assets/standard.json of this skill)' },
    'dry-run': { type: 'boolean', help: 'Check the name and list the files without writing anything' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  name-format    1-64 characters of a-z, 0-9 and single hyphens, no leading or trailing hyphen',
    '  name-reserved  not a bundled command or skill, not an Expo skill name, no "claude" or "anthropic"',
    '  name-exists    the folder must not exist yet',
    '  runbook-name   --runbook needs a name that starts with run- (only run-* runbooks may leave the listing)',
    '',
    'Next steps it prints: fill the placeholders, then validate-skill.mjs, the new self-test and check-skill.mjs.',
  ].join('\n'),
};

function titleOf(name) {
  const words = name.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Turns the scaffold's SKILL.md into a run-* runbook: the flag, and a stop-and-ask step before the irreversible one. */
function asRunbook(text, key, value) {
  return text
    .replace(/^(description: .*\n)/m, `$1${key}: ${value}\n`)
    .replace('3. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-rules.mjs .`', `3. Stop and ask the developer before ${TOKEN('FILL_THE_IRREVERSIBLE_STEP')}; go on only after a clear yes.\n4. Run \`node \${CLAUDE_SKILL_DIR}/scripts/check-rules.mjs .\``)
    .replace('| Workflow step 3 and the definition of done |', '| Workflow step 4 and the definition of done |');
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (positionals.length === 0) fail('nothing to create: pass the new skill name', 'Example: node new-skill.mjs store-listing-texts --skills-root skills');
  if (!options['skills-root']) fail('pass --skills-root <folder that holds the skills>', 'Usually --skills-root skills from the repo root.');
  // The first project skill of an app: the repo has no skills/ yet, so create it (only right inside a repo root).
  const wanted = resolve(options['skills-root']);
  const createRoot = !existsSync(wanted) && existsSync(dirname(wanted)) && isRepoRoot(dirname(wanted));
  if (!existsSync(wanted) && !createRoot) fail(`skills root ${options['skills-root']} does not exist, and its parent folder is not a repo root (no package.json or .git)`, 'Run from the repo root with --skills-root skills, or create the folder first.');
  const root = createRoot ? wanted : requireDir(options['skills-root'], 'skills root');
  const rootLabel = toPosix(relative(process.cwd(), root)) || root;
  if (!existsSync(join(SCAFFOLD, 'SKILL.md.tmpl'))) fail(`the scaffold is missing in ${SCAFFOLD}`, 'Reinstall the skill-maintenance skill (assets/scaffold/).');
  const checkLib = options.shared ? join(resolve(options.shared), 'scripts', 'check-lib.mjs') : OWN_CHECK_LIB;
  if (!existsSync(checkLib)) fail(`no check-lib.mjs at ${checkLib}`, 'Pass the canonical shared folder that holds scripts/check-lib.mjs, or drop --shared.');
  const std = loadStandard(options.standard ?? STANDARD_PATH);
  const pattern = new RegExp(std.names.pattern);
  const reserved = new Set(std.names.reserved);
  const name = positionals[0];
  const report = createReporter({ name: 'new-skill', json: options.json });
  if (name.length > std.names.maxLength || !pattern.test(name)) report.problem({ file: name, rule: 'name-format', message: `"${name}" is not 1-${std.names.maxLength} characters of a-z, 0-9 and single hyphens`, fix: 'Use a kebab-case noun phrase, for example store-listing-texts.' });
  if (reserved.has(name) || std.names.reservedSubstrings.some((word) => name.includes(word))) report.problem({ file: name, rule: 'name-reserved', message: `"${name}" shadows a bundled command, a bundled or Expo skill, or contains ${std.names.reservedSubstrings.join('/')}`, fix: 'Pick a more specific name, for example with a domain prefix.' });
  const runbook = std.frontmatter.runbook;
  if (options.runbook && !name.startsWith(runbook.namePrefix)) report.problem({ file: name, rule: 'runbook-name', message: `a runbook leaves the listing and runs only when named, so its name starts with ${runbook.namePrefix}; "${name}" does not`, fix: `Name it ${runbook.namePrefix}<action> (for example ${runbook.namePrefix}store-upload), or drop --runbook for a skill the agent may pick itself.` });
  const target = join(root, name);
  if (existsSync(target)) report.problem({ file: toPosix(relative(process.cwd(), target)) || name, rule: 'name-exists', message: 'that skill folder already exists', fix: 'Edit the existing skill, or choose another name.' });
  const files = [...walk(SCAFFOLD).map((rel) => ({ from: rel, to: rel.replace(/\.tmpl$/, '') })), { from: null, to: 'scripts/check-lib.mjs' }];
  if (report.count > 0 || options['dry-run']) {
    if (report.count === 0 && createRoot) report.note(`would create the skills root ${rootLabel}`);
    if (report.count === 0) for (const file of files) report.note(`would write ${name}/${file.to}`);
    return report.finish({ checked: files.length, unit: 'scaffold files' });
  }

  if (createRoot) {
    mkdirSync(root);
    report.note(`created the skills root ${rootLabel} (the repo had no skills folder yet)`);
  }
  cpSync(SCAFFOLD, target, { recursive: true });
  copyFileSync(checkLib, join(target, 'scripts', 'check-lib.mjs'));
  const title = options.title ?? titleOf(name);
  for (const file of files.filter((entry) => entry.from !== null)) {
    const from = join(target, file.from);
    const to = join(target, file.to);
    if (from !== to) renameSync(from, to);
    if (!statSync(to).isFile()) continue;
    let text = readFileSync(to, 'utf8').split(TOKEN('SKILL_NAME')).join(name).split(TOKEN('SKILL_TITLE')).join(title);
    if (options.runbook && file.to === 'SKILL.md') text = asRunbook(text, runbook.key, runbook.value);
    writeFileSync(to, text);
  }
  // Prove the result: every scaffold file is there and no name or title token is left.
  for (const file of files) {
    const path = join(target, file.to);
    if (!existsSync(path)) report.problem({ file: `${name}/${file.to}`, rule: 'name-exists', message: 'was not written', fix: 'Check the permissions of the skills folder and rerun.' });
    else if ([TOKEN('SKILL_NAME'), TOKEN('SKILL_TITLE')].some((token) => readFileSync(path, 'utf8').includes(token))) report.problem({ file: `${name}/${file.to}`, rule: 'name-format', message: 'still holds a name or title token', fix: 'This is a bug in new-skill.mjs.' });
  }
  const leftovers = readdirSync(target, { recursive: true }).filter((rel) => String(rel).endsWith('.tmpl'));
  for (const rel of leftovers) report.problem({ file: `${name}/${rel}`, rule: 'name-format', message: 'a .tmpl file was not renamed', fix: 'This is a bug in new-skill.mjs.' });
  if (report.count === 0) {
    report.note(`created ${toPosix(relative(process.cwd(), target)) || target} (${files.length} files${options.runbook ? ', a run-only runbook' : ''})`);
    report.note('next: fill every __FILL_...__, then run validate-skill.mjs, the new skill\'s scripts/selftest.mjs and check-skill.mjs on it');
    // check-skill's placeholder-left does not read tests/, so name the fixtures that hold fill tokens too.
    const fillToken = ['__', 'FILL_'].join('');
    const fixtureFills = readdirSync(join(target, 'tests'), { recursive: true }).map((rel) => toPosix(join('tests', String(rel)))).filter((rel) => statSync(join(target, rel)).isFile() && readFileSync(join(target, rel), 'utf8').includes(fillToken));
    if (fixtureFills.length) report.note(`fill the tokens in the fixtures too (check-skill does not read tests/): ${fixtureFills.join(', ')}`);
  }
  return report.finish({ checked: files.length, unit: 'scaffold files' });
});
