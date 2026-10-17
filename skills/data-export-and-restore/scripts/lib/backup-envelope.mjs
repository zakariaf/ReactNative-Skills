// lib/backup-envelope.mjs: the backup envelope's checks in Node (zero dependencies), the same ladder the app's
// checkEnvelope runs: canonical JSON, SHA-256 over its UTF-8 bytes (node:crypto), the strict header.
// Used by check-backup.mjs (frozen fixtures) and inspect-backup.mjs (a user's file, for support).
import { createHash } from 'node:crypto';

/** The header keys, in the order the app writes them; the payload comes last. */
export const HEADER_KEYS = ['format', 'formatVersion', 'schemaVersion', 'appVersion', 'exportedAt', 'payloadSha256'];

/** Sorted keys at every depth, no whitespace: the app's canonicalJson, byte for byte. */
export function canonicalJson(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError(`not a JSON number: ${value}`);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isVersion = (value) => Number.isSafeInteger(value) && value >= 1;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** What is wrong with the header fields (strict: no unknown key, every field of its shape). */
function headerProblems(fields, format) {
  const problems = [];
  const unknown = Object.keys(fields).filter((key) => !HEADER_KEYS.includes(key));
  if (unknown.length > 0) problems.push(`unknown header keys: ${unknown.join(', ')}`);
  if (format !== null && fields.format !== format) problems.push(`format is ${JSON.stringify(fields.format)}, expected ${JSON.stringify(format)}`);
  if (typeof fields.format !== 'string' || fields.format === '') problems.push('format is missing');
  if (!isVersion(fields.formatVersion)) problems.push('formatVersion is not a positive integer');
  if (!isVersion(fields.schemaVersion)) problems.push('schemaVersion is not a positive integer');
  if (typeof fields.appVersion !== 'string' || fields.appVersion === '' || fields.appVersion.length > 64) problems.push('appVersion is not 1-64 characters');
  if (typeof fields.exportedAt !== 'string' || !ISO_UTC.test(fields.exportedAt)) problems.push('exportedAt is not an ISO-8601 UTC instant ending in Z');
  if (typeof fields.payloadSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(fields.payloadSha256)) problems.push('payloadSha256 is not 64 lowercase hex characters');
  return problems;
}

/**
 * Runs the envelope rungs on a file's text. Returns { kind, detail, header, payload, keyOrder }:
 * kind 'ok' or the app's RestoreFailure kind ('not-a-backup', 'damaged', 'newer-format',
 * 'newer-version'); detail says why. `format` null accepts any marker (inspect-backup without --format).
 */
export function checkEnvelope(text, { format = null, formatVersion = 1, schemaVersion = null } = {}) {
  // The app's checkEnvelope reads the file the same way: a leading BOM is dropped, and a file of ours
  // starts with {"format":"<slug>.backup" (whitespace allowed), so a truncated one is 'damaged'.
  if (text.trim() === '') return { kind: 'not-a-backup', detail: 'the file is empty' };
  const marker = format === null ? '"[^"]*"' : JSON.stringify(format).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const looksOurs = new RegExp(`^\\s*\\{\\s*"format"\\s*:\\s*${marker}`).test(text);
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    return { kind: looksOurs ? 'damaged' : 'not-a-backup', detail: `not JSON (${error.message})` };
  }
  if (!isObject(parsed) || typeof parsed.format !== 'string') return { kind: 'not-a-backup', detail: 'no "format" marker' };
  if (format !== null && parsed.format !== format) return { kind: 'not-a-backup', detail: `format ${JSON.stringify(parsed.format)} is not ${JSON.stringify(format)}` };
  if (typeof parsed.formatVersion === 'number' && parsed.formatVersion > formatVersion) {
    return { kind: 'newer-format', detail: `formatVersion ${parsed.formatVersion} is newer than ${formatVersion}` };
  }
  const { payload, ...fields } = parsed;
  const problems = headerProblems(fields, format);
  if (!isObject(payload)) problems.push('payload is not an object');
  if (problems.length > 0) return { kind: 'damaged', detail: problems.join('; '), header: fields };
  const actual = sha256Hex(canonicalJson(payload));
  if (actual !== fields.payloadSha256) {
    return { kind: 'damaged', detail: `payloadSha256 is ${fields.payloadSha256}, the payload hashes to ${actual}`, header: fields };
  }
  if (schemaVersion !== null && fields.schemaVersion > schemaVersion) {
    return { kind: 'newer-version', detail: `schemaVersion ${fields.schemaVersion} is newer than ${schemaVersion} (written by ${fields.appVersion})`, header: fields, payload };
  }
  return { kind: 'ok', detail: '', header: fields, payload, keyOrder: Object.keys(parsed) };
}

/** Rows per table of a payload ({ lists: 3, tasks: 8 }); a key whose value is not an array counts as -1. */
export function rowCounts(payload) {
  return Object.fromEntries(Object.keys(payload).sort().map((key) => [key, Array.isArray(payload[key]) ? payload[key].length : -1]));
}
