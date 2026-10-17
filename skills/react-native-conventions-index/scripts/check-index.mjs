#!/usr/bin/env node
// check-index.mjs: proves the index is exact. In a library (its top-level skills/ folder, holding the index) the index
// lists every skill that exists and no other, routes every skill from a task row or a build step,
// keeps its row rules, runs only real scripts in its build orders, keeps each order's manifests
// import-closed, and every generated part equals a fresh render; with --catalog, --agents and --readme
// it also agrees with the library catalogue, AGENTS.md's intent map and README.md's skill tables.
// In an app (an agent skills folder holding a subset next to the app's own skills) it checks that each
// installed skill still has the description the index was generated from.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createReporter, fail, lineOf, parseArgs, requireDir, requireFile, run } from './check-lib.mjs';
import {
  AGENTS_MARKERS, DATA_FILE, INDEX_NAME, README_MARKERS, SKILL_DIR, buildSteps, detectMode, findSkillsRoot, intentLines, isSkillName,
  markedBlock, namedSkills, normalizeSpace, readIndexData, readSkills, renderAll, renderedDescriptions,
} from './lib/index-model.mjs';
import { catalogDrift, readCatalogFile } from './lib/catalog-sync.mjs';
import { basePositions, checkOrder, closureConfig, companionReader, hasManifests, indexTemplates, stepHasManifest } from './lib/step-closure.mjs';

