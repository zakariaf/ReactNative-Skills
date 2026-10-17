// ledger.mjs: the schema ledger (contracts/schema-ledger.json), the step files and fixtures it pins,
// and the static rules of the release ritual (a helper, not an entry point).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lineOf, maskComments, resolveLayout } from '../check-lib.mjs';

export const LEDGER_FILE = 'schema-ledger.json';
const STEP_FILE = /^v(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_KEYS = new Set(['version', 'name', 'stepSha256', 'fixtureSha256', 'firstShippedIn', 'shippedOn', 'contentTest']);
const TOP_KEYS = new Set(['$schema', '$comment', 'openPath', 'shipped']);

/** sha256 of a text file with CRLF read as LF, so a Windows checkout hashes like a macOS one. */
export function sha256Text(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

export const pad4 = (version) => String(version).padStart(4, '0');

/** Every repo path the ritual reads, from the layout and the options. */
export function ritualPaths(root, options = {}) {
  const layout = resolveLayout(root, { dataDir: options['data-dir'], testDir: options['test-dir'], contractsDir: options['contracts-dir'] });
  const migrationsDir = options['migrations-dir'] ?? `${layout.dataDir}/migrations`;
  return {
    layout,
    migrationsDir,
    fixturesDir: `${migrationsDir}/fixtures`,
    list: `${migrationsDir}/migrations.ts`,
    runner: `${migrationsDir}/migration-runner.ts`,
    ledger: options.ledger ?? `${layout.contractsDir}/${LEDGER_FILE}`,
    sqliteTests: `${layout.testDir}/sqlite`,
    defaultOpenPath: `${layout.dataDir}/app-database.ts`,
  };
}

/** The step files in the migrations folder, by version: [{ version, name, rel }]. */
export function stepFiles(root, paths) {
  const dir = join(root, paths.migrationsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, match: STEP_FILE.exec(name) }))
    .filter((entry) => entry.match !== null)
    .map(({ name, match }) => ({ version: Number(match[1]), name: match[2], rel: `${paths.migrationsDir}/${name}` }))
    .sort((a, b) => a.version - b.version);
}

export const fixtureRel = (paths, version) => `${paths.fixturesDir}/db-v${version}.sql`;
export const contentTestRel = (paths, step) => `${paths.sqliteTests}/v${pad4(step.version)}-${step.name}.test.ts`;

/** The text of a repo file, or null when it does not exist. */
export function readRepoText(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** The 1-based line of `"version": <n>` in the ledger text (1 when not found). */
export function lineOfVersion(text, version) {
  const index = text.search(new RegExp(`"version"\\s*:\\s*${version}\\b`));
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
}

/**
 * Reads and validates the ledger. Returns { text, data, problems: [{ line, message, fix }] };
 * data is null when the file is missing or not JSON.
 */
export function readLedger(root, rel) {
  const text = readRepoText(root, rel);
  if (text === null) return { text: null, data: null, problems: [{ line: 1, message: `${rel} does not exist: nothing records which schema versions reached a device`, fix: "Copy the skill's templates/contracts/schema-ledger.json (and its schema); for an app that already shipped versions, run record-shipped --adopt --build '<first build>'." }] };
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { text, data: null, problems: [{ line: 1, message: `${rel} is not valid JSON: ${error.message}`, fix: 'Restore the file from git; it is written by record-shipped.' }] };
  }
  return { text, data, problems: shapeProblems(text, data) };
}

function shapeProblems(text, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.shipped)) {
    return [{ line: 1, message: 'the ledger needs a "shipped" array', fix: 'Start from the template: { "$schema": "./schema-ledger.schema.json", "shipped": [] }.' }];
  }
  const problems = Object.keys(data).filter((key) => !TOP_KEYS.has(key)).map((key) => ({ line: 1, message: `unknown key "${key}"`, fix: `Use only ${[...TOP_KEYS].join(', ')}.` }));
  if (data.openPath !== undefined && typeof data.openPath !== 'string') problems.push({ line: 1, message: '"openPath" must be a repo path', fix: 'For example "src/data/app-database.ts".' });
  data.shipped.forEach((entry, index) => problems.push(...entryProblems(text, entry, index)));
  return problems;
}

