#!/usr/bin/env node
// check-routing-evals.mjs: checks the structure and coverage of tools/routing-evals.json against the
// catalogue: every eval is { prompt, expect: <skill> | null, near?: <skill> }, every named skill exists,
// no prompt is duplicated, every skill has enough prompts, every model-invocable skill has a near miss,
// and some prompts expect no skill at all. It does not rank prompts (skill-maintenance's check-routing.mjs
// does that, offline or live).
// Usage: node tools/check-routing-evals.mjs [--evals <file>] [--catalog <file>] [options]   (see --help)

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATALOG_PATH, TOOLS_DIR, readJson } from './lib/library.mjs';
import { UsageError, createReporter, parseArgs, run } from './shared/scripts/check-lib.mjs';

export const DEFAULT_EVALS = resolve(TOOLS_DIR, 'routing-evals.json');
export const EVAL_KEYS = ['prompt', 'expect', 'near'];
export const PROMPT_MAX = 600;
const LOCAL_PATH = /(?:\/Users\/|\/home\/[a-z]|[A-Za-z]:\\Users\\|\/private\/(?:tmp|var)\/|\/var\/folders\/)/;

/** The key two prompts share when they are the same task (case, punctuation and spacing ignored). */
export const promptKey = (prompt) => prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Check an evals document against a catalogue. Returns a list of problems ({ rule, message, fix, line? }).
 * evalsDoc: { evals: [...] } or a plain list; catalog: { skills: [{ name, manual }] }.
 */
