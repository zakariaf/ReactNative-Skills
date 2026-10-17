// scripts/games/new-game.ts
// `npm run new-game -- --game <id> --name "<Name>" --hints none|solver --continue none|once [--write]`
// The root script "new-game" runs this file from the repo root. It forwards every argument to the
// new-game-scaffold skill's generator (wherever an agent installed the skill), so the npm script and
// the skill write exactly the same files. It never writes anything itself.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { findGenerator, generatorCandidates, SKILL_NAME } from './find-generator.ts';

const generator = findGenerator((path) => existsSync(path));

if (generator === null) {
  console.error(`The ${SKILL_NAME} generator is not installed here.`);
  console.error(`Looked for: ${generatorCandidates().join(', ')}.`);
  console.error(`Install the skill (npx skills add <library> --skill ${SKILL_NAME}), then rerun.`);
  console.error(
    'Installed as a Claude Code plugin? Its folder is outside this repo: run node <skill dir>/scripts/scaffold-game.mjs . with the same arguments.',
  );
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, [generator, '.', ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 2;
}
