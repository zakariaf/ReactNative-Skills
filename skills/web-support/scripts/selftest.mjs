#!/usr/bin/env node
// selftest.mjs: proves check-web-support.mjs passes the shipped templates laid over a small Tasks web app
// (tests/bases/app) and catches every planted bug, and that check-web-export.mjs reads an export the way
// a host serves it (tests/fixtures/check-web-export). The browser rules of check-web-export.mjs
// (tests/fixtures/check-web-export-browser: a stand-in bundle that renders, logs, throws, loses its
// testID, is served without isolation, or ignores the browser language) run when Chrome, Chromium or
// Edge is installed; without one the self-test says so and runs the rest.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs [--case <glob>] [--materialize <dir>]

import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { runSelftest } from './check-lib.mjs';

/** The browser check-web-export.mjs --browser auto would pick, or null. */
function installedBrowser() {
  const known = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  const onPath = (process.env.PATH ?? '').split(delimiter).flatMap((dir) => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map((name) => join(dir, name)));
  return [...known, ...onPath].find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

const browser = installedBrowser();
const suites = [
  { script: 'check-web-support.mjs', fixtures: '../tests/fixtures/check-web-support', args: (dir) => [dir] },
  { script: 'check-web-export.mjs', fixtures: '../tests/fixtures/check-web-export', args: (dir) => [dir] },
];
if (browser) suites.push({ script: 'check-web-export.mjs', fixtures: '../tests/fixtures/check-web-export-browser', args: (dir) => [dir, '--browser', browser, '--timeout', '2000'] });
else console.log('selftest: no Chrome, Chromium or Edge found, so the browser cases (tests/fixtures/check-web-export-browser) did not run');

await runSelftest(import.meta.url, suites);