export function checkRoutingEvals(evalsDoc, catalog, { minPerSkill = 3, minNear = 1, minNull = 1 } = {}) {
  const problems = [];
  const evals = Array.isArray(evalsDoc) ? evalsDoc : evalsDoc?.evals;
  if (!Array.isArray(evals)) return [{ rule: 'evals-shape', message: 'has no "evals" list', fix: 'Write { "evals": [{ "prompt": "...", "expect": "<skill>" }] }.' }];
  const skills = new Map((catalog.skills ?? []).map((skill) => [skill.name, skill]));
  const positives = new Map();
  const nearMisses = new Map();
  const seen = new Map();
  let nulls = 0;
  evals.forEach((item, index) => {
    const at = `evals[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      problems.push({ rule: 'eval-shape', message: `${at} is not an object`, fix: 'Write { "prompt": "...", "expect": "<skill>" | null }.' });
      return;
    }
    const extra = Object.keys(item).filter((key) => !EVAL_KEYS.includes(key));
    if (extra.length) problems.push({ rule: 'eval-shape', message: `${at} has unknown key(s) ${extra.join(', ')}`, fix: `Keep only ${EVAL_KEYS.join(', ')}.` });
    const { prompt, expect, near } = item;
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      problems.push({ rule: 'eval-shape', message: `${at} has no prompt text`, fix: 'Write the task the way a developer would.' });
      return;
    }
    const label = `${at} ("${prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt}")`;
    if (prompt.length > PROMPT_MAX) problems.push({ rule: 'eval-shape', message: `${label} is ${prompt.length} characters (at most ${PROMPT_MAX})`, fix: 'Keep the prompt to one realistic task.' });
    if (LOCAL_PATH.test(prompt)) problems.push({ rule: 'eval-local-path', message: `${label} holds a local machine path`, fix: 'Use a repo-relative path (src/..., app.config.ts).' });
    if (expect === 'none') problems.push({ rule: 'eval-expect', message: `${label} expects the string "none"`, fix: 'Write "expect": null for a prompt that should load no skill (skill-maintenance\'s check-routing reads null).' });
    else if (expect === null) nulls += 1;
    else if (typeof expect !== 'string') problems.push({ rule: 'eval-shape', message: `${label} has no "expect" (a skill name or null)`, fix: 'Add "expect": "<skill>" or "expect": null.' });
    else if (!skills.has(expect)) problems.push({ rule: 'eval-unknown-skill', message: `${label} expects ${expect}, which is not in the catalogue`, fix: 'Use a skill name from tools/catalog.json (or null).' });
    else positives.set(expect, (positives.get(expect) ?? 0) + 1);
    if (near !== undefined) {
      if (typeof near !== 'string' || !skills.has(near)) problems.push({ rule: 'eval-unknown-skill', message: `${label} names near ${JSON.stringify(near)}, which is not in the catalogue`, fix: 'near is the catalogue skill whose words the prompt shares; fix or drop it.' });
      else if (near === expect) problems.push({ rule: 'eval-near-self', message: `${label} is a near miss of the skill it expects (${near})`, fix: 'Drop near: a near miss belongs to a different skill than the one it resembles.' });
      else nearMisses.set(near, (nearMisses.get(near) ?? 0) + 1);
    }
    const key = promptKey(prompt);
    if (seen.has(key)) problems.push({ rule: 'eval-duplicate', message: `${label} repeats evals[${seen.get(key)}]`, fix: 'Keep one copy (a duplicate weighs one task twice).' });
    else seen.set(key, index);
  });
  for (const [name, skill] of skills) {
    const count = positives.get(name) ?? 0;
    if (count < minPerSkill) problems.push({ rule: 'eval-coverage', message: `${name} has ${count} prompt${count === 1 ? '' : 's'} that expect it (needs ${minPerSkill})`, fix: `Add ${minPerSkill - count} realistic task prompt(s) that should load ${name}, without naming it.` });
    if (!skill.manual && (nearMisses.get(name) ?? 0) < minNear) problems.push({ rule: 'eval-near-miss', message: `${name} has no near miss (a prompt that shares its words but belongs to a neighbour)`, fix: `Add one with "near": "${name}" and the neighbour skill as "expect".` });
  }
  if (nulls < minNull) problems.push({ rule: 'eval-null', message: `${nulls} prompt(s) expect no skill (needs ${minNull})`, fix: 'Add a task no skill in this library should load, with "expect": null.' });
  return problems;
}

const SPEC = {
  name: 'check-routing-evals',
  summary: 'Checks tools/routing-evals.json against tools/catalog.json: structure, known skills, duplicates, at least --min-per-skill prompts per skill, a near miss for every model-invocable skill, and prompts that expect no skill. Zero dependencies; it ranks nothing.',
  usage: '[--evals <file>] [--catalog <file>] [options]',
  options: {
    evals: { type: 'string', value: 'file', help: 'Routing evals file (default: tools/routing-evals.json)' },
    catalog: { type: 'string', value: 'file', help: 'Catalogue (default: tools/catalog.json)' },
    'min-per-skill': { type: 'string', value: 'n', default: '3', help: 'Prompts each catalogue skill needs (manual runbooks too: they are invoked by name)' },
    'min-near': { type: 'string', value: 'n', default: '1', help: 'Near misses each model-invocable skill needs' },
    'min-null': { type: 'string', value: 'n', default: '1', help: 'Prompts that must expect no skill' },
  },
  positionals: { min: 0, max: 0 },
  details: [
    'Rules: evals-shape, eval-shape, eval-expect ("none" instead of null), eval-unknown-skill, eval-near-self, eval-duplicate,',
    'eval-local-path, eval-coverage, eval-near-miss, eval-null.',
    'An eval: { "prompt": "<a task, written without the skill name>", "expect": "<skill>" | null, "near": "<skill it resembles>" }.',
    'Rank the prompts with skill-maintenance: node skills/skill-maintenance/scripts/check-routing.mjs . --evals tools/routing-evals.json',
    '(offline, seconds) or add --live --runs 3 (asks Claude Code; costs model calls; run by hand, never in CI).',
  ].join('\n'),
};

const count = (value, flag) => {
  if (!/^\d+$/.test(value)) throw new UsageError(`--${flag} must be a whole number, got ${value}`, `Pass --${flag} <n>.`);
  return Number(value);
};

async function main() {
  const { options } = parseArgs(process.argv.slice(2), SPEC);
  const evalsPath = resolve(options.evals ?? DEFAULT_EVALS);
  const catalogPath = resolve(options.catalog ?? CATALOG_PATH);
  const evalsDoc = readJson(evalsPath, `routing evals ${evalsPath}`);
  const catalog = readJson(catalogPath, `catalogue ${catalogPath}`);
  if (!Array.isArray(catalog.skills) || catalog.skills.length === 0) throw new UsageError(`catalogue ${catalogPath} has no "skills" list`, 'Pass the library catalogue (tools/catalog.json).');
  const report = createReporter({ name: 'check-routing-evals' });
  const problems = checkRoutingEvals(evalsDoc, catalog, { minPerSkill: count(options['min-per-skill'], 'min-per-skill'), minNear: count(options['min-near'], 'min-near'), minNull: count(options['min-null'], 'min-null') });
  for (const problem of problems) report.problem({ file: options.evals ?? 'tools/routing-evals.json', ...problem });
  const evals = Array.isArray(evalsDoc) ? evalsDoc : (evalsDoc.evals ?? []);
  report.note(`${evals.length} evals for ${catalog.skills.length} catalogue skills (${evals.filter((item) => item?.expect === null).length} expect no skill, ${evals.filter((item) => typeof item?.near === 'string').length} near misses)`);
  return report.finish({ checked: evals.length, unit: 'evals' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(main);
