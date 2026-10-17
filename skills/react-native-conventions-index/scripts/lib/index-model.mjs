// index-model.mjs: reads the skills, finds the skills folder of a repo, loads and validates the
// curated index data (assets/index.json), and renders every generated part of the index: the skill
// catalogue, the intent map, the task matrix, the build orders and the quick table in SKILL.md.
// Shared by build-index.mjs (writes) and check-index.mjs (compares). Not an entry point.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_SKILL_FOLDERS } from '../check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** This skill's folder (scripts/lib/ is two levels below it). */
export const SKILL_DIR = resolve(HERE, '..', '..');
/** The folder name of the index skill, used to find it inside a skills folder. */
export const INDEX_NAME = 'react-native-conventions-index';
export const DATA_FILE = 'assets/index.json';
export const QUICK_START = '<!-- generated:task-table:start (build-index.mjs; edit assets/index.json instead) -->';
export const QUICK_END = '<!-- generated:task-table:end -->';
export const GENERATED_FILES = ['references/skill-table.md', 'references/intent-map.md', 'references/task-matrix.md', 'references/build-orders.md'];
/** The phrases every description uses (CONTRIBUTING section 10); the repo's catalogue tool splits on the same two. */
export const TRIGGER_PHRASE = 'Use when';
export const NOT_FOR_PHRASE = 'Not for';
/** AGENTS.md's generated intent map sits between these markers. */
export const AGENTS_MARKERS = { start: '<!-- generated:intents:start -->', end: '<!-- generated:intents:end -->' };
/** README.md's generated skill tables sit between these markers. */
export const README_MARKERS = { start: '<!-- generated:skills:start -->', end: '<!-- generated:skills:end -->' };
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MANUAL_KEY = 'disable-model-invocation';
/** Where skills live in a repo, most specific first: the library's own folder, then agent install folders. */
export const SKILL_FOLDER_CANDIDATES = ['skills', ...AGENT_SKILL_FOLDERS.filter((folder) => folder !== 'skills').map((folder) => `${folder}/skills`)];

export const isSkillName = (name) => NAME.test(name);

/** name, description and the other one-line keys of a SKILL.md frontmatter (optionally quoted). */
export function readFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return null;
  const values = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1).replaceAll("''", "'");
    }
    values[match[1]] = value;
  }
  return values;
}

/** Every skill in a skills folder: a folder holding a SKILL.md, sorted by folder name. */
export function readSkills(root) {
  const skills = [];
  for (const entry of readdirSync(root).sort()) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const dir = join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir || !existsSync(join(dir, 'SKILL.md'))) continue;
    const frontmatter = readFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8')) ?? {};
    skills.push({ folder: entry, name: frontmatter.name ?? '', description: frontmatter.description ?? '', manual: String(frontmatter[MANUAL_KEY]) === 'true' });
  }
  return skills;
}

/**
 * The skills folder of a repo: the first candidate (skills/, .agents/skills/, .claude/skills/, ...)
 * that holds the index skill, else the first that holds any skill. Returns null when there is none.
 */
export function findSkillsRoot(repoRoot) {
  const found = SKILL_FOLDER_CANDIDATES.map((rel) => join(repoRoot, rel)).filter((dir) => existsSync(dir) && statSync(dir).isDirectory() && readSkills(dir).length > 0);
  return found.find((dir) => existsSync(join(dir, INDEX_NAME, 'SKILL.md'))) ?? found[0] ?? null;
}

/**
 * library: the skills folder is a library's own top-level skills/ folder that holds the index skill
 * itself (every listed skill must be there, and nothing else). installed: anything else - the folder
 * sits inside an agent folder (.agents/skills, .claude/skills, a plugin cache under ~/.claude), or it is
 * an app's own skills/ folder while the index comes from a plugin or another folder. An app's skills
 * are then its own, never "missing from the index".
 */
export function detectMode(skillsRoot, indexDir) {
  const root = resolve(skillsRoot);
  const segments = root.split(sep);
  const agentFolders = new Set(AGENT_SKILL_FOLDERS.filter((folder) => folder !== 'skills'));
  if (segments.slice(0, -1).some((segment) => agentFolders.has(segment)) || basename(root) !== 'skills') return 'installed';
  return dirname(resolve(indexDir)) === root ? 'library' : 'installed';
}

