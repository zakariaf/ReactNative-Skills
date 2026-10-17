// src/data/document/reset-document.test.ts: resets clear their sections and keep settings, onboarding and premium.
import { fnv1a32 } from '@/data/checksum';
import { decodeSlot } from '@/data/document/document-codec';
import { DEFAULT_STATS } from '@/data/document/schema/default-app-document';

import fullFixture from './fixtures/app-document-v1.full.json';
import { resetAllProgress, resetStatistics } from './reset-document';

import type { AppDocument } from '@/data/document/schema/app-document';

function fullDocument(): AppDocument {
  const payload = JSON.stringify(fullFixture);
  const record = {
    schemaVersion: 1,
    appVersion: 'fixture',
    writtenAtMs: 0,
    writeCount: 1,
    checksum: fnv1a32(payload),
    payload,
  };
  const decoded = decodeSlot(record, 'tasks-app');
  if (decoded.kind !== 'ok') throw new Error('the full fixture must decode');
  return decoded.doc;
}

describe('resetAllProgress', () => {
  it('clears statistics and keeps premium, settings and the first-run state', () => {
    const doc = fullDocument();
    const reset = resetAllProgress(doc);
    expect([reset.premium, reset.settings]).toStrictEqual([doc.premium, doc.settings]);
    expect(reset.stats).toStrictEqual(DEFAULT_STATS);
    expect(reset.onboarding).toStrictEqual(doc.onboarding);
    expect(doc.onboarding.completed).toBe(true);
  });
});

describe('resetStatistics', () => {
  it('clears the stats section only', () => {
    const doc = fullDocument();
    const reset = resetStatistics(doc);
    expect(reset.stats).toStrictEqual(DEFAULT_STATS);
    expect({ ...reset, stats: doc.stats }).toStrictEqual(doc);
  });
});
