// level-run.mjs: runs the repo's real code: starsFor against its golden values, and each game's level
// plan through planLevelTable, compared with the committed pack files (values and bytes). Not an
// entry point.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorText } from './app-modules.mjs';
import { STAR_GOLDENS } from './level-checks.mjs';
import { gameLevelPaths } from './level-layout.mjs';
import { createPackFormatter } from './pack-format.mjs';

/** The one star formula: 3 at or under par, 2 up to par + 2, 1 for finishing; score levels by thresholds. */
export async function checkStarRule(paths, modules, report) {
  const rel = `${paths.kitDir}/level-kit/star-rating.ts`;
  if (!modules.exists(rel)) return 0;
  let starsFor;
  try {
    ({ starsFor } = await modules.load(rel));
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'star-rule', message: `star-rating.ts cannot be loaded: ${errorText(error)}`, fix: 'Keep it free of imports other than the contract types (copy the template).' });
    return 1;
  }
  for (const golden of STAR_GOLDENS) {
    const stars = starsFor(golden.rule, golden.run);
    if (stars !== golden.stars) report.problem({ file: rel, line: 1, rule: 'star-rule', message: `starsFor(${JSON.stringify(golden.rule)}, ${JSON.stringify(golden.run)}) is ${stars}, the star rule gives ${golden.stars}`, fix: 'Restore star-rating.ts from templates/src/core/game/level-kit/star-rating.ts: 3 stars at or under par, 2 up to par + 2, 1 for finishing, 0 for a loss; score levels 2 and 3 at the upper thresholds.' });
  }
  return 1;
}

function firstDifference(expected, actual) {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (JSON.stringify(expected[index]) !== JSON.stringify(actual[index])) {
      return `entry ${index}: committed ${JSON.stringify(actual[index] ?? null)}, the plan generates ${JSON.stringify(expected[index] ?? null)}`;
    }
  }
  return null;
}

/** Runs the game's plan headless: { packs, failures } from planLevelTable. Throws on a load error. */
export async function runPlan(paths, modules, gameId) {
  const planRel = gameLevelPaths(paths, gameId).plan;
  const planModule = await modules.load(planRel);
  const plan = Object.values(planModule).find((value) => value && typeof value === 'object' && typeof value.rate === 'function' && value.solver);
  if (!plan) throw new Error(`${planRel} exports no LevelPlan`);
  const { planLevelTable } = await modules.load(`${paths.kitDir}/level-kit/plan-level-table.ts`);
  return planLevelTable(plan);
}

/** Writes every pack the plan generates, formatted as generate-levels.ts does (the self-test's score repo). */
export async function writePacks(paths, modules, gameId) {
  const { packs, failures } = await runPlan(paths, modules, gameId);
  if (failures.length > 0) throw new Error(`${gameId}: ${failures.length} levels without a candidate`);
  const formatter = await createPackFormatter(paths.root);
  for (const [index, pack] of packs.entries()) {
    const rel = gameLevelPaths(paths, gameId).pack(index + 1);
    writeFileSync(join(paths.root, rel), await formatter.format(rel, pack));
  }
  return packs.length;
}

function readCommitted(path) {
  try {
    const text = readFileSync(path, 'utf8');
    return { text, value: JSON.parse(text) };
  } catch {
    return { text: null, value: null };
  }
}

/**
 * Regenerates the table from the game's plan and compares it with the committed packs, value by
 * value (pack-stale) and byte by byte against the generator's Prettier output (pack-format).
 */
export async function checkPlan(paths, modules, gameId, report) {
  const game = gameLevelPaths(paths, gameId);
  const regenerate = `node scripts/levels/generate-levels.ts --game ${gameId}`;
  if (!modules.exists(game.plan) || !modules.exists(`${paths.kitDir}/level-kit/plan-level-table.ts`)) return 0;
  let planned;
  try {
    planned = await runPlan(paths, modules, gameId);
  } catch (error) {
    report.problem({ file: game.plan, rule: 'plan-run', message: `the level plan cannot run headless: ${errorText(error)}`, fix: `The plan and everything it imports must be pure (${paths.coreDir}, the game's rules/ and levels/); fix the error, then rerun.` });
    return 1;
  }
  // One problem per game: a band or curve that is too tight fails dozens of levels at once, and one
  // line per level would bury every other finding.
  if (planned.failures.length > 0) {
    const [first, ...rest] = planned.failures;
    const shown = rest.slice(0, 5).map((failure) => failure.level).join(', ');
    const more = rest.length === 0 ? '' : ` (and ${rest.length} more level${rest.length === 1 ? '' : 's'}: ${shown}${rest.length > 5 ? ', ...' : ''})`;
    report.problem({ file: game.plan, rule: 'plan-failure', message: `level ${first.level}: no candidate passed the solver and rate() in ${first.tries} tries${more}`, fix: 'Loosen rate() for that band, raise maxTries or the solver budget, or lower the difficulty there; many failing levels usually mean the curve or a band is too tight. (A witness that loses a candidate is only a retry; the level fails when every try is lost or rejected.)' });
  }
  // An incomplete table is not compared: the generator writes nothing until every level has a candidate.
  if (planned.failures.length > 0) return 1;
  const formatter = await createPackFormatter(paths.root);
  for (const [index, generated] of planned.packs.entries()) {
    const rel = game.pack(index + 1);
    const committed = readCommitted(join(paths.root, rel));
    const difference = Array.isArray(committed.value) ? firstDifference(generated, committed.value) : 'the file is missing or not an array';
    if (difference !== null) {
      report.problem({ file: rel, rule: 'pack-stale', message: `differs from what the plan generates (${difference})`, fix: `Regenerate: ${regenerate}, read the golden diff, and commit with a Gate-Change: trailer.` });
      continue;
    }
    const expected = await formatter.format(rel, generated);
    if (committed.text !== expected) {
      const line = committed.text.split('\n').findIndex((row, at) => row !== expected.split('\n')[at]) + 1;
      report.problem({ file: rel, line, rule: 'pack-format', message: `holds the right levels but not the bytes generate-levels.ts writes (compared with ${formatter.source}; for example short arrays such as score thresholds go on one line)`, fix: `Regenerate the pack (${regenerate}), which formats through the repo's Prettier, so prettier --check and generate-levels --check agree. Never hand-format a pack or add it to .prettierignore.` });
    }
  }
  return 1;
}
