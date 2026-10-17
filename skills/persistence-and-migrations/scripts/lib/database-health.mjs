// database-health.mjs: reads a COPY of an app database and judges its health; writes reviewable .sql dumps.
// Shared by inspect-database.mjs, kill-test.mjs and check-persistence.mjs. Node's built-in node:sqlite only.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** FNV-1a 32 over UTF-16 code units, 8 lowercase hex characters: the app's src/data/checksum.ts. */
export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A frozen text file's checksum ignores Windows line endings (a CRLF checkout must not "edit" it). */
export function textChecksum(text) {
  return fnv1a32(text.replace(/\r\n/g, '\n'));
}

/** node:sqlite's DatabaseSync, or null on a Node without it (22.13+ has it unflagged). */
export async function loadDatabaseSync() {
  try {
    return (await import('node:sqlite')).DatabaseSync;
  } catch {
    return null;
  }
}

/**
 * Copies the database (+ -wal, -shm) into a fresh temporary folder, so the app's own files are
 * never opened in place (opening can checkpoint or lock them). A .sql dump is executed into a new
 * temporary database instead. Returns { path, cleanup }.
 */
export function stageDatabase(DatabaseSync, source, name = 'app.db') {
  const dir = mkdtempSync(join(tmpdir(), 'inspect-database-'));
  const target = join(dir, name);
  if (source.endsWith('.sql')) {
    const db = new DatabaseSync(target, { enableForeignKeyConstraints: false });
    try {
      db.exec(readFileSync(source, 'utf8'));
    } finally {
      db.close();
    }
  } else {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(source + suffix)) copyFileSync(source + suffix, target + suffix);
    }
  }
  return { path: target, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------------------------
// Dumps
// ---------------------------------------------------------------------------------------------

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isInteger(value) ? `${value}.0` : String(value);
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

const quoteName = (name) => `"${name.replaceAll('"', '""')}"`;

function tableRows(db, table, sql) {
  const columns = db.prepare(`PRAGMA table_info(${quoteName(table)})`).all();
  const names = columns.map((column) => column.name);
  const keys = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => quoteName(column.name));
  const order = /without\s+rowid/i.test(sql) ? keys.join(', ') : 'rowid';
  const statement = db.prepare(`SELECT ${names.map(quoteName).join(', ')} FROM ${quoteName(table)} ORDER BY ${order}`);
  statement.setReadBigInts(true);
  const list = names.join(', ');
  return statement.all().map((row) => `INSERT INTO ${table} (${list}) VALUES (${names.map((name) => sqlLiteral(row[name])).join(', ')});`);
}

/**
 * A deterministic, reviewable dump: tables in creation order with their rows (by rowid or primary
 * key), sqlite_sequence, then indexes, triggers and views, then user_version; one transaction,
 * loadable with foreign keys off. The CREATE statements are sqlite_master's text, verbatim, so a
 * dump of an upgraded database and a dump of a fresh one compare exactly.
 */
export function dumpDatabase(db, { header } = {}) {
  const lines = [];
  if (header) lines.push(`-- ${header}`);
  const mode = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
  lines.push('PRAGMA foreign_keys = OFF;');
  if (mode === 'wal') lines.push('PRAGMA journal_mode = WAL;');
  lines.push('BEGIN;');
  const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  for (const table of objects.filter((object) => object.type === 'table')) {
    lines.push(`${table.sql};`, ...tableRows(db, table.name, table.sql));
  }
  const hasSequence = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE name = 'sqlite_sequence'").get();
  if (hasSequence) {
    lines.push('DELETE FROM sqlite_sequence;');
    for (const row of db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all()) {
      lines.push(`INSERT INTO sqlite_sequence (name, seq) VALUES (${sqlLiteral(row.name)}, ${row.seq});`);
    }
  }
  for (const object of objects.filter((entry) => entry.type !== 'table')) lines.push(`${object.sql};`);
  lines.push(`PRAGMA user_version = ${db.prepare('PRAGMA user_version').get().user_version};`, 'COMMIT;');
  return `${lines.join('\n')}\n`;
}

/** sqlite_master without SQLite's own objects, as comparable rows. `all(sql)` runs a query. */
export function schemaOf(all) {
  return all("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").map((row) => ({ ...row }));
}

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

/**
 * Inspects a staged copy. Returns { lines, problems }; each problem is { rule, message, fix }.
 * options: { expectVersion, maxVersion, document: { appId, maxVersion, allowQuarantine, decode } }.
 */
