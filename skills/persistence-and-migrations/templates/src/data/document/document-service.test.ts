// src/data/document/document-service.test.ts: the single writer: counter, backup moments, refused and held writes, the guard, read-only.
import fc from 'fast-check';

import { encodeAppDocument } from '@/data/document/document-codec';
import { planLoad } from '@/data/document/document-load-plan';
import { createFakeDocumentStore } from '@/data/document/fake-document-store';
import { createDefaultAppDocument } from '@/data/document/schema/default-app-document';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createDocumentService, keepPremiumUnlessRevoked } from './document-service';

import type { LoadPlan } from '@/data/document/document-load-plan';
import type { DocumentStore } from '@/data/document/document-store';
import type { AppDocument } from '@/data/document/schema/app-document';

const APP_ID = 'tasks-app';
const CLOCK = { nowMs: () => 1_790_000_000_000 };
const GOOD = encodeAppDocument(createDefaultAppDocument(APP_ID), {
  appVersion: '1.0.0',
  writtenAtMs: 1,
  writeCount: 7,
});
/** A damaged current with a good backup: the plan quarantines current, then writes both. */
const RESTORE_PLAN = planLoad({
  current: { ...GOOD, payload: `${GOOD.payload} ` },
  backup: GOOD,
  appId: APP_ID,
});
const NEWER_PLAN = planLoad({
  current: { ...GOOD, schemaVersion: 99 },
  backup: null,
  appId: APP_ID,
});

function setup(options: {
  readonly isStrict: boolean;
  readonly plan?: LoadPlan;
  readonly store?: DocumentStore;
}) {
  const store = createFakeDocumentStore();
  const errorLog = createFakeErrorLog();
  const plan = options.plan ?? planLoad({ current: null, backup: null, appId: APP_ID });
  const deps = { store: options.store ?? store, clock: CLOCK, errorLog, appVersion: '1.0.0' };
  const service = createDocumentService({ ...deps, isStrict: options.isStrict }, plan, 41);
  service.applyLoadWrites();
  return { store, errorLog, service };
}

const dark = (doc: AppDocument): AppDocument => ({
  ...doc,
  settings: { ...doc.settings, theme: 'dark' },
});
const lateReminder = (doc: AppDocument): AppDocument => ({
  ...doc,
  settings: { ...doc.settings, reminderHour: 25 },
});
const remindAt =
  (reminderHour: number) =>
  (doc: AppDocument): AppDocument => ({
    ...doc,
    settings: { ...doc.settings, reminderHour },
  });

/** A store whose quarantine refuses while `isFull()` (the only copy of a damaged slot must land first). */
function quarantineRefusing(isFull: () => boolean) {
  const store = createFakeDocumentStore();
  const writes: unknown[] = [];
  const refusing: DocumentStore = {
    read: store.read,
    write: (slots) => {
      writes.push(slots);
      store.write(slots);
    },
    quarantine: (slot, reason, atMs) => {
      if (isFull()) throw new Error('SQLITE_FULL');
      store.quarantine(slot, reason, atMs);
    },
  };
  return { store, writes, refusing };
}

