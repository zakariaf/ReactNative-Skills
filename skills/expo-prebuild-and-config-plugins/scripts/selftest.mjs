// selftest.mjs: proves both checkers of this skill against planted-bug fixtures.
// check-native-generation's cases assemble from tests/bases/app plus this skill's templates (so the
// shipped plugin, its test and the contract are the good case), plus each case's mutation.json.
// check-native-snapshot's cases read a saved introspection of an SDK 57 app (--from).
// The bad-native-tracked case needs git: its args hook stages the planted ios/ folder first.
//   node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]
import { spawnSync } from 'node:child_process';

import { runSelftest } from './check-lib.mjs';

function stageNativeFolder(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-f', 'ios'], { cwd: dir });
}

await runSelftest(import.meta.url, [
  {
    script: 'check-native-generation.mjs',
    fixtures: '../tests/fixtures/check-native-generation',
    args: (dir, { name }) => {
      if (name === 'bad-native-tracked') stageNativeFolder(dir);
      return [dir];
    },
  },
  {
    script: 'check-native-snapshot.mjs',
    fixtures: '../tests/fixtures/check-native-snapshot',
    args: (dir) => [dir, '--from', 'introspect.json'],
  },
]);
