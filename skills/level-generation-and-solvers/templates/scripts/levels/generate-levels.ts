// scripts/levels/generate-levels.ts
// Usage: node scripts/levels/generate-levels.ts --game <game-id> [--check] [--games-dir src/games]
//        [--src-dir src]
// Runs the game's level plan (<games-dir>/<game-id>/levels/<game-id>-level-plan.ts) and writes
// pack-<n>.json next to it through the repo's Prettier. With --check it writes nothing and exits 1
// when a committed pack differs from what the plan generates today (a changed rule, curve, tuning
// or solver). Exit 1 too when a level has no accepted candidate, and 2 on a usage error. Never
// hand-edit or hand-format a pack, and never copy one from another game: regenerate.
import { parseArgs } from 'node:util';

import { registerAppImports } from './app-imports.ts';

const GAME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const USAGE = [
  'Usage: node scripts/levels/generate-levels.ts --game <game-id> [--check]',
  '         [--games-dir src/games] [--src-dir src]',
  '  --game       the game id (kebab-case); its plan is <games-dir>/<id>/levels/<id>-level-plan.ts',
  '  --check      write nothing; exit 1 when a committed pack differs from the generated one',
  '  --games-dir  the folder of the games (default src/games)',
  '  --src-dir    the folder the @/ alias points at (default src)',
].join('\n');

function usageError(message: string): never {
  console.error(`generate-levels: ${message} (run with --help for usage)`);
  process.exit(2);
}

function readArgs() {
  try {
    return parseArgs({
      options: {
        game: { type: 'string' },
        check: { type: 'boolean', default: false },
        'games-dir': { type: 'string', default: 'src/games' },
        'src-dir': { type: 'string', default: 'src' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }).values;
  } catch (error: unknown) {
    return usageError(error instanceof Error ? error.message : String(error));
  }
}

const values = readArgs();
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const gameId = values.game ?? '';
if (!GAME_ID.test(gameId)) usageError('pass --game <game-id> (kebab-case)');

registerAppImports(process.cwd(), values['src-dir']);
const { runLevelPlan } = await import('./run-level-plan.ts');
const summary = await runLevelPlan({
  rootDir: process.cwd(),
  srcDir: values['src-dir'],
  gamesDir: values['games-dir'],
  gameId,
  isCheck: values.check,
});
for (const failure of summary.failures) console.error(failure);
for (const path of summary.differing)
  console.error(`${values.check ? 'differs' : 'wrote'}: ${path}`);
const verb = values.check ? 'differing' : 'written';
console.warn(
  `${gameId}: ${String(summary.levels)} levels, ${String(summary.failures.length)} failures, ${String(summary.differing.length)} ${verb} packs`,
);
process.exitCode =
  summary.failures.length > 0 || (values.check && summary.differing.length > 0) ? 1 : 0;
