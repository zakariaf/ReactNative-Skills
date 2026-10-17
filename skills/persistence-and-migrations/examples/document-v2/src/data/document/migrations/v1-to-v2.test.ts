// src/data/document/migrations/v1-to-v2.test.ts: the step on the frozen v1 documents, and on every valid v1 settings section.
import fc from 'fast-check';

import { validateAppDocument } from '@/data/document/document-codec';
import appDocumentV1Full from '@/data/document/fixtures/app-document-v1.full.json';
import appDocumentV1Minimal from '@/data/document/fixtures/app-document-v1.minimal.json';

import { migrateDocumentToLatest } from './document-migrations';
import { V1_TO_V2 } from './v1-to-v2';

describe('V1_TO_V2', () => {
  it('adds settings.textScale 100 and changes nothing else', () => {
    expect(V1_TO_V2.migrate(appDocumentV1Minimal)).toStrictEqual({
      ...appDocumentV1Minimal,
      settings: { ...appDocumentV1Minimal.settings, textScale: 100 },
    });
  });

  it('turns the full v1 fixture into a valid v2 document', () => {
    const migrated = migrateDocumentToLatest(appDocumentV1Full, 1);
    expect(migrated.ok && validateAppDocument(migrated.value)).toStrictEqual({
      doc: {
        ...appDocumentV1Full,
        schemaVersion: 2,
        settings: { ...appDocumentV1Full.settings, textScale: 100 },
      },
    });
  });

  it('turns every valid v1 settings section into a valid v2 document', () => {
    const settings = fc.record({
      theme: fc.constantFrom('system', 'light', 'dark'),
      language: fc.constantFrom(null, 'en', 'ar'),
      reminderHour: fc.integer({ min: 0, max: 23 }),
      soundEnabled: fc.boolean(),
      reduceMotion: fc.constantFrom('system', 'on', 'off'),
    });
    fc.assert(
      fc.property(settings, (v1Settings) => {
        const migrated = migrateDocumentToLatest({ ...appDocumentV1Full, settings: v1Settings }, 1);
        expect(migrated.ok && 'doc' in validateAppDocument(migrated.value)).toBe(true);
      }),
    );
  });
});
