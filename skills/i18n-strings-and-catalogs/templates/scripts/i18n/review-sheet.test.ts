// scripts/i18n/review-sheet.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  REVIEW_STATE_FILE,
  csvOf,
  markReviewed,
  pendingRows,
  runReviewSheet,
  sha256Of,
  shownOnOf,
} from './review-sheet.ts';

import type { ReviewPolicy } from './review-sheet.ts';

const EN = {
  'debug.title': 'Debug menu',
  'permissions.camera.usage-description': 'Lets you add a photo to a task.',
  'tasks.list.title': 'Tasks',
};
const AR = {
  'debug.title': 'Debug menu',
  'permissions.camera.usage-description': 'يتيح لك هذا إضافة صورة إلى مهمة.',
  'tasks.list.title': 'المهام',
};
const POLICY: ReviewPolicy = {
  untranslatedPrefixes: ['debug.'],
  screens: { tasks: ['tasks.list.title'] },
};

describe('shownOnOf', () => {
  it('names the system dialog, the screen or the area that shows a key', () => {
    expect([
      shownOnOf('permissions.camera.usage-description', POLICY.screens),
      shownOnOf('tasks.list.title', POLICY.screens),
      shownOnOf('settings.title', POLICY.screens),
    ]).toStrictEqual([
      'iOS permission dialog (InfoPlist.strings)',
      'screen tasks',
      'area settings',
    ]);
  });
});

describe('pendingRows', () => {
  it('lists every text not yet reviewed, sorted, and never an untranslated key', () => {
    const rows = pendingRows({ source: EN, catalog: AR, reviewed: {}, policy: POLICY });
    expect(rows.map((row) => row.key)).toStrictEqual([
      'permissions.camera.usage-description',
      'tasks.list.title',
    ]);
  });

  it('leaves a reviewed text out until it changes', () => {
    const reviewed = {
      'tasks.list.title': { sha256: sha256Of('المهام'), reviewedOn: '2026-10-01' },
    };
    const input = { source: EN, catalog: AR, reviewed, policy: POLICY };
    expect(pendingRows(input)).toHaveLength(1);
    const changed = { ...AR, 'tasks.list.title': 'قائمة المهام' };
    expect(pendingRows({ ...input, catalog: changed })).toContainEqual({
      key: 'tasks.list.title',
      source: 'Tasks',
      current: 'قائمة المهام',
      shownOn: 'screen tasks',
    });
  });
});

describe('csvOf', () => {
  it('writes a byte-order mark, a header and quoted fields', () => {
    const rows = [{ key: 'a.b', source: 'Say "hi"', current: 'مرحبا، عالم', shownOn: 'area a' }];
    expect(csvOf(rows)).toBe(
      '﻿"key","source","current","shown on"\n"a.b","Say ""hi""","مرحبا، عالم","area a"\n',
    );
  });
});

describe('markReviewed', () => {
  it('records the hash and date of every reviewable text, keys sorted', () => {
    const next = markReviewed({}, AR, {
      language: 'ar',
      date: '2026-10-02',
      keys: [],
      policy: POLICY,
    });
    expect(Object.keys(next['ar'] ?? {})).toStrictEqual([
      'permissions.camera.usage-description',
      'tasks.list.title',
    ]);
  });

  it('refuses an untranslated key and a key the catalogs lack', () => {
    const mark = { language: 'ar', date: '2026-10-02', policy: POLICY };
    expect(() => markReviewed({}, AR, { ...mark, keys: ['debug.title'] })).toThrow(
      'never reviewed',
    );
    expect(() => markReviewed({}, AR, { ...mark, keys: ['tasks.none'] })).toThrow('not in the ar');
  });
});

describe('runReviewSheet', () => {
  let root = '';
  let output: string[] = [];

  const put = (rel: string, value: object): void => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, 2)}\n`);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'review-sheet-'));
    output = [];
    const record = (...parts: unknown[]): void => {
      output.push(parts.map(String).join(' '));
    };
    jest.spyOn(console, 'log').mockImplementation(record);
    jest.spyOn(console, 'error').mockImplementation(record);
    put('src/i18n/catalogs/en.json', EN);
    writeFileSync(
      path.join(root, 'src/i18n/languages.ts'),
      "export const LANGUAGES = ['en', 'ar'] as const;\nexport const SOURCE_LANGUAGE = 'en';\n",
    );
    put('src/i18n/catalogs/ar.json', AR);
    put('contracts/i18n.json', { reviewLanguages: ['ar'], untranslatedPrefixes: ['debug.'] });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the sheet, prints the pending line and exits 0 on a release run', () => {
    expect(runReviewSheet(root, ['--release'])).toBe(0);
    const sheet = readFileSync(path.join(root, 'reports/i18n/review-ar.csv'), 'utf8');
    expect(sheet).not.toContain('debug.');
    expect(output.at(-1)).toMatch(/^REVIEW PENDING \(not blocking\): 2 drafted texts/);
  });

  it('finds nothing to review once the language is marked', () => {
    expect(runReviewSheet(root, ['--mark-reviewed', 'ar', '--date', '2026-10-02'])).toBe(0);
    expect(readFileSync(path.join(root, REVIEW_STATE_FILE), 'utf8')).toContain('tasks.list.title');
    expect(runReviewSheet(root, [])).toBe(0);
    expect(output.at(-1)).toBe('review-sheet: every drafted text has been reviewed');
  });

  it('exits 2 for bad input and never for texts that wait', () => {
    expect(runReviewSheet(root, ['--mark-reviewed', 'de', '--date', '2026-10-02'])).toBe(2);
    expect(runReviewSheet(root, ['--mark-reviewed', 'ar'])).toBe(2);
    expect(runReviewSheet(root, ['--strict'])).toBe(2);
    rmSync(path.join(root, 'src'), { recursive: true });
    expect(runReviewSheet(root, [])).toBe(2);
  });
});
