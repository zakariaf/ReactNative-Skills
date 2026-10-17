// scripts/i18n/app-languages.ts
// The app's languages for Node tooling (app.config.ts, scripts/i18n/), read from the literal
// LANGUAGES and SOURCE_LANGUAGE in <I18N_DIR>/languages.ts. Tooling reads the file instead of
// importing it: app code is not Node code (an Expo app's package.json has no "type", so Node would
// reparse it as an ES module with a warning on every run). Any layout Prettier writes parses: one
// line, or one code per line with a trailing comma, single or double quotes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AppLanguages = {
  readonly languages: readonly string[];
  readonly sourceLanguage: string;
};

/**
 * The i18n folder (languages.ts, catalogs/), relative to the app folder. The one place the Node
 * tooling learns it: native-locales (app.config.ts), i18n-contract, verify-catalogs and review-sheet
 * all read it from here. When the app moves the folder, change it here and in rn-skills.config.json
 * "i18nDir" together; check-i18n-code.mjs rule tooling-dir fails while the two disagree.
 */
export const I18N_DIR = 'src/i18n';

const LIST = /export const LANGUAGES\s*=\s*\[([^\]]*)\]/;
const SOURCE = /export const SOURCE_LANGUAGE\s*=\s*(['"])([^'"]+)\1/;
const ITEM = /^(['"])([^'"]+)\1$/;
const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

function parseList(body: string): string[] | null {
  const items = body
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const codes = items.map((item) => ITEM.exec(item)?.[2] ?? '');
  return codes.length > 0 && codes.every((code) => CODE.test(code)) ? codes : null;
}

/** Parses the two literals; throws when the file no longer has the canonical shape. */
export function parseAppLanguages(source: string): AppLanguages {
  const body = LIST.exec(source)?.[1];
  const languages = body === undefined ? null : parseList(body);
  if (languages === null) {
    throw new Error("app-languages: write LANGUAGES as a literal: ['en', 'ar'] as const");
  }
  const sourceLanguage = SOURCE.exec(source)?.[2];
  if (sourceLanguage === undefined || !languages.includes(sourceLanguage)) {
    throw new Error('app-languages: SOURCE_LANGUAGE must be a literal code from LANGUAGES');
  }
  return { languages, sourceLanguage };
}

export function readAppLanguages(projectRoot: string): AppLanguages {
  return parseAppLanguages(readFileSync(join(projectRoot, I18N_DIR, 'languages.ts'), 'utf8'));
}
