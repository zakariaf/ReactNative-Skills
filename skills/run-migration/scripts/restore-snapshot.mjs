#!/usr/bin/env node
// restore-snapshot.mjs: puts a migration snapshot (<db>.v<N>.bak, taken by the open path before the
// first step ran) back in place of the database: in a local folder, on a named iOS simulator, or on
// a named Android emulator. Prints the plan and stops unless --yes; checks the copy first and the
// restored file after; moves the replaced files aside instead of deleting them.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run } from './check-lib.mjs';
import { emulatorFolder, localFolder, simulatorFolder } from './lib/device-files.mjs';
import { loadDatabaseSync } from './lib/sqlite-drill.mjs';

const SPEC = {
  name: 'restore-snapshot',
  summary: 'Restores a migration snapshot (<db>.v<N>.bak) over the database in a folder, on a named iOS simulator or on a named Android emulator. Dry run unless --yes.',
  usage: '[repo-root] (--dir <folder> | --udid <udid> --bundle-id <id> | --serial <serial> --package <id>) [options]',
  options: {
    dir: { type: 'string', value: 'folder', help: 'A local folder holding the database and its snapshots (a copy, or a container you found), relative to the repo root' },
    udid: { type: 'string', value: 'udid', help: 'iOS simulator UDID (with --bundle-id); never "booted"' },
    'bundle-id': { type: 'string', value: 'id', help: 'The app bundle identifier on the simulator' },
    serial: { type: 'string', value: 'serial', help: 'Android emulator serial (with --package), for example emulator-5554' },
    package: { type: 'string', value: 'id', help: 'The Android application id; run-as needs a debuggable build' },
    'db-name': { type: 'string', value: 'name', help: 'Database file name (default: app.db)' },
    from: { type: 'string', value: 'N', help: 'Restore <db>.v<N>.bak (default: the highest N present)' },
    yes: { type: 'boolean', help: 'Do it (after the developer agreed): stop the app, move the current files aside, copy the snapshot in, verify' },
  },
  positionals: { min: 0, max: 1 },
  details: 'The repo root (default .) only anchors a relative --dir; a simulator or emulator is named by its options.\n' +
    'Rule: snapshot-health (the copy passes quick_check and stamps user_version N before anything moves).\n' +
    'After a restore the database must read as the snapshot (user_version, quick_check, no -wal beside it), or exit 2.\n' +
    'The replaced app.db, -wal and -shm are moved into kept-<time>/ in the same folder, never deleted.',
};

const isWhole = (value) => /^[0-9]+$/.test(value);

function pickTarget(options, root) {
  const given = [options.dir !== undefined, options.udid !== undefined || options['bundle-id'] !== undefined, options.serial !== undefined || options.package !== undefined].filter(Boolean).length;
  if (given !== 1) fail('name exactly one database: --dir <folder>, --udid <udid> --bundle-id <id>, or --serial <serial> --package <id>', 'Devices are always named; a restore never guesses which simulator or emulator to change.');
  if (options.dir !== undefined) {
    const dir = resolve(root, options.dir);
    if (!existsSync(dir)) fail(`--dir ${options.dir} does not exist`, 'Pass the folder that holds the database file.');
    return localFolder(dir);
  }
  if (options.udid !== undefined) {
    if (options['bundle-id'] === undefined) fail('--udid needs --bundle-id', 'For example --udid <udid> --bundle-id com.acme.tasks.');
    if (/^(booted|all)$/i.test(options.udid)) fail(`--udid ${options.udid} does not name one simulator`, 'Pass the UDID from xcrun simctl list devices.');
    return simulatorFolder(options.udid, options['bundle-id']);
  }
  if (options.package === undefined || options.serial === undefined) fail('--serial and --package go together', 'For example --serial emulator-5554 --package com.acme.tasks.');
  return emulatorFolder(options.serial, options.package);
}

function snapshotsOf(names, dbName) {
  return names
    .map((name) => ({ name, match: name.startsWith(dbName) ? /^\.v(\d+)\.bak$/.exec(name.slice(dbName.length)) : null }))
    .filter((entry) => entry.match !== null)
    .map((entry) => ({ name: entry.name, version: Number(entry.match[1]) }))
    .sort((a, b) => b.version - a.version);
}

/** user_version and quick_check of a database file, read-only; { error } when it does not open. */
function inspect(DatabaseSync, path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const check = db.prepare('PRAGMA quick_check').all().map((row) => row.quick_check);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    return { ok: check.length === 1 && check[0] === 'ok', check: check[0], version: Number(version) };
  } catch (error) {
    return { ok: false, check: String(error.message ?? error).split('\n')[0], version: null };
  } finally {
    db?.close();
  }
}

