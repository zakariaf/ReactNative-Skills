// lib/backup-rules.mjs: the rules of check-backup.mjs. Each rule reads the app's source through a small
// model (scanSource: comments and string contents blanked in `code`, every literal in `strings`) and
// reports through ctx.add / ctx.skip. Paths come from the layout; nothing here knows a product.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { notYetCreated } from '../check-lib.mjs';
import { functionsOf, importsOf, isTestFile, matchBracket, scanSource } from './source-scan.mjs';
import { canonicalJson, checkEnvelope, HEADER_KEYS, sha256Hex } from './backup-envelope.mjs';

/** SDKs that move files in or out of the app: only an adapter may import them. */
export const FILE_SDKS = ['expo-sharing', 'expo-document-picker', 'expo-file-system'];
/** Leaders a spreadsheet runs as a formula; the CSV encoder must neutralize every one. */
export const FORMULA_LEADERS = ['=', '+', '-', '@', '\\t', '\\r'];
/** Failure kinds a restore must be able to name (one per reason the screen explains). */
export const REQUIRED_RESTORE_KINDS = ['not-a-backup', 'damaged', 'newer-version', 'invalid-row', 'inconsistent', 'storage'];

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA|WITH)\b/i;
const WRITE_SQL = /^\s*(INSERT|DELETE|UPDATE|REPLACE)\b/i;

// ---------------------------------------------------------------------------------------------
// Source model
// ---------------------------------------------------------------------------------------------

export function loadSource(root, rel) {
  const raw = readFileSync(join(root, rel), 'utf8');
  const scan = scanSource(raw);
  return { rel, raw, scan, code: scan.code, strings: scan.strings, lineOf: scan.lineOf, imports: importsOf(scan) };
}

/** Every call whose callee matches `callee` (a RegExp source): [{ index, open, close }]. */
export function calls(src, callee) {
  const found = [];
  for (const match of src.code.matchAll(new RegExp(`${callee}\\s*\\(`, 'g'))) {
    const open = match.index + match[0].length - 1;
    found.push({ index: match.index, open, close: matchBracket(src.code, open), match });
  }
  return found;
}

/** The innermost function (declaration or block-bodied arrow) whose body holds `index`, or null. */
export function functionAt(src, index) {
  const holding = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1 && fn.bodyStart < index && index < fn.bodyEnd);
  return holding.sort((a, b) => a.bodyEnd - a.bodyStart - (b.bodyEnd - b.bodyStart))[0] ?? null;
}

/** Literal strings inside [from, to). */
const stringsIn = (src, from, to) => src.strings.filter((entry) => entry.index >= from && entry.index < to);

/** `const NAME = 'literal'` → { NAME: 'literal' } (the value of the first literal after the =). */
export function stringConstants(src) {
  const constants = {};
  for (const match of src.code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/g)) {
    const at = match.index + match[0].length;
    const entry = src.scan.stringAt.get(at);
    if (entry !== undefined) constants[match[1]] = entry.value;
  }
  return constants;
}

/** Top-level keys of the object literal whose `{` is at `open` (raw text positions). */
export function objectKeys(src, open) {
  const close = matchBracket(src.code, open);
  if (close === -1) return [];
  const keys = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i <= close; i += 1) {
    const ch = src.code[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch) && i !== close) depth -= 1;
    if ((ch === ',' && depth === 0) || i === close) {
      const segment = src.raw.slice(start, i);
      const key = /^\s*(?:\.\.\.\s*[\w$.]+|['"]?([A-Za-z_$][\w$-]*)['"]?\s*[:,(]?)/.exec(segment);
      const spread = /^\s*\.\.\./.test(segment);
      if (key?.[1] && !spread) keys.push({ key: key[1], index: start + segment.search(/\S/) });
      start = i + 1;
    }
  }
  return keys;
}

