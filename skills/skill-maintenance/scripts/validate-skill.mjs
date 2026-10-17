#!/usr/bin/env node
// validate-skill.mjs: checks skills against the skill standard: frontmatter, description, SKILL.md
// sections and size, links, self-containment, device calls, layout, fixture hygiene and budget,
// scripts (--help, the RESULT line, zero dependencies), self-test fixtures and shared copies.
// The constants come from assets/standard.json (or --standard <file>).
//   node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs skills/<name>
//   node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs .            (every skill in the repo)
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { UsageError, createReporter, fail, parseArgs, run } from './check-lib.mjs';
import { RULES, STANDARD_PATH, compileStandard, libraryLayout, loadStandard, validateSkill } from './lib/skill-standard.mjs';
import { isAuthoredSkillsFolder, judgedSkills, nothingToJudge, resolveSkillPath } from './lib/skill-md.mjs';

const SPEC = {
  name: 'validate-skill',
  summary: 'Validates skills against the skill standard (constants in assets/standard.json). A path is a skill folder, a skills folder (every skill in it, plus the folder layout), or a repo root (its authored skills in skills/ and .claude/skills/; skills installed under .agents/skills/ are their authors\' and only noted: pass that folder to validate them).',
  usage: '[path...] [options]',
  options: {
    standard: { type: 'string', value: 'file', help: 'Standard constants file (default: assets/standard.json of this skill)' },
    shared: { type: 'string', value: 'dir', help: 'The canonical shared folder of a skill library: turns on shared-drift (each copy in assets/shared.json must equal its canonical file)' },
    'no-run': { type: 'boolean', help: 'Skip running the skill scripts (the --help and no-argument runs, up to 30 s each)' },
    rule: { type: 'string', multiple: true, value: 'id', help: 'Report only this rule (comma-separated ids allowed)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: Infinity },
  details: `Rules:\n${Object.entries(RULES).map(([id, text]) => `  ${id.padEnd(22)} ${text}`).join('\n')}\n\nlibrary-layout runs on an authored skills folder (skills/), never on an installer's .claude/skills or .agents/skills.\nA repo root (package.json or .git) with no skill folders, or whose only skills are installed ones, is NOT APPLICABLE;\nany other folder without skills exits 2.`,
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const standardFile = options.standard ?? STANDARD_PATH;
  const S = compileStandard(loadStandard(standardFile));
  const shared = options.shared ? resolve(options.shared) : null;
  if (shared && !existsSync(shared)) fail(`the shared folder ${options.shared} does not exist`, 'Pass the canonical shared folder of your skill library, or drop --shared.');
  const ruleFilter = new Set(options.rule.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean));
  for (const id of ruleFilter) if (!(id in RULES)) throw new UsageError(`unknown rule "${id}"`, `Use one of: ${Object.keys(RULES).join(', ')}.`);
  const wants = (rule) => ruleFilter.size === 0 || ruleFilter.has(rule);
  const runScripts = !options['no-run'] && (wants('script-help') || wants('script-result'));

  const report = createReporter({ name: 'validate-skill', json: options.json });
  const resolved = (positionals.length > 0 ? positionals : ['.']).map((path) => resolveSkillPath(path));
  const { judged, installed } = judgedSkills(resolved);
  const dirs = [...judged];
  // An authored skills folder holds only skill folders: a child folder without SKILL.md is validated (and fails skill-md).
  for (const item of resolved.filter((entry) => entry.kind === 'skills-folder' && isAuthoredSkillsFolder(entry.path))) {
    for (const entry of readdirSync(item.path, { withFileTypes: true })) {
      const dir = join(item.path, entry.name);
      if (entry.isDirectory() && !/^[_.]/.test(entry.name) && !existsSync(join(dir, 'SKILL.md'))) dirs.push(dir);
    }
  }
  if (dirs.length === 0) {
    const fact = nothingToJudge(resolved, judged);
    if (fact) return report.notApplicable(fact);
    fail(`nothing to check: no folder with a SKILL.md in ${positionals.join(', ') || '.'}`, 'Pass a skill folder, a skills folder or the repo root.');
  }
  // The folder layout of each authored skills folder that was named or found.
  const layoutRoots = [...new Set(resolved.filter((item) => item.kind !== 'skill').flatMap((item) => item.roots).filter(isAuthoredSkillsFolder))];
  if (wants('library-layout')) for (const skillsRoot of layoutRoots) for (const problem of libraryLayout({ skillsRoot })) report.problem(problem);

  if (installed.length > 0) report.note(`note: ${installed.length} installed skill(s) not validated (their authors own them; pass .agents/skills to validate them): ${installed.map((dir) => dir.split(/[\\/]/).pop()).join(', ')}`);
  let passed = 0;
  for (const dir of dirs) {
    const name = dir.split(/[\\/]/).pop();
    const problems = validateSkill({ name, dir }, { shared }, { runScripts, standard: S }).filter((problem) => wants(problem.rule));
    for (const problem of problems) report.problem(problem);
    if (problems.length === 0) passed += 1;
    report.note(`skill ${name}: ${problems.length === 0 ? 'passes' : `${problems.length} problems`}`);
  }
  report.note(`${passed} of ${dirs.length} skills pass`);
  return report.finish({ checked: dirs.length, unit: 'skills' });
});
