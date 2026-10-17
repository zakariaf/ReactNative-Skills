// src/data/document/document-load-plan.test.ts: every branch of the load plan, without SQL.
import fc from 'fast-check';

import { fnv1a32 } from '@/data/checksum';
import { encodeAppDocument, validateAppDocument } from '@/data/document/document-codec';
import { createDefaultAppDocument } from '@/data/document/schema/default-app-document';

import { lastWriteCount, planLoad } from './document-load-plan';

const APP_ID = 'tasks-app';
const META = { appVersion: '1.0.0', writtenAtMs: 1, writeCount: 1 };
const GOOD = encodeAppDocument(createDefaultAppDocument(APP_ID), META);
const BROKEN = { ...GOOD, payload: `${GOOD.payload} ` };
const NEWER = { ...GOOD, schemaVersion: 99 };
const OUTCOME_KINDS = [
  'fresh',
  'loaded',
  'migrated',
  'restored-from-backup',
  'reset-after-damage',
  'newer-version',
];
const OTHER_APP = encodeAppDocument(createDefaultAppDocument('other-app'), META);

/** Any row a phone could hold: good, bit-rotted, hand-edited, another app's, or another version's. */
const rowArb = fc
  .record({
    schemaVersion: fc.integer({ min: -1, max: 3 }),
    writeCount: fc.nat(),
    payload: fc.oneof(
      fc.constant(GOOD.payload),
      fc.constant(BROKEN.payload),
      fc.constant(OTHER_APP.payload),
      fc.string(),
      fc.jsonValue().map((value) => JSON.stringify(value)),
    ),
    hasRightChecksum: fc.boolean(),
  })
  .map(({ schemaVersion, writeCount, payload, hasRightChecksum }) => ({
    ...GOOD,
    schemaVersion,
    writeCount,
    payload,
    checksum: hasRightChecksum ? fnv1a32(payload) : 'ffffffff',
  }));
const slotArb = fc.option(rowArb, { nil: null });

describe('planLoad', () => {
  it('starts fresh on a first launch and writes both slots', () => {
    const plan = planLoad({ current: null, backup: null, appId: APP_ID });
    expect(plan.outcome).toStrictEqual({ kind: 'fresh' });
    expect(plan.writes).toStrictEqual([{ kind: 'write-both' }]);
  });

  it('loads a valid current and refreshes the backup', () => {
    const plan = planLoad({ current: GOOD, backup: null, appId: APP_ID });
    expect(plan.outcome).toStrictEqual({ kind: 'loaded' });
    expect(plan.writes).toStrictEqual([{ kind: 'write-both' }]);
  });

  it('restores the backup and quarantines a damaged current', () => {
    const plan = planLoad({ current: BROKEN, backup: GOOD, appId: APP_ID });
    expect(plan.outcome).toStrictEqual({ kind: 'restored-from-backup', reason: 'checksum' });
    expect(plan.writes[0]).toStrictEqual({
      kind: 'quarantine',
      slot: 'current',
      reason: 'checksum',
    });
  });

  it('writes nothing when the document comes from a newer build', () => {
    const plan = planLoad({ current: NEWER, backup: GOOD, appId: APP_ID });
    expect(plan.outcome).toStrictEqual({ kind: 'newer-version', found: 99 });
    expect([plan.writes, plan.isReadOnly]).toStrictEqual([[], true]);
  });

  it('resets after both slots are damaged and keeps both bad copies', () => {
    const plan = planLoad({ current: BROKEN, backup: BROKEN, appId: APP_ID });
    expect(plan.outcome.kind).toBe('reset-after-damage');
    expect(plan.writes.filter((write) => write.kind === 'quarantine')).toHaveLength(2);
  });

  it('treats a document of another app as damaged', () => {
    const plan = planLoad({ current: GOOD, backup: null, appId: 'other-app' });
    expect(plan.outcome).toStrictEqual({ kind: 'reset-after-damage', reason: 'app-id' });
  });

  it('restores the backup without a quarantine when current was never written', () => {
    const plan = planLoad({ current: null, backup: GOOD, appId: APP_ID });
    expect(plan.outcome).toStrictEqual({ kind: 'restored-from-backup', reason: 'missing' });
    expect(plan.writes).toStrictEqual([{ kind: 'write-both' }]);
  });

  it('plays read-only when current is damaged and the backup comes from a newer build', () => {
    const plan = planLoad({ current: BROKEN, backup: NEWER, appId: APP_ID });
    expect([plan.outcome, plan.isReadOnly]).toStrictEqual([
      { kind: 'newer-version', found: 99 },
      true,
    ]);
  });
});

describe('planLoad over any two rows', () => {
  it('always yields a valid document and a known outcome, and never throws', () => {
    fc.assert(
      fc.property(slotArb, slotArb, (current, backup) => {
        const plan = planLoad({ current, backup, appId: APP_ID });
        expect(validateAppDocument(plan.doc)).toStrictEqual({ doc: plan.doc });
        expect(OUTCOME_KINDS).toContain(plan.outcome.kind);
        expect(plan.isReadOnly).toBe(plan.outcome.kind === 'newer-version');
      }),
    );
  });
});

describe('lastWriteCount', () => {
  it('returns the highest write count of the two slots', () => {
    const later = { ...GOOD, writeCount: 9 };
    expect(lastWriteCount({ current: GOOD, backup: later, appId: APP_ID })).toBe(9);
    expect(lastWriteCount({ current: null, backup: null, appId: APP_ID })).toBe(0);
  });
});
