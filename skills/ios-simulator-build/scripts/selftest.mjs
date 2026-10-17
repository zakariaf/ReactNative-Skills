#!/usr/bin/env node
// selftest.mjs: proves every checker of this skill passes its good fixture and catches each planted
// bug. sim-setup assembles the shipped templates over tests/bases/app (so the templates are the good
// case) with decoys under .agents/skills/, skills/ and a vendored SKILL.md folder that must stay
// silent; sim-app and sim-app-production check a stand-in .app; screenshot cases generate their PNGs.
//   node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

const APP = 'artifacts/Tasks.app';

await runSelftest(import.meta.url, [
  { script: 'check-sim-setup.mjs', fixtures: '../tests/fixtures/sim-setup', args: (dir) => [dir] },
  { script: 'check-sim-app.mjs', fixtures: '../tests/fixtures/sim-app', args: (dir) => [dir, '--app', APP, '--variant', 'preview'] },
  { script: 'check-sim-app.mjs', fixtures: '../tests/fixtures/sim-app-production', args: (dir) => [dir, '--app', APP, '--variant', 'production'] },
  { script: 'check-screenshot.mjs', fixtures: '../tests/fixtures/screenshot', args: (dir) => [dir] },
]);