/** The `{` of the object literal assigned to (or passed in the first call after) `const NAME =`, or -1. */
export function objectOf(src, name) {
  const match = new RegExp(`\\b(?:const|let)\\s+${name}\\b[^=]*=\\s*`).exec(src.code);
  if (match === null) return -1;
  const at = match.index + match[0].length;
  const brace = src.code.indexOf('{', at);
  const stop = src.code.indexOf(';', at);
  return brace !== -1 && (stop === -1 || brace < stop) ? brace : -1;
}

// ---------------------------------------------------------------------------------------------
// Repo facts
// ---------------------------------------------------------------------------------------------

/** Migration step files `vNNNN-*.ts` in version order: [{ rel, version }]. */
export function migrationSteps(root, migrationsDir) {
  const abs = join(root, migrationsDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .map((name) => ({ name, match: /^v(\d{4})-[a-z0-9-]+\.ts$/.exec(name) }))
    .filter((entry) => entry.match !== null && !isTestFile(entry.name))
    .map((entry) => ({ rel: `${migrationsDir}/${entry.name}`, version: Number(entry.match[1]) }))
    .sort((a, b) => a.version - b.version);
}

/** The user tables the migrations leave: CREATE minus DROP, RENAME applied, in version order. */
export function migratedTables(root, steps) {
  const tables = new Set();
  for (const step of steps) {
    const sql = loadSource(root, step.rel).strings.map((entry) => entry.value).join('\n');
    const statements = sql.matchAll(/\b(CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|ALTER\s+TABLE)\s+["`]?(\w+)["`]?(?:\s+RENAME\s+TO\s+["`]?(\w+))?/gi);
    for (const [, verb, name, renamed] of statements) {
      if (/^CREATE/i.test(verb)) tables.add(name);
      else if (/^DROP/i.test(verb)) tables.delete(name);
      else if (renamed !== undefined) {
        tables.delete(name);
        tables.add(renamed);
      }
    }
  }
  return [...tables].filter((name) => !name.startsWith('sqlite_')).sort();
}

