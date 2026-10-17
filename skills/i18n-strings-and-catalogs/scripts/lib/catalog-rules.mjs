// catalog-rules.mjs: the message rules L1-L13 and the cross-language parity rules P3-P5 of
// check-catalogs.mjs. Not an entry point. The project linter the skill ships
// (templates/scripts/i18n/catalog-lint-rules.ts, behind `npm run i18n:verify`) prints the same ids
// and messages, so both tools say the same words.
//
// Language facts come from Node's ICU, never from a table here: plural categories from
// Intl.PluralRules, the script from Intl.Locale#maximize. That keeps the rules right for any
// language the app adds (ar has six cardinal categories, ja one, fa puts 0 in "one").

import { collectVariables, exactSelectors, IcuSyntaxError, parseIcu, walkIcu } from './icu-parse.mjs';

const KEY_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){1,4}$/;
const ARG_NAME = /^[a-z][A-Za-z0-9]*$/;
const TEXT_ARG = /(Name|Text)$/;
const EXACT = /^=\d+$/;
const ANY_DIGIT = /\p{Nd}/u;
const BANNED_CONTROLS = /[؜‪-‮⁦-⁩]/;
const ARABIC_ONLY_LETTERS = /[يك]/; // Arabic yeh and kaf
const LATIN_PUNCTUATION = /[,;?]/;
const JOINER_EDGE = /^[\s,;:+&/–-]|[\s,;:+&/–-]$/;
const SYSTEM_TEXT_KEY = /\.usage-description$/;
/** Languages written with ی (U+06CC) and ک (U+06A9), never Arabic ي and ك. Arabic and Pashto are not. */
export const PERSIAN_LETTER_LANGUAGES = Object.freeze(['fa', 'prs', 'ckb', 'ur']);
const CASED_SCRIPTS = new Set(['Latn', 'Cyrl', 'Grek', 'Armn']);
/** Scripts written without spaces between words: a word after a number is no sign of a count there. */
const UNSPACED_SCRIPTS = new Set('Hani Hans Hant Jpan Thai Laoo Khmr Mymr Tibt'.split(' '));

/** Rule id -> [short name, fix]. */
export const RULES = {
  L1: ['key-shape', 'Rename the key to <area>.<element>[.<variant>]: 2-5 lowercase kebab-case segments (tasks.summary.open).'],
  L1b: ['key-namespace', 'Keys of a package catalog start with its "<keyPrefix>." and app keys never use a package prefix (contracts/i18n.json "catalogs"); move or rename the key.'],
  L2: ['icu-syntax', "Fix the ICU syntax: balanced braces, {x, number}, {x, plural, one {...} other {...}}; quote a literal brace as '{'."],
  L3: ['no-date-time-tags', 'Remove {x, date}/{x, time} and <tags>: format the date in src/i18n/format-date.ts, pass it as a *Text value, and keep emphasis out of messages.'],
  L4: ['placeholder-name', 'Name placeholders in camelCase; a plain {x} must end in Name/Text (free text), numbers use {x, number} or a plural.'],
  L5: ['plural-categories', 'Give every plural exactly the CLDR categories of its language (new Intl.PluralRules(lang).resolvedOptions().pluralCategories; selectordinal uses { type: "ordinal" }); an =N branch may stand in for a category that holds only those numbers (ar zero with =0). No offset.'],
  L6: ['count-needs-plural', 'A number followed by a counted noun must be {n, plural, one {# noun} other {# nouns}} (with every category of the language).'],
  L7: ['literal-digits', 'Replace digits in the text with a {x, number} placeholder so the digits follow the language.'],
  L8: ['bidi-controls', 'Delete the bidi control characters; t() isolates *Name/*Text values with FSI/PDI itself.'],
  L9: ['arabic-letters', `Replace Arabic ي (U+064A) and ك (U+0643) with ی (U+06CC) and ک (U+06A9): ${PERSIAN_LETTER_LANGUAGES.join(', ')} write those letters.`],
  L10: ['latin-punctuation', 'Use Arabic-script punctuation in this language: ، (comma) ؛ (semicolon) ؟ (question mark).'],
  L11: ['sentence-shape', 'Store one whole sentence per key: no leading/trailing space or joiner, no double space, the source language starts with a capital, not a bare placeholder.'],
  L12: ['keys-sorted', 'Sort the keys (JavaScript default sort): rewrite the file with sorted keys, or run sync-copy.mjs apply.'],
  L13: ['system-text-plain', 'Write a *.usage-description text as plain sentences in every language: iOS shows it from InfoPlist.strings, where nothing formats ICU, and the dialog title already names the app.'],
  P1: ['missing-key', 'Add the key to this language with a real translation (never a copy of the source text).'],
  P2: ['extra-key', 'Delete the key, or add it to the source catalog first: the source language is authoritative.'],
  P3: ['placeholder-parity', 'Use exactly the placeholders of the source message with the same types (number stays number, plural stays plural).'],
  P4: ['exact-plural-parity', 'Give every language the same =N branches as the source (fa counts 0 as "one", so =0 must exist everywhere or nowhere).'],
  P5: ['untranslated-prefix', 'Copy the source text into this language: keys under an untranslatedPrefixes entry of contracts/i18n.json (developer-only screens) keep the source text everywhere; numbers inside still follow the language.'],
  F1: ['catalog-file', 'Every language in LANGUAGES (src/i18n/languages.ts) needs <lang>.json in each catalog folder: a flat JSON object of key -> ICU string.'],
};