const text = (value) => typeof value === 'string' && value.trim() !== '';
const texts = (value) => Array.isArray(value) && value.every(text);
const nonEmptyTexts = (value) => texts(value) && value.length > 0;
const optionalTexts = (value) => value === undefined || texts(value);

/** The curated data, or an error message saying what is wrong with its shape. */
export function readIndexData(indexDir) {
  const path = join(indexDir, DATA_FILE);
  if (!existsSync(path)) return { error: `${DATA_FILE} does not exist` };
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { error: `${DATA_FILE} is not valid JSON (${error.message})` };
  }
  const problem = dataError(data);
  return problem ? { error: `${DATA_FILE}: ${problem}` } : { data };
}

function dataError(data) {
  if (!Array.isArray(data?.plugins) || data.plugins.length === 0 || !data.plugins.every((plugin) => text(plugin?.key) && text(plugin?.name))) return 'plugins must be a list of { key, name }';
  const catalog = data.catalog;
  if (!Array.isArray(catalog?.categories) || catalog.categories.length === 0 || !catalog.categories.every((category) => text(category?.key) && text(category?.label))) return 'catalog.categories must be a list of { key, label }';
  const categoryKeys = new Set(catalog.categories.map((category) => category.key));
  const pluginKeys = new Set(data.plugins.map((plugin) => plugin.key));
  const skillOk = (skill) => text(skill?.name) && categoryKeys.has(skill.category) && pluginKeys.has(skill.plugin) && typeof skill.manual === 'boolean';
  if (!Array.isArray(catalog.skills) || !catalog.skills.every(skillOk)) return 'catalog.skills must be a list of { name, category (a catalog.categories key), plugin (a plugins key), manual: true|false }';
  if (data.categoryNotes !== undefined && (typeof data.categoryNotes !== 'object' || data.categoryNotes === null || !Object.entries(data.categoryNotes).every(([key, note]) => categoryKeys.has(key) && text(note)))) return 'categoryNotes must map catalog category keys to one sentence each';
  const taskOk = (task) => text(task?.task) && texts(task?.skills) && (task.note === undefined || text(task.note)) && (task.quick === undefined || typeof task.quick === 'boolean');
  if (!Array.isArray(data.tasks) || !data.tasks.every(taskOk)) return 'tasks must be a list of { task, skills: [names], note?, quick? }';
  const ruleOk = (rule) => text(rule?.id) && nonEmptyTexts(rule?.when) && optionalTexts(rule?.whenAny) && nonEmptyTexts(rule?.require) && text(rule?.why);
  if (data.rowRules !== undefined && !(Array.isArray(data.rowRules) && data.rowRules.every(ruleOk))) return 'rowRules must be a list of { id, when: [lead skills], whenAny?: [skills anywhere in the row], require: [skills], why }';
  const ordersError = buildOrdersError(data.buildOrders);
  if (ordersError) return ordersError;
  const ids = new Set(data.buildOrders.map((order) => order.id));
  if (data.requireManifests !== undefined && !(texts(data.requireManifests) && data.requireManifests.every((id) => ids.has(id)))) return 'requireManifests must list buildOrders ids (the orders whose every step states what it copies, installs or generates)';
  const verifyError = verifyGreenError(data.verifyGreen, data.buildOrders);
  if (verifyError) return verifyError;
  return closureError(data.closure);
}

/**
 * The optional verifyGreen block: which gate of `npm run verify` is red until which step of which order,
 * and what to run meanwhile. { intro, order: <buildOrders id>, rows: [{ gate, greenFrom: <step number>, before, meanwhile? }] }
 */
function verifyGreenError(block, orders) {
  if (block === undefined) return null;
  const order = orders.find((entry) => entry.id === block?.order);
  if (!text(block?.intro) || !order || !Array.isArray(block?.rows) || block.rows.length === 0) return 'verifyGreen must be { intro, order: <a buildOrders id>, rows: [{ gate, greenFrom, before, meanwhile? }] }';
  const rowOk = (row) => text(row?.gate) && Number.isInteger(row?.greenFrom) && row.greenFrom >= 1 && row.greenFrom <= order.steps.length && text(row?.before) && (row.meanwhile === undefined || text(row.meanwhile));
  if (!block.rows.every(rowOk)) return `verifyGreen.rows must be { gate, greenFrom: <a step number of "${order.id}">, before, meanwhile? }`;
  return null;
}

