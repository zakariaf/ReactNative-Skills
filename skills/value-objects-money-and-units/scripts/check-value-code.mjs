#!/usr/bin/env node
// check-value-code.mjs: scans an Expo app's source for values stored or computed in the wrong shape:
// money as a float, a major-unit number or a hard-coded "× 100"; money divided or multiplied by a
// float instead of allocate()/applyRate(); a Money's integer used in raw arithmetic; currency
// formatting outside src/i18n/ or without the ISO 4217 digits; a currency symbol glued to a number;
// formatting in pure core code; quantities and instants without their unit; SQL money and instant
// columns of the wrong type or name; and the money core missing or untested.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-value-code.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { findCalls, isTestFile, scanSource, typeRegionsOf } from './lib/source-scan.mjs';
import { columnsOf, holdsDdl, isIntegerType } from './lib/sql-columns.mjs';
import { isInstantName, isMinorUnitName, isMoneyChain, isMoneyName, lacksUnit, segmentsOf } from './lib/value-names.mjs';

const SPEC = {
  name: 'check-value-code',
  summary: 'Scans app source for money, quantities and instants stored or computed in the wrong shape (floats, hard-coded scales, raw arithmetic, formatting outside the edge, unit-less names, wrong SQL column types).',
  usage: '[repo-root] [options]',
  options: {
    'money-dir': { type: 'string', value: 'dir', help: 'The money core folder (default: <coreDir>/money, e.g. src/core/money)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: float-money, hard-coded-scale, exponent-default, money-division, money-float-rate,',
    'raw-minor-arithmetic, currency-format-edge, currency-fraction-digits, currency-symbol-literal,',
    'core-formats, unit-suffix, instant-type, money-column, instant-column, money-core, core-tests.',
    '',
    'Scope: every .ts/.tsx file under the source folder (src/), tests left out (core-tests reads them).',
    'The money core (src/core/money/) and src/core/decimal/ implement the arithmetic, so the money rules',
    'skip them; src/games/ holds game points, not money, so the money rules skip it too. unit-suffix and',
    'instant-type read type declarations in src/core, src/stores, src/data, src/services (and src/api for',
    'unit-suffix), where stored values are declared.',
    'A line (or the line above it) holding "// value-objects-allow <rule>: <why>" is exempt from that rule.',
    'A root without a source folder is bad input (exit 2).',
    'When multi-package: run once per app, with the app folder as the root.',
    'Example: node check-value-code.mjs .',
  ].join('\n'),
};

const FIX = {
  'float-money': 'Hold money as Money (src/core/money/money.ts) or as an integer named <what>Minor; parse text with parseMoney and store prices with moneyFromMicros / moneyFromStoreDouble; a schema field is v.pipe(v.number(), v.safeInteger()).',
  'hard-coded-scale': "Scale by the currency's ISO 4217 exponent: parseMoney / toDecimalString (src/core/money/money-text.ts), and format with formatMoney (src/i18n/format-money.ts), never * 100, / 100 or toFixed(2).",
  'exponent-default': 'An unknown currency is a typed failure: parseCurrencyCode(code) returns { kind: "unknown-currency" }; never fall back to 2 decimals.',
  'money-division': 'Split money with allocate(total, weights) or splitEvenly(total, n) (src/core/money/allocate.ts): the parts then sum to the whole. A share of a rate goes through applyRate.',
  'money-float-rate': 'Keep the rate an exact ratio (parsePercent("8.25"), basisPoints(825)) and apply it once with applyRate(amount, rate, mode) (src/core/money/rate.ts).',
  'raw-minor-arithmetic': 'Use the Money functions (addMoney, subtractMoney, negateMoney, multiplyMoney, sumMoney, compareMoney): they refuse mixed currencies and unsafe integers.',
  'currency-format-edge': 'Format money only in src/i18n/: formatMoney(amount, localeTag) or useFormatMoney() in the model hook.',
  'currency-fraction-digits': 'Set minimumFractionDigits and maximumFractionDigits to exponentOf(currency): CLDR display digits differ from ISO 4217 for 16 currencies (IQD, HUF, IDR, ...).',
  'currency-symbol-literal': 'Let Intl place the symbol: formatMoney(amount, localeTag) puts it where each locale wants it, with the right spacing and digits.',
  'core-formats': 'Pure core code returns values; format them at the edge in src/i18n/ (formatMoney, formatQuantity).',
  'unit-suffix': 'Store the quantity as an integer in its canonical unit and end the name with it: durationMs, distanceMm, weightG (src/core/units/units.ts converts at the edge).',
  'instant-type': 'Store an instant as epoch milliseconds named <what>AtMs (number); parse wire text once with parseIsoInstant and write it with toIsoInstant (src/core/time/instant.ts).',
  'money-column': 'Store money as <name>_minor INTEGER NOT NULL (plus the currency code as TEXT on the row or its aggregate); never REAL, NUMERIC or DECIMAL.',
  'instant-column': 'Store an instant as <name>_at_ms INTEGER (epoch milliseconds, UTC); a local calendar day is a TEXT DateKey named <name>_on.',
  'money-core': 'Copy templates/src/core/money/ (and src/core/decimal/) from this skill, then build every amount with money() and the functions there.',
  'core-tests': 'Add the sibling <module>.test.ts (copy the template test): the value objects carry the pinned vectors and the properties.',
};

const ALLOW = /value-objects-allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*:\s*\S/;
const CHAIN = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*`;
const ANNOTATION = /([A-Za-z_$][\w$]*)\s*\??\s*:\s*(?:readonly\s+)?(number|string|Date|Money)\b(\s*\[\])?/g;
const SYMBOLS = /[$€£¥₹₩₽₺₪₫₦₱฿₴₸₼₾¢]/;

function inDir(rel, dir) {
  return dir !== '' && (rel === dir || rel.startsWith(`${dir}/`));
}

/** One scanned file: its text, lexer output and a problem helper that honours the allow marker. */
function fileContext(root, rel, report) {
  const text = readFileSync(join(root, rel), 'utf8');
  const scan = scanSource(text);
  const lines = text.split('\n');
  const isAllowed = (line, rule) => [lines[line - 1], lines[line - 2]].some((raw) => {
    const match = raw === undefined ? null : ALLOW.exec(raw);
    return match !== null && match[1].split(/\s*,\s*/).includes(rule);
  });
  const add = (index, rule, message) => {
    const line = scan.lineOf(index);
    if (!isAllowed(line, rule)) report.problem({ file: rel, line, rule, message, fix: FIX[rule] });
  };
  return { rel, text, scan, add, isAllowed };
}

// ---- money as a value -------------------------------------------------------------------------

function checkFloatMoney({ scan, add }) {
  for (const match of scan.code.matchAll(ANNOTATION)) {
    const [, name, type] = match;
    if (type !== 'number' || !isMoneyName(name) || isMinorUnitName(name)) continue;
    add(match.index, 'float-money', `${name}: number holds money as a plain number (a float or a major-unit amount)`);
  }
  for (const match of scan.code.matchAll(/(?<![\w$.])(?:Number\.)?parseFloat\s*\(/g)) {
    const lineText = scan.code.slice(scan.code.lastIndexOf('\n', match.index) + 1, scan.code.indexOf('\n', match.index));
    if ([...lineText.matchAll(/[A-Za-z_$][\w$]*/g)].some(([word]) => isMoneyName(word))) {
      add(match.index, 'float-money', 'parseFloat turns typed money into a binary float');
    }
  }
  checkSchemaNumbers(scan, add);
  checkDecimalLiterals(scan, add);
}

/** A money-named const/let/var or object key set to a decimal literal: `deliveryFee = 2.99`, `{ serviceFee: 1.5 }`. */
const MONEY_DECIMAL_LITERAL = /(?<![\w$.])(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|([A-Za-z_$][\w$]*)\s*:)\s*(-?\d[\d_]*\.\d[\d_]*)(?![\w.])/g;

/**
 * The untyped form of the float-money bug: the canonical lint (no-inferrable-types) rejects
 * `const fee: number = 2.99`, so a plain literal is the only lint-clean way to write it. A fraction in
 * a minor-unit name (`priceMinor: 19.99`) is always wrong. Rates and ratios (`taxRate`, `opacity`) are
 * not money names, so they stay silent.
 */
function checkDecimalLiterals(scan, add) {
  for (const match of scan.code.matchAll(MONEY_DECIMAL_LITERAL)) {
    const name = match[1] ?? match[2];
    if (!isMoneyName(name)) continue;
    const why = isMinorUnitName(name) ? 'a fraction in a minor-unit name' : 'money as a binary float';
    add(match.index, 'float-money', `${name} = ${match[3]} holds ${why}`);
  }
}

/** The end of a property value: the first ',' or closing bracket at depth 0 (or the end of the text). */
function valueEnd(code, from) {
  let depth = 0;
  for (let index = from; index < code.length; index += 1) {
    const character = code[index];
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) {
      if (depth === 0) return index;
      depth -= 1;
    } else if (character === ',' && depth === 0) return index;
  }
  return code.length;
}

const SCHEMA_NUMBER = /(?<![\w$.])(?:v|z)\.number\(\s*\)/;
const SCHEMA_INTEGER = /(?<![\w$.])v\.(?:safeInteger|integer)\(|\.(?:int|safe)\(\s*\)/;

/** A money-named schema key whose value accepts any number: v.number() (also inside v.pipe, v.optional, ...) without v.safeInteger(). */
function checkSchemaNumbers(scan, add) {
  for (const match of scan.code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?=(?:v|z)\.)/g)) {
    if (!isMoneyName(match[1])) continue;
    const start = match.index + match[0].length;
    const value = scan.code.slice(start, valueEnd(scan.code, start));
    if (SCHEMA_NUMBER.test(value) && !SCHEMA_INTEGER.test(value)) {
      add(match.index, 'float-money', `${match[1]}: a schema number without v.safeInteger() accepts 19.99 as money`);
    }
  }
}

function checkScale({ scan, add }) {
  const after = new RegExp(String.raw`(${CHAIN})\s*([*/])\s*(100|1_?000)(?![\w.])`, 'g');
  for (const match of scan.code.matchAll(after)) {
    if (isMoneyChain(match[1])) add(match.index, 'hard-coded-scale', `${match[1]} ${match[2]} ${match[3]} assumes a currency exponent`);
  }
  const before = new RegExp(String.raw`(?<![\w.])(100|1_?000)\s*\*\s*(${CHAIN})`, 'g');
  for (const match of scan.code.matchAll(before)) {
    if (isMoneyChain(match[2])) add(match.index, 'hard-coded-scale', `${match[1]} * ${match[2]} assumes a currency exponent`);
  }
  checkParsedScale(scan, add);
  for (const match of scan.code.matchAll(/\.toFixed\s*\(/g)) {
    const lineStart = scan.code.lastIndexOf('\n', match.index) + 1;
    const head = scan.code.slice(lineStart, match.index);
    if ([...head.matchAll(/[A-Za-z_$][\w$]*/g)].some(([word]) => word === 'minor' || isMoneyName(word))) {
      add(match.index, 'hard-coded-scale', 'toFixed fixes the decimals and the digits of an amount (and rounds a binary float)');
    }
  }
}

/** The text of the line that holds `index`. */
function lineAt(code, index) {
  const end = code.indexOf('\n', index);
  return code.slice(code.lastIndexOf('\n', index) + 1, end === -1 ? code.length : end);
}

/** Number(text) * 100, parseFloat(text) * 100 (or 100 * ...) on a line that names money: typed text scaled by a guessed exponent. */
function checkParsedScale(scan, add) {
  for (const call of findCalls(scan.code, String.raw`(?:Number\.parseFloat|parseFloat|Number)`)) {
    const after = /^\s*\*\s*(100|1_?000)(?![\w.])/.exec(scan.code.slice(call.close + 1));
    const before = /(?<![\w.])(100|1_?000)\s*\*\s*$/.exec(scan.code.slice(Math.max(0, call.start - 12), call.start));
    if (after === null && before === null) continue;
    const words = [...lineAt(scan.code, call.start).matchAll(/[A-Za-z_$][\w$]*/g)];
    if (!words.some(([word]) => isMoneyName(word))) continue;
    add(call.start, 'hard-coded-scale', `a parsed number times ${(after ?? before)[1]} assumes a currency exponent`);
  }
}

function checkExponentDefault({ scan, add }) {
  for (const match of scan.code.matchAll(/(\?\?|\|\|)\s*2(?![\w.])/g)) {
    const lineStart = scan.code.lastIndexOf('\n', match.index) + 1;
    if (/exponent|decimals|fractiondigits|minorunit|minordigits/i.test(scan.code.slice(lineStart, match.index))) {
      add(match.index, 'exponent-default', `${match[1]} 2 gives an unknown currency two decimals`);
    }
  }
}

function checkMoneyMath({ scan, add }) {
  const division = new RegExp(String.raw`(${CHAIN})\s*\/(?![/*=])\s*(${CHAIN}|\d[\d_.]*)`, 'g');
  for (const match of scan.code.matchAll(division)) {
    const [, left, right] = match;
    if (!isMoneyChain(left) || isMoneyChain(right) || /^(100|1_?000)$/.test(right)) continue;
    add(match.index, 'money-division', `${left} / ${right} divides money; the rounded parts will not sum to the whole`);
  }
  const rateWord = String.raw`(?:\d*\.\d+|${CHAIN}(?:Rate|Percent|Pct|Ratio|Factor|Multiplier))(?![\w$])`;
  const times = new RegExp(String.raw`(${CHAIN})\s*\*\s*(${rateWord})|(${rateWord})\s*\*\s*(${CHAIN})`, 'g');
  for (const match of scan.code.matchAll(times)) {
    const money = match[1] ?? match[4];
    const factor = match[2] ?? match[3];
    if (isMoneyChain(money)) add(match.index, 'money-float-rate', `${money} * ${factor} multiplies money by a float rate`);
  }
}

function checkRawMinor({ scan, add }) {
  const patterns = [/\.minor\s*(?:[-+*/%]=?)(?![-+>])/g, /(?<![-+])[-+*/%]=?\s*[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\??\.minor\b/g];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of scan.code.matchAll(pattern)) {
      const line = scan.lineOf(match.index);
      if (seen.has(line)) continue;
      seen.add(line);
      add(match.index, 'raw-minor-arithmetic', 'arithmetic on .minor skips the currency check and the safe-integer check');
    }
  }
}

