// src/data/document/document-codec.test.ts: decoding names what is wrong with a row and never throws.
import fc from 'fast-check';

import { fnv1a32 } from '@/data/checksum';
import { createDefaultAppDocument } from '@/data/document/schema/default-app-document';

import { decodeSlot, encodeAppDocument, validateAppDocument } from './document-codec';

import type { SlotRecord } from '@/data/document/document-store';
import type { AppDocument } from '@/data/document/schema/app-document';

const APP_ID = 'tasks-app';
const META = { appVersion: '1.0.0', writtenAtMs: 1, writeCount: 1 };
const GOOD = encodeAppDocument(createDefaultAppDocument(APP_ID), META);

const pad = (value: number): string => String(value).padStart(2, '0');
const dateKey = fc
  .record({
    year: fc.integer({ min: 2020, max: 2035 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => `${String(year)}-${pad(month)}-${pad(day)}`);
const count = fc.nat({ max: 1_000_000 });

/** Valid documents: every section filled from its own allowed values. */
const docArb = fc
  .record({
    theme: fc.constantFrom('system', 'light', 'dark'),
    reminderHour: fc.integer({ min: 0, max: 23 }),
    seenTips: fc.array(fc.constantFrom('add-task', 'swipe-done', 'lists'), { maxLength: 3 }),
    tasksCompleted: count,
    days: fc.dictionary(dateKey, count, { maxKeys: 5, noNullPrototype: true }),
    lastDate: fc.option(dateKey, { nil: null }),
  })
  .map(({ theme, reminderHour, seenTips, tasksCompleted, days, lastDate }): AppDocument => {
    const doc = createDefaultAppDocument(APP_ID);
    return {
      ...doc,
      settings: { ...doc.settings, theme, reminderHour },
      onboarding: { completed: seenTips.length > 0, seenTips },
      stats: { ...doc.stats, tasksCompleted, days, streak: { lastDate, length: 1 } },
    };
  });

/** A row whose checksum matches its (possibly broken) payload. */
function rowWith(payload: string): SlotRecord {
  return { ...GOOD, payload, checksum: fnv1a32(payload) };
}

describe('decodeSlot', () => {
  it('reads a valid row back as the same document', () => {
    expect(decodeSlot(GOOD, APP_ID)).toStrictEqual({
      kind: 'ok',
      doc: createDefaultAppDocument(APP_ID),
      migratedFrom: null,
    });
  });

  it('names what is wrong with a damaged row', () => {
    expect(decodeSlot({ ...GOOD, payload: `${GOOD.payload} ` }, APP_ID)).toStrictEqual({
      kind: 'damaged',
      reason: 'checksum',
    });
    expect(decodeSlot(rowWith('{not json'), APP_ID)).toStrictEqual({
      kind: 'damaged',
      reason: 'json',
    });
    expect(decodeSlot(rowWith('{}'), APP_ID)).toMatchObject({ kind: 'damaged' });
    expect(decodeSlot(GOOD, 'other-app')).toStrictEqual({ kind: 'damaged', reason: 'app-id' });
  });

  it('reports a row from a newer build by its version', () => {
    expect(decodeSlot({ ...GOOD, schemaVersion: 99 }, APP_ID)).toStrictEqual({
      kind: 'newer',
      version: 99,
    });
  });

  it('treats an old row without a migration step as damaged', () => {
    expect(decodeSlot({ ...GOOD, schemaVersion: 0 }, APP_ID)).toMatchObject({ kind: 'damaged' });
  });
});

describe('encodeAppDocument and decodeSlot', () => {
  it('decodes every encoded valid document back to itself', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        expect(decodeSlot(encodeAppDocument(doc, META), APP_ID)).toStrictEqual({
          kind: 'ok',
          doc,
          migratedFrom: null,
        });
      }),
    );
  });
});

describe('validateAppDocument', () => {
  it('rejects an unknown key, because every section is strict', () => {
    const doc = { ...createDefaultAppDocument(APP_ID), extra: true };
    expect(validateAppDocument(doc)).toStrictEqual({ error: expect.stringMatching(/^extra: /) });
  });
});
