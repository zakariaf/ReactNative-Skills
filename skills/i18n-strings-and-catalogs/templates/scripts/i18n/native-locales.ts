// scripts/i18n/native-locales.ts
// Builds app.config.ts `locales` from the catalogs: the name under the app icon and the purpose
// strings iOS prints in its own permission dialogs (InfoPlist.strings per language), and the
// Android app name (strings.xml per language). sourceText() gives a config plugin its base
// (source-language) text from the same catalogs. The system texts are then the catalogs' texts,
// never a second copy. Node runs it inside app.config.ts (type stripping).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { I18N_DIR, readAppLanguages } from './app-languages.ts';

export type NativeTextKeys = {
  /** The catalog key of the app name (CFBundleDisplayName on iOS, app_name on Android). */
  readonly displayName: string;
  /** Info.plist key -> catalog key, e.g. NSCameraUsageDescription -> 'permissions.camera.usage-description'. */
  readonly usageDescriptions: Readonly<Record<string, string>>;
};
export type NativeLocaleOptions = {
  /**
   * Turns the catalog's app name into this build's name, so development and preview builds keep
   * their label in every language ('المهام' -> 'المهام (Dev)'). Without it every variant shows the
   * production name. app-variants-and-environment owns the label:
   * (name) => variantIdentity({ ...BASE, name }, variant).name.
   */
  readonly variantName?: (catalogName: string) => string;
};
export type NativeLocale = {
  readonly ios: Readonly<Record<string, string>>;
  readonly android: Readonly<Record<string, string>>;
};
type Catalog = Readonly<Record<string, string>>;

function plainText(catalog: Catalog, key: string, language: string): string {
  const text = catalog[key];
  if (text === undefined) throw new Error(`native-locales: the ${language} catalog lacks ${key}`);
  if (/[{}]/.test(text)) {
    throw new Error(`native-locales: ${language} ${key} holds ICU syntax; system texts are plain`);
  }
  return text;
}

function readCatalog(projectRoot: string, language: string): Catalog {
  const file = join(projectRoot, I18N_DIR, 'catalogs', `${language}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Catalog;
}

/** One language's native strings from its catalog. */
export function nativeLocale(
  catalog: Catalog,
  keys: NativeTextKeys,
  options: NativeLocaleOptions & { readonly language: string },
): NativeLocale {
  const { language, variantName = (name: string): string => name } = options;
  const name = variantName(plainText(catalog, keys.displayName, language));
  const usage = Object.entries(keys.usageDescriptions).map(([plistKey, key]): [string, string] => [
    plistKey,
    plainText(catalog, key, language),
  ]);
  return {
    ios: { CFBundleDisplayName: name, ...Object.fromEntries(usage) },
    android: { app_name: name },
  };
}

/** `locales` for app.config.ts: every language in LANGUAGES, read from <I18N_DIR>/catalogs/. */
export function nativeLocales(
  projectRoot: string,
  keys: NativeTextKeys,
  options: NativeLocaleOptions = {},
): Record<string, NativeLocale> {
  const { languages } = readAppLanguages(projectRoot);
  return Object.fromEntries(
    languages.map((language) => [
      language,
      nativeLocale(readCatalog(projectRoot, language), keys, { ...options, language }),
    ]),
  );
}

/**
 * A system text in the source language, for the base value a config plugin writes into Info.plist
 * (cameraPermission, userTrackingPermission, ...): the catalogs stay the only copy.
 */
export function sourceText(projectRoot: string, key: string): string {
  const { sourceLanguage } = readAppLanguages(projectRoot);
  return plainText(readCatalog(projectRoot, sourceLanguage), key, sourceLanguage);
}
