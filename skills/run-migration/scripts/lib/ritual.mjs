// ritual.mjs: the release ritual's rules over one app repo, shared by check-migration and
// record-shipped (a helper, not an entry point). Static rules read the ledger, the step files, the
// fixtures and the tests; the replay rules run the app's own runner and open path on node:sqlite.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { fail, maskComments, notYetCreated } from '../check-lib.mjs';
import {
  contentTestProblem,
  fixtureRel,
  lineOfVersion,
  missingHostileKinds,
  pathTestProblems,
  pendingFixtureProblem,
  readLedger,
  readRepoText,
  rewrittenEntries,
  sha256Text,
  stepFiles,
} from './ledger.mjs';
import { everyPath, fixtureLoadError, loadApp, loadDatabaseSync, restoreDrill } from './sqlite-drill.mjs';

export const RULES = {
  ledger: 'contracts/schema-ledger.json exists and lists versions 1..N with both sha256 values, the first build and the date',
  'ledger-append-only': 'compared with --base or --base-ledger: no shipped entry was removed or changed',
  'shipped-frozen': 'every shipped version still has its step file and fixture, byte for byte as the ledger pinned them',
  'bump-by-one': 'at most one version is pending (not in the ledger), the step files run 1..N without a gap, and MIGRATIONS lists exactly those files in order',
  'pending-fixture': 'the pending version has its frozen db-vN.sql that stamps user_version N',
  'hostile-rows': "the pending version's fixture stores an apostrophe, a non-ASCII letter and an emoji",
  'content-test': 'every version from 2 has test/sqlite/vNNNN-<name>.test.ts that loads db-v(N-1).sql and reads values back',
  'path-tests': 'test/sqlite/migration-paths.test.ts and migration-restore-drill.test.ts exist and still do their job',
  'every-path': 'on node:sqlite, an empty file and every fixture upgrade to every later version: the frozen schema, every row, integrity and foreign keys',
  'restore-drill': 'on node:sqlite through openAppDatabase: a step failing halfway changes nothing, a committed wrong step is undone by its snapshot, and the previous build leaves the upgraded file alone',
};

/** The app has a versioned database when its migration list exists. */
export function databaseFact(root, paths) {
  if (existsSync(join(root, paths.list))) return null;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return 'expo-sqlite' in deps
    ? `no ${paths.list}: the app keeps no versioned SQLite database (preferences only, or persistence-and-migrations has not built the data layer)`
    : `expo-sqlite is not in package.json and there is no ${paths.list}: the app has no SQLite database`;
}

/** Exits 2 unless `ref` names a commit in the repo that holds `root`. */
export function requireCommit(root, ref, flag) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${ref}^{commit}`], { stdio: 'pipe' });
  } catch {
    fail(`${flag} ${ref} is not a commit in ${root}`, flag === '--base'
      ? 'Pass a ref the checkout has, for example --base origin/main after git fetch.'
      : 'Pass the tag or commit the release was built from (EAS shows the commit on each build); git fetch --tags first if it is not here.');
  }
}

/**
 * A repo file as a git ref holds it (null when the file is not in that ref). The path is read
 * relative to `root` (`<ref>:./<rel>`), so an app in a subfolder of the git repo works too.
 */
export function gitFileAt(root, ref, rel) {
  try {
    return execFileSync('git', ['-C', root, 'show', `${ref}:./${rel}`], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if (/does not exist|exists on disk, but not in/.test(String(error.stderr ?? ''))) return null;
    fail(`could not read ${rel} at ${ref}: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`, 'Check the ref and that git works in this folder.');
  }
  return null;
}

/** The ledger as it was at a git ref (null when the file did not exist there). */
function ledgerAtRef(root, ref, rel) {
  requireCommit(root, ref, '--base');
  const text = gitFileAt(root, ref, rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${rel} at ${ref} is not valid JSON: ${error.message}`, 'Check the ref; the ledger there must be the file record-shipped wrote.');
  }
  return null;
}

