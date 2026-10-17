#!/usr/bin/env node
// fake-jest.mjs: stands in for `npx jest` in the self-test of rebaseline.mjs (passed as --jest "node fake-jest.mjs").
// --listTests prints fake-jest/list.txt. A run copies fake-jest/<update|assertions|golden>.json to --outputFile with
// fresh timestamps and exits like Jest (0 green, 1 red); with -u it first writes fake-jest/writes.json ({ path: text }).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, 'fake-jest');
const args = process.argv.slice(2);
if (args.includes('--listTests')) {
  process.stdout.write(readFileSync(join(data, 'list.txt'), 'utf8'));
  process.exit(0);
}
const isUpdate = args.includes('-u');
const name = isUpdate ? 'update.json' : args.includes('--ignoreProjects') ? 'assertions.json' : 'golden.json';
const result = JSON.parse(readFileSync(join(data, name), 'utf8'));
result.startTime = Date.now();
for (const file of result.testResults) {
  file.startTime = result.startTime;
  file.endTime = result.startTime + 1;
}
if (isUpdate) {
  const writes = JSON.parse(readFileSync(join(data, 'writes.json'), 'utf8'));
  for (const [path, text] of Object.entries(writes)) writeFileSync(join(here, path), text);
}
writeFileSync(args[args.indexOf('--outputFile') + 1], `${JSON.stringify(result)}\n`);
process.exit(result.success ? 0 : 1);
