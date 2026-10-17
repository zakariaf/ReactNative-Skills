// src/data/document/document-codec.ts: document <-> slot row: strict validation, checksum, JSON, migrations. Never throws.
import * as v from 'valibot';

import { attempt, ok } from '@/core/result';
import { fnv1a32 } from '@/data/checksum';
import { migrateDocumentToLatest } from '@/data/document/migrations/document-migrations';
import {
  LATEST_DOCUMENT_SCHEMA,
  LATEST_DOCUMENT_VERSION,
} from '@/data/document/schema/app-document';

import type { SlotRecord } from '@/data/document/document-store';
import type { AppDocument } from '@/data/document/schema/app-document';

export type DecodeResult =
  | { readonly kind: 'ok'; readonly doc: AppDocument; readonly migratedFrom: number | null }
  | { readonly kind: 'newer'; readonly version: number }
  | { readonly kind: 'damaged'; readonly reason: string };

export type EncodeMeta = {
  readonly appVersion: string;
  readonly writtenAtMs: number;
  readonly writeCount: number;
};

/** Validates against the latest schema; the first issue becomes one short line for the error log. */
export function validateAppDocument(
  doc: unknown,
): { readonly doc: AppDocument } | { readonly error: string } {
  const result = v.safeParse(LATEST_DOCUMENT_SCHEMA, doc);
  if (result.success) return { doc: result.output };
  const first = result.issues[0];
  return { error: `${v.getDotPath(first) ?? '(root)'}: ${first.message}` };
}

export function encodeAppDocument(doc: AppDocument, meta: EncodeMeta): SlotRecord {
  const payload = JSON.stringify(doc);
  return { schemaVersion: doc.schemaVersion, checksum: fnv1a32(payload), payload, ...meta };
}

const DAMAGED_JSON: DecodeResult = { kind: 'damaged', reason: 'json' };

/**
 * Row -> latest document, in this order: a newer version, a checksum mismatch, broken JSON, an
 * older version through the migrations, the latest schema, the app identity. Never writes.
 */
export function decodeSlot(record: SlotRecord, appId: string): DecodeResult {
  if (record.schemaVersion > LATEST_DOCUMENT_VERSION) {
    return { kind: 'newer', version: record.schemaVersion };
  }
  if (fnv1a32(record.payload) !== record.checksum) return { kind: 'damaged', reason: 'checksum' };
  const parsed = attempt(
    (): unknown => JSON.parse(record.payload),
    () => DAMAGED_JSON,
  );
  if (!parsed.ok) return parsed.error;
  const isOld = record.schemaVersion < LATEST_DOCUMENT_VERSION;
  const migrated = isOld
    ? migrateDocumentToLatest(parsed.value, record.schemaVersion)
    : ok(parsed.value);
  if (!migrated.ok) return { kind: 'damaged', reason: migrated.error.kind };
  const checked = validateAppDocument(migrated.value);
  if ('error' in checked) return { kind: 'damaged', reason: `schema ${checked.error}` };
  if (checked.doc.appId !== appId) return { kind: 'damaged', reason: 'app-id' };
  return { kind: 'ok', doc: checked.doc, migratedFrom: isOld ? record.schemaVersion : null };
}