function baseLedger(root, options, rel) {
  if (options['base-ledger'] !== undefined) {
    const path = join(root, options['base-ledger']);
    const absolute = existsSync(path) ? path : options['base-ledger'];
    if (!existsSync(absolute)) fail(`--base-ledger ${options['base-ledger']} does not exist`, 'Pass the path of the ledger as the base branch holds it.');
    try {
      return { label: options['base-ledger'], data: JSON.parse(readFileSync(absolute, 'utf8')) };
    } catch (error) {
      fail(`--base-ledger ${options['base-ledger']} is not valid JSON: ${error.message}`, 'Pass the ledger file itself.');
    }
  }
  if (options.base !== undefined) return { label: options.base, data: ledgerAtRef(root, options.base, rel) };
  return null;
}

/**
 * Static rules. ctx: { root, paths, add({ file, line, rule, message, fix }), note(text) }.
 * Returns { steps, ledger, pending } for the caller (record-shipped writes from it).
 */
export function staticChecks(ctx, options = {}) {
  const { root, paths } = ctx;
  const steps = stepFiles(root, paths);
  const ledger = readLedger(root, paths.ledger);
  for (const problem of ledger.problems) ctx.add({ file: paths.ledger, rule: 'ledger', ...problem });
  const shipped = Array.isArray(ledger.data?.shipped) ? ledger.data.shipped : [];

  const base = baseLedger(root, options, paths.ledger);
  if (base !== null && ledger.data !== null) {
    for (const { entry, message } of rewrittenEntries(base.data, ledger.data)) {
      ctx.add({ file: paths.ledger, line: lineOfVersion(ledger.text, entry?.version), rule: 'ledger-append-only', message: `${message} since ${base.label}`, fix: 'A shipped version is permanent: restore the entry from the base branch; record a change of schema as a new version.' });
    }
    ctx.note(`ledger compared with ${base.label}${base.data === null ? ' (no ledger there yet)' : ''}`);
  }

  steps.forEach((step, index) => {
    if (step.version !== index + 1) ctx.add({ file: step.rel, line: 1, rule: 'bump-by-one', message: `step files jump to version ${step.version} after ${index}`, fix: 'Versions run 1..N without a gap: number the new step one above the last.' });
  });
  const unlisted = unlistedSteps(root, paths, steps);
  for (const step of unlisted) {
    ctx.add({ file: paths.list, line: 1, rule: 'bump-by-one', message: `step file ${basename(step.rel)} is not imported by ${basename(paths.list)}: no build runs version ${step.version}`, fix: 'Append the step to MIGRATIONS in version order (persistence-and-migrations "Adding version N+1"), or delete the file and its fixture if the version was abandoned before it shipped.' });
  }
  shipped.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object') return;
    checkShippedEntry(ctx, { entry, index, steps, ledgerText: ledger.text });
  });

  const pending = steps.filter((step) => step.version > shipped.length);
  if (!options.adopt && pending.length > 1) {
    ctx.add({ file: pending[1].rel, line: 1, rule: 'bump-by-one', message: `${pending.length} versions are pending (${pending.map((step) => `v${step.version}`).join(', ')}); a release adds one`, fix: `None of them reached a device yet: fold them into one step v${pending[0].version} (one file, one fixture), or run record-shipped --adopt when they did ship before the ledger existed.` });
  }
  for (const step of pending) {
    const fixture = pendingFixtureProblem(root, paths, step);
    if (fixture !== null) ctx.add({ rule: 'pending-fixture', ...fixture });
    else {
      const missing = missingHostileKinds(readRepoText(root, fixtureRel(paths, step.version)));
      if (missing.length > 0) ctx.add({ file: fixtureRel(paths, step.version), line: 1, rule: 'hostile-rows', message: `the frozen rows of pending version ${step.version} lack ${missing.join(', ')}`, fix: 'The next step is tested on these rows: before freezing, add rows whose text has an escaped apostrophe, a non-ASCII letter and an emoji (a copy or transform step mangles exactly those).' });
    }
  }
  for (const step of steps) {
    if (step.version < 2) continue;
    const entry = shipped[step.version - 1];
    if (typeof entry?.contentTest === 'string') continue;
    if (options.adopt && step.version > shipped.length) continue;
    const problem = contentTestProblem(root, paths, step);
    if (problem !== null) ctx.add({ rule: 'content-test', ...problem });
  }
  for (const problem of pathTestProblems(root, paths)) ctx.add({ rule: 'path-tests', ...problem });
  return { steps, ledger, shipped, pending, unlisted };
}

