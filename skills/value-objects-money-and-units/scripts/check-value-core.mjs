#!/usr/bin/env node
// check-value-core.mjs: runs an Expo app's own value-object modules against the rules: the ISO 4217
// exponent table, unknown codes as failures, Money as safe integers, no arithmetic across currencies,
// allocation that never loses or invents a minor unit (pinned vectors plus 400 seeded cases), rates
// and conversions rounded once, exact money text, store prices, exact unit factors, and instants that
// refuse text without an offset. The modules are imported as pure TypeScript (Node type stripping), so
// a module that reaches React Native, Expo or Intl formatting cannot load.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-value-core.mjs [repo-root]

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, fail, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import { enableAppImports, lineOfExport, reasonOf } from './lib/app-modules.mjs';
import { MONEY_CHECKS } from './lib/value-core-checks.mjs';
import { EDGE_CHECKS } from './lib/value-edge-checks.mjs';

const SPEC = {
  name: 'check-value-core',
  summary: "Runs the app's money, units and instant modules against the value-object rules (ISO 4217 exponents, safe integers, one currency, exact allocation, rates rounded once, exact text, store prices, unit factors, instants with offsets).",
  usage: '[repo-root] [options]',
  options: {
    'money-dir': { type: 'string', value: 'dir', help: 'The money core folder (default: <coreDir>/money, e.g. src/core/money)' },
    'units-file': { type: 'string', value: 'file', help: 'The units module (default: <coreDir>/units/units.ts)' },
    'instant-file': { type: 'string', value: 'file', help: 'The instant module (default: <coreDir>/time/instant.ts)' },
    'iso-xml': { type: 'string', value: 'file', help: 'Compare the exponent table with a freshly downloaded ISO 4217 list one (XML) instead of the bundled copy' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: missing-module, module-load, exponent-table, unknown-currency, money-integer, cross-currency,',
    'allocate-vectors, allocate-conservation, allocate-refuses, apply-rate, convert-money, parse-money,',
    'store-price, units-exact, instant-parse.',
    '',
    'Modules (default path: exports read):',
    '  <money-dir>/currency.ts: parseCurrencyCode, exponentOf · currency-exponents.ts: CURRENCY_EXPONENTS',
    '  money.ts: money, addMoney, subtractMoney, sumMoney, compareMoney, equalsMoney · allocate.ts: allocateMinor',
    '  rate.ts: applyRate, parsePercent, convertMoney · money-text.ts: parseMoney, toDecimalString',
    '  store-price.ts (optional): moneyFromMicros, moneyFromStoreDouble',
    '  <units-file> (optional): LENGTH, MASS, VOLUME, quantityFromDecimal, quantityToDisplay',
    '  <instant-file> (optional): parseIsoInstant, toIsoInstant',
    'Once any money module exists, all six money modules are required. With none of money.ts, the units',
    'module and the instant module present, the check prints NOT APPLICABLE.',
    'The ISO 4217 table is the copy in the skill (assets/iso-4217.json, list one published 2026-09-17);',
    '--iso-xml <list-one.xml> re-verifies against a newer list from six-group.com.',
    'A root without a source folder is bad input (exit 2). When multi-package: run once per app.',
    'Example: node check-value-core.mjs .',
  ].join('\n'),
};

const MONEY_MODULES = { currency: 'currency.ts', exponents: 'currency-exponents.ts', money: 'money.ts', allocate: 'allocate.ts', rate: 'rate.ts', text: 'money-text.ts' };
const ASSET = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'iso-4217.json');

/** { code: exponent } from the bundled asset, or from a downloaded list-one XML. */
function readIsoTable(xmlPath) {
  if (xmlPath === undefined) return JSON.parse(readFileSync(ASSET, 'utf8')).exponents;
  if (!existsSync(xmlPath)) fail(`--iso-xml ${xmlPath} does not exist`, 'Download https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml and pass its path.');
  const table = {};
  for (const [, entry] of readFileSync(xmlPath, 'utf8').matchAll(/<CcyNtry>([\s\S]*?)<\/CcyNtry>/g)) {
    const code = /<Ccy>([A-Z]{3})<\/Ccy>/.exec(entry)?.[1];
    const units = /<CcyMnrUnts>(\d+)<\/CcyMnrUnts>/.exec(entry)?.[1];
    if (code !== undefined && units !== undefined) table[code] = Number(units);
  }
  if (Object.keys(table).length === 0) fail(`${xmlPath} holds no ISO 4217 entries`, 'Pass the list-one XML file (ISO_4217 > CcyTbl > CcyNtry).');
  return table;
}

