// src/data/backup/backup-envelope.ts: the backup file: a versioned, checksummed header first, the canonical payload last.
import * as v from 'valibot';

import { canonicalJson, isJsonObject, parseJson } from '@/core/portable/canonical-json';
import { sha256Hex } from '@/core/portable/sha256';
import { err, ok } from '@/core/result';
import { LATEST_DB_VERSION } from '@/data/migrations/migrations';

import type { JsonObject, JsonValue } from '@/core/portable/canonical-json';
import type { Result } from '@/core/result';
import type { RestoreFailure } from '@/data/backup/backup-failures';
import type { BackupPayload } from '@/data/backup/backup-schema';

/** Says "this file is a backup of this app". Never changes once a backup has shipped. */
export const BACKUP_FORMAT = '__APP_SLUG__.backup';

/** The envelope's own shape. Bumped only when the header changes, never for a table change. */
export const BACKUP_FORMAT_VERSION = 1;

/** The payload's shape is the database's: a table change bumps both, in the same release. */
export const BACKUP_SCHEMA_VERSION = LATEST_DB_VERSION;

/** The first database version that wrote backups; older files are refused as too-old. */
export const FIRST_BACKUP_SCHEMA_VERSION = 1;

/** What the share sheet and the picker are told (Android: mimeType, iOS: UTI). */
export const BACKUP_MIME_TYPE = 'application/json';
export const BACKUP_UTI = 'public.json';

/** The header, in the order it is written: a reader sees what the file is before any payload. */
export const BACKUP_HEADER = v.strictObject({
  format: v.literal(BACKUP_FORMAT),
  formatVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  schemaVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  appVersion: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  exportedAt: v.pipe(v.string(), v.isoTimestamp(), v.endsWith('Z')),
  payloadSha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
});

export type BackupHeader = v.InferOutput<typeof BACKUP_HEADER>;

const DAMAGED: RestoreFailure = { kind: 'damaged' };
const NOT_A_BACKUP: RestoreFailure = { kind: 'not-a-backup' };

/** A file that passed the envelope checks; its payload is not yet upgraded or validated. */
export type CheckedEnvelope = { readonly header: BackupHeader; readonly payload: JsonObject };

export type EncodeMeta = {
  /** The app's version for support ("written by 2.3.0"); never a compatibility check. */
  readonly appVersion: string;
  /** From the ClockPort; written as an ISO-8601 UTC instant with Z. */
  readonly exportedAtMs: number;
};

/**
 * The file text. The payload is canonical JSON (sorted keys, no spaces, rows in id order), so
 * the same data always gives the same bytes and payloadSha256 is the SHA-256 of exactly that text.
 */
export function encodeBackup(payload: BackupPayload, meta: EncodeMeta): string {
  const body = canonicalJson(payload);
  const header: BackupHeader = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: meta.appVersion,
    exportedAt: new Date(meta.exportedAtMs).toISOString(),
    payloadSha256: sha256Hex(body),
  };
  return `${JSON.stringify(header).slice(0, -1)},"payload":${body}}\n`;
}

/**
 * `{"format":"<slug>.backup"`, with any whitespace a text editor or a pretty-printer adds. The slug
 * is kebab case, so the dots are the only characters to escape.
 */
const OUR_MARKER = new RegExp(
  String.raw`^\s*\{\s*"format"\s*:\s*"` + BACKUP_FORMAT.replaceAll('.', String.raw`\.`) + '"',
);

/** A byte order mark some editors and cloud tools put before the text; never part of the JSON. */
const BOM = '\uFEFF';

/** Rungs 2 and 3: our format, a version this build reads, then a strict header. */
function readHeader(
  parsed: JsonValue | undefined,
  text: string,
): Result<CheckedEnvelope, RestoreFailure> {
  // Header first pays off here: a truncated file of ours still starts with our marker (also when an
  // editor pretty-printed it; inspect-backup reads the file the same way).
  const isOurs = OUR_MARKER.test(text);
  if (!isJsonObject(parsed)) return err(isOurs ? DAMAGED : NOT_A_BACKUP);
  if (parsed['format'] !== BACKUP_FORMAT) return err(NOT_A_BACKUP);
  const formatVersion = parsed['formatVersion'];
  if (typeof formatVersion === 'number' && formatVersion > BACKUP_FORMAT_VERSION) {
    return err({ kind: 'newer-format', found: formatVersion, supported: BACKUP_FORMAT_VERSION });
  }
  const { payload, ...fields } = parsed;
  const header = v.safeParse(BACKUP_HEADER, fields);
  if (!header.success || !isJsonObject(payload)) return err(DAMAGED);
  return ok({ header: header.output, payload });
}

/** Rung 5: the schema version is one this build can read or upgrade from. */
function versionFailure(header: BackupHeader): RestoreFailure | null {
  const found = header.schemaVersion;
  if (found > BACKUP_SCHEMA_VERSION) {
    const { appVersion } = header;
    return { kind: 'newer-version', found, supported: BACKUP_SCHEMA_VERSION, appVersion };
  }
  if (found < FIRST_BACKUP_SCHEMA_VERSION) {
    return { kind: 'too-old', found, oldest: FIRST_BACKUP_SCHEMA_VERSION };
  }
  return null;
}

/**
 * The envelope rungs of the ladder, cheapest first; nothing here writes anything:
 * 1 not empty · 2 ours (marker, format version) · 3 strict header · 4 intact (the checksum of the
 * payload's canonical text, before a single row is read) · 5 a schema version this build reads.
 */
export function checkEnvelope(file: string): Result<CheckedEnvelope, RestoreFailure> {
  // A leading BOM is dropped (the checksum still proves every payload byte); JSON.parse refuses it.
  const text = file.startsWith(BOM) ? file.slice(BOM.length) : file;
  if (text.trim() === '') return err(NOT_A_BACKUP);
  const checked = readHeader(parseJson(text), text);
  if (!checked.ok) return checked;
  const { header, payload } = checked.value;
  if (sha256Hex(canonicalJson(payload)) !== header.payloadSha256) return err(DAMAGED);
  const tooNewOrOld = versionFailure(header);
  return tooNewOrOld === null ? checked : err(tooNewOrOld);
}