/** Step files whose module the migration list never names (an import of './vNNNN-<name>'). */
function unlistedSteps(root, paths, steps) {
  const text = readRepoText(root, paths.list);
  if (text === null) return [];
  const code = maskComments(text);
  return steps.filter((step) => !new RegExp(`['"\`][^'"\`]*/${basename(step.rel, '.ts')}(?:\\.ts)?['"\`]`).test(code));
}

/**
 * MIGRATIONS as the app exports it against the step files on disk: the same count, entry i is
 * version i+1 with its file's name. A file the list skips is a version no build runs, and its
 * fixture is never replayed. Files already reported as not imported are not reported twice.
 */
function listMatchesFiles(ctx, { steps, migrations, unlisted }) {
  const { paths } = ctx;
  const skipped = new Set(unlisted.map((step) => step.rel));
  const add = (message, fix) => ctx.add({ file: paths.list, line: 1, rule: 'bump-by-one', message, fix });
  const listed = steps.filter((step) => !skipped.has(step.rel));
  const count = Math.max(listed.length, migrations.length);
  for (let index = 0; index < count; index += 1) {
    const step = listed[index];
    const entry = migrations[index];
    if (entry === undefined) {
      add(`step file ${basename(step.rel)} is not in MIGRATIONS (it lists ${migrations.length} step${migrations.length === 1 ? '' : 's'}): no build runs version ${step.version}`, 'Put the imported step into the MIGRATIONS array in version order, or delete the file and its fixture if the version was abandoned before it shipped.');
    } else if (step === undefined) {
      add(`MIGRATIONS[${index}] (version ${JSON.stringify(entry?.version)}, ${JSON.stringify(entry?.name)}) has no step file of its own in ${paths.migrationsDir}`, 'Each entry comes from its own vNNNN-<name>.ts file: one file per version, listed once.');
    } else if (entry?.version !== index + 1 || entry?.name !== step.name) {
      add(`MIGRATIONS[${index}] is version ${JSON.stringify(entry?.version)} ${JSON.stringify(entry?.name)}, but step file ${index + 1} is ${basename(step.rel)}`, 'MIGRATIONS lists the step files in order, one each: entry i is version i+1 with the name its file carries.');
    }
  }
}

/** Frozen fixtures newer than the last listed version: the replay never loads them. */
function orphanFixtures(ctx, latest) {
  const { root, paths } = ctx;
  const dir = join(root, paths.fixturesDir);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const match = /^db-v(\d+)\.sql$/.exec(name);
    if (match === null || Number(match[1]) <= latest) continue;
    ctx.add({ file: `${paths.fixturesDir}/${name}`, line: 1, rule: 'every-path', message: `${name} is never replayed: MIGRATIONS ends at version ${latest}`, fix: `List the step of version ${match[1]} in MIGRATIONS, or delete the fixture if that version was abandoned before it shipped.` });
  }
}

