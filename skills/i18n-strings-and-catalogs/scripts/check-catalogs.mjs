#!/usr/bin/env node
// check-catalogs.mjs: lints every message catalog of the app (src/i18n/catalogs/<lang>.json, and
// the package catalogs contracts/i18n.json declares) with rules L1-L13, and checks every language
// against the source language: missing and extra keys, placeholders, =N branches, and the keys that
// stay untranslated on purpose.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-catalogs.mjs [repo-root] [options]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, parseArgs, run } from './check-lib.mjs';
import { lineOfKey, lintMessage, parityProblems, RULES, ruleLabel, untranslatedProblem } from './lib/catalog-rules.mjs';
import { catalogFolders, noLanguagesFix, readContract, readLanguages, resolveAppLayout } from './lib/i18n-config.mjs';

const RULE_SUMMARIES = {
  L1: '2-5 lowercase kebab-case segments',
  L1b: 'package catalogs: keys start with the keyPrefix; app keys never use one',
  L2: 'parses as ICU with an other clause',
  L3: 'no {x, date}, {x, time} or rich-text tags',
  L4: 'camelCase placeholders; plain {x} only for *Name/*Text',
  L5: 'plurals carry exactly the CLDR categories of their language; no offset',
  L6: 'source language with plural forms and spaces between words (en, de, ar; not ja, zh): a plain number followed by a word must be a plural',
  L7: 'no literal digits in any script',
  L8: 'no bidi controls or ALM',
  L9: 'fa, ckb, ur: ی/ک, never Arabic ي/ك',
  L10: 'Arabic-script languages: ، ؛ ؟ instead of , ; ?',
  L11: 'one whole sentence (no edge joiner, double space, bare placeholder)',
  L12: 'keys sorted',
  L13: '*.usage-description texts are plain text (no ICU)',
  P1: 'every source key exists in every language',
  P2: 'no key the source lacks',
  P3: 'same placeholders and types as the source',
  P4: 'same =N plural branches as the source',
  P5: 'untranslatedPrefixes keys equal the source text',
  F1: 'one flat JSON object of strings per language and folder, named <tag>.json exactly as LANGUAGES spells the tag, every tag in BCP 47 canonical casing (pt-BR, zh-Hant), and no file for a language outside LANGUAGES',
};

const SPEC = {
  name: 'check-catalogs',
  summary: 'Checks the message catalogs (src/i18n/catalogs/<lang>.json for every language in src/i18n/languages.ts, plus the package catalogs of contracts/i18n.json): key shape and namespace, ICU syntax, placeholders, CLDR plural categories per language, digits, bidi controls, Arabic-script letters and punctuation, whole sentences, sorting, plain system texts, and parity of every language with the source language.',
  usage: '[repo-root] [options]',
  options: {
    'i18n-dir': { type: 'string', value: 'dir', help: 'The i18n folder (default: src/i18n from resolveLayout / rn-skills.config.json "i18nDir")' },
    'app-dir': { type: 'string', value: 'dir', help: 'When multi-package: the Expo app\'s folder (e.g. apps/mobile); its src/i18n is checked' },
    languages: { type: 'string', value: 'list', help: 'The languages, source first (default: LANGUAGES and SOURCE_LANGUAGE in <i18n-dir>/languages.ts)' },
    contract: { type: 'string', value: 'file', help: 'The i18n contract (default: contracts/i18n.json; optional)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (the same ids as the project linter behind npm run i18n:verify):',
    ...Object.entries(RULES).map(([id, [name]]) => `  ${`${id} ${name}`.padEnd(26)}${RULE_SUMMARIES[id] ?? ''}`),
    '',
    'Plural categories and scripts come from Node\'s ICU (Intl.PluralRules, Intl.Locale), so any',
    'language the app adds is checked with its own CLDR rules.',
    '',
    'Example: node check-catalogs.mjs .',
  ].join('\n'),
};

/** A tag in BCP 47 canonical casing: language lower, Script title, REGION upper, the rest lower (pt-BR, zh-Hant, es-419). */
export function canonicalCasing(tag) {
  return tag
    .split('-')
    .map((subtag, index) => {
      if (index === 0) return subtag.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(subtag)) return subtag[0].toUpperCase() + subtag.slice(1).toLowerCase();
      return /^([A-Za-z]{2}|\d{3})$/.test(subtag) ? subtag.toUpperCase() : subtag.toLowerCase();
    })
    .join('-');
}

