// scripts/deps/check-npm-config.ts
// Fails when the config npm will actually run with breaks the dependency policy: an NPM_CONFIG_*
// variable or a ~/.npmrc line that switches a guard of the project .npmrc off. It needs no
// node_modules, so it runs before the install: in CI before `npm ci`, and on EAS Build as the
// "eas-build-pre-install" script, where EAS environment variables reach npm too.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { EFFECTIVE_KEYS, effectiveConfigProblems, parseConfigGet } from './effective-npm-config.ts';
import { excludePatternsOf } from './release-age-excludes.ts';

function main(): number {
  const result = spawnSync('npm', ['config', 'get', ...EFFECTIVE_KEYS], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`check-npm-config: npm config get failed\n${result.stdout}${result.stderr}`);
    return 1;
  }
  const projectExcludes = excludePatternsOf(readFileSync('.npmrc', 'utf8'));
  const problems = effectiveConfigProblems(parseConfigGet(result.stdout), projectExcludes);
  for (const problem of problems) {
    console.error(`check-npm-config: ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
