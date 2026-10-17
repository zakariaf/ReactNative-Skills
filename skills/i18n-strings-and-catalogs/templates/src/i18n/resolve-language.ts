// src/i18n/resolve-language.ts
import { isLanguage, LANGUAGES, SOURCE_LANGUAGE } from './languages';

import type { Language } from './languages';

/**
 * The fields read from expo-localization's getLocales() entries. `languageTag` is the preferred
 * language's own tag on both platforms ('pt-BR', 'zh-Hant-TW', 'es-419'). `regionCode` is not read:
 * on iOS it is the Region setting, the same for every entry, not the language's region.
 */
export type DeviceLocale = {
  readonly languageTag: string;
  readonly languageCode: string | null;
  readonly languageScriptCode: string | null;
};

/**
 * Device tags that mean one of the app's languages without being its code, tried before the code
 * itself: an ISO 639-3 individual language of a macro-language ('arb', Standard Arabic), a
 * '<code>-<Script>' that means a language only in one script ('ku-Arab' is Sorani, 'ckb'; Kurdish in
 * Latin script is Kurmanji and must not match), or a full tag ('es-MX' -> 'es-419'; 'zh-TW' ->
 * 'zh-Hant', because Android reports Taiwan's Chinese without a script). Every entry is a decision,
 * never a guess.
 */
const DEVICE_CODE_ALIASES: Readonly<Record<string, Language>> = { arb: 'ar' };

/** One subtag in BCP 47 case: language lower, Script title, REGION upper, variants lower. */
function caseSubtag(subtag: string, index: number): string {
  if (index === 0) return subtag.toLowerCase();
  if (subtag.length === 4 && /^[A-Za-z]+$/.test(subtag)) {
    return subtag.charAt(0).toUpperCase() + subtag.slice(1).toLowerCase();
  }
  return subtag.length === 2 || /^\d{3}$/.test(subtag)
    ? subtag.toUpperCase()
    : subtag.toLowerCase();
}

/** 'ZH_hant_tw' -> 'zh-Hant-TW'; extensions dropped ('en-US-u-fw-mon' -> 'en-US'). */
function canonicalTag(tag: string): string {
  const subtags = tag.replaceAll('_', '-').split('-');
  const singleton = subtags.findIndex((subtag, index) => index > 0 && subtag.length === 1);
  return subtags
    .slice(0, singleton === -1 ? subtags.length : singleton)
    .map(caseSubtag)
    .join('-');
}

/** The tags to try for one device locale, most specific first: the full tag, language-Script, the language. */
export function deviceTagCandidates(locale: DeviceLocale): string[] {
  const full = canonicalTag(locale.languageTag);
  const [head = '', ...rest] = full.split('-');
  const language = head === '' ? (locale.languageCode?.toLowerCase() ?? '') : head;
  const script = rest.find((subtag) => /^[A-Z][a-z]{3}$/.test(subtag)) ?? locale.languageScriptCode;
  const scripted = script === null ? '' : canonicalTag(`${language}-${script}`);
  return [...new Set([full, scripted, language])].filter((tag) => tag !== '' && tag !== 'und');
}

/** The first candidate that an alias maps or `languages` lists, or null. */
export function matchDeviceLocale(
  locale: DeviceLocale,
  languages: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string | null {
  for (const tag of deviceTagCandidates(locale)) {
    const alias = aliases[tag];
    if (alias !== undefined) return alias;
    if (languages.includes(tag)) return tag;
  }
  return null;
}

/** One device locale to a supported language, or null to try the next one. */
export function languageFromDeviceLocale(locale: DeviceLocale): Language | null {
  const match = matchDeviceLocale(locale, LANGUAGES, DEVICE_CODE_ALIASES);
  return isLanguage(match) ? match : null;
}

/** The saved choice wins (null = follow the device), then the first supported device language, then the source. */
export function resolveLanguage(
  saved: Language | null,
  deviceLocales: readonly DeviceLocale[],
): Language {
  if (saved !== null) return saved;
  for (const locale of deviceLocales) {
    const language = languageFromDeviceLocale(locale);
    if (language !== null) return language;
  }
  return SOURCE_LANGUAGE;
}
