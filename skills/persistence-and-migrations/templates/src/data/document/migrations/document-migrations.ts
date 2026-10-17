// src/data/document/migrations/document-migrations.ts: the ordered steps that upgrade an old document to the latest version.
import { attempt, err, ok } from '@/core/result';
import { LATEST_DOCUMENT_VERSION } from '@/data/document/schema/app-document';

import type { Result } from '@/core/result';

/** A pure step vK -> vK+1 over plain JSON. It never reads the clock, the device or today's defaults. */
export type DocumentMigration = {
  readonly from: number;
  readonly migrate: (doc: Readonly<Record<string, unknown>>) => Record<string, unknown>;
};

/**
 * Why an old document could not be upgraded. decodeSlot reports the slot as damaged with this kind
 * (backup restore, quarantine), never a crash at startup; the quarantined payload reproduces it.
 */
export type DocumentMigrationFailure =
  | { readonly kind: 'document-step-missing'; readonly from: number }
  | { readonly kind: 'document-not-an-object'; readonly version: number }
  | { readonly kind: 'document-step-threw'; readonly from: number };

/**
 * Ordered, append-only: entry i upgrades version i+1 to i+2. Version 1 is the first shipped
 * document, so the list stays empty until v2 exists.
 */
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Runs every step from `from` up to `latest`, stamping schemaVersion after each one. */
export function runDocumentMigrations(
  steps: readonly DocumentMigration[],
  doc: unknown,
  versions: { readonly from: number; readonly latest: number },
): Result<unknown, DocumentMigrationFailure> {
  let current: unknown = doc;
  for (let version = versions.from; version < versions.latest; version += 1) {
    const step = steps.find((migration) => migration.from === version);
    if (step === undefined) return err({ kind: 'document-step-missing', from: version });
    if (!isRecord(current)) return err({ kind: 'document-not-an-object', version });
    const record = current;
    const next = attempt(
      () => ({ ...step.migrate(record), schemaVersion: version + 1 }),
      (): DocumentMigrationFailure => ({ kind: 'document-step-threw', from: version }),
    );
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(current);
}

/** The app's chain: DOCUMENT_MIGRATIONS from `fromVersion` to LATEST_DOCUMENT_VERSION. */
export function migrateDocumentToLatest(
  doc: unknown,
  fromVersion: number,
): Result<unknown, DocumentMigrationFailure> {
  return runDocumentMigrations(DOCUMENT_MIGRATIONS, doc, {
    from: fromVersion,
    latest: LATEST_DOCUMENT_VERSION,
  });
}
