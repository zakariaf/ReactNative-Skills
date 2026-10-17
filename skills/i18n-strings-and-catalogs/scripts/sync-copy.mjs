#!/usr/bin/env node
// sync-copy.mjs: the bridge between an approved copy source (contracts/copy-source.json: every text
// design or marketing signed off, in every language) and the app's catalogs.
//   keys   look up copy texts (by screen, prefix, key or all)
//   apply  write copy texts into the catalogs, keys sorted, never clobbering a different text
//   check  prove the catalogs still say exactly what the copy source says
// Run: node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs <keys|apply|check> [repo-root] [options]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createReporter, fail, parseArgs, run } from './check-lib.mjs';
import { isUntranslated, lineOfKey, untranslatedProblem } from './lib/catalog-rules.mjs';
import { catalogFolders, noLanguagesFix, readContract, readLanguages, resolveAppLayout } from './lib/i18n-config.mjs';

const SPEC = {
  name: 'sync-copy',
  summary: 'Looks up, applies and checks the approved copy (contracts/copy-source.json) against the catalogs, so approved texts are copied byte for byte, never retyped.',
  usage: '<keys|apply|check> [repo-root] [--screen id]... [--prefix text]... [--key key]... [--all] [options]',
  options: {
    screen: { type: 'string', multiple: true, value: 'id', help: 'Select the keys a screen of the copy source lists' },
    prefix: { type: 'string', multiple: true, value: 'text', help: 'Select copy keys starting with this text' },
    key: { type: 'string', multiple: true, value: 'key', help: 'Select one copy key' },
    all: { type: 'boolean', help: 'Select every key of the copy source' },
    overwrite: { type: 'boolean', help: 'apply: replace catalog texts that differ from the copy source' },
    lang: { type: 'string', default: 'source', value: 'list', help: 'keys: languages to print, comma-separated, "source" (default) or "all"' },
    source: { type: 'string', value: 'file', help: 'The copy source (default: contracts/copy-source.json, or rn-skills.config.json "copySource")' },
    'i18n-dir': { type: 'string', value: 'dir', help: 'The i18n folder (default: src/i18n)' },
    'app-dir': { type: 'string', value: 'dir', help: 'When multi-package: the Expo app\'s folder (e.g. apps/mobile), whose src/i18n holds the catalogs' },
    contract: { type: 'string', value: 'file', help: 'The i18n contract (default: contracts/i18n.json; optional)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 1, max: 2 },
  details: [
    'Commands:',
    '  keys   print the selected keys and their texts (exit 0)',
    '  apply  add the selected texts to every catalog, keys sorted; a catalog text that differs from the',
    '         copy source is reported (copy-conflict, exit 1) and kept unless --overwrite',
    '  check  copy-drift: a catalog text differs from the copy source (the first differing code point is',
    '         named: apostrophes, dashes and ZWNJ look alike); copy-key-missing: a selected key is absent;',
    '         retired-key: a key the copy source retired is still in a catalog; untranslated-prefix: a copy',
    '         row under an untranslatedPrefixes entry (contracts/i18n.json) differs from its source text',
    '',
    'contracts/copy-source.json: { "screens": { "<id>": ["<key>", ...] }, "strings": { "<key>": { "<lang>": "<ICU>" } },',
    '"retired": { "<key>": "<why>" } }; every row has every language of src/i18n/languages.ts.',
    '',
    'Examples:',
    '  node sync-copy.mjs keys . --screen tasks --lang all',
    '  node sync-copy.mjs apply . --all',
    '  node sync-copy.mjs check . --screen tasks',
  ].join('\n'),
};

function loadSource(root, file, languages) {
  if (!existsSync(join(root, file))) fail(`no copy source: ${file} does not exist`, 'Create contracts/copy-source.json (see the skill\'s examples/copy-source.json), or pass --source <file>.');
  let data;
  try {
    data = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`, 'Fix the JSON.');
  }
  if (typeof data?.strings !== 'object' || data.strings === null) fail(`${file} has no "strings" object`, 'Write "strings": { "<key>": { "<lang>": "<text>" } }.');
  for (const [key, row] of Object.entries(data.strings)) {
    const missing = languages.filter((language) => typeof row?.[language] !== 'string');
    if (missing.length > 0) fail(`${file}: ${key} has no ${missing.join(', ')} text`, 'Every copy row carries every language in LANGUAGES; ask for the missing texts before applying.');
  }
  return { file, text: readFileSync(join(root, file), 'utf8'), strings: data.strings, screens: data.screens ?? {}, retired: data.retired ?? {} };
}

function select(source, options) {
  const chosen = new Map();
  const add = (key, why) => {
    if (!Object.hasOwn(source.strings, key)) fail(`"${key}" (${why}) is not in ${source.file}`, 'Check the spelling: node sync-copy.mjs keys . --all');
    if (!chosen.has(key)) chosen.set(key, why);
  };
  for (const id of options.screen) {
    if (!Array.isArray(source.screens[id])) fail(`unknown screen "${id}"`, `Use one of: ${Object.keys(source.screens).join(', ') || '(the copy source lists no screens)'}.`);
    for (const key of source.screens[id]) add(key, `screen ${id}`);
  }
  for (const prefix of options.prefix) {
    const keys = Object.keys(source.strings).filter((key) => key.startsWith(prefix));
    if (keys.length === 0) fail(`no copy key starts with "${prefix}"`, 'Run: node sync-copy.mjs keys . --all');
    keys.forEach((key) => add(key, `prefix ${prefix}`));
  }
  options.key.forEach((key) => add(key, 'key'));
  if (options.all) Object.keys(source.strings).forEach((key) => add(key, 'all'));
  return chosen;
}

const codePoint = (char) => (char === undefined ? 'end of text' : `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);

/** Names the first differing character by code point: ZWNJ, dashes and apostrophes look alike. */
function firstDifference(actual, expected) {
  if (typeof actual !== 'string') return '';
  const a = [...actual];
  const b = [...expected];
  const at = a.findIndex((char, index) => char !== b[index]);
  const index = at === -1 ? a.length : at;
  return ` (first difference at character ${index + 1}: catalog ${codePoint(a[index])}, copy source ${codePoint(b[index])})`;
}

function folderFor(key, folders) {
  return folders.find((folder) => folder.keyPrefix && key.startsWith(`${folder.keyPrefix}.`)) ?? folders.find((folder) => folder.isMain);
}

function readCatalog(root, file) {
  if (!existsSync(join(root, file))) return { exists: false, data: {}, text: '' };
  const text = readFileSync(join(root, file), 'utf8');
  try {
    return { exists: true, data: JSON.parse(text), text };
  } catch (error) {
    return fail(`${file} is not valid JSON: ${error.message}`, 'Fix the JSON first (check-catalogs.mjs names the problem).');
  }
}

function writeCatalog(root, file, data) {
  const sorted = Object.fromEntries(Object.keys(data).sort().map((key) => [key, data[key]]));
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), `${JSON.stringify(sorted, null, 2)}\n`);
}

function printKeys(source, chosen, options, languages) {
  const wanted = options.lang === 'all' ? languages.languages : options.lang === 'source' ? [languages.sourceLanguage] : options.lang.split(',').map((l) => l.trim());
  for (const language of wanted) if (!languages.languages.includes(language)) fail(`unknown language "${language}"`, `Use ${languages.languages.join(', ')}, source or all.`);
  for (const key of chosen.keys()) {
    console.log(key);
    for (const language of wanted) console.log(`  ${language.padEnd(5)} ${source.strings[key][language]}`);
  }
}

function applyKeys(ctx, chosen, overwrite) {
  const { root, source, folders, languages, report } = ctx;
  let added = 0;
  let replaced = 0;
  for (const folder of folders) {
    const keys = [...chosen.keys()].filter((key) => folderFor(key, folders) === folder);
    if (keys.length === 0) continue;
    for (const language of languages.languages) {
      const file = `${folder.dir}/${language}.json`;
      const catalog = readCatalog(root, file);
      const data = { ...catalog.data };
      for (const key of keys) {
        const text = source.strings[key][language];
        if (!Object.hasOwn(data, key)) {
          data[key] = text;
          added += 1;
        } else if (data[key] !== text && overwrite) {
          data[key] = text;
          replaced += 1;
        } else if (data[key] !== text) {
          report.problem({ file, line: lineOfKey(catalog.text, key), rule: 'copy-conflict', message: `${key}: catalog says ${JSON.stringify(data[key])}, the copy source says ${JSON.stringify(text)}${firstDifference(data[key], text)}`, fix: 'Keep the approved text (rerun with --overwrite) unless the change was approved; then change the copy source first.' });
        }
      }
      writeCatalog(root, file, data);
    }
  }
  console.log(`sync-copy apply: ${added} texts added, ${replaced} replaced`);
}

function checkSourceRows(ctx) {
  const { source, languages, policy, report } = ctx;
  for (const [key, row] of Object.entries(source.strings)) {
    if (!isUntranslated(key, policy)) continue;
    for (const language of languages.languages) {
      const problem = untranslatedProblem(key, row[languages.sourceLanguage], row[language], language, policy);
      if (problem) report.problem({ file: source.file, line: lineOfKey(source.text, key), rule: 'untranslated-prefix', message: `${key}: ${problem.message}`, fix: 'Write the source text in every language of an untranslated key, in the copy source first, then apply.' });
    }
  }
}

function checkCatalogs(ctx, chosen) {
  const { root, source, folders, languages, report } = ctx;
  let compared = 0;
  for (const language of languages.languages) {
    for (const folder of folders) {
      const file = `${folder.dir}/${language}.json`;
      const catalog = readCatalog(root, file);
      for (const [key, row] of Object.entries(source.strings).filter(([k]) => folderFor(k, folders) === folder)) {
        if (!Object.hasOwn(catalog.data, key)) {
          if (chosen.has(key)) report.problem({ file, line: 1, rule: 'copy-key-missing', message: `${key}: the approved copy has this text (${chosen.get(key)}) but the catalog lacks it`, fix: `Run: node sync-copy.mjs apply . --key ${key} (it writes every language).` });
          continue;
        }
        compared += 1;
        if (catalog.data[key] !== row[language]) {
          report.problem({ file, line: lineOfKey(catalog.text, key), rule: 'copy-drift', message: `${key}: catalog says ${JSON.stringify(catalog.data[key])}, the copy source says ${JSON.stringify(row[language])}${firstDifference(catalog.data[key], row[language])}`, fix: 'Restore the approved text (sync-copy.mjs apply --overwrite). An approved wording change goes into the copy source first, then into the catalogs.' });
        }
      }
      for (const [key, why] of Object.entries(source.retired).filter(([k]) => Object.hasOwn(catalog.data, k))) {
        report.problem({ file, line: lineOfKey(catalog.text, key), rule: 'retired-key', message: `${key} is retired by the copy source: ${why}`, fix: `Delete ${key} from every catalog and the code that shows it.` });
      }
    }
  }
  return compared;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const [command, rootArg = '.'] = positionals;
  if (!['keys', 'apply', 'check'].includes(command)) fail(`unknown command "${command}"`, 'Run: node sync-copy.mjs keys|apply|check --help');
  if (!existsSync(rootArg)) fail(`nothing to check: ${rootArg} does not exist`, 'Pass the app repo root.');
  const root = rootArg;
  const layout = resolveAppLayout(root, { appDir: options['app-dir'], i18nDir: options['i18n-dir'] });
  const languages = readLanguages(root, layout, {});
  if (languages === null) fail(`nothing to check: no language list (${layout.i18nDir}/languages.ts does not exist)`, noLanguagesFix(layout));
  const contract = readContract(root, layout, { contract: options.contract });
  const named = options.source ?? layout.config.copySource;
  const sourceFile = named ?? `${layout.contractsDir}/copy-source.json`;
  // A copy source is opt-in (approved copy owned by design or marketing). Without one, check has
  // nothing to compare: a repo fact, not bad input. A source the caller names must exist.
  if (command === 'check' && named === undefined && !existsSync(join(root, sourceFile))) {
    return createReporter({ name: 'sync-copy check', json: options.json }).notApplicable(`${sourceFile} does not exist: the app keeps no approved copy source, so its texts live only in the catalogs`);
  }
  const source = loadSource(root, sourceFile, languages.languages);
  const chosen = select(source, options);
  const report = createReporter({ name: `sync-copy ${command}`, json: options.json });
  const policy = { sourceLanguage: languages.sourceLanguage, untranslatedPrefixes: contract.untranslatedPrefixes };
  const ctx = { root, source, folders: catalogFolders(layout, contract), languages, policy, report };
  if (command === 'keys') {
    if (chosen.size === 0) fail('keys needs a selection', 'Pass --screen <id>, --prefix <text>, --key <key> or --all.');
    printKeys(source, chosen, options, languages);
    return report.finish({ checked: chosen.size, unit: 'copy keys' });
  }
  if (command === 'apply') {
    if (chosen.size === 0) fail('apply needs a selection', 'Pass --all, --screen <id>, --prefix <text> or --key <key>.');
    applyKeys(ctx, chosen, options.overwrite);
    return report.finish({ checked: chosen.size, unit: 'copy keys' });
  }
  checkSourceRows(ctx);
  const compared = checkCatalogs(ctx, chosen);
  return report.finish({ checked: compared, unit: 'catalog texts' });
});