export function ruleLabel(id) {
  return `${id} ${RULES[id][0]}`;
}

/** True for a key that keeps the source text in every language (contract untranslatedPrefixes). */
export function isUntranslated(key, policy) {
  return policy.untranslatedPrefixes.some((prefix) => key.startsWith(prefix));
}

const scriptCache = new Map();
/** The script a language is written in ('Latn', 'Arab', ...), from CLDR likely subtags. */
export function scriptOf(language) {
  if (!scriptCache.has(language)) {
    let script = '';
    try {
      script = new Intl.Locale(language).maximize().script ?? '';
    } catch {
      script = '';
    }
    scriptCache.set(language, script);
  }
  return scriptCache.get(language);
}

/**
 * L6 applies to the source language when its number forms differ (more than one cardinal category)
 * and its script puts spaces between words: en, de, es, ar, ru, hi... (not ja, zh, th, ko, vi). The
 * translations follow the source's plural through P3.
 */
export function countNeedsPlural(language, policy) {
  return language === policy.sourceLanguage && categoriesOf(language, 'cardinal').length > 1 && !UNSPACED_SCRIPTS.has(scriptOf(language));
}

/** The CLDR plural categories of a language: cardinal (plural) or ordinal (selectordinal). */
export function categoriesOf(language, type) {
  return new Intl.PluralRules(language, { type }).resolvedOptions().pluralCategories;
}

/**
 * True when exact branches cover a category: the category holds only a few fixed integers
 * (ar "zero" = 0, fa "one" = 0 and 1) and every one of them has its =N branch.
 */
function coveredByExact(language, type, category, exact) {
  const rules = new Intl.PluralRules(language, { type });
  const members = [];
  for (let n = 0; n <= 1000 && members.length <= 9; n += 1) if (rules.select(n) === category) members.push(n);
  return members.length > 0 && members.length <= 9 && members.every((n) => exact.has(n));
}

function pluralProblems(el, language, add) {
  if (el.offset !== 0) {
    add('L5', 'plural offset is not allowed: give the other count its own placeholder');
    return;
  }
  const type = el.pluralType === 'ordinal' ? 'ordinal' : 'cardinal';
  const allowed = categoriesOf(language, type);
  const options = Object.keys(el.options);
  const exact = new Set(options.filter((option) => EXACT.test(option)).map((option) => Number(option.slice(1))));
  for (const option of options.filter((o) => !EXACT.test(o) && !allowed.includes(o))) {
    add('L5', `plural category "${option}" does not exist in ${language} (${type}: ${allowed.join(', ')})`);
  }
  const missing = allowed.filter((category) => !options.includes(category) && !coveredByExact(language, type, category, exact));
  if (missing.length > 0) add('L5', `{${el.value}} lacks the ${language} ${type} categories ${missing.join(', ')} (${language} has ${allowed.join(', ')})`);
}

function placeholderProblems(el, add) {
  if (el.type === 'literal' || el.type === 'pound') return;
  const name = el.value;
  if (!ARG_NAME.test(name)) add('L4', `placeholder "${name}" must be camelCase`);
  else if (el.type === 'argument' && !TEXT_ARG.test(name)) add('L4', `{${name}} is plain text: name it *Name/*Text, or use {${name}, number} / plural`);
  else if (el.type !== 'argument' && el.type !== 'tag' && TEXT_ARG.test(name)) add('L4', `"${name}" ends in Name/Text, which is reserved for plain-text placeholders`);
}

function literalProblems(value, scripts, add) {
  if (ANY_DIGIT.test(value)) add('L7', 'literal digits: numbers must be placeholders');
  if (BANNED_CONTROLS.test(value)) add('L8', 'bidi controls/ALM in catalog: t() isolates values');
  if (scripts.persianLetters && ARABIC_ONLY_LETTERS.test(value)) add('L9', 'Arabic ي/ك: use ی/ک');
  if (scripts.arabicScript && LATIN_PUNCTUATION.test(value)) add('L10', 'Latin , ; ? in Arabic-script text: use ، ؛ ؟');
}

function keyProblems(key, policy, add) {
  if (!KEY_FORMAT.test(key)) add('L1', 'key must be 2-5 dot-separated kebab-case segments');
  if (policy.keyPrefix && !key.startsWith(`${policy.keyPrefix}.`)) add('L1b', `keys of this catalog start with "${policy.keyPrefix}."`);
  const owner = (policy.reservedPrefixes ?? []).find((prefix) => key.startsWith(`${prefix}.`));
  if (owner) add('L1b', `"${owner}." is reserved for that package's catalog`);
}