function keepName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `kept-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  requireDir(root, 'repo root');
  if (options.from !== undefined && !isWhole(options.from)) fail(`--from ${options.from} is not a version number`, 'For example --from 3 restores app.db.v3.bak.');
  const dbName = options['db-name'] ?? 'app.db';
  const DatabaseSync = await loadDatabaseSync();
  if (DatabaseSync === null) fail(`node:sqlite is not available in Node ${process.versions.node}`, 'Use Node 22.18 or newer.');
  const target = pickTarget(options, root);
  try {
    return restore(options, { DatabaseSync, dbName, target });
  } finally {
    target.cleanup();
  }
});

function restore(options, { DatabaseSync, dbName, target }) {
  const names = target.list();
  if (!names.includes(dbName)) fail(`no ${dbName} in ${target.where}`, 'Check --db-name and the folder; the app creates the database on its first launch.');
  const snapshots = snapshotsOf(names, dbName);
  if (snapshots.length === 0) fail(`no snapshot ${dbName}.v<N>.bak in ${target.where}`, 'The open path takes one before migrating a database that holds tables; without one there is nothing to restore (look for a device backup or a data export).');
  const chosen = options.from === undefined ? snapshots[0] : snapshots.find((each) => each.version === Number(options.from));
  if (chosen === undefined) fail(`no ${dbName}.v${options.from}.bak in ${target.where} (present: ${snapshots.map((each) => each.name).join(', ')})`, 'Pick one of the snapshots present.');

  const report = createReporter({ name: SPEC.name });
  const health = inspect(DatabaseSync, target.fetch(chosen.name));
  if (!health.ok || health.version !== chosen.version) {
    report.problem({ file: chosen.name, line: 1, rule: 'snapshot-health', message: `${chosen.name} is not a healthy database at version ${chosen.version} (quick_check: ${health.check}, user_version: ${health.version})`, fix: 'Do not restore it: try an older snapshot (--from), a device backup or a data export, and keep this file for support.' });
    return report.finish({ checked: 1, unit: 'snapshots' });
  }
  const current = inspect(DatabaseSync, target.fetch(dbName));
  const moving = names.filter((name) => [dbName, `${dbName}-wal`, `${dbName}-shm`].includes(name));
  const keep = keepName();
  report.note(`PLAN stop the app: ${target.stopText}`);
  report.note(`PLAN move ${moving.join(', ')} (user_version ${current.version ?? 'unreadable'}) into ${keep}/ beside them in ${target.where}`);
  report.note(`PLAN copy ${chosen.name} (user_version ${chosen.version}, quick_check ok) over ${dbName}`);
  report.note(`PLAN every write made since the upgrade from v${chosen.version} leaves the database (it stays in ${keep}/)`);
  if (!options.yes) {
    // The plan step reads copies only: the folder must list exactly what it listed before.
    const unchanged = target.list();
    if (unchanged.length !== names.length || unchanged.some((name) => !names.includes(name))) {
      fail(`the dry run changed ${target.where}: before ${names.join(', ')}; after ${unchanged.join(', ')}`, 'Report this as a restore-snapshot bug; the plan step must read copies, never the live files.');
    }
    report.note('STOP: restoring discards every write made since the upgrade from the live database. Ask the developer, then rerun with --yes.');
    return report.finish({ checked: 1, unit: 'snapshots' });
  }
  const stopped = target.stop();
  if (typeof stopped === 'string') report.note(`STOPPED ${stopped}`);
  target.restore(dbName, chosen.name, keep);
  const after = target.list();
  const restored = inspect(DatabaseSync, target.fetch(dbName));
  if (!restored.ok || restored.version !== chosen.version || after.includes(`${dbName}-wal`)) {
    fail(`the restore did not take: ${dbName} reads user_version ${restored.version}, quick_check ${restored.check}${after.includes(`${dbName}-wal`) ? ', and a -wal file is beside it' : ''}`, `Stop the app, move ${dbName}-wal and -shm into ${keep}/ and copy ${chosen.name} over ${dbName} by hand; the replaced files are in ${keep}/.`);
  }
  report.note(`RESTORED ${dbName} from ${chosen.name} (user_version ${chosen.version}); the replaced files are in ${keep}/`);
  report.note(`NEXT launch only a build whose steps after v${chosen.version} are fixed: the same build reruns the same step on the restored file.`);
  return report.finish({ checked: 1, unit: 'snapshots' });
}