export function inspectDatabase(DatabaseSync, path, options = {}) {
  const lines = [];
  const problems = [];
  const add = (rule, message, fix) => problems.push({ rule, message, fix });
  let db;
  try {
    db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    db.prepare('PRAGMA user_version').get();
  } catch (error) {
    db?.close();
    add('open', `not a readable SQLite database: ${String(error.message).split('\n')[0]}`, 'The app opens such a file as "unreadable" and runs in memory; keep the file for support and find what wrote it (a partial copy, a file written outside SQLite).');
    return { lines, problems };
  }
  const state = { lines, add, isDamaged: false };
  try {
    checkDatabase(db, options, state);
    if (options.document) guarded(state, 'document slots', () => checkDocument(db, options.document, state));
  } finally {
    db.close();
  }
  return { lines, problems };
}

const DAMAGE_FIX = 'The file is physically damaged: SQLite cannot read some pages, so reads of the tables on them fail (repositories return storage-unavailable and log it). Keep the file; restore the newest snapshot (*.v<N>.bak) or a backup with the app closed (stop and ask first: newer writes are lost), and find what wrote it (a copy taken mid-write, a file written outside SQLite, failing storage).';

/** SQLITE_CORRUPT (11) or SQLITE_NOTADB (26), from node:sqlite's errcode or SQLite's message text. */
function isCorruption(error) {
  const code = typeof error?.errcode === 'number' ? error.errcode & 0xff : null;
  return code === 11 || code === 26 || /malformed|not a database/i.test(String(error?.message));
}

/**
 * Runs one read; a throw becomes a problem, never a crash of the script: physical damage is
 * reported once as `integrity`, any other failure as `open`. Returns the value, or undefined.
 */
function guarded(state, what, run) {
  try {
    return run();
  } catch (error) {
    const text = String(error?.message ?? error).split('\n')[0];
    state.lines.push(`${what}: failed (${text})`);
    if (isCorruption(error)) {
      if (!state.isDamaged) state.add('integrity', `${what}: ${text}`, DAMAGE_FIX);
      state.isDamaged = true;
    } else {
      state.add('open', `${what} failed: ${text}`, 'Run the same read with sqlite3 on a copy to see why; the app opens a file it cannot read as "unreadable" and runs in memory.');
    }
    return undefined;
  }
}

function checkDatabase(db, options, state) {
  const { lines, add } = state;
  const version = guarded(state, 'user_version', () => Number(db.prepare('PRAGMA user_version').get().user_version));
  const mode = guarded(state, 'journal_mode', () => db.prepare('PRAGMA journal_mode').get()?.journal_mode);
  if (version !== undefined) lines.push(`user_version: ${version}`);
  if (mode !== undefined) lines.push(`journal_mode: ${mode}`);
  if (version === 0) add('user-version', 'user_version is 0: no migration ever completed on this file', 'The app never finished its first open: check that the startup opens the database before the first screen and that migration 1 succeeds.');
  else if (version !== undefined && options.expectVersion !== undefined && version !== options.expectVersion && !(options.maxVersion !== undefined && version > options.maxVersion)) {
    add('user-version', `user_version is ${version}, expected ${options.expectVersion}`, 'The installed build did not migrate to the version this build ships, or the file belongs to another build.');
  }
  if (version !== undefined && options.maxVersion !== undefined && version > options.maxVersion) {
    add('newer-version', `user_version ${version} is newer than ${options.maxVersion}`, 'A build that knows only version ' + options.maxVersion + ' must open this file read-only (an in-memory session) and never write it.');
  }
  if (mode !== undefined && mode !== 'wal') add('journal-mode', `journal_mode is ${mode}, not wal`, 'Run APP_DB_PRAGMAS (journal_mode = WAL; synchronous = FULL; foreign_keys = ON) on every open.');
  // At most 20 findings; SQLite may join several into one row, so flatten them to one line each.
  const integrity = guarded(state, 'integrity_check', () => db.prepare('PRAGMA integrity_check(20)').all().flatMap((row) => String(row.integrity_check).split('\n')).filter((line) => line.trim() !== '' && !/^\*\*\* in database/.test(line)));
  if (integrity !== undefined) {
    const shown = `${integrity.slice(0, 3).join('; ')}${integrity.length > 3 ? ` (and ${integrity.length - 3} more)` : ''}`;
    lines.push(`integrity_check: ${shown}`);
    if (integrity.length !== 1 || integrity[0] !== 'ok') add('integrity', `integrity_check: ${shown}`, 'The file is damaged (or a CHECK/NOT NULL constraint was bypassed): restore the newest snapshot (*.v<N>.bak) or a backup, and find the write that did it.');
  }
  const orphans = guarded(state, 'foreign_key_check', () => db.prepare('PRAGMA foreign_key_check').all());
  if (orphans === undefined) return;
  lines.push(`foreign_key_check: ${orphans.length} row(s)`);
  if (orphans.length > 0) {
    const first = orphans[0];
    add('foreign-keys', `${orphans.length} row(s) break a foreign key (first: ${first.table} rowid ${first.rowid} -> ${first.parent})`, 'foreign_keys was off when they were written: set PRAGMA foreign_keys = ON on every open, and repair the rows in a migration.');
  }
}

