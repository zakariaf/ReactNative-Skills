#!/usr/bin/env node
// selftest.mjs: proves both checkers pass the shipped templates and catch every planted bug.
// Each suite's base is this skill's templates (filled for the Tasks app's tasks feature) plus
// tests/bases/app (stand-ins for the files the app and other skills own: the root layout, models
// that play the moments, a game with drained events); every case is that tree plus one planted change
// (mutation.json). Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-audio-haptics.mjs', fixtures: '../tests/fixtures/check-audio-haptics', args: (dir) => [dir] },
  { script: 'check-sound-banks.mjs', fixtures: '../tests/fixtures/check-sound-banks', args: (dir) => [dir] },
]);