function buildOrdersError(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return 'buildOrders must be a non-empty list of { id, title, intro, steps }';
  const seen = new Map();
  for (const [index, order] of orders.entries()) {
    const where = `buildOrders[${index}]`;
    if (!text(order?.id) || !text(order?.title) || !text(order?.intro) || !Array.isArray(order?.steps) || order.steps.length === 0) return `${where} must be { id, title, intro, base?, steps: [{ step, skills: [names], proof, localLane? }] }`;
    if (seen.has(order.id)) return `${where} repeats the id "${order.id}"`;
    for (const [stepIndex, step] of order.steps.entries()) {
      if (!text(step?.step) || !texts(step?.skills) || !text(step?.proof)) return `${where}.steps[${stepIndex}] must be { step, skills: [names], proof }`;
      if (step.noManifest !== undefined && !text(step.noManifest)) return `${where}.steps[${stepIndex}].noManifest must say why the step writes no file`;
      if (step.localLane !== undefined && !text(step.localLane)) return `${where}.steps[${stepIndex}].localLane must be the proof a team on the local lanes (no EAS) runs instead`;
      const manifest = manifestError(step);
      if (manifest) return `${where}.steps[${stepIndex}]: ${manifest}`;
    }
    if (order.base !== undefined) {
      const from = seen.get(order.base?.order);
      if (!from || !Number.isInteger(order.base?.through) || order.base.through < 1 || order.base.through > from.steps.length) return `${where}.base must be { order: <the id of an earlier order>, through: <one of its step numbers> }`;
    }
    seen.set(order.id, order);
  }
  return null;
}

/**
 * A step's optional manifest (the build-order contract):
 *   copies:    [{ skill, paths: [repo paths or globs, tests included], exclude?: [globs], swap?: true,
 *                merge?: true (JSON message catalogs: merge the keys into the file an earlier step copied),
 *                examples?: true (a glob may take examples/ files too; by default only a literal path does),
 *                importsLater?: [globs or npm names that are stand-ins until a later step brings them],
 *                deferredTests?: [{ test, why }] (a test a later step copies, named and explained), note? }]
 *   installs:  [{ package, companions?: [packages], where?: text }]   (plan-dependency.mjs, dependency-management)
 *   generates: [{ tool, paths: [repo paths or globs], installs?: [packages the written package.json holds] }]
 *   noManifest: text                                                    (why the step writes no file: it only runs tools)
 */
export function manifestError(step) {
  const deferredOk = (value) => value === undefined || (Array.isArray(value) && value.every((item) => text(item?.test) && text(item?.why)));
  const copyOk = (copy) => text(copy?.skill) && nonEmptyTexts(copy?.paths) && optionalTexts(copy?.exclude) && optionalTexts(copy?.importsLater) && deferredOk(copy?.deferredTests) && ['swap', 'merge', 'examples'].every((key) => copy[key] === undefined || typeof copy[key] === 'boolean') && !(copy.swap && copy.merge) && (copy.note === undefined || text(copy.note));
  const installOk = (install) => text(install?.package) && optionalTexts(install?.companions) && (install.where === undefined || text(install.where));
  const generateOk = (gen) => text(gen?.tool) && nonEmptyTexts(gen?.paths) && optionalTexts(gen?.installs);
  const listOk = (value, ok) => value === undefined || (Array.isArray(value) && value.every(ok));
  if (!listOk(step?.copies, copyOk)) return 'copies must be a list of { skill, paths: [repo paths or globs], exclude?, importsLater?, deferredTests?: [{ test, why }], swap? or merge?, examples?, note? }';
  if (!listOk(step?.installs, installOk)) return 'installs must be a list of { package, companions?: [names], where? }';
  if (!listOk(step?.generates, generateOk)) return 'generates must be a list of { tool, paths: [repo paths or globs], installs?: [names] }';
  return null;
}

