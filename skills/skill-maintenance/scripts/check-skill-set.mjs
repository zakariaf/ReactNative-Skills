#!/usr/bin/env node
// check-skill-set.mjs: checks the whole skill set for what no single-skill check can see:
// descriptions that overlap or start the same, "Not for" hand-offs to skills that do not exist,
// the listing budget and the average description length, and an index skill that forgets a skill.
// Run after adding a skill or changing a description:
//   node ${CLAUDE_SKILL_DIR}/scripts/check-skill-set.mjs skills
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, parseArgs, parseJsonc, run } from './check-lib.mjs';
import { STANDARD_PATH, loadStandard } from './lib/skill-standard.mjs';
import { findRepoRoot, isAuthoredSkill, notForNames, nothingToJudge, readSkill, resolveSkillPath } from './lib/skill-md.mjs';

const SPEC = {
  name: 'check-skill-set',
  summary: 'Checks a skill set as a whole: duplicate or overlapping descriptions, identical leads, "Not for" names that do not exist, the listing budget, the average description length, and the index skill naming every skill. The path is a skills folder or a repo root (its skills/, .claude/skills/ and .agents/skills/).',
  usage: '[path] [options]',
  options: {
    'max-overlap': { type: 'string', default: '0.3', help: 'Highest allowed word overlap (Jaccard) between two descriptions' },
    budget: { type: 'string', help: 'Most characters the listed skills may add to the skill listing (default: listing.setBudgetChars of the standard, 20000, scaled by the repo\'s skillListingBudgetFraction)' },
    average: { type: 'string', help: 'Highest average description length (default: listing.averageDescriptionTarget of the standard, 250)' },
    index: { type: 'string', help: 'The index skill that must name every skill (default: the one skill whose name ends in -index; "none" turns the check off)' },
    standard: { type: 'string', value: 'file', help: 'Standard file (default: assets/standard.json of this skill)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  desc-duplicate    two skills have the same description',
    '  desc-lead         two descriptions start with the same five content words (the agent reads the lead first)',
    '  desc-overlap      two descriptions share more than --max-overlap of their words (before "Not for")',
    '  not-for-unknown   a "Not for (...)" hand-off names a skill that does not exist (bundled and Expo skills count as known)',
    '  not-for-self      a description hands off to itself',
    '  listing-budget    names plus descriptions of the listed skills exceed --budget characters, so descriptions get dropped',
    '  desc-average      the average description is longer than --average characters',
    '  index-coverage    an authored index skill (SKILL.md, references/*.md, assets/*.json) does not name every authored skill',
    '',
    'Skills with disable-model-invocation: true leave the listing: they count for neither budget nor average.',
    'Installed skills (.agents/skills/, or a link) count toward the listing budget and toward collisions with an',
    'authored skill, but their own hand-offs, average and index coverage belong to their authors: those print as',
    'notes. listing-budget fails only when the authored skills push the set over; installed skills that exceed it',
    'alone print a note. A repo root whose only skills are installed ones is NOT APPLICABLE; pass the installed',
    'folder (.agents/skills) to judge those skills whole.',
    'The budget default keeps the set under two thirds of the 30,000-character listing measured at the default',
    'skillListingBudgetFraction (0.01) on a 1,000,000-token context window (2026-10-16), because the set shares the',
    'listing with the developer\'s other skills; the listing is a share of the window, so a smaller window needs a',
    'lower --budget. Skills installed from a plugin live outside the repo and are not counted: with any installed',
    '(this library\'s plugin too), lower --budget by their share. When',
    'the repo\'s .claude/settings.local.json or .claude/settings.json (read in that order) sets',
    'skillListingBudgetFraction, the budget scales with it (0.04 gives 80,000). --budget overrides both; the',
    'developer\'s own ~/.claude/settings.json is not read.',
  ].join('\n'),
};

// The listing fraction the measured budget belongs to, and where a repo sets its own (first found wins).
const DEFAULT_FRACTION = 0.01;
const SETTINGS_FILES = ['.claude/settings.local.json', '.claude/settings.json'];

/** The listing budget and where it came from: --budget, the repo's skillListingBudgetFraction, or the default. */
function listingBudget(std, given, repoRoot) {
  const base = std.listing?.setBudgetChars ?? 20000;
  if (given !== undefined) return { budget: Number(given), source: '--budget' };
  for (const rel of repoRoot ? SETTINGS_FILES : []) {
    const path = join(repoRoot, rel);
    if (!existsSync(path)) continue;
    let settings;
    try {
      settings = parseJsonc(readFileSync(path, 'utf8'));
    } catch (error) {
      fail(`cannot read ${rel}: ${error.message}`, 'Fix the JSON of the settings file, or pass --budget <characters>.');
    }
    const fraction = settings?.skillListingBudgetFraction;
    if (fraction === undefined) continue;
    if (typeof fraction !== 'number' || !(fraction > 0) || fraction > 1) fail(`${rel} sets skillListingBudgetFraction to ${JSON.stringify(fraction)}`, 'Use a number above 0 and at most 1 (0.04 for a large skill set).');
    return { budget: Math.round((base * fraction) / DEFAULT_FRACTION), source: `skillListingBudgetFraction ${fraction} in ${rel}` };
  }
  return { budget: base, source: `default at skillListingBudgetFraction ${DEFAULT_FRACTION}` };
}

const STOP = new Set(
  ('a an and are as at be by for from in into is it its of on or the to with when use used using not this that each every all any via per ' +
    'without only than then so no one two new app apps skill skills do does make run write set add check build ' +
    'builds checks adds makes runs writes sets creates keeps').split(' '),
);

function contentWords(description) {
  const what = description.split(/\bNot for\b/)[0];
  return what.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP.has(word));
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const std = loadStandard(options.standard ?? STANDARD_PATH);
  const resolved = resolveSkillPath(positionals[0] ?? '.');
  const report = createReporter({ name: 'check-skill-set', json: options.json });
  if (resolved.kind === 'skill') fail(`${positionals[0]} is one skill; this checks a set`, 'Pass the folder that holds the skills (skills) or the repo root; check one skill with check-skill.mjs.');
  const fact = nothingToJudge([resolved], resolved.kind === 'repo' ? resolved.dirs.filter((dir) => isAuthoredSkill(dir)) : resolved.dirs);
  if (fact) return report.notApplicable(fact);
  if (resolved.dirs.length === 0) fail(`nothing to check: no skill folders with a SKILL.md in ${positionals[0] ?? '.'}`, 'Pass the folder that holds the skills, or the repo root.');
  const maxOverlap = Number(options['max-overlap']);
  const { budget, source: budgetSource } = listingBudget(std, options.budget, resolved.kind === 'repo' ? resolved.path : findRepoRoot(resolved.path));
  const average = Number(options.average ?? std.listing?.averageDescriptionTarget ?? 250);
  const overhead = std.listing?.perEntryOverheadChars ?? 4;
  for (const [key, value] of [['max-overlap', maxOverlap], ['budget', budget], ['average', average]]) if (!Number.isFinite(value) || value <= 0) fail(`--${key} must be a positive number`, `Example: --${key} ${key === 'max-overlap' ? '0.3' : '20000'}`);
  const runbook = std.frontmatter.runbook;
  const skills = resolved.dirs.map((dir) => {
    const parsed = readSkill(dir);
    const name = dir.split(/[\\/]/).pop();
    return { name, dir, description: parsed?.frontmatter.description ?? '', listed: String(parsed?.frontmatter[runbook.key] ?? '') !== String(runbook.value), authored: isAuthoredSkill(dir) };
  });
  // Judge the authored skills; a skills folder named explicitly (.agents/skills) with none authored is judged whole.
  if (!skills.some((skill) => skill.authored)) for (const skill of skills) skill.authored = true;
  const foreign = (skill, text) => report.note(`note: ${skill.name} (installed) ${text}; its author owns it`);
  const known = new Set([...skills.map((skill) => skill.name), ...std.names.reserved]);

  let listing = 0;
  let installedListing = 0;
  let lengths = 0;
  const listed = skills.filter((skill) => skill.listed);
  const judged = listed.filter((skill) => skill.authored);
  for (const skill of skills) {
    if (skill.listed) listing += skill.name.length + skill.description.length + overhead;
    if (skill.listed && !skill.authored) installedListing += skill.name.length + skill.description.length + overhead;
    if (skill.listed && skill.authored) lengths += skill.description.length;
    for (const other of notForNames(skill.description)) {
      if (!skill.authored) {
        if (other === skill.name || !known.has(other)) foreign(skill, `hands off to ${other}, which is ${other === skill.name ? 'itself' : 'not in this set'}`);
        continue;
      }
      if (other === skill.name) report.problem({ file: `${skill.name}/SKILL.md`, line: 3, rule: 'not-for-self', message: 'the "Not for" clause names the skill itself', fix: 'Name the neighbouring skill that owns that work.' });
      else if (!known.has(other)) report.problem({ file: `${skill.name}/SKILL.md`, line: 3, rule: 'not-for-unknown', message: `"Not for" hands off to ${other}, which does not exist`, fix: 'Use the neighbour\'s exact folder name, or create that skill.' });
    }
  }
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const a = skills[i];
      const b = skills[j];
      // Two installed skills colliding is their authors' business; a collision with an authored skill is ours.
      const target = b.authored ? b : a.authored ? a : null;
      const other = target === b ? a : b;
      if (!target) continue;
      if (a.description && a.description === b.description) {
        report.problem({ file: `${target.name}/SKILL.md`, line: 3, rule: 'desc-duplicate', message: `has the same description as ${other.name}`, fix: 'Write what this skill alone does, with its own trigger words.' });
        continue;
      }
      const wordsA = contentWords(a.description);
      const wordsB = contentWords(b.description);
      if (wordsA.length >= 5 && wordsA.slice(0, 5).join(' ') === wordsB.slice(0, 5).join(' ')) {
        report.problem({ file: `${target.name}/SKILL.md`, line: 3, rule: 'desc-lead', message: `starts like ${other.name} ("${wordsA.slice(0, 5).join(' ')}")`, fix: 'Lead with the verb and object only this skill has.' });
      }
      const setA = new Set(wordsA);
      const setB = new Set(wordsB);
      const shared = [...setA].filter((word) => setB.has(word));
      const overlap = shared.length / (setA.size + setB.size - shared.length || 1);
      if (overlap > maxOverlap) {
        report.problem({ file: `${target.name}/SKILL.md`, line: 3, rule: 'desc-overlap', message: `shares ${Math.round(overlap * 100)}% of its words with ${other.name} (${shared.join(', ')})`, fix: 'Split the work cleanly: rewrite both descriptions around what differs and add each as the other\'s "Not for".' });
      }
    }
  }
  const raise = `raise skillListingBudgetFraction in .claude/settings.json (0.04 gives ${Math.round(((std.listing?.setBudgetChars ?? 20000) * 0.04) / DEFAULT_FRACTION)})`;
  if (listing > budget && installedListing > budget) report.note(`note: the installed skills alone take ${installedListing} of the ${budget}-character listing budget (${budgetSource}); ${raise}, or remove installed skills the app does not use`);
  else if (listing > budget) report.problem({ file: '', line: 0, rule: 'listing-budget', message: `names and descriptions of ${listed.length} listed skills total ${listing} characters, over the ${budget} budget (${budgetSource})`, fix: `Shorten the longest descriptions (trigger words first), split a side-effecting run-* runbook out of the listing, or ${raise}.` });
  const mean = judged.length ? Math.round(lengths / judged.length) : 0;
  if (mean > average) {
    const longest = [...judged].sort((a, b) => b.description.length - a.description.length).slice(0, 3).map((skill) => `${skill.name} ${skill.description.length}`);
    report.problem({ file: '', line: 0, rule: 'desc-average', message: `descriptions average ${mean} characters, over the ${average} target (longest: ${longest.join(', ')})`, fix: 'Cut the longest descriptions to the trigger words and the one job; the listing is shared with every other installed skill.' });
  }

  const indexCandidates = skills.filter((skill) => skill.name.endsWith('-index')).map((skill) => skill.name);
  const indexName = options.index === 'none' ? null : (options.index ?? (indexCandidates.length === 1 ? indexCandidates[0] : null));
  if (indexName) {
    const index = skills.find((skill) => skill.name === indexName);
    if (!index) fail(`the index skill ${indexName} does not exist in ${resolved.path}`, 'Pass --index <existing skill>, --index none, or drop the option.');
    // The index may render its table from data: its SKILL.md, references/*.md and assets/*.json all count.
    const filesIn = (folder, ext) => (existsSync(join(index.dir, folder)) ? readdirSync(join(index.dir, folder)).filter((file) => file.endsWith(ext)).map((file) => readFileSync(join(index.dir, folder, file), 'utf8')) : []);
    const text = [readFileSync(join(index.dir, 'SKILL.md'), 'utf8'), ...filesIn('references', '.md'), ...filesIn('assets', '.json')].join('\n');
    // An installed index lists its own library, not this repo's skills; an authored index names every authored skill.
    for (const { name } of index.authored ? skills.filter((skill) => skill.authored) : []) {
      if (name !== indexName && !new RegExp(`(^|[^a-z0-9-])${name}([^a-z0-9-]|$)`).test(text)) report.problem({ file: `${indexName}/SKILL.md`, line: 0, rule: 'index-coverage', message: `the index never names ${name}`, fix: `Add ${name} to the index's routing table with when to load it.` });
    }
  }
  const installed = skills.filter((skill) => !skill.authored).length;
  report.note(`listing: ${listed.length} listed skills (${skills.length - listed.length} run-only${installed ? `, ${installed} installed` : ''}), ${listing} of ${budget} characters (${budgetSource}), average authored description ${mean} (target ${average})`);
  return report.finish({ checked: skills.length, unit: 'skills' });
});
