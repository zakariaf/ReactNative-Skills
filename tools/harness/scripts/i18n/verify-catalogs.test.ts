// scripts/i18n/verify-catalogs.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { repoRootOf } from './i18n-contract.ts';
import { verifyCatalogs } from './verify-catalogs.ts';

import type { FormatjsRunner } from './verify-catalogs.ts';

const LANGUAGES_TS =
  "export const LANGUAGES = ['en', 'ar'] as const;\nexport const SOURCE_LANGUAGE = 'en';\n";
const EN = { 'tasks.list.title': 'Tasks', 'tasks.page': 'Page {page, number}' };
const AR = { 'tasks.list.title': 'المهام', 'tasks.page': 'الصفحة {page, number}' };

let root = '';

function write(file: string, content: unknown): void {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
}

function appIn(dir: string): void {
  write(`${dir}/package.json`, { name: 'tasks' });
  write(`${dir}/src/i18n/languages.ts`, LANGUAGES_TS);
  write(`${dir}/src/i18n/catalogs/en.json`, EN);
  write(`${dir}/src/i18n/catalogs/ar.json`, AR);
}

/** A stand-in for the formatjs binary: records each call and answers whether it passed. */
function stubFormatjs(isPassing: boolean): { calls: (readonly string[])[]; run: FormatjsRunner } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    run: (args) => {
      calls.push(args);
      return isPassing;
    },
  };
}

describe('verifyCatalogs', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'verify-catalogs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes clean catalogs and hands FormatJS every language file', () => {
    appIn('.');
    const formatjs = stubFormatjs(true);
    const lines: string[] = [];
    expect(verifyCatalogs(root, formatjs.run, (line) => lines.push(line))).toBe(0);
    expect(formatjs.calls).toHaveLength(1);
    expect(formatjs.calls[0]).toContain('--structural-equality');
    expect(formatjs.calls[0]?.slice(-2).map((file) => path.basename(file))).toStrictEqual([
      'en.json',
      'ar.json',
    ]);
    expect(lines.at(-1)).toBe('i18n:verify: 0 catalog folder(s) failing');
  });

  it('fails when FormatJS fails, when the linter finds a problem, and without the binary', () => {
    appIn('.');
    expect(verifyCatalogs(root, stubFormatjs(false).run, () => undefined)).toBe(1);
    write('src/i18n/catalogs/ar.json', {
      'tasks.page': AR['tasks.page'],
      'tasks.list.title': AR['tasks.list.title'],
    });
    const lines: string[] = [];
    expect(verifyCatalogs(root, stubFormatjs(true).run, (line) => lines.push(line))).toBe(1);
    expect(lines).toContain(
      'src/i18n/catalogs/ar.json:1 [L12 keys-sorted] keys are not sorted (first out of place: "tasks.page")',
    );
    const missing: string[] = [];
    expect(verifyCatalogs(root, null, (line) => missing.push(line))).toBe(1);
    expect(missing[0]).toContain('@formatjs/cli is not installed');
  });

  it('reads contracts/ at the workspace root and checks package catalogs from there', () => {
    write('package.json', { name: 'tasks-monorepo', private: true, workspaces: ['apps/*'] });
    write('contracts/i18n.json', {
      catalogs: [{ dir: 'packages/billing/src/i18n', keyPrefix: 'billing' }],
    });
    write('packages/billing/src/i18n/en.json', { 'billing.plan.title': 'Premium' });
    write('packages/billing/src/i18n/ar.json', { 'billing.plan.title': 'بريميوم' });
    appIn('apps/mobile');
    const app = path.join(root, 'apps', 'mobile');
    expect(repoRootOf(app)).toBe(path.resolve(root));
    const formatjs = stubFormatjs(true);
    expect(verifyCatalogs(app, formatjs.run, () => undefined)).toBe(0);
    expect(formatjs.calls.map((args) => path.dirname(args.at(-1) ?? ''))).toStrictEqual([
      path.join(app, 'src', 'i18n', 'catalogs'),
      path.join(path.resolve(root), 'packages', 'billing', 'src', 'i18n'),
    ]);
  });
});