function checkShippedEntry(ctx, { entry, index, steps, ledgerText }) {
  const { root, paths } = ctx;
  const line = lineOfVersion(ledgerText, entry.version);
  const step = steps.find((each) => each.version === index + 1);
  const add = (message, fix) => ctx.add({ file: step?.rel ?? paths.ledger, line: step === undefined ? line : 1, rule: 'shipped-frozen', message, fix });
  if (step === undefined) {
    add(`shipped version ${index + 1} (${entry.name}) has no step file in ${paths.migrationsDir}`, 'Restore the step file from git: every install that has not upgraded yet still needs it.');
    return;
  }
  if (step.name !== entry.name) add(`shipped version ${step.version} was renamed from ${entry.name} to ${step.name}`, 'Restore the original file name and name; a shipped step never changes.');
  const stepText = readRepoText(root, step.rel);
  if (stepText !== null && typeof entry.stepSha256 === 'string' && sha256Text(stepText) !== entry.stepSha256) {
    add(`shipped step v${step.version} (${entry.name}) changed after it reached a device (sha256 ${sha256Text(stepText).slice(0, 12)}, ledger ${entry.stepSha256.slice(0, 12)})`, `Restore it from git (git log -- ${step.rel}); change the schema in a new version. A formatter rewrite or a lint autofix counts too: restore the file, keep the frozen steps in .prettierignore and out of bulk eslint --fix.`);
  }
  const fixture = fixtureRel(paths, step.version);
  const fixtureText = readRepoText(root, fixture);
  if (fixtureText === null) ctx.add({ file: fixture, line: 1, rule: 'shipped-frozen', message: `shipped version ${step.version} lost its fixture`, fix: 'Restore it from git: it is the database old phones hold.' });
  else if (typeof entry.fixtureSha256 === 'string' && sha256Text(fixtureText) !== entry.fixtureSha256) {
    ctx.add({ file: fixture, line: 1, rule: 'shipped-frozen', message: `the fixture of shipped version ${step.version} changed after it was recorded`, fix: `Restore it from git (git log -- ${fixture}); old phones hold the database it was.` });
  }
}

/**
 * The replay rules on node:sqlite. Returns the number of runs (paths plus drill parts), or 0 when a
 * rule could not run. ctx as for staticChecks, plus skip({ file, rule, message }).
 */
export async function replayChecks(ctx, options = {}) {
  const { root, paths } = ctx;
  const DatabaseSync = await loadDatabaseSync();
  if (DatabaseSync === null) fail(`node:sqlite is not available in Node ${process.versions.node}`, 'Use Node 22.18 or newer (the project pins Node 26), or pass --no-replay.');
  const openPath = options['open-path'] ?? paths.defaultOpenPath;
  const hasOpenPath = existsSync(join(root, openPath));
  let app;
  try {
    app = await loadApp(root, paths, { openPath: hasOpenPath ? openPath : undefined });
  } catch (error) {
    ctx.add({ file: paths.list, line: 1, rule: 'every-path', message: `the app's migrations do not load on Node: ${String(error.message ?? error).split('\n')[0]}`, fix: 'Steps import only types (persistence-and-migrations rule 4); fix the import, then rerun.' });
    return 0;
  }
  listMatchesFiles(ctx, { steps: stepFiles(root, paths), migrations: app.migrations, unlisted: options.unlisted ?? unlistedSteps(root, paths, stepFiles(root, paths)) });
  orphanFixtures(ctx, app.migrations.length);
  const fixtures = new Map();
  for (let version = 1; version <= app.migrations.length; version += 1) {
    const rel = fixtureRel(paths, version);
    if (!existsSync(join(root, rel))) continue;
    const loadError = fixtureLoadError(DatabaseSync, root, rel);
    if (loadError === null) fixtures.set(version, rel);
    else ctx.add({ file: rel, line: 1, rule: 'every-path', message: `${rel} does not load into an empty database: ${loadError}`, fix: 'A frozen fixture is a dump of a database its version wrote: a shipped one is restored from git, a pending one is dumped again (persistence-and-migrations: inspect-database.mjs --dump).' });
  }
  let runs = everyPath(ctx, { DatabaseSync, app, fixtures });
  if (!hasOpenPath) {
    const reason = notYetCreated(root, { file: openPath, owner: 'persistence-and-migrations' });
    ctx.skip({ file: openPath, rule: 'restore-drill', message: reason });
  } else if (fixtures.size === 0) {
    ctx.add({ file: paths.fixturesDir, line: 1, rule: 'restore-drill', message: 'no frozen fixture to drill on', fix: 'Every version has its db-vN.sql (persistence-and-migrations rule 6).' });
  } else {
    runs += restoreDrill(ctx, { DatabaseSync, app, fixtures, openPath });
  }
  return runs;
}
