// src/data/document/migrations/document-migrations.test.ts: one step per version, in order, and a broken step is never a crash.
import { LATEST_DOCUMENT_VERSION } from '@/data/document/schema/app-document';

import {
  DOCUMENT_MIGRATIONS,
  migrateDocumentToLatest,
  runDocumentMigrations,
} from './document-migrations';

describe('document migrations', () => {
  it('has exactly one step for every version below the latest, in order', () => {
    expect(DOCUMENT_MIGRATIONS.map((step) => step.from)).toStrictEqual(
      Array.from({ length: LATEST_DOCUMENT_VERSION - 1 }, (_, index) => index + 1),
    );
  });

  it('leaves a latest document unchanged', () => {
    const doc = { schemaVersion: LATEST_DOCUMENT_VERSION, appId: 'tasks-app' };
    expect(migrateDocumentToLatest(doc, LATEST_DOCUMENT_VERSION)).toStrictEqual({
      ok: true,
      value: doc,
    });
  });

  it('fails on a version it has no step for', () => {
    expect(migrateDocumentToLatest({ schemaVersion: 0 }, 0)).toStrictEqual({
      ok: false,
      error: { kind: 'document-step-missing', from: 0 },
    });
  });

  it('runs the steps in order and stamps each new version', () => {
    const steps = [
      { from: 1, migrate: (doc: Readonly<Record<string, unknown>>) => ({ ...doc, a: 1 }) },
      { from: 2, migrate: (doc: Readonly<Record<string, unknown>>) => ({ ...doc, b: 2 }) },
    ];
    expect(
      runDocumentMigrations(steps, { schemaVersion: 1 }, { from: 1, latest: 3 }),
    ).toStrictEqual({ ok: true, value: { schemaVersion: 3, a: 1, b: 2 } });
  });

  it('turns a throwing step into a failure (a damaged slot), never a crash', () => {
    const steps = [
      {
        from: 1,
        migrate: (): Record<string, unknown> => {
          throw new Error('bad step');
        },
      },
    ];
    expect(
      runDocumentMigrations(steps, { schemaVersion: 1 }, { from: 1, latest: 2 }),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'document-step-threw', from: 1 },
    });
    expect(runDocumentMigrations(steps, 'not an object', { from: 1, latest: 2 })).toStrictEqual({
      ok: false,
      error: { kind: 'document-not-an-object', version: 1 },
    });
  });
});
