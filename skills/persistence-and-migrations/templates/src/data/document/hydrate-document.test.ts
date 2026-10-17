// src/data/document/hydrate-document.test.ts: a first launch, a relaunch, a newer build's document, and a full disk at startup.
import { encodeAppDocument } from '@/data/document/document-codec';
import { createFakeDocumentStore } from '@/data/document/fake-document-store';
import { createDefaultAppDocument } from '@/data/document/schema/default-app-document';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { hydrateDocument } from './hydrate-document';

import type { FakeDocumentStore } from '@/data/document/fake-document-store';

const APP_ID = 'tasks-app';

function hydrate(store: FakeDocumentStore = createFakeDocumentStore()) {
  const errorLog = createFakeErrorLog();
  const deps = { store, clock: { nowMs: () => 1 }, errorLog, appVersion: '1.0.0' };
  return { store, errorLog, hydrated: hydrateDocument({ ...deps, isStrict: true, appId: APP_ID }) };
}

describe('hydrateDocument', () => {
  it('starts a first launch from a fresh document written to both slots', () => {
    const { store, hydrated } = hydrate();
    expect(hydrated.outcome).toStrictEqual({ kind: 'fresh' });
    expect([store.slots.has('current'), store.slots.has('backup')]).toStrictEqual([true, true]);
    expect(hydrated.document.doc().appId).toBe(APP_ID);
  });

  it('loads the document a previous launch wrote', () => {
    const first = hydrate();
    first.hydrated.document.update((doc) => ({
      ...doc,
      onboarding: { ...doc.onboarding, completed: true },
    }));
    const { hydrated } = hydrate(first.store);
    expect(hydrated.outcome).toStrictEqual({ kind: 'loaded' });
    expect(hydrated.document.doc().onboarding.completed).toBe(true);
  });

  it('plays a document from a newer build in memory without writing it', () => {
    const store = createFakeDocumentStore();
    const meta = { appVersion: '9.0.0', writtenAtMs: 1, writeCount: 3 };
    const newer = {
      ...encodeAppDocument(createDefaultAppDocument(APP_ID), meta),
      schemaVersion: 4,
    };
    store.slots.set('current', newer);
    const { hydrated } = hydrate(store);
    expect(hydrated.outcome).toStrictEqual({ kind: 'newer-version', found: 4 });
    expect(store.read('current')).toBe(newer);
    expect(store.slots.has('backup')).toBe(false);
  });

  it('logs a write the disk refuses at startup and never throws, so every launch still starts', () => {
    const store = createFakeDocumentStore();
    store.failNextWrite = true;
    const { hydrated, errorLog } = hydrate(store);
    expect([hydrated.outcome, hydrated.document.didLastWriteFail()]).toStrictEqual([
      { kind: 'fresh' },
      true,
    ]);
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'simulated crash before COMMIT',
    ]);
    expect(store.slots.size).toBe(0);
  });
});