/** The module paths this app must have: { key: rel }, plus the ones that exist but are optional. */
function planModules(root, layout, options) {
  const moneyDir = options['money-dir'] ?? posix.join(layout.coreDir, 'money');
  const optional = {
    store: posix.join(moneyDir, 'store-price.ts'),
    units: options['units-file'] ?? posix.join(layout.coreDir, 'units', 'units.ts'),
    instant: options['instant-file'] ?? posix.join(layout.coreDir, 'time', 'instant.ts'),
  };
  const money = Object.fromEntries(Object.entries(MONEY_MODULES).map(([key, file]) => [key, posix.join(moneyDir, file)]));
  const hasMoney = Object.values(money).some((rel) => existsSync(join(root, rel)));
  const present = Object.fromEntries(Object.entries(optional).filter(([, rel]) => existsSync(join(root, rel))));
  return { required: hasMoney ? money : {}, present: hasMoney ? present : { ...present, store: undefined }, looked: [money.money, optional.units, optional.instant] };
}

/** The failed assertion's label, with what was expected and what the module gave. */
function explain(error) {
  const label = reasonOf(error);
  if (error?.code !== 'ERR_ASSERTION' || error.generatedMessage === true || !('actual' in error) || typeof error.actual === 'boolean') return label;
  const short = (value) => {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  };
  return `${label} (expected ${short(error.expected)}, got ${short(error.actual)})`;
}

async function loadModules(root, layout, plan, report) {
  const app = enableAppImports(root, { aliases: layout.aliases });
  const loaded = {};
  const paths = { ...plan.required, ...Object.fromEntries(Object.entries(plan.present).filter(([, rel]) => rel !== undefined)) };
  for (const [key, rel] of Object.entries(paths)) {
    if (!existsSync(join(root, rel))) {
      report.problem({ file: rel, rule: 'missing-module', message: `the ${key} module is missing (the money core is all six modules)`, fix: `Copy templates/${rel.replace(/^.*?src\//, 'src/')} from this skill and its test.` });
      continue;
    }
    try {
      loaded[key] = await app.load(rel);
    } catch (error) {
      report.problem({ file: rel, line: 1, rule: 'module-load', message: `cannot be imported: ${reasonOf(error).replace(/ imported from \S+/, '')}`, fix: 'Keep the module pure TypeScript: other src/core modules only (no React, React Native, Expo, Intl formatting), no enums or namespaces.' });
    }
  }
  return { loaded, paths };
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  requireDir(join(root, layout.srcDir), `app source folder ${layout.srcDir}/`);
  const iso = readIsoTable(options['iso-xml']);
  const report = createReporter({ name: 'check-value-core', json: options.json });
  const plan = planModules(root, layout, options);
  if (Object.keys(plan.required).length === 0 && Object.values(plan.present).every((rel) => rel === undefined)) {
    return report.notApplicable(`no value-object core: none of ${plan.looked.join(', ')} exists`);
  }
  const { loaded, paths } = await loadModules(root, layout, plan, report);
  let checked = 0;
  for (const check of [...MONEY_CHECKS, ...EDGE_CHECKS]) {
    if (!check.needs.every((key) => loaded[key] !== undefined)) continue;
    checked += 1;
    try {
      check.run(loaded, assert, { iso });
    } catch (error) {
      const rel = paths[check.needs[check.needs.length - 1]];
      const line = lineOfExport(readFileSync(join(root, rel), 'utf8'), check.fn);
      report.problem({ file: rel, line, rule: check.rule, message: `${check.fn}: ${explain(error)}`, fix: check.fix });
    }
  }
  return report.finish({ checked, unit: 'checks' });
});