// ---- formatting at the edge ------------------------------------------------------------------

function checkCurrencyFormat({ scan, add }, { inI18n }) {
  const currencyStyle = /style\s*:\s*(['"])currency\1/g;
  if (!inI18n) {
    for (const match of scan.codeKeep.matchAll(currencyStyle)) {
      add(match.index, 'currency-format-edge', "style: 'currency' outside src/i18n/");
    }
  }
  for (const call of findCalls(scan.code, String.raw`(?:new\s+)?Intl\.NumberFormat`)) {
    const args = scan.codeKeep.slice(call.open, call.close);
    if (!/style\s*:\s*(['"])currency\1/.test(args)) continue;
    const digits = ['minimumFractionDigits', 'maximumFractionDigits'].map((key) => new RegExp(`${key}\\s*:\\s*([^,}\\n]+)`).exec(args));
    if (digits.some((found) => found === null)) {
      add(call.start, 'currency-fraction-digits', 'a currency NumberFormat without minimumFractionDigits and maximumFractionDigits uses CLDR digits, not the ISO 4217 exponent');
    } else if (digits.some((found) => /^\s*\d+\s*$/.test(found[1]))) {
      add(call.start, 'currency-fraction-digits', 'a currency NumberFormat with literal fraction digits ignores the currency exponent');
    }
  }
}

function checkSymbols({ scan, add }) {
  for (const entry of scan.strings) {
    if (entry.quote === '`' && entry.parts.length > 1) {
      const glued = entry.parts.some((part, index) =>
        (index < entry.parts.length - 1 && SYMBOLS.test(part.trimEnd().slice(-1))) || (index > 0 && SYMBOLS.test(part.trimStart().charAt(0))));
      if (glued) add(entry.index, 'currency-symbol-literal', 'a currency symbol glued to an interpolated number');
      continue;
    }
    if (!SYMBOLS.test(entry.value.trim()) || entry.value.trim().length > 3) continue;
    const before = scan.code.slice(Math.max(0, entry.index - 3), entry.index);
    const after = scan.code.slice(entry.end, entry.end + 3);
    if (/\+\s*$/.test(before) || /^\s*\+/.test(after)) add(entry.index, 'currency-symbol-literal', `"${entry.value}" concatenated with a number`);
  }
}

function checkCoreFormats({ scan, add }) {
  for (const match of scan.code.matchAll(/(?<![\w$.])Intl\.|\.(toLocaleString|toFixed|toPrecision)\s*\(/g)) {
    add(match.index, 'core-formats', `${match[1] === undefined ? 'Intl' : match[1]} formats inside pure core code`);
  }
}

// ---- stored shapes ---------------------------------------------------------------------------

function inRegions(index, regions) {
  return regions.some(([from, to]) => index >= from && index <= to);
}

function checkStoredShapes({ scan, add }, { unitScope, instantScope }) {
  const regions = typeRegionsOf(scan.code);
  for (const match of scan.code.matchAll(ANNOTATION)) {
    if (!inRegions(match.index, regions)) continue;
    const [, name, type] = match;
    if (unitScope && type === 'number' && lacksUnit(name)) {
      add(match.index, 'unit-suffix', `${name}: number does not say its unit`);
    }
    if (!instantScope) continue;
    if (type === 'Date') add(match.index, 'instant-type', `${name}: Date keeps a mutable object that does not survive JSON or SQLite`);
    else if (isInstantName(name) && type === 'string') add(match.index, 'instant-type', `${name}: string keeps wire text (or local time) in stored state`);
    else if (isInstantName(name) && type === 'number' && segmentsOf(name).at(-1) !== 'ms') add(match.index, 'instant-type', `${name}: number does not say seconds or milliseconds`);
  }
}

function checkColumns({ scan, add }) {
  for (const entry of scan.strings) {
    if (!holdsDdl(entry.value)) continue;
    for (const column of columnsOf(entry.value)) {
      const at = entry.index + 1 + column.offset;
      const { name, type } = column;
      if (isMoneyName(name) && (!isIntegerType(type) || !isMinorUnitName(name))) {
        add(at, 'money-column', `column ${name} ${type} holds money ${isIntegerType(type) ? 'without saying minor units' : 'as a non-integer type'}`);
      }
      if (!isInstantName(name)) continue;
      if (segmentsOf(name).at(-1) !== 'ms') add(at, 'instant-column', `column ${name} ${type} does not say it holds epoch milliseconds`);
      else if (!isIntegerType(type)) add(at, 'instant-column', `column ${name} ${type} holds epoch milliseconds in a non-integer type`);
    }
  }
}

// ---- the core itself -------------------------------------------------------------------------

/**
 * Where a file first shows it handles money (a Money or money-named number field, or currency
 * formatting), or -1. A field whose line carries a float-money allow marker (a vendor's double such
 * as expo-iap's price) is not a signal on its own: the app converts it at the boundary.
 */
function moneySignal(file) {
  const isVendorField = (index) => {
    const line = file.scan.lineOf(index);
    return file.isAllowed(line, 'float-money') || file.isAllowed(line, 'money-core');
  };
  const declares = [...file.scan.code.matchAll(ANNOTATION)].find(
    (match) => (match[2] === 'Money' || (isMoneyName(match[1]) && match[2] === 'number')) && !isVendorField(match.index),
  );
  if (declares !== undefined) return declares.index;
  const style = /style\s*:\s*(['"])currency\1/.exec(file.scan.codeKeep);
  return style === null ? -1 : style.index;
}

function checkCore(root, files, { moneyDir, coreDirs }, report) {
  const moneyFile = posix.join(moneyDir, 'money.ts');
  if (!existsSync(join(root, moneyFile))) {
    for (const file of files) {
      const index = moneySignal(file);
      if (index === -1) continue;
      file.add(index, 'money-core', `the app handles money but ${moneyFile} does not exist`);
      break;
    }
  }
  const modules = walkRepo(root, { include: ['*.ts'] }).filter((rel) => coreDirs.some((dir) => posix.dirname(rel) === dir) && !isTestFile(rel) && !rel.endsWith('.d.ts'));
  for (const rel of modules) {
    if (posix.basename(rel) === 'currency-exponents.ts') continue;
    const test = rel.replace(/\.ts$/, '.test.ts');
    if (!existsSync(join(root, test))) report.problem({ file: rel, line: 1, rule: 'core-tests', message: `no ${posix.basename(test)} beside it`, fix: FIX['core-tests'] });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  requireDir(join(root, layout.srcDir), `app source folder ${layout.srcDir}/`);
  const report = createReporter({ name: 'check-value-code', json: options.json });
  const moneyDir = options['money-dir'] ?? posix.join(layout.coreDir, 'money');
  const exempt = [moneyDir, posix.join(layout.coreDir, 'decimal'), posix.join(layout.srcDir, 'games')];
  const stored = [layout.coreDir, layout.storesDir, layout.dataDir, layout.servicesDir];
  const rels = walkRepo(root, { include: ['*.ts', '*.tsx'] }).filter((rel) => inDir(rel, layout.srcDir) && !rel.endsWith('.d.ts') && !isTestFile(rel));
  const files = rels.map((rel) => fileContext(root, rel, report));
  for (const file of files) {
    const isMoneyCode = !exempt.some((dir) => inDir(file.rel, dir));
    if (isMoneyCode) {
      checkFloatMoney(file);
      checkScale(file);
      checkExponentDefault(file);
      checkMoneyMath(file);
      checkRawMinor(file);
    }
    checkCurrencyFormat(file, { inI18n: inDir(file.rel, layout.i18nDir) });
    checkSymbols(file);
    if (inDir(file.rel, layout.coreDir)) checkCoreFormats(file);
    checkStoredShapes(file, {
      unitScope: [...stored, layout.apiDir].some((dir) => inDir(file.rel, dir)),
      instantScope: stored.some((dir) => inDir(file.rel, dir)),
    });
    checkColumns(file);
  }
  const coreDirs = [moneyDir, posix.join(layout.coreDir, 'units'), posix.join(layout.coreDir, 'time'), posix.join(layout.coreDir, 'decimal')];
  checkCore(root, files, { moneyDir, coreDirs }, report);
  return report.finish({ checked: files.length, unit: 'files' });
});
