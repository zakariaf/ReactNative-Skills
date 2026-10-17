// src/i18n/intl-polyfills.ts
// Side-effect module, evaluated before any other app code: index.ts (the app entry) imports it
// first, and jest.config.js lists it in setupFiles, so Jest formats exactly like the phone.
// Order matters: getCanonicalLocales -> Locale -> PluralRules -> NumberFormat.
// One locale-data import per language in LANGUAGES (languages.ts), each written out: Metro cannot
// resolve template-string imports, and every extra locale is startup weight.
// Regional and script languages import the file each package ships, found by truncation fallback
// (the full tag, then the tag minus its last subtag; not CLDR's parentLocales): pt-BR takes
// pluralrules pt.js and numberformat pt.js (neither ships pt-BR.js); zh-Hant takes pluralrules zh.js
// and numberformat zh-Hant.js. A file that does not exist fails Metro and Jest with "Cannot find
// module"; check-i18n-code.mjs rule polyfill-locales names the exact file for every language.
// Optional forced blocks follow NumberFormat only while src/i18n/ uses their API (DateTimeFormat,
// RelativeTimeFormat, ListFormat, DisplayNames, Segmenter: Hermes has none of the last four).

// 1. Conditional: Hermes ships getCanonicalLocales, so this is normally a no-op.
import '@formatjs/intl-getcanonicallocales/polyfill.js';
// 2-4. Forced: Hermes has no Intl.Locale or Intl.PluralRules and ignores -u-nu- in NumberFormat.
//      Forcing also makes Jest (Node's ICU) produce exactly what the device produces.
import '@formatjs/intl-locale/polyfill-force.js';
import '@formatjs/intl-pluralrules/polyfill-force.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/ar.js';
import '@formatjs/intl-numberformat/polyfill-force.js';
import '@formatjs/intl-numberformat/locale-data/en.js';
import '@formatjs/intl-numberformat/locale-data/ar.js';
