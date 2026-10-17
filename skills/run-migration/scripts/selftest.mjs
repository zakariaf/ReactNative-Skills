#!/usr/bin/env node
// selftest.mjs: proves check-migration, record-shipped and restore-snapshot against tests/fixtures/:
// each passes the good repo and catches every planted bug for its own rule. restore-snapshot's
// simulator and emulator modes run against stand-in `xcrun` and `adb` commands put first on PATH:
// they answer from folders in the case directory, as simctl and adb run-as answer from a device.
// record-shipped --ref runs in a git repository made at run time from the assembled case.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { applyMutation, makeTempDir, removeTempDir, runSelftest } from './check-lib.mjs';
import { loadDatabaseSync } from './lib/sqlite-drill.mjs';

/** Where the stand-ins keep an app's files, relative to the case directory (their working directory). */
const SIM_CONTAINER = 'sim-container';
const EMU_APP_DATA = 'emu-app-data';

/**
 * db/app.db at version 2 (a step deleted its rows) beside db/app.db.v1.bak, the VACUUM INTO copy the
 * open path took before that step: made with node:sqlite at run time (no binary committed). The same
 * files sit in the stand-in simulator container and emulator app folder.
 */
async function writeDatabases(dir) {
  const DatabaseSync = await loadDatabaseSync();
  const folder = join(dir, 'db');
  mkdirSync(folder, { recursive: true });
  const db = new DatabaseSync(join(folder, 'app.db'));
  db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL) STRICT;
INSERT INTO tasks (id, title) VALUES (1, 'Water the plants'), (2, 'Mum''s birthday 🎂');
PRAGMA user_version = 1;`);
  db.prepare('VACUUM INTO ?').run(join(folder, 'app.db.v1.bak'));
  db.exec('ALTER TABLE tasks ADD COLUMN is_done INTEGER; DELETE FROM tasks; PRAGMA user_version = 2;');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  cpSync(folder, join(dir, SIM_CONTAINER, 'Documents', 'SQLite'), { recursive: true });
  cpSync(folder, join(dir, EMU_APP_DATA, 'files', 'SQLite'), { recursive: true });
}

/**
 * `xcrun simctl`: get_app_container prints the case's sim-container folder; terminate answers as
 * device-stub.json's "terminate" says: "not-running" (the default: exit 3, as simctl does for an app
 * that is not running), "running" (exit 0) or "error" (exit 149, a simulator that is not booted).
 */
const XCRUN_STUB = `
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const [tool, command, udid, bundleId] = process.argv.slice(2);
const state = existsSync('device-stub.json') ? JSON.parse(readFileSync('device-stub.json', 'utf8')) : {};
const failWith = (status, text) => { process.stderr.write(text); process.exit(status); };
if (tool !== 'simctl' || udid === undefined || /^(booted|all)$/i.test(udid)) failWith(64, 'stub xcrun: expected simctl <command> <udid> <bundle-id>\\n');
if (command === 'get_app_container') {
  process.stdout.write(join(process.cwd(), '${SIM_CONTAINER}') + '\\n');
} else if (command === 'terminate') {
  const mode = state.terminate ?? 'not-running';
  if (mode === 'not-running') failWith(3, 'An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=3):\\nSimulator device failed to terminate ' + bundleId + '.\\nfound nothing to terminate\\n');
  if (mode === 'error') failWith(149, 'An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):\\nUnable to lookup in current state: Shutdown\\n');
} else {
  failWith(64, 'stub xcrun: unknown simctl command ' + command + '\\n');
}
`;

/**
 * \`adb -s <serial> shell|exec-out ...\`: like adb, joins the words into one command line for the
 * device shell; \`am force-stop\` succeeds, and \`run-as <package> <command>\` runs the command in the
 * case's emu-app-data folder (the app's private folder).
 */
const ADB_STUB = `
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const [flag, serial, mode, ...words] = process.argv.slice(2);
if (flag !== '-s' || !serial) { process.stderr.write('adb: more than one device/emulator\\n'); process.exit(1); }
if (mode !== 'shell' && mode !== 'exec-out') { process.stderr.write('stub adb: unknown command ' + mode + '\\n'); process.exit(1); }
const line = words.join(' ');
if (line.startsWith('am force-stop ')) process.exit(0);
const runAs = /^run-as (\\S+) ([\\s\\S]*)$/.exec(line);
if (runAs === null) { process.stderr.write('stub adb: expected run-as <package> <command>\\n'); process.exit(1); }
const result = spawnSync('/bin/sh', ['-c', runAs[2]], { cwd: join(process.cwd(), '${EMU_APP_DATA}'), stdio: 'inherit' });
process.exit(result.status ?? 1);
`;

/** A folder holding `xcrun` and `adb` stand-ins, first on PATH for every script the self-test runs. */
function installDeviceStubs() {
  const bin = makeTempDir('run-migration-stubs-');
  for (const [name, source] of [['xcrun', XCRUN_STUB], ['adb', ADB_STUB]]) {
    writeFileSync(join(bin, `${name}.mjs`), source);
    writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, `${name}.mjs`)}" "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
  process.on('exit', () => removeTempDir(bin));
}

installDeviceStubs();

/**
 * Turns an assembled record-shipped-ref case into the repo a release was built from, as the case's
 * git-setup.json says: { "git": false } (no repository), "untracked" (paths left out of the release
 * commit), "tag" (default v1.1.0), "afterTag" (ops applied to the working tree after the release),
 * "ref" (what --ref names; default the tag). Returns the record-shipped arguments.
 */
function releaseRepo(dir) {
  const file = join(dir, 'git-setup.json');
  const setup = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  rmSync(file, { force: true });
  const tag = setup.tag ?? 'v1.1.0';
  if (setup.git !== false) {
    const git = (...words) => execFileSync('git', ['-C', dir, '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'init.defaultBranch=main', ...words], { stdio: 'pipe' });
    git('init', '--quiet');
    git('add', '--all');
    for (const path of setup.untracked ?? []) git('rm', '--cached', '--quiet', path);
    git('commit', '--quiet', '--no-verify', '-m', 'release 1.1.0 (12)');
    git('tag', tag);
    if (setup.afterTag) applyMutation(dir, setup.afterTag, 'git-setup.json afterTag');
  }
  return [dir, '--build', '1.1.0 (12)', '--date', '2026-10-14', '--ref', setup.ref ?? tag];
}

await runSelftest(import.meta.url, [
  { script: 'check-migration.mjs', fixtures: '../tests/fixtures/check-migration', args: (dir) => [dir] },
  {
    script: 'record-shipped.mjs',
    fixtures: '../tests/fixtures/record-shipped',
    args: (dir) => [dir, '--build', '1.1.0+12', '--date', '2026-10-14'],
  },
  {
    script: 'record-shipped.mjs',
    fixtures: '../tests/fixtures/record-shipped-ref',
    args: (dir) => releaseRepo(dir),
    argsFile: 'append',
  },
  {
    script: 'restore-snapshot.mjs',
    fixtures: '../tests/fixtures/restore-snapshot',
    args: (dir) => ['--dir', join(dir, 'db')],
    base: [{ build: writeDatabases }],
  },
]);