describe('createDocumentService', () => {
  it('keeps the write counter rising from the highest count found at load', () => {
    const { store } = setup({ isStrict: true });
    expect([store.read('current')?.writeCount, store.read('backup')?.writeCount]).toStrictEqual([
      42, 42,
    ]);
  });

  it('writes only the current slot unless the backup is refreshed', () => {
    const { store, service } = setup({ isStrict: true });
    service.update(dark);
    expect([store.read('current')?.writeCount, store.read('backup')?.writeCount]).toStrictEqual([
      43, 42,
    ]);
    service.update((doc) => doc, { refreshBackup: true });
    expect(store.read('backup')?.writeCount).toBe(44);
  });

  it('throws on an invalid document in strict builds and writes nothing', () => {
    const { store, service } = setup({ isStrict: true });
    expect(() => {
      service.update(lateReminder);
    }).toThrow('invalid document not written: settings.reminderHour');
    expect(store.read('current')?.writeCount).toBe(42);
    expect(service.doc().settings.reminderHour).toBe(9);
  });

  it('logs an invalid document in production builds, writes nothing and keeps the valid one', () => {
    const { store, service, errorLog } = setup({ isStrict: false });
    const before = service.doc();
    expect(service.update(lateReminder)).toBe(false);
    expect(errorLog.entries().map((entry) => entry.source)).toStrictEqual(['storage']);
    expect([store.read('current')?.writeCount, service.doc()]).toStrictEqual([42, before]);
  });

  it('keeps Premium on unless a revocation date comes with the change', () => {
    const { service } = setup({ isStrict: true });
    const owned = { owned: true, ownedSinceMs: 1, lastCheckedAtMs: null, revokedAtMs: null };
    service.update((doc) => ({ ...doc, premium: owned }));
    service.update((doc) => ({ ...doc, premium: { ...doc.premium, owned: false } }));
    expect(service.doc().premium.owned).toBe(true);
    service.update((doc) => ({
      ...doc,
      premium: { ...doc.premium, owned: false, revokedAtMs: 9 },
    }));
    expect(service.doc().premium.owned).toBe(false);
  });

  it('plays in memory and writes nothing when the document came from a newer build', () => {
    const { store, service } = setup({ isStrict: true, plan: NEWER_PLAN });
    expect(service.update(dark)).toBe(false);
    expect([service.isReadOnly(), service.doc().settings.theme, store.slots.size]).toStrictEqual([
      true,
      'dark',
      0,
    ]);
  });

  it('quarantines a damaged current at load and restores the backup', () => {
    const { store } = setup({ isStrict: true, plan: RESTORE_PLAN });
    expect(store.quarantined).toStrictEqual([{ slot: 'current', reason: 'checksum' }]);
    expect(store.read('current')?.payload).toBe(GOOD.payload);
  });

  it('logs a refused write, goes on with the new document, and reports it until a write lands', () => {
    const { store, service, errorLog } = setup({ isStrict: true });
    store.failNextWrite = true; // a full disk: SQLITE_FULL from the COMMIT
    expect(service.update(dark)).toBe(false);
    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual([
      new Error('simulated crash before COMMIT'),
    ]);
    expect([service.doc().settings.theme, service.didLastWriteFail()]).toStrictEqual([
      'dark',
      true,
    ]);
    expect(store.read('current')?.writeCount).toBe(42);
    expect(service.update((doc) => doc)).toBe(true);
    expect(service.didLastWriteFail()).toBe(false);
    expect(store.read('current')?.payload).toContain('"theme":"dark"');
  });

  it('keeps a refused backup refresh due until a write that includes the backup lands', () => {
    const { store, service } = setup({ isStrict: true });
    store.failNextWrite = true;
    service.update(dark, { refreshBackup: true });
    service.update(remindAt(7));
    expect(store.read('backup')?.payload).toBe(store.read('current')?.payload);
    expect(store.read('backup')?.writeCount).toBe(44);
    service.update(remindAt(8));
    expect([store.read('backup')?.writeCount, store.read('current')?.writeCount]).toStrictEqual([
      44, 45,
    ]);
  });

  it('keeps starting without a throw when the disk refuses every planned write', () => {
    const refusing: DocumentStore = {
      read: () => null,
      write: () => {
        throw new Error('SQLITE_FULL');
      },
      quarantine: () => {
        throw new Error('SQLITE_FULL');
      },
    };
    const run = () => setup({ isStrict: true, plan: RESTORE_PLAN, store: refusing });
    expect(run).not.toThrow();
    const { service, errorLog } = run();
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'SQLITE_FULL',
      'SQLITE_FULL',
    ]);
    expect([service.doc(), service.didLastWriteFail()]).toStrictEqual([
      createDefaultAppDocument(APP_ID),
      true,
    ]);
  });

  it('holds every slot write while the quarantine copy of a damaged slot is pending', () => {
    let isFull = true;
    const { writes, refusing } = quarantineRefusing(() => isFull);
    const { service } = setup({ isStrict: true, plan: RESTORE_PLAN, store: refusing });
    expect(service.update(dark)).toBe(false);
    expect([writes, service.didLastWriteFail()]).toStrictEqual([[], true]);
    isFull = false;
    expect(service.update((doc) => doc)).toBe(true);
    expect([writes.length, service.didLastWriteFail()]).toStrictEqual([1, false]);
  });

  it('writes the backup the startup planned once a blocking quarantine copy lands', () => {
    let isFull = true;
    const { store, refusing } = quarantineRefusing(() => isFull);
    const { service } = setup({ isStrict: true, plan: RESTORE_PLAN, store: refusing });
    isFull = false;
    service.update(dark);
    expect(store.read('backup')?.writeCount).toBe(42);
    expect(store.read('backup')?.payload).toContain('"theme":"dark"');
    expect(store.quarantined).toStrictEqual([{ slot: 'current', reason: 'checksum' }]);
  });

  it('answers true once a change has reached the disk, with or without the backup', () => {
    const { service } = setup({ isStrict: true });
    expect([service.update(dark), service.update(dark, { refreshBackup: true })]).toStrictEqual([
      true,
      true,
    ]);
  });
});

const nullableMs = fc.option(fc.nat(), { nil: null });
const premiumArb = fc.record({
  owned: fc.boolean(),
  ownedSinceMs: nullableMs,
  lastCheckedAtMs: nullableMs,
  revokedAtMs: nullableMs,
});

describe('keepPremiumUnlessRevoked', () => {
  it('keeps owned Premium for any change that brings no revocation date', () => {
    fc.assert(
      fc.property(premiumArb, premiumArb, (before, after) => {
        const doc = createDefaultAppDocument(APP_ID);
        const previous = { ...doc, premium: before };
        const next = { ...doc, premium: after };
        const isGuarded = before.owned && !after.owned && after.revokedAtMs === null;
        expect(keepPremiumUnlessRevoked(previous, next)).toStrictEqual(isGuarded ? previous : next);
      }),
    );
  });
});
