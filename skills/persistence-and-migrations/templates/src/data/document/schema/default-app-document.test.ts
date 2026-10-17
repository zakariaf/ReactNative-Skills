// src/data/document/schema/default-app-document.test.ts: the first-launch document is valid, pinned, and strict at every depth.
import fc from 'fast-check';
import * as v from 'valibot';

import { LATEST_DOCUMENT_SCHEMA, LATEST_DOCUMENT_VERSION } from './app-document';
import { createDefaultAppDocument, DEFAULT_SETTINGS, DEFAULT_STATS } from './default-app-document';

const APP_ID = 'tasks-app';

function accepts(doc: unknown): boolean {
  return v.safeParse(LATEST_DOCUMENT_SCHEMA, doc).success;
}

function withExtraKey(path: 'top' | 'settings' | 'premium'): unknown {
  const doc = createDefaultAppDocument(APP_ID);
  return path === 'top' ? { ...doc, coins: 0 } : { ...doc, [path]: { ...doc[path], typo: true } };
}

const settingsArb = fc.record({
  theme: fc.constantFrom('system', 'light', 'dark'),
  language: fc.constantFrom(null, 'en', 'ar', 'pt-BR', 'zh-Hant-TW'),
  reminderHour: fc.integer({ min: 0, max: 23 }),
  soundEnabled: fc.boolean(),
  reduceMotion: fc.constantFrom('system', 'on', 'off'),
});

describe('createDefaultAppDocument', () => {
  it('creates a first-launch document the latest schema accepts', () => {
    const doc = createDefaultAppDocument(APP_ID);
    expect([accepts(doc), doc.schemaVersion, doc.appId]).toStrictEqual([
      true,
      LATEST_DOCUMENT_VERSION,
      APP_ID,
    ]);
  });

  it('starts from the pinned first-launch values', () => {
    expect(DEFAULT_SETTINGS).toStrictEqual({
      theme: 'system',
      language: null,
      reminderHour: 9,
      soundEnabled: true,
      reduceMotion: 'system',
    });
    expect(DEFAULT_STATS).toStrictEqual({
      tasksCompleted: 0,
      streak: { lastDate: null, length: 0 },
      bestStreak: 0,
      days: {},
    });
    expect(createDefaultAppDocument(APP_ID)).toStrictEqual({
      schemaVersion: LATEST_DOCUMENT_VERSION,
      appId: APP_ID,
      settings: DEFAULT_SETTINGS,
      onboarding: { completed: false, seenTips: [] },
      stats: DEFAULT_STATS,
      premium: { owned: false, ownedSinceMs: null, lastCheckedAtMs: null, revokedAtMs: null },
    });
  });
});

describe('LATEST_DOCUMENT_SCHEMA', () => {
  it.each(['top', 'settings', 'premium'] as const)(
    'rejects an unknown key at any depth: %s',
    (path) => {
      expect(accepts(withExtraKey(path))).toBe(false);
    },
  );

  it('rejects a document that claims another version', () => {
    expect(accepts({ ...createDefaultAppDocument(APP_ID), schemaVersion: 2 })).toBe(false);
  });

  it('keeps every allowed settings value valid after a JSON round trip', () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        const doc = { ...createDefaultAppDocument(APP_ID), settings };
        expect(accepts(JSON.parse(JSON.stringify(doc)))).toBe(true);
      }),
    );
  });
});