/** The optional closure block: how template repo paths and imports map in the app (defaults: single app, @/ and @test/). */
function closureError(closure) {
  if (closure === undefined) return null;
  const aliasOk = (alias) => text(alias?.prefix) && typeof alias?.to === 'string';
  if (typeof closure !== 'object' || closure === null) return 'closure must be an object';
  if (closure.aliases !== undefined && !(Array.isArray(closure.aliases) && closure.aliases.every(aliasOk))) return 'closure.aliases must be a list of { prefix, to }';
  if (closure.roots !== undefined && !nonEmptyTexts(closure.roots)) return 'closure.roots must be a non-empty list of repo folders';
  if (closure.coverage !== undefined && !nonEmptyTexts(closure.coverage)) return 'closure.coverage must be a non-empty list of globs';
  if (closure.placeholders !== undefined && (typeof closure.placeholders !== 'object' || closure.placeholders === null || !Object.entries(closure.placeholders).every(([key, value]) => /^__[A-Z][A-Z0-9_]*__$/.test(key) && text(value)))) return 'closure.placeholders must map __UPPER_SNAKE__ tokens to values';
  return null;
}

/** Every build step with a label, in order. */
export function buildSteps(data) {
  return data.buildOrders.flatMap((order, orderIndex) => order.steps.map((step, index) => ({ label: `buildOrders[${orderIndex}] "${order.id}" step ${index + 1}`, step, order })));
}

/** Every place the data names a skill, for the stale-name check. */
export function namedSkills(data) {
  const out = [];
  data.catalog.skills.forEach((skill, index) => out.push({ name: skill.name, where: `catalog.skills[${index}]` }));
  data.tasks.forEach((task, index) => task.skills.forEach((name) => out.push({ name, where: `tasks[${index}] "${task.task}"` })));
  for (const { label, step } of buildSteps(data)) step.skills.forEach((name) => out.push({ name, where: label }));
  (data.rowRules ?? []).forEach((rule) => [...rule.when, ...(rule.whenAny ?? []), ...rule.require].forEach((name) => out.push({ name, where: `rowRules "${rule.id}"` })));
  return out;
}

/** The catalogue part of the index data, in the shape of the library catalogue's entries. */
export function catalogSnapshot(catalog) {
  return {
    categories: catalog.categories.map(({ key, label }) => ({ key, label })),
    skills: catalog.skills.map(({ name, category, plugin, manual }) => ({ name, category, plugin, manual: Boolean(manual) })),
  };
}

/** The description split into its lead, the "Use when" clause and the "Not for" clause (as the catalogue tool splits it). */
export function splitDescription(description) {
  const at = description.indexOf(TRIGGER_PHRASE);
  const lead = (at === -1 ? description : description.slice(0, at)).trim();
  const rest = at === -1 ? '' : description.slice(at + TRIGGER_PHRASE.length).trim();
  const notAt = rest.indexOf(NOT_FOR_PHRASE);
  return { lead, useWhen: (notAt === -1 ? rest : rest.slice(0, notAt)).trim().replace(/[.;,\s]+$/, ''), notFor: notAt === -1 ? '' : rest.slice(notAt).trim() };
}

/** The intent line AGENTS.md shows for a skill (same wording as the repo's catalogue tool). */
export function intentText(description) {
  const { lead, useWhen } = splitDescription(description);
  return useWhen ? `${TRIGGER_PHRASE.toLowerCase()} ${useWhen}` : lead.replace(/[.\s]+$/, '');
}

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const code = (name) => `\`${name}\``;
const GENERATED_NOTE = 'Generated by `scripts/build-index.mjs` from `assets/index.json` and every skill\'s frontmatter. Do not edit it by hand: change the data (or a skill\'s description), then run `node ${CLAUDE_SKILL_DIR}/scripts/build-index.mjs --write`.';

/** The skills of each catalogue category, in catalogue order, limited to the skills present. */
function categoriesWithSkills(data, skills) {
  const present = new Map(skills.map((skill) => [skill.folder, skill]));
  return data.catalog.categories.map((category) => ({ ...category, skills: data.catalog.skills.filter((entry) => entry.category === category.key && present.has(entry.name)).map((entry) => ({ ...entry, description: present.get(entry.name).description })) })).filter((category) => category.skills.length > 0);
}

