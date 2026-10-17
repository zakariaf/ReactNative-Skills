#!/usr/bin/env node
// list-screen.mjs: prints one screen's build contract from contracts/screens.json (every testID with its
// role, component, copy key and text in a chosen language, its states, who draws it and its screenshot
// reach, the route, model, view and test files, the reference images), and validates the contract:
// its format, its copy keys against the source catalog, its reference images.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/list-screen.mjs . --screen <id> | --all

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createReporter, fail, notYetCreated, parseArgs, requireDir, run } from './check-lib.mjs';
import { catalogText, derivationOf, loadContract } from './lib/screen-contract.mjs';

const SPEC = {
  name: 'list-screen',
  summary:
    'Prints the build contract of one screen from contracts/screens.json (testIDs, roles, components, copy keys ' +
    'with their text, states, derived parts, screenshot reach, files, reference images) and validates the contract.',
  usage: '[repo-root] (--screen <id> | --all) [options]',
  options: {
    screen: { type: 'string', value: 'id', help: 'The screen to print (its id or one of its scopes)' },
    all: { type: 'boolean', help: 'Validate every screen and print one summary line each' },
    lang: { type: 'string', value: 'code', help: 'Language of the text column (default: the source language)' },
    contract: { type: 'string', value: 'file', help: 'The contract (default: rn-skills.config.json "screensContract", else <contractsDir>/screens.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  contract-invalid         the contract breaks its format (references/contract-format.md)',
    '  retired-copy-key         an element still shows a key listed in policies.retiredKeys',
    '  unknown-copy-key         an element\'s text or a11yLabel key is not in the source-language catalog',
    '  reference-image-missing  a state names a reference image the references folder does not hold',
    '',
    'Without a contract there is nothing to print or validate: --all and --screen both exit 2 (the',
    'definition-of-done gate check-screens --all is the one that fails contract-missing). A missing',
    'source catalog prints a SKIP for unknown-copy-key (i18n-strings-and-catalogs creates it).',
    '',
    'Examples:',
    '  node list-screen.mjs . --screen lists          every testID, part and copy key of Lists',
    '  node list-screen.mjs . --screen lists --lang ar',
    '  node list-screen.mjs . --all                   validate the whole contract',
  ].join('\n'),
};

function reachOf(element) {
  if (element.parent !== undefined || element.a11yHidden === true) {
    return `crop-only in ${element.coveredBy ?? element.parent ?? '(its cover)'}${element.a11yHidden ? ' (hidden from screen readers)' : ''}`;
  }
  return Array.isArray(element.checks) && element.checks.length > 0 ? element.checks.join('+') : 'bounds';
}

function printScreen(contract, screen, texts) {
  console.log(`${screen.id} ${screen.name ?? ''}  presentation: ${screen.presentation}`);
  console.log(`route: ${screen.route ?? '(none)'}  model: ${screen.model ?? '(none)'}  view: ${screen.view}  test: ${screen.test ?? '(none)'}`);
  console.log(`code: ${screen.code.join(', ')}  scopes: ${screen.scopes.join(', ')}`);
  const states = screen.states.map((state) => `${state.id}${state.drawn === false ? ' (not drawn: Chosen)' : ''}${state.reference ? ` -> ${contract.referencesDir}/${state.reference}` : ''}`);
  console.log(`states: ${states.join('; ')}`);
  if (screen.notes) console.log(`notes: ${screen.notes}`);
  console.log('');
  console.log('testID | role | component | copy key | text | states | set by | reach');
  for (const element of screen.elements) {
    const derived = derivationOf(contract, screen, element.canon);
    const setBy = derived === null ? 'this screen' : `${derived.component} from ${derived.parent.testID}${derived.keyed ? ' (keyed by data)' : ''}`;
    const key = [element.text, element.a11yLabel ? `a11y ${element.a11yLabel}` : null].filter(Boolean).join(' ');
    const text = element.text ? JSON.stringify(catalogText(texts, element.text) ?? '(missing)') : '';
    const note = element.note ? ` | note: ${element.note}` : '';
    console.log(`${element.testID} | ${element.role ?? ''} | ${element.component ?? ''}${element.kind ? ` (${element.kind})` : ''} | ${key} | ${text} | ${(element.states ?? ['all']).join(',')}${element.requires ? ` requires ${element.requires}` : ''} | ${setBy} | ${reachOf(element)}${note}`);
  }
  console.log('');
}

function validate(root, contract, screens, report) {
  for (const problem of contract.problems) report.problem({ file: contract.rel, line: problem.line, rule: 'contract-invalid', message: problem.message, fix: problem.fix });
  const skip = contract.catalog === null ? notYetCreated(root, { file: contract.catalogRel, owner: 'i18n-strings-and-catalogs' }) : null;
  if (skip !== null) report.skip({ file: contract.catalogRel, rule: 'unknown-copy-key', message: skip });
  for (const screen of screens) {
    for (const element of screen.elements) {
      for (const key of [element.text, element.a11yLabel]) {
        if (typeof key !== 'string') continue;
        if (Object.hasOwn(contract.policies.retiredKeys, key)) {
          report.problem({ file: contract.rel, line: element.line, rule: 'retired-copy-key', message: `${screen.id} ${element.testID} still shows the retired key "${key}"`, fix: `Use ${contract.policies.retiredKeys[key]} in the contract and the code.` });
          continue;
        }
        if (contract.catalog === null || catalogText(contract.catalog, key) !== null) continue;
        report.problem({ file: contract.rel, line: element.line, rule: 'unknown-copy-key', message: `${screen.id} ${element.testID} shows "${key}", which ${contract.catalogRel} does not have`, fix: 'Add the text to the source catalog first (then every language, i18n-strings-and-catalogs), or fix the key.' });
      }
    }
    for (const state of screen.states) {
      if (typeof state.reference !== 'string') continue;
      const image = `${contract.referencesDir}/${state.reference}`;
      if (!existsSync(join(root, image))) report.problem({ file: contract.rel, rule: 'reference-image-missing', message: `${screen.id} state "${state.id}" names ${image}, which does not exist`, fix: 'Export the approved design frame there (1 pt = 1 px, light theme, the source language), or fix the name.' });
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (!options.all && options.screen === undefined) fail('name a screen (--screen lists) or pass --all', 'Run: node list-screen.mjs . --screen <id>   or   node list-screen.mjs . --all');
  const root = requireDir(resolve(positionals[0] ?? '.'), 'app root');
  const contract = loadContract(root, { contract: options.contract });
  const report = createReporter({ name: 'list-screen', json: options.json });
  if (contract.missing) fail(`nothing to check: ${contract.rel} does not exist`, 'Copy the skill\'s templates/contracts/screens.json into the app and describe its screens.');
  const all = [...contract.screens.values()];
  const screens = options.all
    ? all
    : [all.find((screen) => screen.id === options.screen || screen.scopes.includes(options.screen)) ?? fail(`unknown screen "${options.screen}"`, `Use a screen id from ${contract.rel}: ${all.map((screen) => screen.id).join(', ')}.`)];
  let texts = contract.catalog;
  if (options.lang !== undefined) {
    const file = join(root, contract.layout.i18nDir, 'catalogs', `${options.lang}.json`);
    if (!existsSync(file)) fail(`no catalog for "${options.lang}" at ${contract.layout.i18nDir}/catalogs/${options.lang}.json`, 'Pass one of the app\'s languages (src/i18n/languages.ts).');
    texts = JSON.parse(readFileSync(file, 'utf8'));
  }
  for (const screen of screens) {
    if (options.all) console.log(`${screen.id} (${screen.presentation}): ${screen.elements.length} testIDs, ${screen.states.length} states`);
    else printScreen(contract, screen, texts);
  }
  validate(root, contract, screens, report);
  return report.finish({ checked: screens.length, unit: 'screens' });
});