/** LANGUAGES entries not in canonical casing: the catalog file, digits row and polyfill imports follow that spelling. */
function checkLanguageCasing(root, languages, report) {
  const text = languages.file ? readFileSync(join(root, languages.file), 'utf8') : '';
  for (const language of languages.languages.filter((code) => canonicalCasing(code) !== code)) {
    const want = canonicalCasing(language);
    const at = Math.max(text.search(new RegExp(`(['"])${language}\\1`)), 0);
    report.problem({ file: languages.file ?? '--languages', line: text.slice(0, at).split('\n').length, rule: ruleLabel('F1'), message: `"${language}" in LANGUAGES is not in BCP 47 canonical casing: the tag is "${want}"`, fix: `Write "${want}" in LANGUAGES and everywhere the tag is a key or a name: catalogs/${want}.json, digits.ts, messages.ts, the autonyms, the polyfill imports (naming-conventions names catalogs the same way).` });
  }
}

/** The name a folder really has for a file, matched without case (the file system may ignore case), or null. */
function actualName(root, dir, name) {
  if (!existsSync(join(root, dir))) return null;
  const names = readdirSync(join(root, dir));
  return names.includes(name) ? name : (names.find((entry) => entry.toLowerCase() === name.toLowerCase()) ?? null);
}

function readCatalog(root, file, report) {
  const problem = (message) => report.problem({ file, line: 1, rule: ruleLabel('F1'), message, fix: RULES.F1[1] });
  const dir = file.split('/').slice(0, -1).join('/');
  const name = file.split('/').at(-1);
  const actual = actualName(root, dir, name);
  if (actual === null) {
    problem(`${name} is missing`);
    return null;
  }
  if (actual !== name) {
    report.problem({ file: `${dir}/${actual}`, line: 1, rule: ruleLabel('F1'), message: `the catalog is named ${actual}, but LANGUAGES spells the tag ${name.replace(/\.json$/, '')}: Linux CI and EAS Build cannot find ${name} (a case-insensitive Mac can)`, fix: `Rename it to ${name} (on macOS in two steps: git mv ${actual} tmp.json && git mv tmp.json ${name}).` });
    file = `${dir}/${actual}`;
  }
  const text = readFileSync(join(root, file), 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    problem(`not valid JSON: ${error.message}`);
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    problem('not a flat JSON object');
    return null;
  }
  return { file, text, data };
}

/** A `<lang>.json` in a catalog folder for a language LANGUAGES does not list: nobody loads it. */
function checkOrphans(root, folder, languages, report) {
  if (!existsSync(join(root, folder.dir))) return;
  for (const name of readdirSync(join(root, folder.dir)).sort()) {
    const language = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.json$/i.exec(name)?.[1];
    // A name that differs from a language only by case is that language's catalog (readCatalog reports the casing).
    if (!language || languages.languages.some((code) => code.toLowerCase() === language.toLowerCase())) continue;
    report.problem({ file: `${folder.dir}/${name}`, line: 1, rule: ruleLabel('F1'), message: `${name} is not in LANGUAGES (${languages.languages.join(', ')}): a catalog nobody loads, still read by reviewers and tools`, fix: `Add "${language}" to LANGUAGES in ${languages.file ?? 'src/i18n/languages.ts'} (with its polyfill data, digits row and messages entry), or delete ${folder.dir}/${name}.` });
  }
}