function entryProblems(text, entry, index) {
  const expected = index + 1;
  const line = lineOfVersion(text, entry?.version ?? expected);
  const add = (message, fix) => ({ line, message: `shipped[${index}]: ${message}`, fix });
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [add('is not an object', 'Each entry is { version, name, stepSha256, fixtureSha256, firstShippedIn, shippedOn }.')];
  const problems = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key)).map((key) => add(`unknown key "${key}"`, `Use only ${[...ENTRY_KEYS].join(', ')}.`));
  if (entry.version !== expected) problems.push(add(`holds version ${JSON.stringify(entry.version)}, expected ${expected}`, 'The ledger lists versions 1..N in order, one entry each, never a gap: restore it from git.'));
  if (typeof entry.name !== 'string' || !KEBAB.test(entry.name)) problems.push(add(`name ${JSON.stringify(entry.name)} is not kebab-case`, "Use the step file's name without its vNNNN- prefix."));
  for (const key of ['stepSha256', 'fixtureSha256']) {
    if (typeof entry[key] !== 'string' || !SHA256.test(entry[key])) problems.push(add(`${key} is not a sha256`, 'Let record-shipped write the entry; never type a hash by hand.'));
  }
  if (typeof entry.firstShippedIn !== 'string' || entry.firstShippedIn.trim() === '') problems.push(add('firstShippedIn is empty', "Name the first build or update that carried it, for example '1.4.0 (37)'."));
  if (typeof entry.shippedOn !== 'string' || !DATE.test(entry.shippedOn)) problems.push(add('shippedOn is not YYYY-MM-DD', 'Use the date the build or update first left the machine.'));
  if (entry.contentTest !== undefined && (typeof entry.contentTest !== 'string' || entry.contentTest.trim().length < 10)) problems.push(add('contentTest must be a reason of at least 10 characters', 'Only a version shipped before the ledger was adopted may carry a reason instead of a content test.'));
  return problems;
}

/** Entries of `base` that the current ledger lost or changed (the ledger only grows). */
export function rewrittenEntries(base, current) {
  const shipped = Array.isArray(current?.shipped) ? current.shipped : [];
  return (Array.isArray(base?.shipped) ? base.shipped : []).flatMap((entry, index) => {
    const now = shipped[index];
    if (now === undefined) return [{ entry, message: `v${entry?.version} (${entry?.name}) was removed` }];
    return JSON.stringify(now) === JSON.stringify(entry) ? [] : [{ entry, message: `v${entry?.version} (${entry?.name}) was changed` }];
  });
}

/**
 * One ledger entry for a step about to be recorded. `read(rel)` gives a file's text: the working
 * tree by default, the release's git ref with record-shipped --ref.
 */
export function entryFor(root, paths, step, { build, date, read = (rel) => readRepoText(root, rel) }) {
  return {
    version: step.version,
    name: step.name,
    stepSha256: sha256Text(read(step.rel)),
    fixtureSha256: sha256Text(read(fixtureRel(paths, step.version))),
    firstShippedIn: build,
    shippedOn: date,
  };
}

/**
 * True when a SELECT reads stored values: not a count alone (`SELECT COUNT(*) AS n FROM lists`), and
 * not the schema (sqlite_master, sqlite_schema, a pragma_ table function).
 */
