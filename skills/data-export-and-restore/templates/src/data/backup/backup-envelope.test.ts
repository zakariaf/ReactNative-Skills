// src/data/backup/backup-envelope.test.ts
import { canonicalJson } from '@/core/portable/canonical-json';
import { sha256Hex } from '@/core/portable/sha256';

import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  checkEnvelope,
  encodeBackup,
} from './backup-envelope';

import type { BackupPayload } from './backup-schema';

const PAYLOAD: BackupPayload = {
  lists: [{ id: 1, name: 'Home', created_at_ms: 1_790_000_000_000 }],
  tasks: [{ id: 1, list_id: 1, title: 'Buy milk', is_done: 0, created_at_ms: 1_790_000_060_000 }],
};
const META = { appVersion: '2.3.0', exportedAtMs: 1_790_000_120_000 };
const TEXT = encodeBackup(PAYLOAD, META);

describe('encodeBackup', () => {
  it('writes the header first, in order, and the canonical payload last', () => {
    expect(Object.keys(JSON.parse(TEXT) as object)).toStrictEqual([
      'format',
      'formatVersion',
      'schemaVersion',
      'appVersion',
      'exportedAt',
      'payloadSha256',
      'payload',
    ]);
    expect(TEXT.startsWith(`{"format":"${BACKUP_FORMAT}","formatVersion":1,`)).toBe(true);
    expect(TEXT.endsWith(`"payload":${canonicalJson(PAYLOAD)}}\n`)).toBe(true);
  });

  it('stamps the versions, a UTC instant and the SHA-256 of the canonical payload', () => {
    expect(JSON.parse(TEXT)).toMatchObject({
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '2.3.0',
      exportedAt: '2026-09-21T14:15:20.000Z',
      payloadSha256: sha256Hex(canonicalJson(PAYLOAD)),
    });
  });

  it('gives the same bytes for the same data', () => {
    expect(encodeBackup({ ...PAYLOAD }, META)).toBe(TEXT);
  });
});

describe('checkEnvelope', () => {
  it('accepts its own file, and the same file pretty-printed (the checksum is over canonical JSON)', () => {
    expect(checkEnvelope(TEXT).ok).toBe(true);
    expect(checkEnvelope(JSON.stringify(JSON.parse(TEXT), null, 2)).ok).toBe(true);
  });

  it.each([
    ['an empty file', '  \n'],
    [
      'a CSV export',
      'list,title,done,created_at\r\nHome,Buy milk,false,2026-09-21T14:15:20.000Z\r\n',
    ],
    ['the JSON file of another app', '{"format":"other.backup","payload":{}}'],
    ['a JSON array', '[1,2,3]'],
  ])('refuses %s as not-a-backup', (_name, text) => {
    expect(checkEnvelope(text)).toStrictEqual({ ok: false, error: { kind: 'not-a-backup' } });
  });

  it('calls a truncated file of ours damaged, not foreign (the header comes first)', () => {
    expect(checkEnvelope(TEXT.slice(0, TEXT.length / 2))).toStrictEqual({
      ok: false,
      error: { kind: 'damaged' },
    });
    const pretty = JSON.stringify(JSON.parse(TEXT), null, 2);
    expect(checkEnvelope(pretty.slice(0, pretty.length / 2))).toStrictEqual({
      ok: false,
      error: { kind: 'damaged' },
    });
  });

  it('accepts a file an editor saved with a byte order mark (inspect-backup agrees)', () => {
    expect(checkEnvelope(`\uFEFF${TEXT}`).ok).toBe(true);
    expect(checkEnvelope('\uFEFF')).toStrictEqual({ ok: false, error: { kind: 'not-a-backup' } });
  });

  it('refuses one changed byte of the payload, and a header field of the wrong shape', () => {
    const edited = TEXT.replace('Buy milk', 'Buy mink');
    expect(checkEnvelope(edited)).toStrictEqual({ ok: false, error: { kind: 'damaged' } });
    const naive = TEXT.replace('14:15:20.000Z', '14:15:20.000');
    expect(checkEnvelope(naive)).toStrictEqual({ ok: false, error: { kind: 'damaged' } });
  });

  it('refuses a newer envelope or a newer schema with the numbers the message needs', () => {
    const newerFormat = TEXT.replace('"formatVersion":1', '"formatVersion":2');
    expect(checkEnvelope(newerFormat)).toStrictEqual({
      ok: false,
      error: { kind: 'newer-format', found: 2, supported: BACKUP_FORMAT_VERSION },
    });
    const found = BACKUP_SCHEMA_VERSION + 1;
    const newer = TEXT.replace(
      `"schemaVersion":${String(BACKUP_SCHEMA_VERSION)}`,
      `"schemaVersion":${String(found)}`,
    );
    expect(checkEnvelope(newer)).toStrictEqual({
      ok: false,
      error: {
        kind: 'newer-version',
        found,
        supported: BACKUP_SCHEMA_VERSION,
        appVersion: '2.3.0',
      },
    });
  });
});
