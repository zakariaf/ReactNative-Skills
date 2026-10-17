// test/i18n/app-entry-imports.test.ts
// Guardrail: Hermes has no Intl.PluralRules or Intl.Locale, so the forced polyfills must be the
// first module the app entry evaluates, and expo-router/entry the last. It reads the file with
// node:fs, so it lives in the root test/ folder (the test code with Node types).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function importsOf(file: string): string[] {
  const source = readFileSync(join(__dirname, '..', '..', file), 'utf8');
  return source.split('\n').filter((line) => line.startsWith('import '));
}

describe('index.ts, the app entry', () => {
  it('imports the Intl polyfills before any other module', () => {
    expect(importsOf('index.ts')[0]).toBe("import '@/i18n/intl-polyfills';");
  });

  it('registers expo-router/entry last', () => {
    expect(importsOf('index.ts').at(-1)).toBe("import 'expo-router/entry';");
  });
});