const SPEC = {
  name: 'check-index',
  summary:
    'Checks that the index lists exactly the skills present (no missing, stale or duplicate entries), routes every ' +
    'skill, keeps its row rules and build-order contract, and that its generated parts are current; optionally that it ' +
    'agrees with the library catalogue, AGENTS.md and README.md. In an app, checks the installed skills against it.',
  usage: '[repo-root] [--skills-root <dir>] [--index <dir>] [--library | --installed] [--catalog <file>] [--agents <file>] [--readme <file>] [--min-tasks <n>] [--policy <file>]',
  options: {
    'skills-root': { type: 'string', value: 'dir', help: 'The folder that holds the skills (default: skills/ or an agent skills folder of the repo root)' },
    index: { type: 'string', value: 'dir', help: `The index skill to check (default: <skills-root>/${INDEX_NAME}, else this skill)` },
    library: { type: 'boolean', help: 'Library mode: every listed skill must exist and every skill must be listed (default for a top-level skills/ folder that holds the index skill)' },
    installed: { type: 'boolean', help: 'Installed mode: a subset next to the app\'s own skills (default inside .agents/, .claude/ and the other agent folders, and for an app\'s own skills/ folder without the index)' },
    catalog: { type: 'string', value: 'file', help: 'Also check the catalogue snapshot against the library catalogue file' },
    agents: { type: 'string', value: 'file', help: 'Also check that this AGENTS.md\'s generated intent map agrees with the index' },
    readme: { type: 'string', value: 'file', help: 'Also check that this README names every skill and no other' },
    'min-tasks': { type: 'string', default: '25', value: 'n', help: 'Fewest task rows the matrix may have (library mode)' },
    policy: { type: 'string', value: 'file', help: 'Dependency policy with companions (default: the template whose repo path is contracts/dependency-policy.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (library mode):',
    '  index-data          assets/index.json is missing or has the wrong shape',
    '  skill-name          a skill folder whose frontmatter name is missing or differs from the folder',
    '  skill-missing       a skill in the skills folder is not in the index\'s catalogue',
    '  skill-stale         the index names a skill that does not exist (catalogue, tasks, build steps, row rules)',
    '  skill-duplicate     a skill is listed twice in the catalogue, or twice in one task row or build step',
    '  skill-uncovered     a skill is in no task row and no build step, so nothing routes to it',
    '  task-count          fewer task rows than --min-tasks',
    '  task-shape          a task row or build step with no skill',
    '  row-rule            a task row whose lead skill is a rowRules "when" skill, or that loads a "whenAny" skill',
    '                      anywhere, lacks one of its "require" skills',
    '  generated-missing   a generated file, or the quick-table markers in SKILL.md, is missing',
    '  generated-stale     a generated part differs from a fresh render (run build-index.mjs --write)',
    '  related-unknown     the Related skills section of SKILL.md names a skill that does not exist',
    '  command-unknown     a step names a <name>.mjs script that the skill in brackets after it (or, without',
    '                      brackets, every skill of that step) does not have in scripts/, or passes it a --flag its',
    '                      source does not declare (a static read: a flag named anywhere in the script passes)',
    '  step-manifest       a copy names no template, a skill that does not exist or that the step does not load, an',
    '                      install lacks a companion the dependency policy lists, or an order in requireManifests',
    '                      declares no copies or has a step that states no copies, installs, generates or noManifest',
    '  step-import-closure (orders with copies) a copied file imports a file a later step copies or no step copies,',
    '                      an npm package no earlier step installs, or arrives without its sibling test, or its runtime',
    '                      code is reached only by a later step\'s tests (test:coverage drops in between)',
    '  catalog-drift       (--catalog) the catalogue snapshot differs from the catalogue file',
    '  agents-drift        (--agents) AGENTS.md\'s generated intent map disagrees with the index',
    '  readme-missing      (--readme) a skill the README does not name',
    '  readme-stale        (--readme) the README names a skill that does not exist',
    'Rules (installed mode): index-data, skill-name (installed skills the index lists), installed-drift (an installed',
    'skill\'s description differs from the one in references/skill-table.md: the index and that skill come from',
    'different releases), related-unknown (against the catalogue). Skills the index does not list are the app\'s own',
    'and are not checked; listed skills that are not installed are counted in a note.',
    '',
    'The README is read between <!-- generated:skills:start --> and <!-- generated:skills:end --> (table rows whose',
    'first cell holds the skill name in backticks), else under a heading that contains "catalogue" (list items that',
    'start with the name in backticks). A repo without any skills folder prints NOT APPLICABLE. Library mode is the',
    'default only for a top-level skills/ folder that holds the index skill itself; an app\'s own skills/ folder next',
    'to an index from a plugin is installed mode.',
    '',
    'Examples:',
    '  node check-index.mjs .                                                     (a library, or an app with skills)',
    '  node check-index.mjs . --library --catalog <catalogue> --agents AGENTS.md --readme README.md   (library CI)',
  ].join('\n'),
};

function checkNames(skills, report) {
  for (const skill of skills) {
    if (skill.name !== skill.folder || !isSkillName(skill.name)) {
      report.problem({ file: `${skill.folder}/SKILL.md`, line: 2, rule: 'skill-name', message: `frontmatter name "${skill.name}" does not match the folder`, fix: 'Make name: equal the folder name (kebab-case).' });
    }
  }
}

function routedRows(data) {
  return [...data.tasks.map((task, index) => ({ label: `tasks[${index}] "${task.task}"`, skills: task.skills })), ...buildSteps(data).map(({ label, step }) => ({ label, skills: step.skills }))];
}

function checkCoverage(data, skills, minTasks, report) {
  const known = new Set(skills.map((skill) => skill.folder));
  for (const entry of namedSkills(data)) {
    if (!known.has(entry.name)) report.problem({ file: DATA_FILE, rule: 'skill-stale', message: `${entry.where} names ${entry.name}, which does not exist`, fix: 'Use the skill\'s exact folder name, or remove the stale entry; then run build-index.mjs --write.' });
  }
  const listed = new Set();
  for (const skill of data.catalog.skills) {
    if (listed.has(skill.name)) report.problem({ file: DATA_FILE, rule: 'skill-duplicate', message: `${skill.name} is listed twice in catalog.skills`, fix: 'Keep each skill once in the catalogue (one category, one plugin).' });
    listed.add(skill.name);
  }
  const rows = routedRows(data);
  for (const row of rows) {
    if (row.skills.length === 0) report.problem({ file: DATA_FILE, rule: 'task-shape', message: `${row.label} names no skill`, fix: 'Every row routes to at least one skill (the lead first).' });
    const twice = row.skills.filter((name, index) => row.skills.indexOf(name) !== index);
    for (const name of new Set(twice)) report.problem({ file: DATA_FILE, rule: 'skill-duplicate', message: `${row.label} lists ${name} twice`, fix: 'List each skill once per row.' });
  }
  const routed = new Set(rows.flatMap((row) => row.skills));
  for (const name of known) {
    if (!listed.has(name)) report.problem({ file: DATA_FILE, rule: 'skill-missing', message: `${name} exists but is not in the index's catalogue`, fix: `Add ${name} to the library catalogue and run build-index.mjs --catalog <catalogue> --write, then add it to the task rows that need it.` });
    if (!routed.has(name)) report.problem({ file: DATA_FILE, rule: 'skill-uncovered', message: `no task row or build step routes to ${name}`, fix: `Add ${name} to the task rows that need it (or a build step), then run build-index.mjs --write.` });
  }
  if (data.tasks.length < minTasks) report.problem({ file: DATA_FILE, rule: 'task-count', message: `${data.tasks.length} task rows, fewer than ${minTasks}`, fix: 'Add rows for the typical tasks (screens, data, platform features, release, failures) until the matrix covers them.' });
}

/**
 * A task row led by a "when" skill, or loading a "whenAny" skill anywhere, also loads every "require"
 * skill of that rule (build orders state their own skills per step).
 */
function checkRowRules(data, report) {
  for (const rule of data.rowRules ?? []) {
    for (const row of data.tasks.map((task, index) => ({ label: `tasks[${index}] "${task.task}"`, skills: task.skills }))) {
      const anywhere = (rule.whenAny ?? []).find((name) => row.skills.includes(name));
      if (!rule.when.includes(row.skills[0]) && anywhere === undefined) continue;
      const missing = rule.require.filter((name) => !row.skills.includes(name));
      const because = rule.when.includes(row.skills[0]) ? `is led by ${row.skills[0]}` : `loads ${anywhere}`;
      if (missing.length > 0) report.problem({ file: DATA_FILE, rule: 'row-rule', message: `${row.label} ${because} but does not load ${missing.join(', ')} (row rule "${rule.id}": ${rule.why})`, fix: `Add ${missing.join(', ')} to the row, then run build-index.mjs --write.` });
    }
  }
}

function checkGenerated(indexDir, data, skills, report) {
  for (const [rel, content] of Object.entries(renderAll(indexDir, data, skills))) {
    const path = join(indexDir, rel);
    if (content === null) {
      report.problem({ file: rel, rule: 'generated-missing', message: 'SKILL.md has no generated-block markers for the quick task table', fix: 'Restore the generated:task-table marker comments, then run build-index.mjs --write.' });
    } else if (!existsSync(path)) {
      report.problem({ file: rel, rule: 'generated-missing', message: 'is missing', fix: 'Run build-index.mjs --write.' });
    } else if (readFileSync(path, 'utf8') !== content) {
      report.problem({ file: rel, rule: 'generated-stale', message: 'differs from a fresh render: a skill was added, removed or re-described, or the data changed', fix: 'Run build-index.mjs --write (never edit a generated part by hand), then rerun this check.' });
    }
  }
}

/**
 * Every `<name>.mjs ...` command in a build step must be a script of the skill named in brackets right
 * after it, e.g. `check-navigation.mjs .` (navigation-and-routing), or, without brackets, of one of the
 * step's skills. A renamed or removed script then fails here instead of in a session that follows the order.
 */
const COMMAND = /`([a-z0-9]+(?:-[a-z0-9]+)*\.mjs)((?: [^`]*)?)`(?:\s*\(([a-z0-9]+(?:-[a-z0-9]+)*))?/g;

/**
 * A flag is known to a script when its source declares it: `--name` in the text (usage, help), or the
 * option key `'name':` / `name:` of its SPEC. A static read, so it never runs another skill's script;
 * the limit is that a flag named anywhere in the script's text passes (see the rule list in --help).
 */
function declaresFlag(source, flag) {
  const name = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`--${name}(?![\\w-])|['"]${name}['"]\\s*:|^\\s*${name}\\s*:`, 'm').test(source);
}

