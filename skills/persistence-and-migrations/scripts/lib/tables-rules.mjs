// tables-rules.mjs: check-persistence rules for the shared open path, the forward-only migrations and their
// frozen fixtures, the repositories, resets, peeks and the background checkpoint.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { functionsOf, isTestFile, matchBracket } from './source-scan.mjs';
import { textChecksum } from './database-health.mjs';
import { argumentRanges, arrayIdentifiers, boundNames, chainStart, codeMatches, createTables, driverCalls, expressionEnd, firstArgument, functionAt, isDataWrite, objectEntries, paramNamesByPosition, topLevelReturnObject } from './persistence-source.mjs';

const STEP_FILE = /\/migrations\/v(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

/** A frozen step file: <dataDir>/migrations/vNNNN-<name>.ts. */
export const isStepFile = (ctx, rel) => rel.startsWith(`${ctx.dataDir}/migrations/`) && STEP_FILE.test(rel) && !isTestFile(rel);

export function paths(ctx) {
  const data = ctx.dataDir;
  return {
    driver: `${data}/sql-driver.ts`,
    expoDriver: `${data}/expo-sqlite-sql-driver.ts`,
    open: `${data}/app-database.ts`,
    runner: `${data}/migrations/migration-runner.ts`,
    list: `${data}/migrations/migrations.ts`,
    fixtures: `${data}/migrations/fixtures`,
    checksums: `${data}/migrations/fixtures/fixture-checksums.ts`,
    hook: `${data}/use-checkpoint-on-background.ts`,
    nodeDriver: `${ctx.layout.testDir}/sqlite/node-sqlite-sql-driver.ts`,
    fixturesTest: ctx.contract.fixturesTest ?? `${ctx.layout.testDir}/sqlite/migration-fixtures.test.ts`,
  };
}

const missing = (ctx, file, why) =>
  ctx.add({ file, rule: 'missing-file', message: `required persistence file is missing (${why})`, fix: 'Copy it from the skill templates (templates/<same path>) and adapt it.' });

export function checkRequiredFiles(ctx) {
  const p = paths(ctx);
  const required = [
    [p.driver, 'the SqlDriver port'],
    [p.expoDriver, 'the device driver'],
    [p.open, 'the open path: version check, pragmas, snapshot, migrations'],
    [p.runner, 'the forward-only migration runner'],
    [p.list, 'the ordered migration list'],
    [p.checksums, 'the frozen fixtures\' recorded checksums'],
    [p.hook, 'the WAL checkpoint on background'],
    [p.nodeDriver, 'the node:sqlite driver the SQL tests run on'],
    [p.fixturesTest, 'the test that replays every frozen fixture'],
  ];
  for (const [file, why] of required) if (!ctx.exists(file)) missing(ctx, file, why);
}

// ---------------------------------------------------------------------------------------------
// The open path
// ---------------------------------------------------------------------------------------------

export function checkOpenPath(ctx) {
  const { open } = paths(ctx);
  const src = ctx.sources.get(open);
  if (src === undefined) return;
  const keep = src.scan.codeKeep;
  const pragmaString = src.strings.find((entry) => /journal_mode/i.test(entry.value));
  const pragmas = pragmaString?.value ?? '';
  const need = (pattern, message, fix) => {
    if (!pattern.test(pragmas)) ctx.add({ file: open, line: pragmaString?.line, rule: 'pragmas', message, fix });
  };
  need(/journal_mode\s*=\s*WAL/i, 'no PRAGMA journal_mode = WAL', 'APP_DB_PRAGMAS sets journal_mode = WAL, synchronous = FULL and foreign_keys = ON on every open.');
  need(/synchronous\s*=\s*FULL/i, 'no PRAGMA synchronous = FULL', 'FULL makes a committed transaction survive a power cut; it belongs to the connection, so set it on every open.');
  need(/foreign_keys\s*=\s*ON/i, 'no PRAGMA foreign_keys = ON', 'SQLite ships with foreign keys off (node:sqlite turns them on, so tests would lie): set foreign_keys = ON on every open.');
  const constant = pragmaString === undefined ? null : /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*$/.exec(src.code.slice(Math.max(0, pragmaString.index - 80), pragmaString.index))?.[1] ?? null;
  const execAt = constant === null ? -1 : src.code.search(new RegExp(`\\.exec\\(\\s*${constant}\\s*\\)`));
  if (constant !== null && execAt === -1) ctx.add({ file: open, line: pragmaString.line, rule: 'pragmas', message: `${constant} is defined but never executed`, fix: `Run driver.exec(${constant}) on every open, right after the version check.` });
  checkNewerDatabase(ctx, src, execAt);
  checkUnversioned(ctx, src, execAt);
  checkSnapshot(ctx, src);
  checkSnapshotNames(ctx);
  if (!/wal_checkpoint\(TRUNCATE\)/.test(keep)) ctx.add({ file: open, rule: 'transaction-write', message: 'checkpoint() does not run PRAGMA wal_checkpoint(TRUNCATE)', fix: "checkpoint: driver.get('PRAGMA wal_checkpoint(TRUNCATE)', []), called when the app goes to the background." });
}

/** A file written by a newer build is never touched, and opening never throws (no crash loop). */
function checkNewerDatabase(ctx, src, execAt) {
  const fix = 'Read PRAGMA user_version first; when it is newer than the migration list, close the file and run the session in memory with the newer-version outcome. Every failure becomes an outcome, never a throw.';
  for (const { index } of codeMatches(src, /\bthrow\b/g)) {
    ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'newer-db-crash', message: 'the open path throws: a file it cannot use would crash every launch', fix });
  }
  const versionAt = src.code.search(/\breadUserVersion\s*\(|PRAGMA user_version/);
  const versionString = src.strings.find((entry) => /^PRAGMA user_version$/i.test(entry.value.trim()));
  const firstVersion = versionAt === -1 ? versionString?.index ?? -1 : versionAt;
  if (firstVersion === -1) ctx.add({ file: src.rel, rule: 'newer-db-crash', message: 'the open path never reads PRAGMA user_version', fix });
  else if (execAt !== -1 && execAt < firstVersion) ctx.add({ file: src.rel, line: src.lineOf(execAt), rule: 'newer-db-crash', message: 'the pragmas run before the version check: a newer build\'s file gets written (journal mode) before it is recognised', fix });
  if (!src.strings.some((entry) => entry.value === 'newer-version')) ctx.add({ file: src.rel, rule: 'newer-db-crash', message: 'the open path has no newer-version outcome', fix });
}

