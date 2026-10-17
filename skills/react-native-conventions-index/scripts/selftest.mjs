#!/usr/bin/env node
// Self-test: build-index.mjs and check-index.mjs run on one small skill library (tests/bases/library:
// an index skill, two skills with templates, a catalogue file, AGENTS.md and README.md). Each case of
// tests/fixtures/<script>/ is that library plus its overlay: good/ must pass, and every bad-*/ holds one
// planted bug that must fail with the lines of its EXPECT.txt. The library holds two task rows, so
// check-index runs with --min-tasks 2; --catalog, --agents and --readme are passed when the files exist.
// An ARGS.txt replaces the arguments for its case.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { runSelftest } from './check-lib.mjs';

const library = (dir) => ['--skills-root', join(dir, 'skills'), '--index', join(dir, 'skills', 'route-index')];
const when = (dir, file, option) => (existsSync(join(dir, file)) ? [option, join(dir, file)] : []);

await runSelftest(import.meta.url, [
  { script: 'build-index.mjs', fixtures: '../tests/fixtures/build-index', args: (dir) => [...library(dir), ...when(dir, 'catalog.json', '--catalog')] },
  {
    script: 'check-index.mjs',
    fixtures: '../tests/fixtures/check-index',
    args: (dir) => [...library(dir), '--min-tasks', '2', ...when(dir, 'catalog.json', '--catalog'), ...when(dir, 'AGENTS.md', '--agents'), ...when(dir, 'README.md', '--readme')],
  },
]);