function checkCommands(root, data, skills, report) {
  const known = new Set(skills.map((skill) => skill.folder));
  const scriptPath = (skill, script) => join(root, skill, 'scripts', script);
  const hasScript = (skill, script) => known.has(skill) && existsSync(scriptPath(skill, script));
  for (const { label, step } of buildSteps(data)) {
    for (const match of `${step.step} ${step.proof} ${step.localLane ?? ''}`.matchAll(COMMAND)) {
      const [, script, args, named] = match;
      const owners = named !== undefined && known.has(named) ? [named] : step.skills;
      const owner = owners.find((skill) => hasScript(skill, script));
      if (owner === undefined) {
        report.problem({ file: DATA_FILE, rule: 'command-unknown', message: `${label} runs ${script}, which ${owners.join(', ')} does not have in scripts/`, fix: `Name the script's real file and its skill in brackets after the command (\`${script} .\` (<skill>)), then run build-index.mjs --write.` });
        continue;
      }
      const source = readFileSync(scriptPath(owner, script), 'utf8');
      for (const flag of new Set([...args.matchAll(/(?:^|\s)--([a-z0-9][a-z0-9-]*)/g)].map((found) => found[1]))) {
        if (flag === 'help' || declaresFlag(source, flag)) continue;
        report.problem({ file: DATA_FILE, rule: 'command-unknown', message: `${label} runs ${script} --${flag}, which ${owner}'s ${script} does not declare`, fix: `Use the flag its --help prints (node <${owner} folder>/scripts/${script} --help), then run build-index.mjs --write.` });
      }
    }
  }
}