/** A version-0 file that already holds tables (an app adopting this layer) is never opened as fresh. */
function checkUnversioned(ctx, src, execAt) {
  const fix = "Before the pragmas, read the file's own tables (userTables(driver)); at user_version 0 with tables, adopt them only when their schema equals migrations 1..baselineVersion, otherwise leave the file and run in memory with the unversioned outcome.";
  const opener = execAt === -1 ? null : functionAt(src, execAt);
  const from = opener?.bodyStart ?? 0;
  const to = opener === null ? src.code.length : execAt;
  const readsTables = /\buserTables\s*\(/.test(src.code.slice(from, to)) || src.strings.some((entry) => entry.index > from && entry.index < to && /sqlite_master/.test(entry.value));
  if (!src.strings.some((entry) => entry.value === 'unversioned') || !readsTables) {
    ctx.add({ file: src.rel, line: execAt === -1 ? undefined : src.lineOf(execAt), rule: 'unversioned-data', message: 'the open path does not check, before the pragmas, whether a user_version 0 file already holds tables: an existing database would be opened as fresh and its rows ignored (or a CREATE TABLE collides)', fix });
  }
}

/** The try block that holds `index` and the catch block after it, or null. */
function tryCatchAround(src, index) {
  for (const { index: at } of codeMatches(src, /\btry\s*\{/g)) {
    const open = src.code.indexOf('{', at);
    const close = matchBracket(src.code, open);
    if (close === -1 || index < open || index > close) continue;
    const handler = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(src.code.slice(close + 1));
    if (handler === null) return null;
    const catchOpen = close + 1 + handler[0].length - 1;
    return { catchOpen, catchClose: matchBracket(src.code, catchOpen) };
  }
  return null;
}

/** VACUUM INTO a new file right before the steps run, in the same function; a failed copy stops them. */
function checkSnapshot(ctx, src) {
  const fix = "Before migrating a file that already holds data: driver.run('VACUUM INTO ?', [snapshotPathFor(driver.path, from)]); a failed snapshot returns the migration-failed outcome, never a migration without a copy.";
  const vacuum = src.strings.find((entry) => /VACUUM\s+INTO/i.test(entry.value));
  if (vacuum === undefined) {
    ctx.add({ file: src.rel, rule: 'migration-snapshot', message: 'no snapshot (VACUUM INTO) before the migrations run', fix });
    return;
  }
  const fn = functionAt(src, vacuum.index);
  const body = fn === null ? '' : src.code.slice(vacuum.index, fn.bodyEnd);
  if (!/\bmigrateDatabase\s*\(/.test(body)) {
    ctx.add({ file: src.rel, line: src.lineOf(vacuum.index), rule: 'migration-snapshot', message: 'the snapshot is not followed by the migration in the same function', fix });
  }
  const guard = tryCatchAround(src, vacuum.index);
  if (guard !== null && !/\b(return|throw)\b/.test(src.code.slice(guard.catchOpen, guard.catchClose))) {
    ctx.add({ file: src.rel, line: src.lineOf(guard.catchOpen), rule: 'migration-snapshot', message: 'a failed snapshot is caught and the migration runs anyway (the catch never returns)', fix });
  }
  if (!/\bprune\w*\s*\(/.test(src.code)) {
    ctx.add({ file: src.rel, rule: 'migration-snapshot', message: 'old snapshots are never pruned: every upgrade leaves another full copy of the database beside it (and in device backups)', fix: 'After a successful migration call pruneSnapshots(deps, driver.path) (template database-snapshots.ts): keep the newest SNAPSHOTS_KEPT copies, delete the rest.' });
  }
}

/** A snapshot name built from the clock writes a new full-size file on every launch that retries. */
function checkSnapshotNames(ctx) {
  for (const src of ctx.sources.values()) {
    if (!src.rel.startsWith(`${ctx.dataDir}/`) || isTestFile(src.rel)) continue;
    for (const entry of src.strings.filter((item) => item.quote === '`' && /\.bak\b/.test(item.value) && item.parts.length > 1)) {
      const substitutions = [...src.raw.slice(entry.index, entry.end).matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]).join(' ');
      if (/now|Date\b|Ms\b|[tT]ime|[sS]tamp/.test(substitutions)) {
        ctx.add({ file: src.rel, line: entry.line, rule: 'migration-snapshot', message: 'the snapshot name embeds a time: a launch that keeps failing writes a new full-size copy every time', fix: 'Name it per from-version (`${databasePath}.v${from}.bak`) and reuse it when it opens at that version (reuseSnapshot in the template).' });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------------------------

/** Returns the latest version (the number of registered steps), or 0 when unknown. */
export function checkMigrations(ctx) {
  const p = paths(ctx);
  checkRunnerTransaction(ctx, p.runner);
  const steps = [...ctx.sources.keys()]
    .filter((rel) => isStepFile(ctx, rel))
    .map((rel) => ({ rel, version: Number(STEP_FILE.exec(rel)[1]), name: STEP_FILE.exec(rel)[2] }))
    .sort((a, b) => a.version - b.version);
  for (const step of steps) checkStep(ctx, step);
  const list = ctx.sources.get(p.list);
  if (list === undefined) return steps.length;
  const entries = arrayIdentifiers(list, 'MIGRATIONS');
  if (entries === null) {
    ctx.add({ file: p.list, rule: 'migration-chain', message: 'no MIGRATIONS array literal', fix: 'export const MIGRATIONS: readonly Migration[] = [STEP_1, STEP_2]; entry N is version N.' });
    return steps.length;
  }
  checkChain(ctx, { list, entries, steps });
  return entries.length;
}

function checkRunnerTransaction(ctx, runner) {
  const src = ctx.sources.get(runner);
  if (src === undefined) return;
  const isWrapped = codeMatches(src, /\.transaction\s*\(/g).some(({ index }) => {
    const open = index + src.code.slice(index).indexOf('(');
    const close = matchBracket(src.code, open);
    const inside = src.scan.codeKeep.slice(open, close === -1 ? undefined : close);
    return /\.up\s*\(/.test(inside) && /user_version/.test(inside);
  });
  if (!isWrapped) ctx.add({ file: runner, rule: 'transaction-write', message: 'a step and its user_version stamp do not run inside one driver.transaction', fix: 'driver.transaction(() => { migration.up(driver); driver.exec(`PRAGMA user_version = ${version}`); }): both commit, or neither does.' });
}

function checkChain(ctx, { list, entries, steps }) {
  const byVersion = new Map(steps.map((step) => [step.version, step]));
  entries.forEach((entry, index) => {
    const version = index + 1;
    const step = byVersion.get(version);
    if (step === undefined) {
      ctx.add({ file: list.rel, line: list.lineOf(entry.index), rule: 'migration-chain', message: `MIGRATIONS entry ${version} (${entry.name}) has no file migrations/v${String(version).padStart(4, '0')}-<name>.ts`, fix: 'One file per version, numbered without gaps; entry N of MIGRATIONS is version N.' });
      return;
    }
    const exported = /export\s+const\s+([A-Z_][A-Z0-9_]*)\s*:\s*Migration\b/.exec(ctx.sources.get(step.rel).code)?.[1];
    if (exported !== undefined && exported !== entry.name) {
      ctx.add({ file: list.rel, line: list.lineOf(entry.index), rule: 'migration-chain', message: `MIGRATIONS entry ${version} is ${entry.name}, but ${step.rel} exports ${exported}`, fix: 'Keep MIGRATIONS in version order: append the new step, never reorder or insert.' });
    }
  });
  for (const step of steps) {
    if (step.version > entries.length) {
      ctx.add({ file: step.rel, rule: 'migration-chain', message: `version ${step.version} is not registered in MIGRATIONS`, fix: `Append its step to MIGRATIONS in ${list.rel} (append-only).` });
    }
  }
  for (let version = 1; version <= Math.max(0, ...steps.map((step) => step.version)); version += 1) {
    if (!byVersion.has(version)) ctx.add({ file: `${ctx.dataDir}/migrations/v${String(version).padStart(4, '0')}-<name>.ts`, rule: 'migration-chain', message: `no migration file for version ${version} (the numbers have a gap)`, fix: 'Versions run 1..N without gaps; a shipped number is never reused or skipped.' });
  }
}

function checkStep(ctx, step) {
  const src = ctx.sources.get(step.rel);
  const add = (index, rule, message, fix) => ctx.add({ file: step.rel, line: src.lineOf(index), rule, message, fix });
  if (!new RegExp(`\\bversion\\s*:\\s*${step.version}\\b`).test(src.code)) add(0, 'migration-chain', `the step does not declare version: ${step.version}`, `Set version: ${step.version} (the number in its file name).`);
  if (!src.strings.some((entry) => entry.value === step.name)) add(0, 'migration-chain', `the step is not named '${step.name}'`, `Set name: '${step.name}' (its file name without the version).`);
  for (const entry of src.imports.filter((item) => !item.typeOnly)) {
    add(entry.index, 'migration-pure', `imports ${entry.spec} at run time`, 'A step is frozen: literal SQL only, and at most `import type { Migration }`. An imported constant or schema can change later and silently change what old installs run.');
  }
  for (const { index, match } of codeMatches(src, /\b(Date\.now|new\s+Date|Math\.random|crypto\.\w+)\s*\(/g)) {
    add(index, 'migration-pure', `calls ${match[1]}()`, 'A step never reads the clock or randomness: the same old file must always become the same new one.');
  }
  for (const { index } of codeMatches(src, /\bdown\s*[:(]/g)) add(index, 'migration-forward-only', 'declares a down step', 'Installed apps only move forward; a down step is never run and gives false confidence. Fix forward with a new version.');
  for (const { index } of codeMatches(src, /\.transaction\s*\(/g)) add(index, 'migration-forward-only', 'opens its own transaction', 'The runner wraps each step and its version stamp in one transaction; a step only runs its statements.');
  for (const entry of src.strings) {
    if (/user_version/i.test(entry.value)) add(entry.index, 'migration-forward-only', 'sets PRAGMA user_version itself', 'The runner stamps the version inside the step\'s transaction; a step never touches user_version.');
    if (/\b(BEGIN|COMMIT|ROLLBACK)\b/.test(entry.value)) add(entry.index, 'migration-forward-only', 'holds BEGIN/COMMIT/ROLLBACK', 'The runner owns the transaction; a nested BEGIN fails and a COMMIT inside a step breaks atomicity.');
    if (/foreign_keys/i.test(entry.value)) add(entry.index, 'migration-forward-only', 'changes PRAGMA foreign_keys inside a step (a no-op inside a transaction)', 'Mark the step rebuildsTables: true; the runner turns foreign keys off around its transaction and checks them before COMMIT.');
    for (const table of createTables(entry.value).filter((item) => !item.isStrict)) {
      add(entry.index, 'pragmas', `table ${table.name} is not STRICT`, 'End every CREATE TABLE with ") STRICT": a value of the wrong type is then an error, not a silent coercion.');
    }
  }
  checkRebuildFlag(ctx, step, src);
}

const TABLE_REBUILD = /\bDROP\s+TABLE\b|\bALTER\s+TABLE\s+["`]?\w+["`]?\s+RENAME\s+TO\b/gi;

/** A step that drops or renames a table is a rebuild: without the flag, foreign keys stay on through it. */
function checkRebuildFlag(ctx, step, src) {
  if (/\brebuildsTables\s*:\s*true\b/.test(src.code)) return;
  // SQL in a `down` step is reported once, as migration-forward-only.
  const open = /:\s*Migration\s*=\s*\{/.exec(src.code);
  const down = open === null ? [] : objectEntries(src, open.index + open[0].length - 1).filter((item) => item.key === 'down');
  for (const entry of src.strings.filter((item) => !down.some((each) => item.index > each.start && item.index < each.end))) {
    for (const match of entry.value.matchAll(TABLE_REBUILD)) {
      const what = /^DROP/i.test(match[0]) ? 'drops a table' : 'renames a table';
      ctx.add({ file: step.rel, line: src.lineOf(entry.index + 1 + match.index), rule: 'migration-rebuild', message: `${what} (${match[0].replace(/\s+/g, ' ')}) without rebuildsTables: true`, fix: 'Mark the step rebuildsTables: true. The runner then turns foreign keys off around its transaction and runs foreign_key_check before COMMIT; with foreign keys on, DROP TABLE of a parent deletes every ON DELETE CASCADE child row, and a renamed parent drags its children\'s references along.' });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Frozen fixtures
// ---------------------------------------------------------------------------------------------

/** Returns [{ version, rel, text }] of the fixtures that exist (for the replay). */
export function checkFixtures(ctx, latest) {
  const p = paths(ctx);
  const checksums = ctx.sources.get(p.checksums)?.raw ?? '';
  const test = ctx.sources.get(p.fixturesTest)?.raw ?? '';
  const found = [];
  for (let version = 1; version <= latest; version += 1) {
    const name = `db-v${version}`;
    const rel = `${p.fixtures}/${name}.sql`;
    const abs = join(ctx.root, rel);
    if (!existsSync(abs)) {
      ctx.add({ file: rel, rule: 'fixture-missing', message: `no ${name}.sql: version ${version} has no frozen database`, fix: `Open a database with the version ${version} build, add representative rows, and freeze it: node <skill>/scripts/inspect-database.mjs <copy of app.db> --dump ${rel}.` });
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    found.push({ version, rel, text });
    const declared = /PRAGMA\s+user_version\s*=\s*(\d+)\s*;/i.exec(text)?.[1];
    if (Number(declared) !== version) ctx.add({ file: rel, rule: 'fixture-frozen', message: `${name}.sql declares user_version ${declared ?? '(none)'}, expected ${version}`, fix: 'Restore the frozen file from git; a fixture is the database that version wrote.' });
    const recorded = new RegExp(`['"]${name}['"]\\s*:\\s*['"]([0-9a-f]{8})['"]`).exec(checksums)?.[1];
    const actual = textChecksum(text);
    if (recorded === undefined) ctx.add({ file: p.checksums, rule: 'fixture-missing', message: `no checksum entry for ${name}`, fix: `Add '${name}': '${actual}' to FIXTURE_CHECKSUMS (a reviewed change: Gate-Change trailer or CODEOWNERS).` });
    else if (recorded !== actual) ctx.add({ file: rel, rule: 'fixture-frozen', message: `${name}.sql changed: its checksum is ${actual}, the recorded one is ${recorded}`, fix: 'A shipped fixture is frozen: restore it from git. A new schema is a new version with its own fixture, never an edit.' });
    if (!new RegExp(`['"]${name}['"]`).test(test)) ctx.add({ file: p.fixturesTest, rule: 'fixture-untested', message: `${name} is not in FIXTURES`, fix: `Add { name: '${name}', version: ${version} } to FIXTURES so it is replayed on every test run.` });
  }
  return { versioned: found, legacy: checkLegacyFixtures(ctx, { checksums, test }) };
}

/** db-v0-<variant>.sql: unversioned databases older builds left, adopted through BASELINE. */
function checkLegacyFixtures(ctx, { checksums, test }) {
  const p = paths(ctx);
  const dir = join(ctx.root, p.fixtures);
  const names = existsSync(dir) ? readdirSync(dir).filter((file) => /^db-v0-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/.test(file)).sort() : [];
  return names.map((file) => {
    const name = file.replace(/\.sql$/, '');
    const rel = `${p.fixtures}/${file}`;
    const text = readFileSync(join(ctx.root, rel), 'utf8');
    const recorded = new RegExp(`['"]${name}['"]\\s*:\\s*['"]([0-9a-f]{8})['"]`).exec(checksums)?.[1];
    const actual = textChecksum(text);
    if (recorded === undefined) ctx.add({ file: p.checksums, rule: 'fixture-missing', message: `no checksum entry for ${name}`, fix: `Add '${name}': '${actual}' to FIXTURE_CHECKSUMS (a reviewed change).` });
    else if (recorded !== actual) ctx.add({ file: rel, rule: 'fixture-frozen', message: `${name}.sql changed: its checksum is ${actual}, the recorded one is ${recorded}`, fix: 'A legacy fixture is what old builds left on phones: restore it from git.' });
    if (!new RegExp(`['"]${name}['"]`).test(test)) ctx.add({ file: p.fixturesTest, rule: 'fixture-untested', message: `${name} is not in LEGACY_FIXTURES`, fix: `Add '${name}' to LEGACY_FIXTURES so its adoption and upgrade run on every test run.` });
    return { version: 0, name, rel, text };
  });
}

// ---------------------------------------------------------------------------------------------
// Repositories, resets, schemas, peeks, the background checkpoint
// ---------------------------------------------------------------------------------------------

const VALIBOT_PARSE = /\bv\.(?:parse|safeParse|parser|safeParser)\s*\(/g;
const NAMED_PARSE = /(?<![.\w$])(?:parse|safeParse)\s*\(\s*[A-Z][A-Z0-9_]*\b/g;
const LOOP_CALL = /\.(?:forEach|map|flatMap|reduce|filter|some|every)\s*\(/g;
const LOOP_STATEMENT = /\b(?:for|while)\s*\(/g;

/** Indexes of schema checks in [from, to]: v.parse/v.safeParse, or parse(SCHEMA) imported from valibot (never JSON.parse or parseInt). */
function parseCalls(src, from, to) {
  const patterns = src.imports.some((entry) => entry.spec === 'valibot') ? [VALIBOT_PARSE, NAMED_PARSE] : [VALIBOT_PARSE];
  return patterns.flatMap((pattern) => codeMatches(src, pattern).map(({ index }) => index)).filter((index) => index > from && index < to);
}

/** Names of same-file functions whose body passes `test`, directly or through another such function. */
function functionsReaching(src, test) {
  const named = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1 && fn.name !== '(anonymous)');
  const reaching = new Set(named.filter((fn) => test(fn)).map((fn) => fn.name));
  for (let grew = true; grew; ) {
    grew = false;
    for (const fn of named) {
      if (reaching.has(fn.name) || !callsAny(src.code.slice(fn.bodyStart, fn.bodyEnd), reaching)) continue;
      reaching.add(fn.name);
      grew = true;
    }
  }
  return reaching;
}

const callsAny = (text, names) => [...names].some((name) => new RegExp(`(?<![.\\w$])${name}\\s*[(<]`).test(text));

/** Every `.all(` / `.get(` on the driver in [from, to], whatever form its SQL argument takes. */
function driverReads(model, from, to) {
  return model.calls.filter((call) => (call.method === 'all' || call.method === 'get') && call.index > from && call.index < to);
}

/** [start, end] of every loop body and iterating callback between from and to. */
function loopRanges(src, from, to) {
  const ranges = [];
  for (const { index } of codeMatches(src, LOOP_CALL)) {
    const open = index + src.code.slice(index).indexOf('(');
    if (index > from && index < to) ranges.push([open, matchBracket(src.code, open)]);
  }
  for (const { index } of codeMatches(src, LOOP_STATEMENT)) {
    if (index < from || index > to) continue;
    const close = matchBracket(src.code, src.code.indexOf('(', index));
    const after = close + 1 + (/^\s*/.exec(src.code.slice(close + 1))?.[0].length ?? 0);
    const end = src.code[after] === '{' ? matchBracket(src.code, after) : src.code.indexOf(';', after);
    ranges.push([close, end]);
  }
  return ranges;
}

/** [open, close] of the argument list of every `.transaction(` call between from and to. */
function transactionRanges(src, from, to) {
  return codeMatches(src, /\.transaction\s*\(/g)
    .filter(({ index }) => index > from && index < to)
    .map(({ index }) => {
      const open = index + src.code.slice(index).indexOf('(');
      return [open, matchBracket(src.code, open)];
    });
}

const within = (ranges, index) => ranges.some(([from, to]) => index > from && (to === -1 || index < to));

// ---------------------------------------------------------------------------------------------
// Read flow: where the rows a driver read returns go (validate-on-read, and which parses check input)
// ---------------------------------------------------------------------------------------------

const ARRAY_CALLBACK = /\.\s*(?:map|flatMap|forEach|filter|reduce|reduceRight|find|findLast|some|every|sort|toSorted)\s*\(/g;
const escapeName = (name) => name.replace(/\$/g, '\\$');

/** true when the code in [from, to] holds a seed: a read's index, or one of `names` as a free identifier. */
function holds(src, from, to, seeds, names) {
  if (seeds.some((index) => index >= from && index < to)) return true;
  const text = src.code.slice(from, to);
  return [...names].some((name) => new RegExp(`(?<![\\w$.])${escapeName(name)}(?![\\w$])`).test(text));
}

/** The parameter names of the callback that opens right after `open` (`(row) =>`, `row =>`, `function (row)`), or []. */
function callbackParams(code, open) {
  let i = open + 1;
  while (/\s/.test(code[i] ?? '')) i += 1;
  if (code.startsWith('async', i)) i += 5;
  while (/\s/.test(code[i] ?? '')) i += 1;
  if (code.startsWith('function', i)) i = code.indexOf('(', i);
  if (code[i] === '(') return paramNamesByPosition(code, i).flat();
  const single = /^([A-Za-z_$][\w$]*)\s*=>/.exec(code.slice(i, i + 80));
  return single === null ? [] : [single[1]];
}

/**
 * Names that carry what the seeds hold inside [from, to], to a fixpoint: a declaration initialised
 * from a seed (`const rows = driver.all(...)`, `const row = attempt(() => driver.get(...))`), a
 * for...of binding over one, and the parameters of an array callback called on one (`rows.map((row) =>`).
 */
function derivedNames(src, from, to, seeds, initial = []) {
  const { code } = src;
  const names = new Set(initial);
  const steps = [];
  const slice = code.slice(from, to);
  for (const match of slice.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*|\{[^=;]*?\}|\[[^=;]*?\])\s*(?::[^=;]+)?=(?![=>])\s*/g)) {
    const start = from + match.index + match[0].length;
    steps.push({ from: start, to: expressionEnd(code, start, { comma: true }), names: boundNames(match[1].trim()) });
  }
  for (const match of slice.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*|\{[^}]*\}|\[[^\]]*\])\s+of\s+/g)) {
    const open = from + match.index + match[0].indexOf('(');
    steps.push({ from: from + match.index + match[0].length, to: matchBracket(code, open), names: boundNames(match[1].trim()) });
  }
  for (const match of slice.matchAll(ARRAY_CALLBACK)) {
    const at = from + match.index;
    steps.push({ from: chainStart(code, at), to: at, names: callbackParams(code, at + match[0].length - 1) });
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const step of steps) {
      if (step.names.every((name) => names.has(name)) || !holds(src, step.from, step.to, seeds, names)) continue;
      for (const name of step.names) names.add(name);
      grew = true;
    }
  }
  return names;
}

/** [return, end] of every return statement in [from, to]. */
function returnRanges(src, from, to) {
  return codeMatches(src, /\breturn\b/g)
    .filter(({ index }) => index > from && index < to)
    .map(({ index }) => [index, expressionEnd(src.code, index + 6)]);
}

/** Names bound to a valibot parser function (`const parseRow = v.safeParser(TASK_ROW)`): a call of one is a schema check. */
function parserFunctionNames(src) {
  return new Set([...src.code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*v\.(?:parser|safeParser)\s*\(/g)].map((match) => match[1]));
}

/**
 * The schema checks in [from, to], each with the code range of the value it checks: v.parse/v.safeParse
 * (and v.parser(SCHEMA)(value)), a parser function's call, a call of a same-file helper that reaches a
 * parse (`helper`, followed into its parameter), and an array method handed one (`rows.map(parseRow)`).
 */
function parseSites(model, from, to, stack) {
  const { code } = model.src;
  const sites = [];
  for (const index of parseCalls(model.src, from, to)) {
    const open = code.indexOf('(', index);
    let close = matchBracket(code, open);
    if (close !== -1 && /\.(?:parser|safeParser)\s*\($/.test(code.slice(index, open + 1)) && code[close + 1] === '(') close = matchBracket(code, close + 1);
    sites.push({ index, from: open, to: close === -1 ? to : close, helper: null });
  }
  for (const name of model.parserFns) {
    for (const match of code.slice(from, to).matchAll(new RegExp(`(?<![.\\w$])${escapeName(name)}\\s*\\(`, 'g'))) {
      const open = from + match.index + match[0].length - 1;
      sites.push({ index: from + match.index, from: open, to: matchBracket(code, open), helper: null });
    }
  }
  for (const call of helperCalls(model, from, to, stack).filter((each) => model.parsers.has(each.name))) {
    const open = code.indexOf('(', call.index);
    sites.push({ index: call.index, from: open, to: matchBracket(code, open), helper: call.name, open });
  }
  for (const match of code.slice(from, to).matchAll(ARRAY_CALLBACK)) {
    const at = from + match.index;
    const ref = /^\s*([A-Za-z_$][\w$]*)\s*\)/.exec(code.slice(at + match[0].length, at + match[0].length + 80))?.[1];
    if (ref !== undefined && model.parserFns.has(ref)) sites.push({ index: at, from: chainStart(code, at), to: at, helper: null });
    else if (ref !== undefined && model.parsers.has(ref) && !stack.includes(ref)) sites.push({ index: at, from: chainStart(code, at), to: at, helper: ref, position: 0 });
  }
  return sites;
}

/** true when same-file function `name` passes its parameter at `position` into a schema check. */
function paramChecked(model, name, position, stack) {
  const key = `${name}:${position}`;
  if (model.checkedParams.has(key)) return model.checkedParams.get(key);
  const fn = model.byName.get(name);
  if (fn === undefined || stack.includes(name)) return false;
  model.checkedParams.set(key, false);
  const params = paramNamesByPosition(model.src.code, fn.index)[position] ?? [];
  const checked = params.length > 0 && valueChecked(model, fn.bodyStart, fn.bodyEnd, [...stack, name], [], params);
  model.checkedParams.set(key, checked);
  return checked;
}

/** true when what the seeds (read indexes) or `initial` names hold reaches a schema check inside [from, to]. */
function valueChecked(model, from, to, stack, seeds, initial = []) {
  const { src } = model;
  const names = derivedNames(src, from, to, seeds, initial);
  return parseSites(model, from, to, stack).some((site) => {
    if (site.helper === null) return holds(src, site.from, site.to, seeds, names);
    if (site.position !== undefined) return holds(src, site.from, site.to, seeds, names) && paramChecked(model, site.helper, site.position, stack);
    return argumentRanges(src.code, site.open).some(([a, b], position) => holds(src, a, b, seeds, names) && paramChecked(model, site.helper, position, stack));
  });
}

/**
 * The reads in [from, to]: `.get`/`.all` on the driver, and calls of same-file helpers that hand back
 * rows they did not check (the caller must check them).
 */
function readSites(model, from, to, stack) {
  const own = driverReads(model, from, to).map((call) => ({ index: call.index, helper: null }));
  const handed = helperCalls(model, from, to, stack).filter((call) => model.readFlowOf(call.name, stack).raw).map((call) => ({ index: call.index, helper: call.name }));
  return [...own, ...handed].sort((a, b) => a.index - b.index);
}

/**
 * What a helper does with the rows it reads: `raw` when it returns some unchecked (its callers must
 * check them), `dropped` for reads it neither checks nor returns (used as they came).
 */
function readFlow(model, name, stack) {
  const fn = model.byName.get(name);
  const flow = { raw: false, dropped: [] };
  if (fn === undefined || stack.includes(name)) return flow;
  const inner = [...stack, name];
  for (const site of readSites(model, fn.bodyStart, fn.bodyEnd, inner)) {
    if (valueChecked(model, fn.bodyStart, fn.bodyEnd, inner, [site.index])) continue;
    const names = derivedNames(model.src, fn.bodyStart, fn.bodyEnd, [site.index]);
    if (returnRanges(model.src, fn.bodyStart, fn.bodyEnd).some(([a, b]) => holds(model.src, a, b, [site.index], names))) flow.raw = true;
    else flow.dropped.push(site);
  }
  return flow;
}

/** Same-file functions with a schema check of their input: a parse whose value holds no read. */
function inputParsersOf(model) {
  const { src } = model;
  const found = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const fn of model.byName.values()) {
      if (found.has(fn.name)) continue;
      const reads = readSites(model, fn.bodyStart, fn.bodyEnd, [fn.name]).map((site) => site.index);
      const names = derivedNames(src, fn.bodyStart, fn.bodyEnd, reads);
      const checksInput = parseSites(model, fn.bodyStart, fn.bodyEnd, [fn.name]).some((site) => (site.helper === null || found.has(site.helper)) && !holds(src, site.from, site.to, reads, names));
      if (!checksInput) continue;
      found.add(fn.name);
      grew = true;
    }
  }
  return found;
}

/**
 * The same-file call graph of a repository: each named function's statements, summarised once.
 * A summary: { statements, inLoop, covered, write } where `write` is the first data write the
 * function makes before validating (an index in its body), and `covered` means its statements need
 * no transaction from the caller (fewer than two, or all inside its own transaction).
 */
function repositoryModel(ctx, src) {
  const named = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1 && fn.name !== '(anonymous)');
  const byName = new Map();
  for (const fn of named) if (!byName.has(fn.name)) byName.set(fn.name, fn);
  const parserFns = parserFunctionNames(src);
  const parsers = functionsReaching(src, (fn) => parseCalls(src, fn.bodyStart, fn.bodyEnd).length > 0 || callsAny(src.code.slice(fn.bodyStart, fn.bodyEnd), parserFns));
  const summaries = new Map();
  const reached = new Set();
  const flows = new Map();
  let inputParsers = null;
  const model = { src, byName, parsers, parserFns, reached, checkedParams: new Map(), calls: driverCalls(src, ctx) };
  model.readFlowOf = (name, stack = []) => {
    if (!flows.has(name)) {
      flows.set(name, { raw: false, dropped: [] });
      flows.set(name, readFlow(model, name, stack));
    }
    return flows.get(name);
  };
  Object.defineProperty(model, 'inputParsers', { get: () => (inputParsers ??= inputParsersOf(model)) });
  model.summaryOf = (name, stack = []) => {
    if (summaries.has(name)) return summaries.get(name);
    const fn = byName.get(name);
    if (fn === undefined || stack.includes(name)) return null;
    reached.add(name);
    const summary = summarize(model, fn.bodyStart, fn.bodyEnd, [...stack, name]);
    summaries.set(name, summary);
    return summary;
  };
  return model;
}

/** Calls to same-file named functions in [from, to] (not their declarations): [{ name, index }]. */
function helperCalls(model, from, to, stack) {
  const calls = [];
  const text = model.src.code.slice(from, to);
  for (const name of model.byName.keys()) {
    if (stack.includes(name)) continue;
    for (const match of text.matchAll(new RegExp(`(?<![.\\w$])${name}\\s*[(<]`, 'g'))) {
      const index = from + match.index;
      if (/\bfunction\s*$/.test(model.src.code.slice(Math.max(0, index - 12), index))) continue;
      calls.push({ name, index });
    }
  }
  return calls.sort((a, b) => a.index - b.index);
}

/**
 * Statement sites of [from, to]: its own `.run(` calls and calls to helpers that run statements. A
 * `.run(` whose SQL cannot be resolved (built at run time, picked by a condition) counts as a write.
 */
function summarize(model, from, to, stack) {
  const { src } = model;
  const loops = loopRanges(src, from, to);
  const transactions = transactionRanges(src, from, to);
  const sites = model.calls
    .filter((call) => call.method === 'run' && call.index > from && call.index < to)
    .map(({ index, sql }) => ({ index, statements: 1, loop: within(loops, index), wrapped: within(transactions, index), write: sql === null || isDataWrite(sql), helper: null, helperCovered: false }));
  for (const call of helperCalls(model, from, to, stack)) {
    const helper = model.summaryOf(call.name, stack);
    if (helper === null || helper.statements === 0) continue;
    // A helper's own loop matters to the caller only when the helper leaves it uncovered: a loop
    // inside the helper's own transaction commits once, like a single statement.
    const loop = within(loops, call.index) || (helper.inLoop && !helper.covered);
    sites.push({ index: call.index, statements: helper.statements, loop, wrapped: within(transactions, call.index), write: helper.write !== null, helper: call.name, helperCovered: helper.covered });
  }
  sites.sort((a, b) => a.index - b.index);
  // A parse of what a driver read returned checks the rows, not the input (validate-on-read's job).
  const reads = readSites(model, from, to, stack).map((site) => site.index);
  const readNames = derivedNames(src, from, to, reads);
  const parses = parseSites(model, from, to, stack)
    .filter((site) => (site.helper === null || model.inputParsers.has(site.helper)) && !holds(src, site.from, site.to, reads, readNames))
    .map((site) => site.index);
  const statements = sites.reduce((sum, site) => sum + site.statements, 0);
  const inLoop = sites.some((site) => site.loop);
  const isAlone = sites.length === 1 && !sites[0].loop && sites[0].helperCovered;
  const covered = statements + (inLoop ? 1 : 0) < 2 || sites.every((site) => site.wrapped) || isAlone;
  const write = sites.find((site) => site.write && !parses.some((at) => at < site.index)) ?? null;
  return { statements, inLoop, covered, write, sites };
}

export function checkRepositories(ctx) {
  const repositories = [...ctx.sources.keys()].filter((rel) => rel.startsWith(`${ctx.dataDir}/`) && !rel.startsWith(`${ctx.dataDir}/document/`) && /\/sqlite-[a-z0-9-]+-repository\.ts$/.test(rel));
  if (repositories.length === 0) {
    ctx.add({ file: `${ctx.dataDir}/<area>/sqlite-<area>-repository.ts`, rule: 'missing-file', message: 'no SQLite repository: in tables mode every table is reached through one', fix: 'Copy templates/src/data/tasks/ and adapt it, or set "mode": "document" in contracts/persistence.json.' });
  }
  for (const rel of repositories) checkRepository(ctx, ctx.sources.get(rel));
}

/** A repository file of tables mode: <dataDir>/<area>/sqlite-<area>-repository.ts (document/ excluded). */
const isRepositoryFile = (ctx, rel) => rel.startsWith(`${ctx.dataDir}/`) && !rel.startsWith(`${ctx.dataDir}/document/`) && /\/sqlite-[a-z0-9-]+-repository\.ts$/.test(rel);

/**
 * Data-folder files that run statements by design: the open path and its helpers, the drivers, the
 * migrations, the peeks, the document appendix (its own rules), the contract's reset modules, and
 * what the contract's sqlAllowed lists.
 */
function isInfrastructure(ctx, rel) {
  const inData = rel.slice(ctx.dataDir.length + 1);
  if (['app-database.ts', 'database-schema.ts', 'database-snapshots.ts'].includes(inData)) return true;
  if (/^(migrations|document)\//.test(inData) || /(^|\/)peek-[a-z0-9-]+\.ts$/.test(inData) || /-sql-driver\.ts$/.test(inData)) return true;
  return [...(ctx.contract.resetModules ?? []), ...(ctx.contract.sqlAllowed ?? [])].includes(rel);
}

/**
 * Statements run only in repository files (and their same-file helpers), where the rules above prove
 * validation, row schemas and transactions; a helper moved to a sibling file or a repository named
 * otherwise would escape all of them.
 */
export function checkSqlOutsideRepositories(ctx) {
  for (const src of ctx.sources.values()) {
    const { rel } = src;
    if (!rel.startsWith(`${ctx.dataDir}/`) || isTestFile(rel) || isRepositoryFile(ctx, rel) || isInfrastructure(ctx, rel)) continue;
    const calls = driverCalls(src, ctx);
    if (calls.length === 0) continue;
    const methods = [...new Set(calls.map((call) => `.${call.method}()`))].join(', ');
    ctx.add({ file: rel, line: src.lineOf(calls[0].index), rule: 'sql-outside-repository', message: `runs statements (${methods}, ${calls.length} call${calls.length === 1 ? '' : 's'}) outside a repository file: no repository rule (validated input, row schemas, transactions, a node:sqlite test) reads this file`, fix: `Move the statements into ${ctx.dataDir}/<area>/sqlite-<area>-repository.ts, as methods of createSqlite<Area>Repository or same-file helpers they call (rename a repository so its name says so). A reset goes in contracts/persistence.json resetModules (its protected tables and its transaction are checked there); only other infrastructure (a debug read of PRAGMA page_count) goes in sqlAllowed.` });
  }
}

function checkRepository(ctx, src) {
  const tested = [...ctx.sources.values()].some((other) => other.rel.startsWith(`${ctx.layout.testDir}/`) && isTestFile(other.rel) && other.imports.some((entry) => entry.spec.endsWith(src.rel.split('/').pop().replace(/\.ts$/, ''))));
  if (!tested) ctx.add({ file: src.rel, rule: 'missing-file', message: `no node:sqlite test under ${ctx.layout.testDir}/ imports this repository`, fix: `Add ${ctx.layout.testDir}/sqlite/${src.rel.split('/').pop().replace(/\.ts$/, '.test.ts')}: real SQL through openAppDatabase on node:sqlite.` });
  // Methods live in the objects the factory (or its helpers, spread into it) returns.
  const methodObjects = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1).map((fn) => topLevelReturnObject(src, fn)).filter((at) => at !== -1);
  if (!/export\s+function\s+createSqlite\w*Repository\s*\(/.test(src.code) || methodObjects.length === 0) {
    ctx.add({ file: src.rel, rule: 'validate-before-write', message: 'no createSqlite<Area>Repository returning an object of methods', fix: 'export function createSqlite<Area>Repository(deps) { return { method: (input) => { ... } } } (helpers that return methods may be spread into it): the checker reads each method.' });
    return;
  }
  const model = repositoryModel(ctx, src);
  const scope = { model, reported: new Set() };
  checkExecInRepository(ctx, src, model);
  const methods = [];
  for (const at of new Set(methodObjects)) {
    for (const entry of objectEntries(src, at)) {
      const method = methodOf(src, model, entry);
      if (method !== null) methods.push(method);
    }
  }
  for (const method of methods) checkMethod(ctx, src, method, scope);
  checkSqlInsideMethods(ctx, src, model, methods);
}

/**
 * An object entry as a method: { name, start, end }. `addTask: (input) => { ... }` is its own body;
 * `addTask` or `addTask: addTaskImpl` names a same-file function, whose body is the method.
 */
function methodOf(src, model, entry) {
  const text = src.code.slice(entry.start, entry.end).trim();
  const reference = /^(?:([A-Za-z_$][\w$]*)\s*:\s*)?([A-Za-z_$][\w$]*)$/.exec(text);
  const fn = reference === null ? undefined : model.byName.get(reference[2]);
  if (fn !== undefined) {
    model.summaryOf(fn.name);
    return { name: reference[1] ?? reference[2], start: fn.bodyStart, end: fn.bodyEnd, self: fn.name };
  }
  return entry.key === null ? null : { name: entry.key, start: entry.start, end: entry.end, self: null };
}

/** exec() runs DDL and pragmas in the open path and the migrations; in a repository it skips binding and the transaction rules. */
function checkExecInRepository(ctx, src, model) {
  for (const call of model.calls.filter((each) => each.method === 'exec')) {
    const statements = (call.sql ?? '').split(';').filter((part) => part.trim() !== '').length;
    const what = call.sql === null ? 'SQL the checker cannot read' : `${statements} statement${statements === 1 ? '' : 's'}`;
    ctx.add({ file: src.rel, line: src.lineOf(call.index), rule: 'exec-in-repository', message: `calls driver.exec() (${what}): each statement autocommits on its own and takes no bound parameters`, fix: 'Use driver.run(sql, params) for each statement, inside one driver.transaction(() => { ... }) when there are several; exec belongs to the open path and the migrations (DDL, pragmas).' });
  }
}

const READ_FIX = 'Pass what the read returns through its valibot row schema: v.safeParse(ROW, row) on the call\'s result, on a variable assigned from it, or in a same-file helper that receives it (readableRows); skip and log an unreadable row instead of crashing the list. A parse of the input does not check the rows.';

/** Same-file helpers a range calls, directly or through each other. */
function reachedHelpers(model, from, to, stack, found = new Set()) {
  for (const call of helperCalls(model, from, to, stack)) {
    if (found.has(call.name)) continue;
    found.add(call.name);
    const fn = model.byName.get(call.name);
    reachedHelpers(model, fn.bodyStart, fn.bodyEnd, [...stack, call.name], found);
  }
  return found;
}

/** Every row a method reads reaches a schema check: its own reads, rows a helper hands back, rows a helper reads and uses. */
function checkMethodReads(ctx, src, method, scope) {
  const { model } = scope;
  const stack = method.self === null ? [] : [method.self];
  for (const site of readSites(model, method.start, method.end, stack)) {
    if (valueChecked(model, method.start, method.end, stack, [site.index])) continue;
    const via = site.helper === null ? '' : ` (rows from ${site.helper})`;
    ctx.add({ file: src.rel, line: src.lineOf(site.index), rule: 'validate-on-read', message: `${method.name} reads rows without a row schema (no safeParse on its path)${via}`, fix: READ_FIX });
  }
  for (const helper of reachedHelpers(model, method.start, method.end, stack)) {
    for (const site of model.readFlowOf(helper).dropped) {
      if (scope.reported.has(site.index)) continue;
      scope.reported.add(site.index);
      ctx.add({ file: src.rel, line: src.lineOf(site.index), rule: 'validate-on-read', message: `${method.name} reads rows without a row schema (no safeParse on its path) (in ${helper})`, fix: READ_FIX });
    }
  }
}

function checkMethod(ctx, src, method, scope) {
  const { name } = method;
  checkMethodReads(ctx, src, method, scope);
  const summary = summarize(scope.model, method.start, method.end, method.self === null ? [] : [method.self]);
  const via = (site) => (site.helper === null ? '' : ` (through ${site.helper})`);
  if (summary.write !== null) {
    ctx.add({ file: src.rel, line: src.lineOf(summary.write.index), rule: 'validate-before-write', message: `${name} writes without validating its input first${via(summary.write)}`, fix: 'Parse the input with its valibot schema (v.safeParse, here or in a same-file helper the method calls first, failing with a typed input failure) before binding it: invalid data is never written.' });
  }
  if (!summary.covered) {
    const site = summary.sites.find((each) => !each.wrapped) ?? summary.sites[0];
    const what = summary.inLoop ? 'runs a statement per item of a loop' : `runs ${summary.statements} statements`;
    ctx.add({ file: src.rel, line: src.lineOf(site.index), rule: 'transaction-write', message: `${name} ${what} outside driver.transaction${via(site)}`, fix: 'Wrap them in one driver.transaction(() => { ... }) in the method (or inside the one helper that runs them all): a kill between two statements must not leave half a change, and one commit is one fsync under synchronous = FULL.' });
  }
}

/** A statement outside every method and every helper a method reaches escapes the rules above. */
function checkSqlInsideMethods(ctx, src, model, methods) {
  const named = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1);
  for (const { index, method: call } of model.calls.filter((each) => each.method !== 'transaction')) {
    if (methods.some((method) => index > method.start && index < method.end)) continue;
    const owners = named.filter((fn) => index > fn.bodyStart && index < fn.bodyEnd);
    if (owners.some((fn) => model.reached.has(fn.name))) continue;
    const where = owners.length === 0 ? 'at module level' : `in ${owners.sort((a, b) => a.bodyEnd - a.bodyStart - (b.bodyEnd - b.bodyStart))[0].name}, which no method calls`;
    ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'sql-outside-method', message: `runs .${call}() ${where}`, fix: 'Keep every statement inside a method of the object createSqlite<Area>Repository returns, or in a same-file helper a method calls: that is where the checker proves validation and transactions.' });
  }
}

export function checkResets(ctx) {
  const protectedTables = ctx.contract.protectedTables ?? [];
  for (const rel of ctx.contract.resetModules ?? []) {
    const src = ctx.sources.get(rel);
    if (src === undefined) {
      ctx.add({ file: rel, rule: 'missing-file', message: 'a reset module named in contracts/persistence.json is missing', fix: 'Copy templates/src/data/reset-data.ts, or fix resetModules in the contract.' });
      continue;
    }
    for (const entry of src.strings.filter((item) => item.quote === '`' && item.parts.length > 1 && /\b(DELETE|UPDATE|DROP|INSERT|REPLACE)\b/i.test(item.value))) {
      ctx.add({ file: rel, line: entry.line, rule: 'protected-reset', message: 'a reset builds its SQL from a value (a table list): nothing proves it never reaches a protected table', fix: `List each statement literally ('DELETE FROM tasks'), children before parents, so a review and this checker see every table it clears (never ${protectedTables.join(', ') || 'a protected table'}).` });
    }
    for (const entry of src.strings) {
      for (const table of protectedTables) {
        if (new RegExp(`\\b(DELETE\\s+FROM|UPDATE|DROP\\s+TABLE|INSERT\\s+OR\\s+REPLACE\\s+INTO)\\s+["\`]?${table}\\b`, 'i').test(entry.value)) {
          ctx.add({ file: rel, line: entry.line, rule: 'protected-reset', message: `a reset touches the protected table ${table}`, fix: `Resets clear the user's own tables and never ${protectedTables.join(', ')}: an entitlement ends only with a dated revocation from the store.` });
        }
      }
    }
    if (/\.run\s*\(/.test(src.code) && !/\.transaction\s*\(/.test(src.code)) {
      ctx.add({ file: rel, rule: 'transaction-write', message: 'the reset does not run inside driver.transaction', fix: 'A kill halfway through a reset must not leave half the data: wrap every DELETE in one driver.transaction.' });
    }
  }
}

export function checkSchemas(ctx, { document }) {
  for (const src of ctx.sources.values()) {
    const { rel } = src;
    if (!rel.startsWith(`${ctx.dataDir}/`) || isTestFile(rel)) continue;
    const isDocumentSchema = rel.startsWith(`${ctx.dataDir}/document/schema/`);
    const isTableSchema = /-schema\.ts$/.test(rel) && !rel.startsWith(`${ctx.dataDir}/document/`);
    if (!(isTableSchema || (document && isDocumentSchema))) continue;
    for (const { index, match } of codeMatches(src, /\bv\.(object|looseObject|any)\s*\(/g)) {
      ctx.add({ file: rel, line: src.lineOf(index), rule: 'schema-strict', message: `uses v.${match[1]}`, fix: 'Use v.strictObject and precise types: an unknown key or a wrong type is an error, so a typo cannot slip through.' });
    }
  }
}

export function checkPeeks(ctx) {
  for (const src of ctx.sources.values()) {
    if (!src.rel.startsWith(`${ctx.dataDir}/`) || !/\/peek-[a-z0-9-]+\.ts$/.test(src.rel) || isTestFile(src.rel)) continue;
    for (const { index, match } of codeMatches(src, /\.(run|exec|transaction)\s*\(|\b(openAppDatabase|openDeviceDatabase|migrateDatabase)\s*\(/g)) {
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'peek-writes', message: `the startup peek calls ${match[1] ? `.${match[1]}()` : `${match[2]}()`}`, fix: 'A peek runs before decisions that can reload the app: read only (get/all), no DDL, no pragma, no migration, no write.' });
    }
  }
}

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA|WITH|VACUUM)\b/i;
/** The runner's (and the adoption's) version stamp: the one value PRAGMA cannot take as a parameter. */
const VERSION_STAMP = /^`\s*PRAGMA\s+user_version\s*=\s*\$\{[^}]*\}\s*;?\s*`$/;

/** Values go in as bound parameters (`?`), never into the SQL text: no injection, one statement plan. */
export function checkBoundParams(ctx) {
  const resets = new Set(ctx.contract.resetModules ?? []);
  const owners = [`${ctx.layout.servicesDir}/error-log/sqlite-error-log-adapter.ts`, ...(ctx.contract.sqlAllowed ?? [])];
  for (const src of ctx.sources.values()) {
    const isData = src.rel.startsWith(`${ctx.dataDir}/`) || owners.includes(src.rel);
    if (!isData || isTestFile(src.rel) || resets.has(src.rel)) continue;
    const report = (line, how) => ctx.add({ file: src.rel, line, rule: 'sql-bound-params', message: `builds SQL from a value (${how})`, fix: "Bind every value as a parameter: driver.run('UPDATE tasks SET is_done = ? WHERE id = ?', [isDone ? 1 : 0, id]). Text built into SQL breaks on a quote and lets input run its own SQL." });
    for (const entry of src.strings.filter((item) => item.quote === '`' && item.parts.length > 1)) {
      const raw = src.raw.slice(entry.index, entry.end);
      if (SQL_START.test(entry.value) && !VERSION_STAMP.test(raw)) report(entry.line, 'a template literal with ${...}');
    }
    const lines = new Set();
    for (const { index } of codeMatches(src, /\.(?:run|get|all|exec)\s*\(/g)) {
      const { text, sql } = firstArgument(src, index + src.code.slice(index).indexOf('('));
      const isConcatenated = /^['"`][^]*['"`]\s*\+|\+\s*['"`]/.test(text);
      if (isConcatenated && SQL_START.test(sql ?? text.replace(/^['"`]/, ''))) lines.add(src.lineOf(index));
    }
    // Wherever it sits (`const sql = 'UPDATE tasks SET is_done = ' + flag + ' WHERE id = ?'`), not only in the call.
    for (const entry of src.strings.filter((item) => SQL_START.test(item.value) && isConcatenatedWithValue(src, item))) lines.add(entry.line);
    for (const line of [...lines].sort((a, b) => a - b)) report(line, 'string concatenation');
  }
}

/** true when a string literal is an operand of `+` whose chain holds something other than plain literals. */
function isConcatenatedWithValue(src, entry) {
  const literalAt = (index) => src.scan.stringAt.get(index);
  const isPlain = (literal) => literal !== undefined && !(literal.quote === '`' && literal.parts.length > 1);
  for (let end = entry.end; ; ) {
    const plus = /^\s*\+\s*/.exec(src.code.slice(end, end + 200));
    if (plus === null) break;
    const next = literalAt(end + plus[0].length);
    if (!isPlain(next)) return true;
    end = next.end;
  }
  for (let start = entry.index; ; ) {
    const plus = /\+\s*$/.exec(src.code.slice(Math.max(0, start - 200), start));
    if (plus === null) return false;
    const before = start - plus[0].length;
    const previous = src.strings.find((item) => src.code.slice(item.end, before).trim() === '' && item.end <= before && before - item.end < 200);
    if (!isPlain(previous)) return true;
    start = previous.index;
  }
}

const OPENERS = /\b(openDeviceDatabase|openDeviceData|openAppDatabase)\s*\(/g;

/**
 * An open at module level runs on import: before any reload decision, and again after a reload. An
 * open passed to useState as a result (`useState(openOnce())`) runs on every render of the layout.
 */
export function checkOpenAtImport(ctx) {
  for (const src of ctx.sources.values()) {
    if (!src.rel.startsWith(`${ctx.layout.srcDir}/`) || isTestFile(src.rel)) continue;
    for (const { index, match } of codeMatches(src, OPENERS)) {
      if (/\bfunction\s+$/.test(src.code.slice(Math.max(0, index - 12), index)) || !isModuleLevel(src.code, index)) continue;
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'open-at-import', message: `calls ${match[1]}() at module level: it runs on import, before the startup decisions that can reload the app`, fix: 'Open in the root layout on its first render (const [data] = useState(openOnce)): module code runs again after a reload, so an import-time open writes before the reload decisions and again after them.' });
    }
    const openers = functionsReaching(src, (fn) => codeMatches(src, OPENERS).some(({ index }) => index > fn.bodyStart && index < fn.bodyEnd));
    for (const { index, match } of codeMatches(src, /\buseState\s*(?:<[^>]*>)?\s*\(\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = match[1];
      if (!/^(openDeviceDatabase|openDeviceData|openAppDatabase)$/.test(callee) && !openers.has(callee)) continue;
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'open-at-import', message: `useState(${callee}(...)) opens the database on every render (the initial value is computed each time, then thrown away)`, fix: `Pass the function, not its result: useState(${callee === 'openOnce' ? 'openOnce' : `() => ${callee}(...)`}). React calls an initializer function once, on the first render.` });
    }
    checkOpenInRender(ctx, src, openers);
  }
}

/**
 * `const data = openOnce();` in a component or hook body opens on every render. The React Compiler
 * may memoize it today, but it guarantees nothing and skips a component it cannot compile.
 */
function checkOpenInRender(ctx, src, openers) {
  // A hook that opens is reported in its own body; calling it from a component is how hooks work.
  const names = ['openDeviceDatabase', 'openDeviceData', 'openAppDatabase', ...[...openers].filter((name) => !/^use[A-Z]/.test(name))];
  const pattern = new RegExp(`(?<![.\\w$])(${[...new Set(names)].join('|')})\\s*\\(`, 'g');
  for (const { index, match } of codeMatches(src, pattern)) {
    const before = src.code.slice(Math.max(0, index - 40), index);
    if (/\bfunction\s+$/.test(before) || /\buseState\s*(?:<[^>]*>)?\s*\(\s*$/.test(before)) continue;
    const fn = functionAt(src, index);
    if (fn === null || !/^(?:[A-Z]|use[A-Z])/.test(fn.name) || insideArrowExpression(src, fn.bodyStart, index)) continue;
    ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'open-at-import', message: `calls ${match[1]}() in the body of ${fn.name}: it opens the database on every render`, fix: `Open once: const [data] = useState(${match[1] === 'openOnce' ? 'openOnce' : `() => ${match[1]}(...)`}). React calls an initializer function once; the React Compiler's memoization is not a guarantee.` });
  }
}

/** true when `index` sits in the expression body of an arrow function that starts after `from`. */
function insideArrowExpression(src, from, index) {
  for (const { index: arrow } of codeMatches(src, /=>\s*/g)) {
    if (arrow < from || arrow > index) continue;
    const bodyAt = arrow + 2 + (/^\s*/.exec(src.code.slice(arrow + 2))?.[0].length ?? 0);
    if (src.code[bodyAt] === '{') continue;
    let depth = 0;
    let end = src.code.length;
    for (let i = bodyAt; i < src.code.length; i += 1) {
      const c = src.code[i];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      if (depth < 0 || (depth === 0 && (c === ',' || c === ';'))) {
        end = i;
        break;
      }
    }
    if (index >= bodyAt && index < end) return true;
  }
  return false;
}

/** true when `index` sits in a top-level statement that is not a function (brace depth 0, no arrow or function before it). */
function isModuleLevel(code, index) {
  let depth = 0;
  let statementStart = 0;
  for (let i = 0; i < index; i += 1) {
    const c = code[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) statementStart = i + 1;
    } else if (c === ';' && depth === 0) statementStart = i + 1;
  }
  return depth === 0 && !/=>|\bfunction\b/.test(code.slice(statementStart, index));
}

/** BASELINE (migrations.ts) set for adoption but never handed to openAppDatabase adopts nothing. */
export function checkBaselineWired(ctx) {
  const { list } = paths(ctx);
  const src = ctx.sources.get(list);
  const declared = src === undefined ? null : /export\s+const\s+BASELINE\b[^=]*=\s*(?!null\b)\S/.exec(src.code);
  if (declared === null) return;
  const isPassed = [...ctx.sources.values()].some((other) => other.rel !== list && other.rel.startsWith(`${ctx.layout.srcDir}/`) && !isTestFile(other.rel) && /\bbaseline\s*:\s*BASELINE\b/.test(other.code));
  if (!isPassed) ctx.add({ file: list, line: src.lineOf(declared.index), rule: 'unversioned-data', message: 'BASELINE is set but no openAppDatabase call receives it (baseline: BASELINE)', fix: 'Pass baseline: BASELINE in open-device-database.ts (the template does), or the unversioned files it describes still open in memory.' });
}

export function checkBackgroundCheckpoint(ctx) {
  const { hook } = paths(ctx);
  const runtime = [...ctx.sources.values()].filter((src) => src.rel.startsWith(`${ctx.layout.srcDir}/`) && !isTestFile(src.rel));
  const listeners = runtime.filter((src) => src.strings.some((entry) => entry.value === 'background') && /\.checkpoint\s*\(\s*\)/.test(src.code));
  if (listeners.length === 0) {
    ctx.add({ file: hook, rule: 'no-background-checkpoint', message: 'no AppState "background" listener calls checkpoint()', fix: 'Add useCheckpointOnBackground(database) (template) and call it once in the root layout.' });
    return;
  }
  const root = ctx.contract.rootComponent ?? `${ctx.layout.routesDir}/_layout.tsx`;
  const reason = ctx.notYetCreated(root, 'app-startup-and-bootstrap');
  if (reason !== null) {
    ctx.skip({ file: root, rule: 'no-background-checkpoint', message: reason });
    return;
  }
  const isHookOnly = listeners.every((src) => /export\s+function\s+use\w+/.test(src.code));
  const isCalled = runtime.some((src) => !listeners.includes(src) && /\buseCheckpointOnBackground\s*\(/.test(src.code));
  if (isHookOnly && !isCalled) ctx.add({ file: root, rule: 'no-background-checkpoint', message: 'useCheckpointOnBackground is defined but never called', fix: 'Call useCheckpointOnBackground(database) once in the root layout, with the AppDatabase the startup opened.' });
}