function sentenceProblems(message, language, policy, add) {
  if (message.trim() === '') add('L11', 'empty message');
  if (JOINER_EDGE.test(message)) add('L11', 'starts/ends with space or joiner: fragment of a glued sentence?');
  if (/ {2}/.test(message)) add('L11', 'double space');
  if (language === policy.sourceLanguage && CASED_SCRIPTS.has(scriptOf(language)) && /^\p{Ll}/u.test(message)) add('L11', 'source message starts lowercase: fragment?');
}

/** Problems for one message: [{ id, message }]. policy: { sourceLanguage, untranslatedPrefixes, keyPrefix, reservedPrefixes }. */
export function lintMessage({ language, key, message, policy }) {
  const problems = [];
  const add = (id, text) => problems.push({ id, message: text });
  keyProblems(key, policy, add);
  if (typeof message !== 'string') {
    add('F1', 'value is not a string');
    return problems;
  }
  sentenceProblems(message, language, policy, add);
  let elements;
  try {
    elements = parseIcu(message, { requiresOtherClause: true });
  } catch (error) {
    if (!(error instanceof IcuSyntaxError)) throw error;
    add('L2', `ICU syntax error: ${error.message}`);
    return problems;
  }
  if (SYSTEM_TEXT_KEY.test(key) && /[{}]/.test(message)) add('L13', 'is a system dialog text (InfoPlist.strings) but holds an ICU argument or brace');
  // Untranslated keys keep the source text, so the script rules of this language do not apply.
  const keepsSource = isUntranslated(key, policy);
  const scripts = {
    persianLetters: !keepsSource && PERSIAN_LETTER_LANGUAGES.includes(language.split('-')[0]),
    arabicScript: !keepsSource && scriptOf(language) === 'Arab',
  };
  const countsPlural = countNeedsPlural(language, policy);
  walkIcu(elements, (el, next) => {
    if (el.type === 'date' || el.type === 'time') add('L3', 'no {x, date}/{x, time}: format dates in src/i18n/format-date.ts');
    if (el.type === 'tag') add('L3', 'no rich-text tags in messages');
    placeholderProblems(el, add);
    if (el.type === 'plural') pluralProblems(el, language, add);
    // A styled number (percent, currency, unit) is not a count; a plain one followed by a word is.
    if (countsPlural && el.type === 'number' && el.style === null && next?.type === 'literal' && /^\s+\p{L}/u.test(next.value)) {
      add('L6', `{${el.value}, number} is followed by a word: use {${el.value}, plural, one {…} other {…}}`);
    }
    if (el.type === 'literal') literalProblems(el.value, scripts, add);
  });
  if (elements.length === 1 && !['literal', 'plural', 'select'].includes(elements[0].type)) {
    add('L11', 'message is a bare placeholder: put the whole sentence in the catalog');
  }
  return problems;
}

function tryParse(message) {
  try {
    return parseIcu(message, { requiresOtherClause: true });
  } catch {
    return null;
  }
}

function describeVars(vars) {
  return [...vars].map(([name, kinds]) => `${name}:${[...kinds].join('|')}`).sort().join(', ') || '(none)';
}

/** P5: an untranslated key must hold exactly the source text. Returns null or one problem. */
export function untranslatedProblem(key, sourceMessage, message, language, policy) {
  if (!isUntranslated(key, policy) || language === policy.sourceLanguage || message === sourceMessage) return null;
  return { id: 'P5', message: `keeps the source text in every language (untranslatedPrefixes), but ${language} says ${JSON.stringify(message)} where ${policy.sourceLanguage} says ${JSON.stringify(sourceMessage)}` };
}

/** P3 and P4 for one key between the source message and a translation: [{ id, message }]. */
export function parityProblems(sourceMessage, message, sourceLanguage) {
  const source = tryParse(sourceMessage);
  const target = tryParse(message);
  if (!source || !target) return [];
  const problems = [];
  const a = collectVariables(source);
  const b = collectVariables(target);
  const same = a.size === b.size && [...a].every(([name, kinds]) => b.has(name) && [...kinds].sort().join() === [...b.get(name)].sort().join());
  if (!same) problems.push({ id: 'P3', message: `placeholders differ from ${sourceLanguage}: ${sourceLanguage} has ${describeVars(a)}; this has ${describeVars(b)}` });
  const ea = exactSelectors(source);
  const eb = exactSelectors(target);
  for (const name of new Set([...ea.keys(), ...eb.keys()])) {
    const left = [...(ea.get(name) ?? [])].sort().join(' ');
    const right = [...(eb.get(name) ?? [])].sort().join(' ');
    if (left !== right) problems.push({ id: 'P4', message: `plural {${name}} has exact branches [${right || 'none'}] but ${sourceLanguage} has [${left || 'none'}]` });
  }
  return problems;
}

/** 1-based line of a key in a JSON file's text (first occurrence), or 1. */
export function lineOfKey(text, key) {
  const needle = `${JSON.stringify(key)}:`;
  const index = text.indexOf(needle);
  if (index === -1) {
    const loose = text.indexOf(JSON.stringify(key));
    return loose === -1 ? 1 : text.slice(0, loose).split('\n').length;
  }
  return text.slice(0, index).split('\n').length;
}