function lintCatalog(catalog, language, policy, report) {
  const { file, text, data } = catalog;
  const keys = Object.keys(data);
  const sorted = [...keys].sort();
  const firstUnsorted = keys.findIndex((key, index) => key !== sorted[index]);
  if (firstUnsorted !== -1) {
    report.problem({ file, line: lineOfKey(text, keys[firstUnsorted]), rule: ruleLabel('L12'), message: `keys are not sorted (first out of place: "${keys[firstUnsorted]}")`, fix: RULES.L12[1] });
  }
  for (const [key, message] of Object.entries(data)) {
    for (const problem of lintMessage({ language, key, message, policy })) {
      report.problem({ file, line: lineOfKey(text, key), rule: ruleLabel(problem.id), message: `${key}: ${problem.message}`, fix: RULES[problem.id][1] });
    }
  }
}

function checkParity(source, target, language, policy, report) {
  const at = (key) => lineOfKey(target.text, key);
  for (const key of Object.keys(source.data)) {
    if (!Object.hasOwn(target.data, key)) {
      report.problem({ file: target.file, line: 1, rule: ruleLabel('P1'), message: `${key}: missing in ${language} (present in ${policy.sourceLanguage})`, fix: RULES.P1[1] });
      continue;
    }
    if (typeof source.data[key] !== 'string' || typeof target.data[key] !== 'string') continue;
    const untranslated = untranslatedProblem(key, source.data[key], target.data[key], language, policy);
    if (untranslated) report.problem({ file: target.file, line: at(key), rule: ruleLabel('P5'), message: `${key}: ${untranslated.message}`, fix: RULES.P5[1] });
    for (const problem of parityProblems(source.data[key], target.data[key], policy.sourceLanguage)) {
      report.problem({ file: target.file, line: at(key), rule: ruleLabel(problem.id), message: `${key}: ${problem.message}`, fix: RULES[problem.id][1] });
    }
  }
  for (const key of Object.keys(target.data).filter((k) => !Object.hasOwn(source.data, k))) {
    report.problem({ file: target.file, line: at(key), rule: ruleLabel('P2'), message: `${key}: not in ${policy.sourceLanguage}.json`, fix: RULES.P2[1] });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(root)) fail(`nothing to check: ${root} does not exist`, 'Pass the app repo root.');
  const layout = resolveAppLayout(root, { appDir: options['app-dir'], i18nDir: options['i18n-dir'] });
  const languages = readLanguages(root, layout, { languages: options.languages });
  if (languages === null) fail(`nothing to check: no language list (${layout.i18nDir}/languages.ts does not exist)`, noLanguagesFix(layout));
  const contract = readContract(root, layout, { contract: options.contract });
  const folders = catalogFolders(layout, contract);
  if (!folders.some((folder) => existsSync(join(root, folder.dir)))) {
    fail(`nothing to check: no catalog folder (looked for ${folders.map((folder) => folder.dir).join(', ')})`, `Create ${layout.i18nDir}/catalogs/<lang>.json for every language, or pass the repo root.`);
  }
  const report = createReporter({ name: 'check-catalogs', json: options.json });
  checkLanguageCasing(root, languages, report);
  const { sourceLanguage } = languages;
  let checked = 0;
  for (const folder of folders) {
    const policy = { sourceLanguage, untranslatedPrefixes: contract.untranslatedPrefixes, keyPrefix: folder.keyPrefix, reservedPrefixes: folder.reservedPrefixes };
    checkOrphans(root, folder, languages, report);
    const catalogs = {};
    for (const language of languages.languages) {
      const catalog = readCatalog(root, `${folder.dir}/${language}.json`, report);
      if (!catalog) continue;
      catalogs[language] = catalog;
      checked += 1;
      lintCatalog(catalog, language, policy, report);
    }
    const source = catalogs[sourceLanguage];
    if (!source) continue;
    for (const language of languages.languages.filter((l) => l !== sourceLanguage && catalogs[l])) {
      checkParity(source, catalogs[language], language, policy, report);
    }
  }
  return report.finish({ checked, unit: 'catalog files' });
});