const SLOT_SQL = 'SELECT slot, schema_version, app_version, written_at_ms, write_count, checksum, payload FROM document_slots WHERE slot = ?';

function checkDocument(db, options, { lines, add }) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  if (!tables.has('document_slots')) {
    add('no-document-table', 'the database has no document_slots table', 'The document tables migration never ran (or this app does not use the document appendix: drop --document).');
    return;
  }
  for (const slot of ['current', 'backup']) inspectSlot(db, slot, options, { lines, add });
  const quarantined = tables.has('document_quarantine') ? Number(db.prepare('SELECT COUNT(*) AS n FROM document_quarantine').get().n) : 0;
  lines.push(`document quarantine rows: ${quarantined}`);
  if (quarantined > 0 && !options.allowQuarantine) {
    add('quarantine', `document_quarantine holds ${quarantined} row(s): a load found a damaged slot`, 'Read the rows (reason column), find the write that broke the document, fix it; after a kill test this must be 0.');
  }
}

function inspectSlot(db, slot, options, { lines, add }) {
  const row = db.prepare(SLOT_SQL).get(slot);
  if (row === undefined) {
    lines.push(`${slot}: missing`);
    add('slot-missing', `the ${slot} slot is missing`, 'Every load writes both slots (write-both); a missing slot means the startup never finished its first write.');
    return;
  }
  const payload = String(row.payload);
  const facts = [`schema=${row.schema_version}`, `writeCount=${row.write_count}`, `bytes=${payload.length}`, `app=${row.app_version}`];
  let status = 'ok';
  if (fnv1a32(payload) !== row.checksum) {
    status = 'damaged';
    add('checksum', `${slot}: checksum ${row.checksum} does not match the payload (${fnv1a32(payload)})`, 'The row was changed outside encodeAppDocument or the file rotted; the app restores the other slot and quarantines this one.');
  }
  let doc;
  try {
    doc = JSON.parse(payload);
  } catch {
    status = 'damaged';
    add('json', `${slot}: the payload is not valid JSON`, 'Only encodeAppDocument (JSON.stringify of a validated document) may write payloads.');
  }
  if (doc !== undefined) checkSlotDocument(slot, row, doc, options, add);
  if (doc !== undefined && options.decode) {
    const decoded = options.decode({ schemaVersion: row.schema_version, appVersion: row.app_version, writtenAtMs: row.written_at_ms, writeCount: row.write_count, checksum: row.checksum, payload });
    facts.push(`decode=${decoded.kind}`);
    if (decoded.kind !== 'ok') {
      status = 'damaged';
      add('decode', `${slot}: the app's decodeSlot says ${decoded.kind}${decoded.reason ? ` (${decoded.reason})` : ''}`, 'Fix the writer or the document migration that produced this document; run the document tests.');
    }
  }
  lines.push(`${slot}: ${status} ${facts.join(' ')}`);
}

function checkSlotDocument(slot, row, doc, options, add) {
  if (doc?.schemaVersion !== row.schema_version) {
    add('schema-version', `${slot}: payload schemaVersion ${doc?.schemaVersion} differs from the row's schema_version ${row.schema_version}`, 'encodeAppDocument copies doc.schemaVersion into the row; never write the row by hand.');
  }
  if (options.maxVersion !== undefined && row.schema_version > options.maxVersion) {
    add('newer-version', `${slot}: document schema_version ${row.schema_version} is newer than ${options.maxVersion}`, 'An older build plays such a document in memory and never writes it.');
  }
  if (options.appId !== undefined && doc?.appId !== options.appId) {
    add('app-id', `${slot}: appId is ${JSON.stringify(doc?.appId)}, expected ${JSON.stringify(options.appId)}`, 'This document belongs to another app or flavor; the app decodes it as damaged.');
  }
}
