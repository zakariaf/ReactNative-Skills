#!/usr/bin/env node
// check-routing.mjs: routing evals for a skill set. Each eval is a realistic task prompt and the
// skill that should handle it (or null for none). The default (offline) mode ranks skills with a
// lexical stand-in for the agent's choice and fails when the expected skill is not in the top N:
// fast, free, run after every description change. --live asks Claude Code itself (one short model
// call per prompt and run). The evals live in the repo: contracts/routing-evals.json by default.
//   node ${CLAUDE_SKILL_DIR}/scripts/check-routing.mjs .
//   node ${CLAUDE_SKILL_DIR}/scripts/check-routing.mjs . --live --only <skill> --runs 3
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { createReporter, fail, parseArgs, resolveLayout, run } from './check-lib.mjs';
import { routeLive } from './lib/live-route.mjs';
import { buildRouter } from './lib/router.mjs';
import { STANDARD_PATH, loadStandard } from './lib/skill-standard.mjs';
import { isAuthoredSkill, nothingToJudge, readSkill, resolveSkillPath } from './lib/skill-md.mjs';

const EVALS_FILE = 'routing-evals.json';

const SPEC = {
  name: 'check-routing',
  summary: 'Runs routing evals: for each prompt, is the expected skill chosen? Offline it ranks skills by description words (the expected skill must be in the top --top); --live runs claude -p and reads the first Skill call. The path is a repo root (default .) or a skills folder.',
  usage: '[path] [options]',
  options: {
    evals: { type: 'string', value: 'file', help: `Evals file (default: <repo>/contracts/${EVALS_FILE}, the contracts folder from resolveLayout): { "evals": [{ "prompt", "expect" }] } or a plain list` },
    'skills-root': { type: 'string', value: 'dir', help: 'The skills folder (same as passing it as the path)' },
    top: { type: 'string', default: '3', help: 'Offline: the expected skill must rank within this many' },
    only: { type: 'string', multiple: true, value: 'skill', help: 'Only evals that expect this skill' },
    prompt: { type: 'string', help: 'One ad-hoc prompt instead of the evals file: alone it prints the ranking (offline: the top --top skills and their scores; live: the skill chosen), with --expect it is an eval' },
    expect: { type: 'string', help: 'The skill the --prompt should route to (omit it to only see the ranking)' },
    'min-per-skill': { type: 'string', default: '2', help: 'Evals each authored, model-invocable skill needs (0 turns eval-coverage off)' },
    'skip-missing': { type: 'boolean', help: 'Skip evals whose expected skill does not exist yet (a note instead of a problem)' },
    live: { type: 'boolean', help: 'Ask Claude Code (claude -p) instead of the offline ranker; costs model calls' },
    runs: { type: 'string', default: '1', help: 'Live: runs per prompt; an eval passes when at least half choose the expected skill' },
    repo: { type: 'string', value: 'dir', help: 'Live: the folder claude runs in (default: the repo root); its project skills are what is tested' },
    'plugin-dir': { type: 'string', value: 'dir', help: 'Live: also load the skills of a plugin folder (claude --plugin-dir <dir>)' },
    claude: { type: 'string', value: 'command', help: 'Live: the Claude Code command (default claude; a .mjs file runs with this Node, which is how the self-test stands in for it)' },
    standard: { type: 'string', value: 'file', help: 'Standard file (default: assets/standard.json of this skill)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  route-miss            the expected skill was not chosen (offline: not in the top N; live: under half the runs)',
    '  route-false-positive  an eval with "expect": null loaded a skill (live only)',
    '  eval-unknown-skill    an eval expects a skill that is not in the set',
    '  eval-shape            an eval is not { prompt: string, expect: skill-name | null }',
    '  eval-placeholder      an eval still holds a template placeholder (__NEW_SKILL_NAME__), even with --skip-missing',
    '  eval-coverage         an authored, model-invocable skill has fewer than --min-per-skill evals',
    '',
    'Authored skills are real folders outside .agents/skills (installers link or copy third-party skills there). A repo',
    'root whose only skills are installed ones is NOT APPLICABLE; pass .agents/skills to route among them.',
    'Live mode reads the session\'s skill list (the stream\'s init event) and stops with exit 2 when an expected skill is',
    'not loaded: skills authored in skills/ need --plugin-dir . (or a .claude/skills/<name> link) to be seen at all.',
    'Write prompts the way the developer writes tasks, without the skill name (a named skill is always found).',
    'Near misses (a prompt that shares words with the skill but belongs to a neighbour) are the valuable ones.',
  ].join('\n'),
};

function loadEvals(path) {
  if (!existsSync(path)) fail(`nothing to check: evals file ${path} does not exist`, `Copy templates/contracts/${EVALS_FILE} of skill-maintenance into the repo and add two prompts per skill, or pass --evals <file> or --prompt "<task>" --expect <skill>.`);
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`, 'The file is JSON: { "evals": [{ "prompt": "...", "expect": "skill-name" }] }.');
  }
  const list = Array.isArray(data) ? data : data?.evals;
  if (!Array.isArray(list)) fail(`${path} holds no evals list`, 'Write { "evals": [{ "prompt": "...", "expect": "skill-name" | null }] } (or a plain list).');
  return list;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const std = loadStandard(options.standard ?? STANDARD_PATH);
  const target = options['skills-root'] ?? positionals[0] ?? '.';
  const resolved = resolveSkillPath(target);
  const report = createReporter({ name: 'check-routing', json: options.json });
  if (resolved.kind === 'skill') fail(`${target} is one skill; routing compares a set`, 'Pass the repo root or the folder that holds the skills.');
  const fact = nothingToJudge([resolved], resolved.kind === 'repo' ? resolved.dirs.filter((dir) => isAuthoredSkill(dir)) : resolved.dirs);
  if (fact) return report.notApplicable(fact);
  if (resolved.dirs.length === 0) fail(`nothing to check: no skill folders with a SKILL.md in ${target}`, 'Pass the repo root or the folder that holds the skills.');
  const repoRoot = resolved.kind === 'repo' ? resolved.path : resolve('.');
  const runbook = std.frontmatter.runbook;
  const skills = resolved.dirs.map((dir) => {
    const parsed = readSkill(dir);
    return { name: dir.split(/[\\/]/).pop(), dir, description: parsed?.frontmatter.description ?? '', listed: String(parsed?.frontmatter[runbook.key] ?? '') !== String(runbook.value) };
  });
  const known = new Set(skills.map((skill) => skill.name));
  const top = Math.max(1, Number(options.top) || 3);
  const runs = Math.max(1, Number(options.runs) || 1);
  const minPerSkill = Math.max(0, Number(options['min-per-skill']) || 0);
  const evalsPath = options.evals ? resolve(options.evals) : join(repoRoot, resolveLayout(repoRoot).contractsDir, EVALS_FILE);
  const where = options.prompt ? '--prompt' : relative(process.cwd(), evalsPath).split(sep).join('/') || evalsPath;
  let evals = (options.prompt ? [{ prompt: options.prompt, expect: options.expect ?? null }] : loadEvals(evalsPath)).map((item, index) => ({ ...item, index }));
  if (options.only.length > 0) evals = evals.filter((item) => options.only.includes(item?.expect));
  const router = buildRouter(skills.filter((skill) => skill.listed).map(({ name, description }) => ({ name, description })));
  const label = (item) => (options.prompt ? '--prompt' : `evals[${item.index}]`);
  const liveOptions = { cwd: resolve(options.repo ?? repoRoot), pluginDir: options['plugin-dir'] ? resolve(options['plugin-dir']) : null, claude: options.claude ? (options.claude.endsWith('.mjs') ? resolve(options.claude) : options.claude) : 'claude' };
  const liveRun = async (prompt, expect = null) => {
    const result = await routeLive(prompt, { ...liveOptions, expect });
    if (result.error && result.firstTool === null && /not installed|exited|within/.test(result.error)) fail(`live routing cannot run: ${result.error}`, 'Install and sign in to Claude Code, run from the repo root, or drop --live.');
    return result;
  };

  // ---- --prompt without --expect: show which skill wins the task today, judge nothing ----
  if (options.prompt && options.expect === undefined) {
    if (options.live) {
      const chosen = [];
      for (let i = 0; i < runs; i += 1) chosen.push((await liveRun(options.prompt)).skill ?? 'no skill');
      report.note(`chose: ${chosen.join(', ')}`);
    } else {
      const ranked = router.rank(options.prompt).slice(0, top);
      ranked.forEach((entry, i) => report.note(`rank #${i + 1} ${entry.name} (score ${entry.score.toFixed(2)})`));
      if (ranked.every((entry) => entry.score <= 0)) report.note('no skill shares a word with this prompt: no skill owns this task yet');
    }
    return report.finish({ checked: 1, unit: `prompt (${options.live ? `live, ${runs} run(s)` : `offline, top ${top}`}; add --expect <skill> to judge it)` });
  }

  // ---- coverage: every authored, listed skill has its prompts ----
  if (!options.prompt && minPerSkill > 0) {
    const counts = new Map();
    for (const item of evals) if (typeof item?.expect === 'string') counts.set(item.expect, (counts.get(item.expect) ?? 0) + 1);
    for (const skill of skills.filter((entry) => entry.listed && isAuthoredSkill(entry.dir) && (options.only.length === 0 || options.only.includes(entry.name)))) {
      const count = counts.get(skill.name) ?? 0;
      if (count < minPerSkill) report.problem({ file: where, rule: 'eval-coverage', message: `${skill.name} has ${count} eval${count === 1 ? '' : 's'} (needs ${minPerSkill})`, fix: `Add ${minPerSkill - count} realistic prompt(s) that should load ${skill.name}, written the way tasks are written (without its name), and one near miss for its closest neighbour.` });
    }
  }

  let checked = 0;
  for (const item of evals) {
    if (!item || typeof item.prompt !== 'string' || item.prompt.trim() === '' || !(item.expect === null || typeof item.expect === 'string')) {
      report.problem({ file: where, rule: 'eval-shape', message: `${label(item ?? { index: '?' })} is not { prompt: string, expect: skill-name | null }`, fix: 'Fix the entry.' });
      continue;
    }
    // The template's seed evals name __PLACEHOLDER__ skills; they fail until replaced, --skip-missing or not.
    const placeholder = [item.prompt, item.expect ?? ''].find((text) => /__[A-Z][A-Z0-9_]*__/.test(text));
    if (placeholder !== undefined) {
      report.problem({ file: where, rule: 'eval-placeholder', message: `${label(item)} still holds the template placeholder ${/__[A-Z][A-Z0-9_]*__/.exec(placeholder)[0]}`, fix: 'Replace the seed with a realistic prompt and the repo skill that should load for it (two per skill, plus a near miss for its neighbour).' });
      continue;
    }
    if (item.expect !== null && !known.has(item.expect)) {
      if (options['skip-missing']) report.note(`skip ${label(item)}: ${item.expect} does not exist yet`);
      else report.problem({ file: where, rule: 'eval-unknown-skill', message: `${label(item)} expects ${item.expect}, which is not in the set`, fix: 'Create the skill, fix the name, or pass --skip-missing while it is being built.' });
      continue;
    }
    checked += 1;
    const shown = item.prompt.length > 70 ? `${item.prompt.slice(0, 67)}...` : item.prompt;
    if (!options.live) {
      if (item.expect === null) continue;
      const ranked = router.rank(item.prompt);
      const place = ranked.findIndex((entry) => entry.name === item.expect) + 1;
      if (place === 0 || place > top) report.problem({ file: where, rule: 'route-miss', message: `${label(item)} "${shown}" ranks ${item.expect} ${place === 0 ? 'nowhere (it is run-only)' : `#${place}`}; top ${top}: ${ranked.slice(0, top).map((entry) => entry.name).join(', ')}`, fix: `Name this category of task in ${item.expect}'s description (lead with it), or add a "Not for" boundary to the skills that win it; never paste the prompt's words in.` });
      else report.note(`ok   ${label(item)} ${item.expect} #${place}`);
      continue;
    }
    const chosen = [];
    for (let i = 0; i < runs; i += 1) {
      const result = await liveRun(item.prompt, item.expect);
      // The session lists its skills before the model answers; an expected skill missing there can never be chosen.
      if (item.expect !== null && Array.isArray(result.loaded) && !result.loaded.includes(item.expect)) {
        fail(`skill ${item.expect} is not loaded in this session (claude listed ${result.loaded.length} skills without it)`, `Pass --plugin-dir . when the repo authors its skills in skills/, or link .claude/skills/${item.expect} to the skill folder, then rerun.`);
      }
      chosen.push(result.skill);
    }
    const hits = chosen.filter((skill) => skill === item.expect).length;
    if (item.expect === null) {
      const loaded = chosen.filter((skill) => skill !== null && known.has(skill));
      if (loaded.length * 2 > runs) report.problem({ file: where, rule: 'route-false-positive', message: `${label(item)} "${shown}" loaded ${loaded.join(', ')} but should load none of these skills`, fix: 'Add this kind of task to the "Not for" clause of the skill that fired.' });
      else report.note(`ok   ${label(item)} no skill (${runs} runs)`);
    } else if (hits * 2 < runs || hits === 0) {
      report.problem({ file: where, rule: 'route-miss', message: `${label(item)} "${shown}" chose ${chosen.map((skill) => skill ?? 'no skill').join(', ')}; expected ${item.expect}`, fix: `Sharpen ${item.expect}'s description around this category of task, or add a "Not for" boundary to the skill that won.` });
    } else {
      report.note(`ok   ${label(item)} ${item.expect} (${hits}/${runs})`);
    }
  }
  return report.finish({ checked, unit: `evals (${options.live ? `live, ${runs} run(s) each` : `offline, top ${top}`})` });
});
