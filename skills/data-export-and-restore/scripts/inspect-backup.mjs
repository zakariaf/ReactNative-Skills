#!/usr/bin/env node
// inspect-backup.mjs: reads one backup file on the computer (a user's file sent to support, a frozen fixture,
// a file pulled from a simulator) and runs the envelope ladder in Node: format, versions, strict header,
// payload checksum; then prints who wrote it and the rows per table. Nothing is written anywhere.
// Usage: node inspect-backup.mjs <backup-file> [--format <marker>] [--schema <n>] [--json]
import { existsSync, readFileSync, statSync } from 'node:fs';

import { createReporter, fail, parseArgs, run } from './check-lib.mjs';
import { checkEnvelope, rowCounts } from './lib/backup-envelope.mjs';

const SPEC = {
  name: 'inspect-backup',
  summary: 'Checks one backup file (envelope, versions, checksum) and prints its header and rows per table.',
  usage: '<backup-file> [options]',
  options: {
    format: { type: 'string', value: 'marker', help: 'The app\'s BACKUP_FORMAT (for example tasks.backup); without it any marker is accepted' },
    schema: { type: 'string', value: 'n', help: 'The schema version the current build reads: a newer file fails as newer-version' },
    'format-version': { type: 'string', value: 'n', help: 'The envelope version the current build reads (default 1)' },
    json: { type: 'boolean', help: 'Also print the result as JSON' },
  },
  positionals: { min: 1, max: 1 },
  details: 'Rule: backup-envelope (one problem naming the refusal kind the app would return: not-a-backup, damaged, newer-format, newer-version).',
};

const toVersion = (value, name) => {
  if (value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`--${name} must be a positive integer, got ${JSON.stringify(value)}`, `Pass --${name} 1 (the app's ${name === 'schema' ? 'LATEST_DB_VERSION' : 'BACKUP_FORMAT_VERSION'}).`);
  return number;
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const file = positionals[0];
  if (!existsSync(file) || !statSync(file).isFile()) fail(`nothing to check: ${file} is not a file`, 'Pass the path of a backup file (.json) on this computer; copy it off a device first.');
  const schemaVersion = toVersion(options.schema, 'schema');
  const formatVersion = toVersion(options['format-version'], 'format-version') ?? 1;
  const report = createReporter({ name: 'inspect-backup', json: options.json });
  const result = checkEnvelope(readFileSync(file, 'utf8'), { format: options.format ?? null, formatVersion, schemaVersion });
  if (result.header !== undefined) {
    const { format, formatVersion: found, schemaVersion: schema, appVersion, exportedAt } = result.header;
    report.note(`header: format ${format}, formatVersion ${found}, schemaVersion ${schema}, written by ${appVersion} at ${exportedAt}`);
  }
  if (result.payload !== undefined) {
    report.note(`rows: ${Object.entries(rowCounts(result.payload)).map(([table, count]) => `${table} ${count}`).join(', ')}`);
  }
  if (result.kind !== 'ok') {
    report.problem({ file, line: 1, rule: 'backup-envelope', message: `${result.kind}: ${result.detail}`, fix: 'The app refuses this file with the same kind. A damaged file cannot be repaired by hand (the checksum covers the payload); look for an older copy of the backup.' });
  }
  return report.finish({ checked: 1, unit: 'backup files' });
});
