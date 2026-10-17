// src/data/document/migrations/v1-to-v2.ts: document v1 -> v2: settings gain a text size. Frozen once shipped.
import type { DocumentMigration } from './document-migrations';

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Pure and frozen: literal values only, no clock, no device, no import of today's defaults (a later
 * default change must not change how old documents upgrade). It runs before validation, so every
 * nested read is guarded.
 */
export const V1_TO_V2: DocumentMigration = {
  from: 1,
  migrate: (doc) => ({ ...doc, settings: { ...asRecord(doc['settings']), textScale: 100 } }),
};