function selectReadsValues(sql) {
  const list = /^\s*SELECT\s+([\s\S]*?)\s+FROM\b/i.exec(sql)?.[1] ?? '';
  if (/^(?:DISTINCT\s+)?COUNT\s*\([^)]*\)(?:\s+AS\s+["`]?\w+["`]?)?$/i.test(list.trim())) return false;
  return !/\bFROM\s+["`]?(?:sqlite_master|sqlite_schema|sqlite_temp_master|pragma_)/i.test(sql);
}

/**
 * True when masked test code reads stored values: rowsOf, contentOf, or a SELECT through the driver
 * (all/get with a string literal) that is more than a count or a schema read.
 */
function readsValues(code) {
  if (/\browsOf\s*\(|\bcontentOf\s*\(/.test(code)) return true;
  for (const match of code.matchAll(/\.(?:all|get)\s*\(\s*(['"`])(\s*SELECT\b[\s\S]*?)\1/gi)) {
    if (selectReadsValues(match[2])) return true;
  }
  return false;
}

/**
 * The content test rule for one step (versions 2 and up): test/sqlite/vNNNN-<name>.test.ts exists,
 * loads the previous version's frozen fixture and reads values back (not only counts or the schema).
 * Returns null when it holds, else { file, line, message, fix }.
 */
export function contentTestProblem(root, paths, step) {
  const rel = contentTestRel(paths, step);
  const text = readRepoText(root, rel);
  const previous = `db-v${step.version - 1}`;
  if (text === null) return { file: rel, line: 1, message: `version ${step.version} (${step.name}) has no content test`, fix: `Add ${rel}: load ${previous}.sql, migrate, and assert the values old installs get, value by value (hostile rows included), not only counts or the schema. examples/v0002-pending shows one.` };
  const code = maskComments(text);
  if (!new RegExp(`['"\`/]${previous}(?:\\.sql)?['"\`]`).test(code)) return { file: rel, line: 1, message: `the content test of version ${step.version} does not load ${previous}.sql`, fix: `A step runs on databases at version ${step.version - 1}: start the test from the frozen ${previous}.sql.` };
  if (!readsValues(code)) return { file: rel, line: 1, message: `the content test of version ${step.version} never reads a stored value (no rowsOf, contentOf or SELECT of values; a COUNT or a schema read is not one)`, fix: 'A schema or row-count check passes a step that copies every row wrong: read the rows back and compare them value by value with what they were.' };
  return null;
}

/**
 * The text kinds a step mangles first: an escaped apostrophe, a non-ASCII letter, a character
 * outside the Basic Multilingual Plane (an emoji is a UTF-16 surrogate pair).
 */
const HOSTILE = [
  // An escaped quote inside text ('Mum''s'), not an empty string literal (, '',).
  { name: "an apostrophe ('')", test: (values) => /[^\s,(]''|''[^\s,)]/.test(values) },
  { name: 'a non-ASCII letter (for example Arabic or an accented letter)', test: (values) => /[À-ɏͰ-῿Ⰰ-퟿]/u.test(values) },
  { name: 'an emoji (a character outside the Basic Multilingual Plane)', test: (values) => /[\u{10000}-\u{10FFFF}]/u.test(values) },
];

/** The INSERT lines of a fixture dump: the stored values. */
function insertedValues(text) {
  return text.split('\n').filter((line) => /^\s*INSERT\s+INTO\b/i.test(line)).join('\n');
}

/** The hostile kinds a fixture's rows lack (empty when it has them all). */
export function missingHostileKinds(text) {
  const values = insertedValues(text);
  return HOSTILE.filter((kind) => !kind.test(values)).map((kind) => kind.name);
}

/** The pending version's fixture: exists and stamps its version. null when it holds. */
export function pendingFixtureProblem(root, paths, step) {
  const rel = fixtureRel(paths, step.version);
  const text = readRepoText(root, rel);
  if (text === null) return { file: rel, line: 1, message: `pending version ${step.version} (${step.name}) has no frozen fixture`, fix: `Open a database at version ${step.version}, add representative rows (hostile text included), and dump it to ${rel} (persistence-and-migrations: inspect-database.mjs --dump); record its checksum and FIXTURES entry.` };
  const stamp = /PRAGMA\s+user_version\s*=\s*(\d+)/i.exec(text);
  if (stamp === null || Number(stamp[1]) !== step.version) {
    return { file: rel, line: stamp === null ? 1 : lineOf(text, stamp.index), message: `${rel} stamps user_version ${stamp === null ? 'nothing' : stamp[1]}, expected ${step.version}`, fix: `Dump the fixture from a database that version ${step.version} wrote: its last statement is PRAGMA user_version = ${step.version}.` };
  }
  return null;
}

export const PATH_TESTS = [
  {
    name: 'migration-paths.test.ts',
    needs: [/\bMIGRATIONS\s*\.\s*slice\s*\(/, /\bmigrateDatabase\s*\(/, /\bdb-v/],
    what: 'upgrades an empty file and every frozen fixture to every later version (MIGRATIONS.slice(0, to))',
  },
  {
    name: 'migration-restore-drill.test.ts',
    needs: [/\bopenAppDatabase\s*\(/, /\bsnapshotPathFor\s*\(/, /\brestoreSnapshotFiles\s*\(/],
    what: 'forces a step to fail through openAppDatabase and restores the snapshot (snapshotPathFor, restoreSnapshotFiles)',
  },
];

/** The two Jest proofs of the ritual: present and still doing their job. [{ file, line, message, fix }] */
export function pathTestProblems(root, paths) {
  return PATH_TESTS.flatMap((test) => {
    const rel = `${paths.sqliteTests}/${test.name}`;
    const text = readRepoText(root, rel);
    if (text === null) return [{ file: rel, line: 1, message: `${rel} does not exist: CI never proves what the ritual proves`, fix: `Copy templates/${rel} (with its helpers database-content.ts and restore-snapshot-files.ts); it ${test.what}.` }];
    const code = maskComments(text);
    const missing = test.needs.filter((pattern) => !pattern.test(code));
    return missing.length === 0 ? [] : [{ file: rel, line: 1, message: `${rel} no longer ${test.what} (missing ${missing.map((pattern) => pattern.source.replaceAll('\\b', '').replaceAll('\\s*', '').replaceAll('\\', '')).join(', ')})`, fix: `Restore it from the skill's templates/${rel}.` }];
  });
}