/**
 * The orders named in requireManifests must keep their contract: some step copies templates, and every
 * step states what it copies, installs or generates (or noManifest with its reason), so the closure
 * check below can never go inert because the manifests were dropped.
 */
function checkRequiredManifests(data, report) {
  for (const id of data.requireManifests ?? []) {
    const order = data.buildOrders.find((entry) => entry.id === id);
    if (!hasManifests(order.steps)) {
      report.problem({ file: DATA_FILE, rule: 'step-manifest', message: `"${order.title}" declares no copies, but requireManifests names it: the import-closure check has nothing to follow`, fix: 'Give each step its copies (repo paths or globs per owner skill, tests included), installs and generates, then run build-index.mjs --write.' });
      continue;
    }
    order.steps.forEach((step, index) => {
      if (!stepHasManifest(step)) report.problem({ file: DATA_FILE, rule: 'step-manifest', message: `"${order.title}", step ${index + 1} states no copies, installs or generates (requireManifests names the order)`, fix: 'List what the step copies, installs or generates, or set noManifest to the reason it writes no file; then run build-index.mjs --write.' });
    });
  }
}

/** The build-order contract: plays every order that declares copies (on top of its base order's steps). */
function checkClosure(root, data, skills, policyFile, report) {
  checkRequiredManifests(data, report);
  const orders = data.buildOrders.filter((order) => hasManifests(order.steps));
  if (orders.length === 0) {
    report.note('step-import-closure: no build order declares copies, so there is no manifest to follow');
    return;
  }
  const config = closureConfig(data.closure);
  const templates = indexTemplates(root, skills.map((skill) => skill.folder), config);
  const companionsOf = companionReader({ policyFile, templates });
  let checked = 0;
  for (const order of orders) {
    const baseOrder = order.base ? data.buildOrders.find((other) => other.id === order.base.order) : null;
    const base = baseOrder ? basePositions(baseOrder, order.base.through) : [];
    const { problems, positions } = checkOrder({ title: order.id, steps: order.steps, base, templates, companionsOf, config });
    checked += [...positions.values()].filter((entry) => !entry.position.inherited).length;
    for (const problem of problems) {
      report.problem({ file: DATA_FILE, rule: problem.kind === 'manifest' ? 'step-manifest' : 'step-import-closure', message: `"${order.title}", ${problem.message}`, fix: `${problem.fix} Then run build-index.mjs --write.` });
    }
  }
  report.note(`step-import-closure: ${checked} copied files followed through ${orders.length} order${orders.length === 1 ? '' : 's'}`);
}

function checkRelated(indexDir, names, report) {
  const path = join(indexDir, 'SKILL.md');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('\n## Related skills');
  if (start === -1) return;
  const section = text.slice(start);
  for (const match of section.matchAll(/^- `([a-z0-9-]+)`/gm)) {
    if (!names.has(match[1])) report.problem({ file: 'SKILL.md', line: lineOf(text, start + match.index + 1), rule: 'related-unknown', message: `Related skills names ${match[1]}, which does not exist`, fix: 'Name an existing skill, or remove the line.' });
  }
}

