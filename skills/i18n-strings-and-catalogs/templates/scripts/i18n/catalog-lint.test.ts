// scripts/i18n/catalog-lint.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalCasing, lintDirectory } from './catalog-lint.ts';

import type { CatalogPolicy } from './catalog-lint-rules.ts';

const POLICY: CatalogPolicy = {
  sourceLanguage: 'en',
  untranslatedPrefixes: ['debug.'],
  keyPrefix: null,
  reservedPrefixes: [],
};

describe('lintDirectory', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catalog-lint-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const put = (language: string, catalog: Record<string, string>): void => {
    writeFileSync(join(dir, `${language}.json`), JSON.stringify(catalog, null, 2));
  };

  it('passes catalogs that agree', () => {
    put('en', { 'debug.title': 'Debug menu', 'tasks.title': 'Tasks' });
    put('ar', { 'debug.title': 'Debug menu', 'tasks.title': 'المهام' });
    expect(lintDirectory(dir, { languages: ['en', 'ar'], policy: POLICY })).toStrictEqual([]);
  });

  it('reports unsorted keys, a translated debug text and a lost =0 branch at file:line with the rule id', () => {
    const plural = '{n, plural, =0 {None} one {# task} other {# tasks}}';
    put('en', { 'debug.title': 'Debug menu', 'tasks.count': plural });
    const arabic =
      '{n, plural, zero {لا مهام} one {مهمة} two {مهمتان} few {# مهام} many {# مهمة} other {# مهمة}}';
    put('ar', { 'tasks.count': arabic, 'debug.title': 'قائمة التصحيح' });
    const report = lintDirectory(dir, {
      languages: ['en', 'ar'],
      policy: POLICY,
      label: (file) => file.slice(dir.length + 1),
    });
    expect(report).toStrictEqual([
      'ar.json:2 [L12 keys-sorted] keys are not sorted (first out of place: "tasks.count")',
      'ar.json:2 [P4 exact-plural-parity] tasks.count: plural {n} has exact branches [none] but en has [=0]',
      'ar.json:3 [P5 untranslated-prefix] debug.title: keeps the source text in every language (untranslatedPrefixes), but ar says "قائمة التصحيح" where en says "Debug menu"',
    ]);
  });

  it('names catalogs after the BCP 47 tag in canonical casing, exactly', () => {
    expect(['pt-br', 'zh-hant-tw', 'es-419', 'EN'].map(canonicalCasing)).toStrictEqual([
      'pt-BR',
      'zh-Hant-TW',
      'es-419',
      'en',
    ]);
    put('en', { 'tasks.title': 'Tasks' });
    put('pt-br', { 'tasks.title': 'Tarefas' });
    const languages = ['en', 'pt-BR', 'en-gb'];
    const report = lintDirectory(dir, { languages, policy: POLICY }).join('\n');
    expect(report).toContain('pt-br.json:1 [F1 catalog-file] the catalog is named pt-br.json');
    expect(report).toContain('[F1 catalog-file] "en-gb" in LANGUAGES is not in BCP 47 canonical');
    expect(report).toContain('[F1 catalog-file] en-gb.json is missing');
  });
});