export function readProtectedTables(root, contractsDir) {
  const file = join(root, contractsDir, 'persistence.json');
  if (!existsSync(file)) return null;
  try {
    const contract = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(contract.protectedTables) ? contract.protectedTables : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Envelope rules
// ---------------------------------------------------------------------------------------------

/** The first object literal in a function body that has a `format` key: { open, keys }. */
function headerObject(src, fn) {
  for (let open = src.code.indexOf('{', fn.bodyStart + 1); open !== -1 && open < fn.bodyEnd; open = src.code.indexOf('{', open + 1)) {
    const keys = objectKeys(src, open).map((entry) => entry.key);
    if (keys.includes('format')) return { open, keys };
  }
  return null;
}

/** envelope-header and schema-version: header-first key order, payload last, version from the database. */
export function checkEnvelopeModule(ctx, src) {
  const encode = calls(src, '\\bfunction\\s+encodeBackup')[0];
  const fn = encode === undefined ? null : functionsOf(src.scan).find((each) => each.index === encode.open);
  if (fn === null || fn === undefined || fn.bodyStart === -1) {
    ctx.add({ file: src.rel, rule: 'envelope-header', message: 'no encodeBackup function writes the envelope', fix: 'export function encodeBackup(payload, meta): the header object (format, formatVersion, schemaVersion, appVersion, exportedAt, payloadSha256), then ,"payload": and the canonical JSON.' });
  } else {
    const body = src.code.slice(fn.bodyStart, fn.bodyEnd);
    const header = headerObject(src, fn);
    const keys = header === null ? [] : header.keys;
    if (JSON.stringify(keys) !== JSON.stringify(HEADER_KEYS)) {
      ctx.add({ file: src.rel, line: src.lineOf(header?.open ?? fn.bodyStart), rule: 'envelope-header', message: `the header keys are [${keys.join(', ')}], expected [${HEADER_KEYS.join(', ')}] in that order`, fix: 'Write the version fields first: a reader (and a person opening the file) sees what the file is and which build wrote it before any payload, and a truncated file still starts with its marker.' });
    }
    const values = stringsIn(src, fn.bodyStart, fn.bodyEnd).map((entry) => entry.value);
    if (!values.some((value) => value.includes('"payload":'))) {
      ctx.add({ file: src.rel, line: src.lineOf(fn.bodyStart), rule: 'envelope-header', message: 'encodeBackup does not append the payload after the header ("payload": last)', fix: 'Return `${JSON.stringify(header).slice(0, -1)},"payload":${canonicalJson(payload)}}`: the payload is last and canonical, so its checksum is reproducible.' });
    }
    if (!/\bsha256Hex\s*\(|\bsha256\s*\(/.test(body)) {
      ctx.add({ file: src.rel, line: src.lineOf(fn.bodyStart), rule: 'envelope-header', message: 'encodeBackup writes no payload checksum (sha256 of the canonical payload)', fix: 'payloadSha256: sha256Hex(canonicalJson(payload)).' });
    }
  }
  const version = /\bBACKUP_SCHEMA_VERSION\s*(?::[^=]+)?=\s*([^;\n]+)/.exec(src.code);
  if (version === null) {
    ctx.add({ file: src.rel, rule: 'schema-version', message: 'no BACKUP_SCHEMA_VERSION constant', fix: 'export const BACKUP_SCHEMA_VERSION = LATEST_DB_VERSION; (from the migrations list).' });
  } else if (!/\bLATEST_DB_VERSION\b|\bMIGRATIONS\.length\b/.test(version[1])) {
    ctx.add({ file: src.rel, line: src.lineOf(version.index), rule: 'schema-version', message: `BACKUP_SCHEMA_VERSION is ${version[1].trim()}, not derived from the database version`, fix: 'export const BACKUP_SCHEMA_VERSION = LATEST_DB_VERSION: a literal stays behind on the next migration, and new files then claim an old schema.' });
  }
}

/** checksum-first and newer-refused: the envelope check compares payloadSha256 and refuses newer files. */
export function checkEnvelopeChecks(ctx, src) {
  const compares = /payloadSha256\s*[!=]==|[!=]==\s*[\w$.]*payloadSha256/.exec(src.code);
  if (compares === null) {
    ctx.add({ file: src.rel, rule: 'checksum-first', message: 'nothing compares the payload checksum (payloadSha256) on read', fix: 'In checkEnvelope: if (sha256Hex(canonicalJson(payload)) !== header.payloadSha256) return err({ kind: \'damaged\' }); before any row is read.' });
  }
  const refusesNewer = /[\w$.]+\s*>\s*BACKUP_SCHEMA_VERSION\b|\bBACKUP_SCHEMA_VERSION\s*<\s*[\w$.]+/.test(src.code) && src.strings.some((entry) => entry.value === 'newer-version');
  if (!refusesNewer) {
    ctx.add({ file: src.rel, rule: 'newer-refused', message: 'a file from a newer schema is not refused (no schemaVersion > BACKUP_SCHEMA_VERSION check returning newer-version)', fix: "if (found > BACKUP_SCHEMA_VERSION) return { kind: 'newer-version', found, supported: BACKUP_SCHEMA_VERSION, appVersion }: never a best-effort read of a shape this build does not know." });
  }
  return compares === null ? null : functionAt(src, compares.index)?.name ?? null;
}

/** A valibot parse of the backup payload rows: v.safeParse(BACKUP_PAYLOAD, ...) or v.parse(BACKUP_PAYLOAD, ...). */
export const PAYLOAD_PARSE = /\bv\.(?:safeParse|parse)\s*\(\s*BACKUP_PAYLOAD\b/;

/**
 * checksum-first, second half: the reader runs the envelope check (or readBackup, which runs it) before
 * it parses or upgrades rows. Runs on the backup folder's readers and on every runtime file outside it
 * that imports from it.
 */
export function checkReaderOrder(ctx, src, checkerName) {
  for (const parse of calls(src, '\\bv\\.(?:safeParse|parse)')) {
    const argument = src.raw.slice(parse.open + 1, parse.close);
    if (!/^\s*BACKUP_PAYLOAD\b/.test(argument)) continue;
    const fn = functionAt(src, parse.index);
    const from = fn?.bodyStart ?? 0;
    const name = checkerName ?? 'checkEnvelope';
    const check = calls(src, `\\b(?:${name}|readBackup)`).find((call) => call.index > from && call.index < parse.index);
    if (check === undefined) {
      ctx.add({ file: src.rel, line: src.lineOf(parse.index), rule: 'checksum-first', message: `the payload rows are parsed before ${name}() verified the envelope and its checksum`, fix: `Call ${name}(text) first and return its failure: a truncated or edited file must fail as damaged, not somewhere random in the rows.` });
    }
  }
}

/** typed-failures: no throw in backup code, and the restore failure union names every reason. */
export function checkTypedFailures(ctx, files) {
  let union = null;
  for (const src of files) {
    for (const match of src.code.matchAll(/\bthrow\b/g)) {
      ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'typed-failures', message: 'backup code throws', fix: 'Return a typed failure (err({ kind })) instead: export, pick and restore are called from a press handler, and a throw there crashes a release build or becomes a generic "something went wrong".' });
    }
    if (/\btype\s+RestoreFailure\b/.test(src.code)) union = src;
  }
  if (union === null) {
    ctx.add({ file: files[0]?.rel ?? '', rule: 'typed-failures', message: 'no RestoreFailure type: a restore cannot say why it stopped', fix: 'Copy templates/src/data/backup/backup-failures.ts: one kind per reason (not-a-backup, damaged, newer-version, invalid-row, inconsistent, storage, ...).' });
    return;
  }
  const kinds = new Set(union.strings.map((entry) => entry.value));
  const missing = REQUIRED_RESTORE_KINDS.filter((kind) => !kinds.has(kind));
  if (missing.length > 0) {
    ctx.add({ file: union.rel, line: union.lineOf(union.code.search(/\btype\s+RestoreFailure\b/)), rule: 'typed-failures', message: `RestoreFailure has no kind for: ${missing.join(', ')}`, fix: 'Give every reason its own kind, so the screen tells a wrong file from a damaged one from an app that needs an update.' });
  }
}

// ---------------------------------------------------------------------------------------------
// Repository rules
// ---------------------------------------------------------------------------------------------

/** restore-transaction: every DELETE and INSERT of the replace runs inside one transaction. */
export function checkRestoreTransaction(ctx, src) {
  const constants = stringConstants(src);
  const transactions = calls(src, '\\.transaction').filter((call) => call.close !== -1);
  const writes = calls(src, '\\.run').map((call) => {
    const argument = src.raw.slice(call.open + 1, call.close).trim();
    const literal = src.scan.stringAt.get(call.open + 1 + src.raw.slice(call.open + 1).search(/\S/));
    const sql = literal?.value ?? constants[/^[\w$]+/.exec(argument)?.[0] ?? ''] ?? '';
    return { call, sql, verb: WRITE_SQL.exec(sql)?.[1]?.toUpperCase() ?? null };
  }).filter((write) => write.verb === 'DELETE' || write.verb === 'INSERT');
  const holding = (index) => transactions.find((tx) => tx.open < index && index < tx.close) ?? null;
  // A write in a same-file helper counts as inside the transaction(s) every call of that helper sits in.
  const rangeOf = (write) => {
    const direct = holding(write.call.index);
    if (direct !== null) return direct;
    const helper = functionAt(src, write.call.index);
    if (helper === null || helper.name === '(anonymous)') return null;
    const sites = calls(src, `(?<![\\w$.])${helper.name}`).filter((call) => call.open !== helper.index).map((call) => holding(call.index));
    return sites.length > 0 && sites.every((range) => range !== null && range === sites[0]) ? sites[0] : null;
  };
  const deletes = writes.filter((write) => write.verb === 'DELETE');
  const replaceRanges = new Set(deletes.map(rangeOf).filter((range) => range !== null));
  for (const write of writes) {
    const range = rangeOf(write);
    const isDelete = write.verb === 'DELETE';
    if (range === null || (!isDelete && deletes.length > 0 && !replaceRanges.has(range))) {
      ctx.add({ file: src.rel, line: src.lineOf(write.call.index), rule: 'restore-transaction', message: `${write.verb} of the restore runs ${range === null ? 'outside any transaction' : 'in another transaction than the DELETEs'}`, fix: 'Run every DELETE and every INSERT of replaceAll inside ONE driver.transaction(() => { ... }) (a same-file helper called inside it counts): a failure or a kill half-way must leave the old rows, never an empty or half-restored database.' });
    }
  }
  return writes.length;
}

/** restore-protected: no SQL in backup code reads or writes a protected table, and the payload never holds one. */
export function checkProtectedSql(ctx, files, protectedTables) {
  for (const src of files) {
    for (const entry of src.strings.filter((item) => SQL_START.test(item.value))) {
      for (const table of protectedTables) {
        if (new RegExp(`\\b(FROM|INTO|UPDATE|JOIN|TABLE)\\s+["\`]?${table}\\b`, 'i').test(entry.value)) {
          ctx.add({ file: src.rel, line: entry.line, rule: 'restore-protected', message: `backup SQL touches the protected table ${table}`, fix: `Leave ${table} out of export and restore (list it in BACKUP_EXCLUDED_TABLES with the reason): a backup is a file the user can edit, so restoring an entitlement grants a purchase nobody made, and diagnostics belong to the device.` });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Schema coverage
// ---------------------------------------------------------------------------------------------

/** backup-coverage and restore-protected: payload keys + excluded tables = the migrated user tables. */
export function checkCoverage(ctx, src, { tables, protectedTables, migrationsDir }) {
  const payloadOpen = (() => {
    const match = /\bBACKUP_PAYLOAD\s*(?::[^=]+)?=\s*v\.(?:strictObject|object|looseObject)\s*\(\s*\{/.exec(src.code);
    return match === null ? -1 : match.index + match[0].length - 1;
  })();
  if (payloadOpen === -1) {
    ctx.add({ file: src.rel, rule: 'backup-coverage', message: 'no BACKUP_PAYLOAD = v.strictObject({ ... }) lists what a backup holds', fix: 'One key per user table (its rows at the latest schema): templates/src/data/backup/backup-schema.ts.' });
    return;
  }
  const payload = objectKeys(src, payloadOpen);
  const excludedOpen = objectOf(src, 'BACKUP_EXCLUDED_TABLES');
  const excluded = excludedOpen === -1 ? [] : objectKeys(src, excludedOpen).map((entry) => entry.key);
  for (const entry of payload) {
    if (protectedTables.includes(entry.key)) {
      ctx.add({ file: src.rel, line: src.lineOf(entry.index), rule: 'restore-protected', message: `the backup payload holds the protected table ${entry.key}`, fix: `Move ${entry.key} to BACKUP_EXCLUDED_TABLES with its reason: a purchase comes back only through the store, and diagnostics belong to the device.` });
    } else if (tables !== null && !tables.includes(entry.key)) {
      ctx.add({ file: src.rel, line: src.lineOf(entry.index), rule: 'backup-coverage', message: `the payload key ${entry.key} is not a table the migrations create`, fix: `Name payload keys after the tables in ${migrationsDir}/ (the payload is the tables' rows).` });
    }
  }
  for (const table of protectedTables.filter((name) => !excluded.includes(name) && (tables === null || tables.includes(name)))) {
    ctx.add({ file: src.rel, line: src.lineOf(excludedOpen === -1 ? payloadOpen : excludedOpen), rule: 'restore-protected', message: `the protected table ${table} is not in BACKUP_EXCLUDED_TABLES`, fix: `Add ${table}: '<why a backup never holds it>' to BACKUP_EXCLUDED_TABLES, so the decision is written down where the next table is added.` });
  }
  if (tables === null) return;
  const covered = new Set([...payload.map((entry) => entry.key), ...excluded]);
  for (const table of tables.filter((name) => !covered.has(name))) {
    ctx.add({ file: src.rel, line: src.lineOf(payloadOpen), rule: 'backup-coverage', message: `the table ${table} is neither backed up nor excluded`, fix: `Add ${table} to BACKUP_PAYLOAD (and to readAll, replaceAll and the round-trip fixture) or to BACKUP_EXCLUDED_TABLES with its reason: a new table silently missing from backups is data the user loses on their next restore.` });
  }
}

// ---------------------------------------------------------------------------------------------
// Upgrades and fixtures
// ---------------------------------------------------------------------------------------------

/** upgrade-chain: one upgrade step per schema version after the first backup version. */
export function checkUpgradeChain(ctx, files, { first, latest, upgradesRel }) {
  const versions = [];
  for (const src of files) {
    for (const match of src.code.matchAll(/\bversion\s*:\s*(\d+)\s*,/g)) {
      const window = src.code.slice(match.index, match.index + 400);
      if (/\bup\s*:/.test(window)) versions.push({ version: Number(match[1]), file: src.rel, line: src.lineOf(match.index) });
    }
  }
  const expected = [];
  for (let version = first + 1; version <= latest; version += 1) expected.push(version);
  for (const version of expected.filter((each) => !versions.some((step) => step.version === each))) {
    ctx.add({ file: upgradesRel, rule: 'upgrade-chain', message: `schema version ${version} has a migration but no backup upgrade step`, fix: `Add { version: ${version}, name, up } to BACKUP_UPGRADES doing to the JSON rows what migration ${version} does to the tables (an added column gets its default), and a frozen backup-v${version - 1} fixture for the parity test.` });
  }
  for (const step of versions.filter((each) => !expected.includes(each.version))) {
    ctx.add({ file: step.file, line: step.line, rule: 'upgrade-chain', message: `upgrade step ${step.version} has no matching migration (expected ${expected.length === 0 ? 'none' : expected.join(', ')})`, fix: 'Steps run first + 1 .. LATEST_DB_VERSION, one per migration; remove or renumber this one.' });
  }
}

/** backup-fixture: a frozen, valid backup per schema version, listed in the round-trip test. */
export function checkFixtures(ctx, { root, fixturesDir, first, latest, roundTrip, format }) {
  let checked = 0;
  for (let version = first; version <= latest; version += 1) {
    const rel = `${fixturesDir}/backup-v${version}.json`;
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      ctx.add({ file: rel, rule: 'backup-fixture', message: `schema version ${version} has no frozen backup fixture`, fix: `Export a backup with the version-${version} build (encodeBackup over hostile rows: quotes, formulas, CRLF, RTL with marks, emoji, blanks) and commit it as ${rel}; never edit it afterwards.` });
      continue;
    }
    checked += 1;
    const result = checkEnvelope(readFileSync(abs, 'utf8'), { format });
    if (result.kind !== 'ok') {
      ctx.add({ file: rel, rule: 'backup-fixture', message: `the fixture is ${result.kind}: ${result.detail}`, fix: 'A frozen fixture is what an installed app wrote: restore it from version control, or re-export it with that version; never hand-edit it (its payloadSha256 would no longer match).' });
    } else if (result.header.schemaVersion !== version) {
      ctx.add({ file: rel, rule: 'backup-fixture', message: `the fixture declares schemaVersion ${result.header.schemaVersion}, expected ${version}`, fix: `backup-v${version}.json is the file version ${version} of the app wrote.` });
    }
    if (roundTrip !== null && !roundTrip.strings.some((entry) => entry.value === `backup-v${version}`)) {
      ctx.add({ file: roundTrip.rel, rule: 'backup-fixture', message: `backup-v${version} is not in the round-trip test's FIXTURES`, fix: `Add { name: 'backup-v${version}', version: ${version} } to FIXTURES: an untested fixture proves nothing.` });
    }
  }
  return checked;
}

export { canonicalJson, sha256Hex };
