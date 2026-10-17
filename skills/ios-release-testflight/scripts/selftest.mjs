#!/usr/bin/env node
// selftest.mjs: proves both checkers pass their good fixtures and catch every planted bug.
// release-setup cases assemble from the shipped templates plus tests/bases/repo; files that must
// never be committed (key-named files, private key text, a .claude/settings.json) are planted at
// run time by the suite's ops. store-artifact cases assemble from tests/bases/app; a case whose
// arguments name --ipa gets its Payload/ zipped into that .ipa first.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { parseArgs, runSelftest } from './check-lib.mjs';

parseArgs(process.argv.slice(2).filter((arg) => arg === '--help' || arg === '-h'), {
  name: 'selftest',
  summary: 'Runs check-release-setup and check-store-artifact against tests/fixtures (overlay cases).',
  usage: '[--case <glob>]... [--materialize <dir>]',
  options: {},
  positionals: { min: 0, max: 0 },
});

const ARTIFACT_DEFAULTS = ['--app', '{dir}/Payload/Tasks.app', '--entitlements', '{dir}/entitlements.plist', '--variant', 'production', '--version', '1.4.0', '--build', '14'];

/** The repo root (unless ARGS.txt starts with {dir}), then the case's words or the defaults; --ipa <file> zips Payload/ into it. */
function artifactArgs(dir, context) {
  const words = context.argsTxt ?? ARTIFACT_DEFAULTS.map((word) => word.replaceAll('{dir}', dir));
  const ipaAt = words.indexOf('--ipa');
  if (ipaAt >= 0) {
    const zip = spawnSync('zip', ['-qr', words[ipaAt + 1], 'Payload'], { cwd: dir });
    if (zip.status !== 0) throw new Error(`zip failed in ${dir}`);
  }
  return words[0] === dir ? words : [dir, ...words];
}

await runSelftest(import.meta.url, [
  { script: 'check-release-setup.mjs', fixtures: '../tests/fixtures/release-setup', args: (dir) => [dir] },
  { script: 'check-store-artifact.mjs', fixtures: '../tests/fixtures/store-artifact', args: artifactArgs, argsFile: 'error-only' },
]);