const pluginName = (data, key) => data.plugins.find((plugin) => plugin.key === key)?.name ?? key;

export function renderSkillTable(data, skills) {
  const groups = categoriesWithSkills(data, skills);
  const count = groups.reduce((sum, group) => sum + group.skills.length, 0);
  const plugins = data.plugins.map((plugin) => `\`${plugin.name}\` ${groups.flatMap((group) => group.skills).filter((skill) => skill.plugin === plugin.key).length}`).join(', ');
  const lines = ['# Skill catalogue', '', GENERATED_NOTE, '', `${count} skills in ${groups.length} groups (plugins: ${plugins}). Each row is the skill's own description: what an agent reads when it decides to load a skill. A skill marked (runbook) loads only when it is named.`, '', '## Contents', ''];
  for (const group of groups) lines.push(`- ${group.label}`);
  for (const group of groups) {
    const note = data.categoryNotes?.[group.key];
    const pluginKeys = [...new Set(group.skills.map((skill) => skill.plugin))];
    const pluginNote = pluginKeys.length === 1 && pluginKeys[0] !== data.plugins[0].key ? ` Plugin \`${pluginName(data, pluginKeys[0])}\`.` : '';
    lines.push('', `## ${group.label}`, '', ...(note || pluginNote ? [`${note ?? ''}${pluginNote}`.trim(), ''] : []), '| Skill | Description |', '|---|---|');
    for (const skill of group.skills) lines.push(`| ${code(skill.name)}${skill.manual ? ' (runbook)' : ''} | ${cell(skill.description)} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** The intent bullets of one skill, exactly as the AGENTS.md intent map writes them. */
export function intentBullet(skill) {
  return `- \`${skill.name}\`${skill.manual ? ' (runbook: only when asked by name)' : ''}: ${cell(intentText(skill.description))}.`;
}

/** The expected AGENTS.md intent map: a heading per category, a bullet per present skill. */
export function intentLines(data, skills) {
  return categoriesWithSkills(data, skills).flatMap((group) => [`### ${group.label}`, ...group.skills.map(intentBullet)]);
}

export function renderIntentMap(data, skills) {
  const lines = ['# Intent map', '', GENERATED_NOTE, '',
    'One row per skill: the "Use when" and "Not for" clauses of its description. This is the same map the library\'s AGENTS.md carries for agents that read AGENTS.md instead of skill descriptions; `check-index.mjs --agents AGENTS.md` proves the two agree. Use it to find the lead skill; then use the task matrix to find what to load with it.', '', '## Contents', ''];
  const groups = categoriesWithSkills(data, skills);
  for (const group of groups) lines.push(`- ${group.label}`);
  for (const group of groups) {
    lines.push('', `## ${group.label}`, '', '| Skill | Use when | Not for |', '|---|---|---|');
    for (const skill of group.skills) {
      const { notFor } = splitDescription(skill.description);
      const name = `${code(skill.name)}${skill.manual ? ' (runbook)' : ''}`;
      lines.push(`| ${name} | ${cell(intentText(skill.description))} | ${cell(notFor.replace(/^Not for\s*/, '').replace(/\.$/, ''))} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderTaskMatrix(data) {
  const lines = ['# Task to skills', '', GENERATED_NOTE, '', '## Contents', '', '- How to read a row', '- Row rules', '- The matrix', '', '## How to read a row', '',
    'Find every row that matches the task and load every skill in them before writing code: the first skill leads the work and the others each own one part of it (their rules and checks apply too). Several rows can apply: load the union. The note says what to add or watch for. A skill the developer names in the task is always loaded as well.',
    '', '## Row rules', '', ...(data.rowRules?.length ? ['Every row whose lead is one of the "when" skills, or that loads one of the "anywhere" skills at any place, also loads every "require" skill (`check-index.mjs` rule `row-rule`).', '', '| Rule | When the lead is | Or the row loads | Also load | Why |', '|---|---|---|---|---|', ...data.rowRules.map((rule) => `| ${rule.id} | ${rule.when.map(code).join(', ')} | ${(rule.whenAny ?? []).map(code).join(', ') || '-'} | ${rule.require.map(code).join(', ')} | ${cell(rule.why)} |`)] : ['None.']),
    '', '## The matrix', '', '| # | Task | Load these skills (the first one leads) | Note |', '|---|---|---|---|'];
  data.tasks.forEach((task, index) => lines.push(`| ${index + 1} | ${cell(task.task)} | ${task.skills.map(code).join(', ')} | ${cell(task.note ?? '')} |`));
  return `${lines.join('\n')}\n`;
}

function stepTable(steps) {
  const lines = ['| # | Step | Skills | Done when |', '|---|---|---|---|'];
  steps.forEach((step, index) => lines.push(`| ${index + 1} | ${cell(step.step)} | ${step.skills.map(code).join(', ')} | ${cell(step.localLane ? `${step.proof} Local lanes (no EAS): ${step.localLane}` : step.proof)} |`));
  return lines;
}

/** Repo paths as inline code; a glob takes every matching template of that skill, tests included. */
const pathList = (paths) => paths.map(code).join(', ');

function copyLine(copy) {
  const parts = [`- Copy from ${code(copy.skill)}: ${pathList(copy.paths)}`];
  if (copy.exclude?.length) parts.push(` (not ${pathList(copy.exclude)})`);
  if (copy.swap) parts.push(', replacing the earlier copy of the same path');
  if (copy.merge) parts.push(', merging their keys into the files an earlier step copied (never replacing them)');
  if (copy.examples) parts.push(' (examples included)');
  if (copy.importsLater?.length) parts.push(`; stand-ins until a later step brings ${pathList(copy.importsLater)}`);
  if (copy.note) parts.push(`. ${copy.note[0].toUpperCase()}${copy.note.slice(1).replace(/\.$/, '')}`);
  const lines = [`${parts.join('')}.`];
  for (const deferred of copy.deferredTests ?? []) lines.push(`  - Its test ${code(deferred.test)} comes later: ${deferred.why.replace(/\.$/, '')}.`);
  return lines;
}

export function manifestLines(entry) {
  const lines = [];
  for (const copy of entry.copies ?? []) lines.push(...copyLine(copy));
  for (const install of entry.installs ?? []) {
    const companions = install.companions?.length ? ` with its companion${install.companions.length > 1 ? 's' : ''} ${pathList(install.companions)}` : '';
    lines.push(`- Install ${code(install.package)}${companions}${install.where ? ` (${install.where})` : ''}: run \`plan-dependency.mjs ${install.package} .\` (dependency-management) and its printed commands.`);
  }
  for (const gen of entry.generates ?? []) lines.push(`- Generated by ${gen.tool}: ${pathList(gen.paths)}${gen.installs?.length ? `; the written package.json installs ${pathList(gen.installs)}` : ''}.`);
  if (entry.noManifest) lines.push(`- Writes no file from a template: ${entry.noManifest.replace(/\.$/, '')}.`);
  return lines;
}

const MANIFEST_INTRO = 'The build-order contract: at each step, copy exactly these templates (tests included), install exactly these packages, and run the named tool for the generated files. A path is the repo path written on line 1 of a template (or its path under `templates/`) in the named skill; a glob takes every such template of that skill that no earlier step copied. Every import of a copied file resolves to a file copied or generated at that step or earlier, every npm package it imports is installed by then, and every file brings its test in the same step, so `tsc`, `check:fast` and `test:coverage` stay green after every step: `check-index.mjs` (rule `step-import-closure`) proves it on the library. When a copy fails to compile, the manifest is wrong: report it, never fetch files by following tsc errors.';

const RUNNING_CHECKS = 'Run every "done when" command from the repo root as `node <that skill\'s folder>/scripts/<script>.mjs . <options>`: the repo root is the first argument, never `--root`. A skill in brackets after a command owns the script. A line `SKIP <file> [<rule>] not yet created (<skill> creates it)` names a file a later step creates; it is expected until that step and a failure after it. `NOT APPLICABLE: <fact>` means a repo fact puts the whole check out of scope (the package is not installed). Exit 2 is never a pass.';

/** The verifyGreen table: which gate of `npm run verify` is expected red until which step, and what to run meanwhile. */
function verifyGreenLines(block) {
  if (!block) return [];
  return ['', '### When `npm run verify` is green', '', block.intro, '', '| Gate | Green from | Red before that because | Run meanwhile |', '|---|---|---|---|',
    ...block.rows.map((row) => `| ${cell(row.gate)} | step ${row.greenFrom} | ${cell(row.before)} | ${cell(row.meanwhile ?? '-')} |`)];
}

function orderSection(order, data) {
  const orders = data.buildOrders;
  const hasCopies = order.steps.some((step) => manifestLines(step).length);
  const base = order.base ? ` It starts from a repo that has passed steps 1 to ${order.base.through} of "${orders.find((other) => other.id === order.base.order)?.title ?? order.base.order}".` : '';
  return ['', `## ${order.title}`, '', order.intro, '', ...stepTable(order.steps),
    ...(data.verifyGreen?.order === order.id ? verifyGreenLines(data.verifyGreen) : []),
    ...(hasCopies ? ['', `### What each step copies, installs and generates`, '', `${MANIFEST_INTRO}${base}`, ...order.steps.flatMap((step, index) => (manifestLines(step).length ? ['', `Step ${index + 1}:`, '', ...manifestLines(step)] : []))] : [])];
}

export function renderBuildOrders(data) {
  const lines = ['# Build orders', '', GENERATED_NOTE, '', '## Contents', '', '- Running a "done when" check', ...data.buildOrders.map((order) => `- ${order.title}`), '',
    'Each layer is tested before anything depends on it. A step starts only when the step before it passes its "done when" checks. Every step is test-first (tdd-workflow) and ends in a commit and a short report (git-commits-and-reporting).',
    '', '## Running a "done when" check', '', RUNNING_CHECKS,
    ...data.buildOrders.flatMap((order) => orderSection(order, data))];
  return `${lines.join('\n')}\n`;
}

export function renderQuickTable(data) {
  const lines = [QUICK_START, '| Task | Load these skills (the first one leads) |', '|---|---|'];
  for (const task of data.tasks.filter((row) => row.quick === true)) lines.push(`| ${cell(task.task)} | ${task.skills.map(code).join(' ')} |`);
  lines.push(QUICK_END);
  return lines.join('\n');
}

/** SKILL.md with its generated block replaced, or null when the markers are missing. */
export function withQuickTable(skillMd, data) {
  const start = skillMd.indexOf(QUICK_START);
  const end = skillMd.indexOf(QUICK_END);
  if (start === -1 || end === -1 || end < start) return null;
  return `${skillMd.slice(0, start)}${renderQuickTable(data)}${skillMd.slice(end + QUICK_END.length)}`;
}

/** Every generated output: relative path -> the content it must have now (SKILL.md null when unmarked). */
export function renderAll(indexDir, data, skills) {
  const skillMdPath = join(indexDir, 'SKILL.md');
  const skillMd = existsSync(skillMdPath) ? readFileSync(skillMdPath, 'utf8') : '';
  return {
    'references/skill-table.md': renderSkillTable(data, skills),
    'references/intent-map.md': renderIntentMap(data, skills),
    'references/task-matrix.md': renderTaskMatrix(data),
    'references/build-orders.md': renderBuildOrders(data),
    'SKILL.md': withQuickTable(skillMd, data),
  };
}

/** The descriptions the rendered catalogue holds: name -> description (for an installed copy's drift check). */
export function renderedDescriptions(indexDir) {
  const path = join(indexDir, 'references', 'skill-table.md');
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\| `([a-z0-9-]+)`(?: \(runbook\))? \| (.*) \|$/.exec(line);
    if (match) out.set(match[1], match[2].replace(/\\\|/g, '|'));
  }
  return out;
}

/** The lines between two markers (null when the markers are missing), with the 1-based line number of each. */
export function markedBlock(text, markers) {
  const start = text.indexOf(markers.start);
  const end = text.indexOf(markers.end);
  if (start === -1 || end === -1 || end < start) return null;
  const firstLine = text.slice(0, start).split('\n').length;
  return text.slice(start, end).split('\n').map((line, index) => ({ line: firstLine + index, text: line })).slice(1);
}

export const normalizeSpace = (value) => String(value).replace(/\s+/g, ' ').trim();