/** AGENTS.md's generated intent map must hold exactly the headings and bullets the index derives. */
function checkAgents(agentsPath, data, skills, report) {
  const shown = 'AGENTS.md';
  const text = readFileSync(agentsPath, 'utf8');
  const block = markedBlock(text, AGENTS_MARKERS);
  if (block === null) {
    report.problem({ file: shown, rule: 'agents-drift', message: `has no ${AGENTS_MARKERS.start} ... ${AGENTS_MARKERS.end} block`, fix: 'Run the library\'s catalogue build (it writes the intent map), then rerun this check.' });
    return;
  }
  const actual = block.filter((entry) => /^(### |- `)/.test(entry.text));
  const expected = intentLines(data, skills);
  const nameOf = (line) => /^- `([a-z0-9-]+)`/.exec(line)?.[1] ?? null;
  const actualByName = new Map(actual.filter((entry) => nameOf(entry.text)).map((entry) => [nameOf(entry.text), entry]));
  const expectedNames = new Set(expected.map(nameOf).filter(Boolean));
  for (const line of expected) {
    const name = nameOf(line);
    if (name === null) continue;
    const found = actualByName.get(name);
    if (!found) report.problem({ file: shown, rule: 'agents-drift', message: `the intent map does not route ${name}`, fix: 'Rebuild AGENTS.md from the same catalogue and descriptions (the library\'s catalogue build), then rerun.' });
    else if (normalizeSpace(found.text) !== normalizeSpace(line)) report.problem({ file: shown, line: found.line, rule: 'agents-drift', message: `the intent for ${name} differs from its description: AGENTS.md has "${found.text}", the index derives "${line}"`, fix: 'Rebuild AGENTS.md (never edit the generated block by hand), then rerun.' });
  }
  for (const [name, entry] of actualByName) {
    if (!expectedNames.has(name)) report.problem({ file: shown, line: entry.line, rule: 'agents-drift', message: `the intent map routes ${name}, which the index does not list`, fix: 'Rebuild AGENTS.md from the current catalogue, or add the skill to the catalogue.' });
  }
  const headings = (lines) => lines.filter((line) => line.startsWith('### ')).join(' | ');
  const actualHeadings = headings(actual.map((entry) => entry.text));
  if (actualHeadings !== headings(expected)) report.problem({ file: shown, line: actual.find((entry) => entry.text.startsWith('### '))?.line, rule: 'agents-drift', message: `the intent map's groups differ: AGENTS.md has [${actualHeadings}], the index [${headings(expected)}]`, fix: 'Rebuild AGENTS.md from the same catalogue, then rerun.' });
  const order = (lines) => lines.map(nameOf).filter((name) => name && expectedNames.has(name) && actualByName.has(name)).join(' ');
  if (order(actual.map((entry) => entry.text)) !== order(expected) && actualHeadings === headings(expected)) report.problem({ file: shown, rule: 'agents-drift', message: 'the intent map lists the skills in a different order or group than the catalogue', fix: 'Rebuild AGENTS.md from the same catalogue, then rerun.' });
}

/** The skills a library README names: its generated skill tables, else its catalogue section. */
function readmeNames(text) {
  const block = markedBlock(text, README_MARKERS);
  if (block !== null) return block.map((entry) => ({ line: entry.line, name: /^\|\s*\[?`([a-z0-9]+(?:-[a-z0-9]+)*)`/.exec(entry.text)?.[1] })).filter((entry) => entry.name);
  const heading = /^(#{2,3}) [^\n]*[Cc]atalogue[^\n]*$/m.exec(text);
  if (!heading) return null;
  const firstLine = lineOf(text, heading.index);
  const rest = text.slice(heading.index + heading[0].length);
  const next = new RegExp(`^#{2,${heading[1].length}} `, 'm').exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  return section.split('\n').map((line, index) => ({ line: firstLine + index, name: /^[-*] `([a-z0-9]+(?:-[a-z0-9]+)*)`/.exec(line)?.[1] })).filter((entry) => entry.name);
}

function checkReadme(readmePath, skills, report) {
  const shown = 'README.md';
  const named = readmeNames(readFileSync(readmePath, 'utf8'));
  if (named === null) {
    report.problem({ file: shown, rule: 'readme-missing', message: 'the README has no skill tables (a generated:skills block) and no catalogue section', fix: 'Add the generated skill tables (the library\'s catalogue build) or a "## The catalogue" section listing every skill.' });
    return;
  }
  const known = new Set(skills.map((skill) => skill.folder));
  const names = new Set(named.map((entry) => entry.name));
  for (const entry of named) {
    if (!known.has(entry.name)) report.problem({ file: shown, line: entry.line, rule: 'readme-stale', message: `the README names ${entry.name}, which is not a skill`, fix: 'Remove it or use the exact name of an existing skill.' });
  }
  for (const name of known) {
    if (!names.has(name)) report.problem({ file: shown, rule: 'readme-missing', message: `the README does not name ${name}`, fix: `Add \`${name}\` with one line on what it does, in its group.` });
  }
}

/** Installed mode: each installed skill the index lists still has the description the index was built from. */
function checkInstalled(indexDir, data, skills, report) {
  const listed = new Set(data.catalog.skills.map((skill) => skill.name));
  const descriptions = renderedDescriptions(indexDir);
  const installed = skills.filter((skill) => listed.has(skill.folder));
  checkNames(installed, report);
  for (const skill of installed) {
    const recorded = descriptions.get(skill.folder);
    if (recorded === undefined) continue;
    if (normalizeSpace(recorded) !== normalizeSpace(skill.description)) report.problem({ file: `${skill.folder}/SKILL.md`, line: 3, rule: 'installed-drift', message: `the description differs from the one the index routes by (references/skill-table.md): the index and ${skill.folder} come from different releases`, fix: `Update the skills together (npx skills add <repo> --skill ${INDEX_NAME} --skill ${skill.folder}), or update the plugin, so the index routes by the current descriptions.` });
  }
  const own = skills.filter((skill) => !listed.has(skill.folder)).length;
  report.note(`installed mode: ${installed.length} of ${listed.size} listed skills installed${own ? `, ${own} other skill${own === 1 ? '' : 's'} (the app's own, not checked)` : ''}; a route to a skill that is not installed names the skill to install`);
  return installed.length;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (options.library && options.installed) fail('--library and --installed exclude each other', 'Pass one of them, or neither to decide from the folder.');
  const minTasks = Number(options['min-tasks']);
  if (!Number.isInteger(minTasks) || minTasks < 1) fail(`--min-tasks ${options['min-tasks']} is not a positive whole number`, 'Pass a number such as 25.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  const repoRoot = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const root = options['skills-root'] !== undefined ? requireDir(resolve(options['skills-root']), 'skills root') : findSkillsRoot(repoRoot);
  if (root === null) return report.notApplicable(`no skills folder in ${repoRoot} (skills/, .agents/skills/, .claude/skills/, ...): no skill is installed, so there is nothing to route`);
  const skills = readSkills(root);
  if (skills.length === 0) fail(`no skill folders with a SKILL.md in ${root}`, 'Pass --skills-root <the folder that holds the skills>.');
  const indexDir = requireDir(resolve(options.index ?? (existsSync(join(root, INDEX_NAME, 'SKILL.md')) ? join(root, INDEX_NAME) : SKILL_DIR)), 'index skill');
  const mode = options.library ? 'library' : options.installed ? 'installed' : detectMode(root, indexDir);
  const loaded = readIndexData(indexDir);
  let checked = skills.length;
  if (loaded.error) {
    report.problem({ file: DATA_FILE, rule: 'index-data', message: loaded.error, fix: 'Restore the shape: plugins, catalog { categories, skills }, tasks, buildOrders (a list of { id, title, intro, steps }), and the optional categoryNotes, rowRules and closure.' });
  } else if (mode === 'installed') {
    checked = checkInstalled(indexDir, loaded.data, skills, report) || skills.length;
    checkRelated(indexDir, new Set(loaded.data.catalog.skills.map((skill) => skill.name)), report);
  } else {
    const data = loaded.data;
    checkNames(skills, report);
    checkCoverage(data, skills, minTasks, report);
    checkRowRules(data, report);
    checkGenerated(indexDir, data, skills, report);
    checkCommands(root, data, skills, report);
    checkClosure(root, data, skills, options.policy === undefined ? null : requireFile(resolve(options.policy), 'dependency policy'), report);
    checkRelated(indexDir, new Set(skills.map((skill) => skill.folder)), report);
    if (options.catalog !== undefined) {
      for (const item of catalogDrift(data, readCatalogFile(requireFile(resolve(options.catalog), 'catalogue')))) report.problem({ file: DATA_FILE, rule: 'catalog-drift', message: item, fix: 'Run build-index.mjs . --catalog <catalogue> --write (never edit the snapshot by hand).' });
    }
    if (options.agents !== undefined) checkAgents(requireFile(resolve(options.agents), 'AGENTS.md'), data, skills, report);
    if (options.readme !== undefined) checkReadme(requireFile(resolve(options.readme), 'README'), skills, report);
    report.note(`library mode: ${skills.length} skills, ${data.catalog.categories.length} categories, ${data.tasks.length} task rows, ${buildSteps(data).length} build steps in ${data.buildOrders.length} orders`);
  }
  return report.finish({ checked, unit: 'skills' });
});
