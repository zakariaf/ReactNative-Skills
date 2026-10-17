#!/usr/bin/env node
// Fake "emulator" and "avdmanager" for the self-test (one script, told apart by the arguments):
// emulator -list-avds prints scenario.avds (default tasks-parity); avdmanager create avd succeeds.
import { existsSync, readFileSync } from 'node:fs';

const scenario = existsSync('scenario.json') ? JSON.parse(readFileSync('scenario.json', 'utf8')) : {};
const args = process.argv.slice(2);
if (args[0] === '-list-avds') {
  process.stdout.write(`${(scenario.avds ?? ['tasks-parity']).join('\n')}\n`);
  process.exit(0);
}
if (args[0] === 'create' && args[1] === 'avd') process.exit(0);
process.exit(0);
