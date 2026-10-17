#!/usr/bin/env node
// check-code-names.mjs: checks names inside the code of an Expo app repo: testIDs, kind and type
// values, message keys and ICU placeholders, env variables, test titles, type names, booleans,
// handlers, module constants and acronyms, plus Maestro flow selectors.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-code-names.mjs [repo-root]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, notYetCreated, parseArgs, requireDir, run, walkRepo } from './check-lib.mjs';
import { ENV_VAR, I18N_KEY, MIME_TYPE, RULES, TEST_ID, TEST_TITLE, hasAcronymRun, hasBooleanPrefix, isPascal, isUpperSnake } from './lib/names.mjs';
import { missingContractNote, namingContext, under } from './lib/naming-scope.mjs';
import { findClosing, findJsxTags, jsxAttributes, makeLineOf, maskCode, matchBracket, scanSource } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-code-names',
  summary:
    'Checks names inside source, message catalogs and Maestro flows: testIDs, kind/type values, message keys and ' +
    'placeholders, env variables, test titles, type names, boolean names, handler names, module constants, acronyms, ' +
    'and that flows select by id.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The naming contract (default: contracts/naming.json, or rn-skills.config.json "namingContract")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  testid-format       a testID is not <screen>.<element> in kebab-case (tasks.add-button, tasks.task-row.<id>), or a',
    '                      template glues a value into a segment (tasks.row-${id}; a leading ${testID} prefix is fine)',
    '  testid-index        a repeated item\'s testID uses a list index (i, idx, index, rowIndex, index + 1) instead of a',
    '                      stable data key, also when the template is first built in a variable named *ID or *TestId',
    '  testid-role         a pressable or input (Pressable, Touchable*, Switch, TextInput, Button, or a component named after',
    '                      a role, such as AppButton or ListRow, that gets onPress/onLongPress/onValueChange/onChangeText)',
    '                      has a literal testID whose element does not end in its role (-button, -row, -switch, -input, ...)',
    '  kind-value          a kind/type literal is not kebab-case (\'task-completed\', \'set-theme\'); left alone: MIME types',
    '                      (text/csv;charset=utf-8, image/*), type: options in a <library>-<concern>-adapter.ts, react-hook-form',
    '                      setError(name, { type }) error types, and type: values in test files (tsc checks them against the',
    '                      unions this rule checks where they are declared; the rest belong to libraries such as valibot)',
    '  i18n-key            a catalog key or a t()/<T id>/<FormattedMessage id>/formatMessage/defineMessage(s) key breaks',
    '                      the key grammar',
    '  i18n-key-built      a key is built from a template literal instead of written as a literal',
    '  i18n-key-namespace  a key\'s first segment is not a feature folder or a contracts/naming.json "keyAreas" entry, or',
    '                      (multi-package) a package\'s keys do not start with the package folder name, or app code or',
    '                      app catalogs use a package\'s key',
    '  i18n-placeholder    a catalog placeholder is not camelCase, or a plain {x} whose name does not end in Name/Text',
    '  env-var             an env variable is not UPPER_SNAKE_CASE; app code reads a variable Expo does not inline',
    '                      (EXPO_PUBLIC_* and Expo\'s own EXPO_OS, EXPO_SERVER, EXPO_BASE_URL, NODE_ENV are inlined), reads one',
    '                      with bracket access, or uses process.env without dot access (destructuring, a copy, a spread, a',
    '                      computed key); or server code (API routes, +middleware, src/server/) reads an EXPO_PUBLIC_ name',
    '                      that names a secret (a SECRET, PRIVATE, PASSWORD, TOKEN, CREDENTIAL, KEY or SALT word)',
    '  test-title          an it() title does not start with a third-person verb or "can"; test() instead of it()',
    '  type-name           a type is not PascalCase, has an I prefix, or (outside tests) is called plain Props or State',
    '  boolean-name        a boolean variable or parameter lacks is/has/can/should/did/will/was',
    '  handler-name        in a .tsx file, an on* prop gets a local function not named handleX/onX, or a local',
    '                      handler is named onX (onX is for callback props)',
    '  constant-name       module-level fixed data (a literal, a regex, an as-const table) is not UPPER_CASE',
    '  acronym-case        an identifier spells an acronym in capitals (SQLDriver, isRTL); write SqlDriver, isRtl',
    '  maestro-selector    a Maestro step selects by text instead of id (OS-owned UI only under a "# system-ui: <why>"',
    '                      comment or on a "# system dialog" line), or an id is not a valid testID',
    '',
    'Scans the .ts/.tsx files of src/, test/, scripts/, plugins/ and root .ts files; catalogs in src/i18n/catalogs/;',
    'flows in .maestro/ (folders from rn-skills.config.json; every workspace in a multi-package repo). Prints',
    'SKIP lines while an Expo app\'s catalogs or e2e folder are not yet created (one pair per Expo app).',
    'Example: node check-code-names.mjs .            (from the app repo root)',
  ].join('\n'),
};

const SOURCE = /\.tsx?$/;

/** Static text of a template literal with each ${...} as `${}`, plus the raw expressions. */
function templateParts(text, entry) {
  const raw = text.slice(entry.index + 1, entry.end - 1);
  const expressions = [...raw.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim());
  return { statics: entry.parts, expressions };
}

/** True when a ${...} expression reads a list position: i, idx, index, rowIndex, String(index + 1). */
function readsListIndex(expression) {
  return (expression.match(/[A-Za-z_$][\w$]*/g) ?? []).some((name) => /^(i|idx|index)$|[a-z0-9]Index$/.test(name));
}

/**
 * True when a template testID glues a ${...} value into a segment ('tasks.row-${id}'): every value
 * fills a whole dot segment, except a leading ${testID} prefix that the rest extends by a segment.
 */
function gluesSegment(statics) {
  for (let k = 0; k < statics.length - 1; k += 1) {
    const isPrefix = k === 0 && statics[0] === '';
    const isLast = k + 1 === statics.length - 1 && statics[k + 1] === '';
    if (!isPrefix && !statics[k].endsWith('.')) return true;
    if (!isLast && !statics[k + 1].startsWith('.')) return true;
  }
  return false;
}

/** Checks literal and template testIDs; returns the start index of every testID string that failed testid-format. */
function checkTestIds(rel, scan, text, report) {
  const { code, stringAt, lineOf } = scan;
  const failed = new Set();
  for (const match of code.matchAll(/\btestID\s*(?:=\s*\{?\s*|:\s*)(?=['"`])/g)) {
    const entry = stringAt.get(match.index + match[0].length);
    if (!entry) continue;
    const at = { file: rel, line: lineOf(entry.index) };
    if (entry.quote !== '`' || entry.parts.length === 1) {
      if (!TEST_ID.test(entry.value)) {
        failed.add(entry.index);
        report.problem({ ...at, rule: 'testid-format', message: `testID "${entry.value}"`, fix: "Use '<screen>.<element>' with kebab-case segments, e.g. 'tasks.add-button'." });
      }
      continue;
    }
    const { statics, expressions } = templateParts(text, entry);
    // A leading ${testID} is a whole testID (two segments or more); every other value is one segment.
    const probe = `${statics[0] === '' ? 'x.' : ''}${statics.join('x')}`;
    if (!TEST_ID.test(probe)) {
      failed.add(entry.index);
      report.problem({ ...at, rule: 'testid-format', message: `testID template "${entry.value}"`, fix: 'Keep the static parts kebab-case with dots between segments: `tasks.task-row.${task.id}`.' });
    } else if (gluesSegment(statics)) {
      failed.add(entry.index);
      report.problem({ ...at, rule: 'testid-format', message: `testID template "${entry.value}" glues a value into a segment`, fix: 'Give the data key its own dot segment (`tasks.task-row.${task.id}`, `${testID}.icon`): a flow then matches the element by its fixed part.' });
    }
    if (expressions.some(readsListIndex)) {
      report.problem({ ...at, rule: 'testid-index', message: `testID "${entry.value}" uses a list index`, fix: 'Append a stable data key (the task id, the locale code), never the position in the list.' });
    }
  }
  // A testID built first and passed later (const rowID = `lists.list-row.${index}`; testID={rowID}):
  // a template assigned to a name ending in ID or TestId that reads like a testID (a dot segment).
  for (const match of code.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:ID|TestId)\s*(?::[^=;]+)?=\s*(?=`)/g)) {
    const entry = stringAt.get(match.index + match[0].length);
    if (!entry || entry.quote !== '`' || entry.parts.length === 1) continue;
    const { statics, expressions } = templateParts(text, entry);
    if (statics.some((part) => part.includes('.')) && expressions.some(readsListIndex)) {
      report.problem({ file: rel, line: lineOf(entry.index), rule: 'testid-index', message: `testID "${entry.value}" (built in a variable) uses a list index`, fix: 'Append a stable data key (the task id, the locale code), never the position in the list.' });
    }
  }
  return failed;
}

/** The static segments of a testID value after the screen scope ('tasks.task-row.${id}' -> ['task-row']). */
function elementSegments(value, isTemplate) {
  const segments = value.replace(/\$\{[^}]*\}/g, '${}').split('.').slice(1);
  return isTemplate ? segments.filter((segment) => segment !== '' && !segment.includes('${')) : segments;
}

function checkTestIdRoles(rel, text, ctx, failed, report) {
  const masked = maskCode(text);
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  for (const tag of findJsxTags(text, masked)) {
    // React Native's pressables and inputs, and the app's own primitives named after a role
    // (AppButton, ListRow, IconButton, SettingsSwitch) when they get a press or change handler: a
    // SummaryCard with no handler is a container, and containers need no role suffix.
    const attrs = jsxAttributes(text, tag, masked);
    const lastWord = /[A-Z][a-z0-9]*$/.exec(tag.name)?.[0]?.toLowerCase() ?? '';
    const isRoleNamed = ctx.testIdRoles.includes(lastWord) && RULES.interactiveProps.some((prop) => attrs.has(prop));
    if (!RULES.pressableComponents.includes(tag.name) && !isRoleNamed) continue;
    const attr = attrs.get('testID');
    if (!attr) continue;
    const literal = attr.kind === 'string' ? attr.value : /^(['"`])([\s\S]*)\1$/.exec(attr.value ?? '')?.[2];
    if (literal === undefined || literal === null) continue;
    // testid-format already reported this value: one finding per attribute.
    if (failed.has(attr.index + text.slice(attr.index).search(/['"`]/))) continue;
    const isTemplate = attr.kind === 'expr' && attr.value.startsWith('`');
    const segments = elementSegments(literal, isTemplate);
    const hasRole = segments.some((segment) => ctx.testIdRoles.some((role) => segment === role || segment.endsWith(`-${role}`)));
    if (segments.length > 0 && !hasRole) {
      report.problem({ file: rel, line: lineOf(attr.index), rule: 'testid-role', message: `${tag.name} testID "${literal}" does not name its role`, fix: `End the element in its role so a flow reads what it taps: ${ctx.testIdRoles.slice(0, 6).map((role) => `-${role}`).join(', ')}, ... (tasks.add-button, tasks.task-row.<id>).` });
    }
  }
}

/** [start, end) ranges of the arguments of every setError( call: react-hook-form owns their `type` values. */
function setErrorRanges(code) {
  const ranges = [];
  for (const call of code.matchAll(/(?<![\w$])setError\s*\(/g)) {
    const open = call.index + call[0].length - 1;
    const close = matchBracket(code, open);
    ranges.push([open, close === -1 ? code.length : close]);
  }
  return ranges;
}

function checkKinds(rel, scan, ctx, report) {
  const { code, stringAt, lineOf } = scan;
  // An adapter (<library>-<concern>-adapter.ts) speaks its SDK's format, so its `type:` options follow
  // the SDK; its own `kind` unions still follow the grammar. A test's `type:` values are either the
  // app's own (tsc holds them to the unions checked where they are declared) or a library's
  // (valibot's 'min_length' issues, react-hook-form's 'maxLength' errors).
  const isTypeExempt = /-adapter\.tsx?$/.test(rel) || ctx.isTest(rel);
  const library = setErrorRanges(code);
  for (const match of code.matchAll(/(?<![\w$.])(kind|type)\s*\??\s*:\s*(?=['"])/g)) {
    if (match[1] === 'type' && (isTypeExempt || library.some(([from, to]) => match.index > from && match.index < to))) continue;
    let index = match.index + match[0].length;
    for (;;) {
      const entry = stringAt.get(index);
      if (!entry) break;
      // A MIME type (new Blob([csv], { type: 'text/csv;charset=utf-8' }), image/*) is a data format, not a discriminant.
      if (/[^a-z0-9-]/.test(entry.value) && !MIME_TYPE.test(entry.value)) {
        report.problem({ file: rel, line: lineOf(entry.index), rule: 'kind-value', message: `${match[1]} value '${entry.value}' is not kebab-case`, fix: "Use lowercase words joined by hyphens: commands imperative ('complete-task'), events past tense ('task-completed'), actions imperative ('set-theme')." });
      }
      const next = /^\s*\|\s*(?=['"])/.exec(code.slice(entry.end, entry.end + 40));
      if (!next) break;
      index = entry.end + next[0].length;
    }
  }
}

/** The workspace package that holds rel when it is not an Expo app (it ships its own catalogs), else null. */
function packageOf(rel, ctx) {
  const app = ctx.appOf(rel);
  return app.isRoot || app.isExpoApp ? null : app.dir.split('/').at(-1);
}

const KEY_CALL = /(?<![\w$.])t\s*\(\s*(?=['"`])|<T\s+id=\{?\s*(?=['"`])|<FormattedMessage\s+id=\{?\s*(?=['"`])|formatMessage\s*\(\s*\{\s*id\s*:\s*(?=['"`])/g;

/**
 * The key strings at call sites: t('x'), <T id="x">, <FormattedMessage id="x">, formatMessage({ id: 'x' }),
 * and react-intl's message descriptors defineMessage({ id: 'x' }) and defineMessages({ a: { id: 'x' } }).
 */
function keyEntries(scan) {
  const { code, stringAt } = scan;
  const entries = [];
  for (const match of code.matchAll(KEY_CALL)) {
    const entry = stringAt.get(match.index + match[0].length);
    if (entry) entries.push(entry);
  }
  for (const call of code.matchAll(/(?<![\w$.])defineMessages?\s*\(/g)) {
    const open = call.index + call[0].length - 1;
    const close = findClosing(code, open);
    const body = code.slice(open, close === -1 ? code.length : close);
    for (const id of body.matchAll(/(?<![\w$.'"])id\s*:\s*(?=['"`])/g)) {
      const entry = stringAt.get(open + id.index + id[0].length);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

function checkKeyCalls(rel, scan, ctx, namespace, report) {
  const { lineOf } = scan;
  const ownPackage = packageOf(rel, ctx);
  for (const entry of keyEntries(scan)) {
    const at = { file: rel, line: lineOf(entry.index) };
    if (entry.quote === '`') {
      report.problem({ ...at, rule: 'i18n-key-built', message: `key built from a template: ${entry.value}`, fix: 'Write the key as a literal, or pick it from a typed table of literals (PRIORITY_LABEL_KEYS[priority]); tools can only check keys they can see.' });
      continue;
    }
    if (!I18N_KEY.test(entry.value)) {
      report.problem({ ...at, rule: 'i18n-key', message: `key '${entry.value}' breaks the grammar`, fix: 'Use 2-5 dot-separated kebab-case segments: <area>.<element>[.<variant>], e.g. tasks.add-button.label.' });
      continue;
    }
    const first = entry.value.split('.')[0];
    if (ownPackage !== null && first !== ownPackage) {
      report.problem({ ...at, rule: 'i18n-key-namespace', message: `package key '${entry.value}' does not start with '${ownPackage}.'`, fix: `Keys of the ${ownPackage} package start with its folder name: ${ownPackage}.<area>.<element>.` });
    } else if (ownPackage === null && namespace.packages.has(first)) {
      report.problem({ ...at, rule: 'i18n-key-namespace', message: `app code names the ${first} package's key '${entry.value}'`, fix: `Let the ${first} package turn its own keys into text (export the component or function that shows it); app keys start with a feature folder or a key area. A package key named in app code breaks silently when the package renames it.` });
    }
  }
}

// Expo inlines process.env.<NAME> read by name (dot access; optional chaining works too). Every other
// use of process.env in app code (destructuring, a copy, a spread, an argument, a computed or template
// key) reaches the release bundle as undefined on both platforms.
const ENV_FIX_DOT = (example) => `Expo inlines only process.env.EXPO_PUBLIC_NAME read by name: write ${example} at each use (destructuring, a copy of process.env, a spread or a computed key is undefined in a release build on iOS and Android).`;

/** How app code uses process.env when it is not read by name, or null when it is (or only typeof'd). */
function envValueForm(code, index, end) {
  const before = code.slice(Math.max(0, index - 300), index);
  if (/\btypeof\s*$/.test(before)) return null;
  const destructure = /\{([^{}]*)\}\s*=\s*$/.exec(before);
  if (destructure) {
    const names = destructure[1].split(',').map((part) => part.split(/[:=]/)[0].trim()).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    return { form: `destructures it ({ ${names.join(', ')} })`, example: `process.env.${names.find((name) => name.startsWith('EXPO_PUBLIC_')) ?? names[0] ?? 'EXPO_PUBLIC_API_URL'}` };
  }
  if (/\.\.\.\s*$/.test(before)) return { form: 'spreads it', example: 'process.env.EXPO_PUBLIC_API_URL' };
  if (/^\s*\[/.test(code.slice(end))) return { form: 'uses a computed key', example: 'process.env.EXPO_PUBLIC_API_URL' };
  return { form: 'uses it as a value (a copy or an argument)', example: 'process.env.EXPO_PUBLIC_API_URL' };
}

/** True when a variable's name says it holds a secret: a word such as SECRET, TOKEN or KEY after the prefix. */
const namesSecret = (name) => name.replace(/^EXPO_PUBLIC_/, '').split('_').some((word) => RULES.secretEnvWords.includes(word));

function checkEnv(rel, scan, ctx, report) {
  const { code, stringAt, lineOf } = scan;
  const isRuntime = ctx.isRuntime(rel);
  const isServer = ctx.isServerCode(rel);
  for (const match of code.matchAll(/\bprocess\.env\b/g)) {
    const end = match.index + match[0].length;
    const at = { file: rel, line: lineOf(match.index) };
    const rest = code.slice(end);
    const dot = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(rest);
    const bracket = /^\s*\[\s*/.exec(rest);
    const literal = bracket ? stringAt.get(end + bracket[0].length) : undefined;
    // A static key: process.env.NAME, process.env?.NAME or process.env['NAME'].
    const name = dot ? dot[1] : literal && literal.quote !== '`' ? literal.value : undefined;
    if (name === undefined) {
      const how = isRuntime ? envValueForm(code, match.index, end) : null;
      if (how) report.problem({ ...at, rule: 'env-var', message: `app code reads process.env without dot access: it ${how.form}`, fix: ENV_FIX_DOT(how.example) });
      continue;
    }
    if (!ENV_VAR.test(name)) {
      report.problem({ ...at, rule: 'env-var', message: `env variable ${name} is not UPPER_SNAKE_CASE`, fix: 'Name env variables in UPPER_SNAKE_CASE (APP_VARIANT, EXPO_PUBLIC_API_URL).' });
    } else if (isServer && name.startsWith('EXPO_PUBLIC_') && namesSecret(name)) {
      report.problem({ ...at, rule: 'env-var', message: `server code reads ${name}: its name says it holds a secret, and every EXPO_PUBLIC_ value ships inside the app`, fix: `Server code (API routes, +middleware, src/server/) reads secrets under plain names (DATABASE_URL, ${name.replace(/^EXPO_PUBLIC_/, '')}), which never reach the app bundle: rename the variable without EXPO_PUBLIC_ and rotate the value, since it has already shipped. A public value (a site URL, a publishable id) may keep the prefix; name it after what it is, without a secret word.` });
    } else if (isRuntime && !name.startsWith('EXPO_PUBLIC_') && !RULES.expoInlinedEnv.includes(name)) {
      report.problem({ ...at, rule: 'env-var', message: `app code reads ${name}, which Expo does not inline (undefined in a release build)`, fix: `If this file runs only on the server or in Node, move it to src/server/ (or an <name>+api.ts route) or list it in contracts/naming.json "nodeCode"; never rename a secret to EXPO_PUBLIC_ (those values ship inside the app). Only a value every user may see becomes EXPO_PUBLIC_<NAME>, declared in src/env.d.ts; Expo also inlines its own ${RULES.expoInlinedEnv.join(', ')}.` });
    } else if (isRuntime && bracket) {
      report.problem({ ...at, rule: 'env-var', message: `app code reads ${name} with bracket access`, fix: `Write process.env.${name}: Expo documents only dot access as inlined (bracket access is called invalid in its environment-variables guide).` });
    }
  }
}

function checkTests(rel, scan, report) {
  const { code, stringAt, lineOf } = scan;
  for (const match of code.matchAll(/(?<![\w$.])(it|test)(?:\.(?:each\([^)]*\)|only|skip))?\s*\(\s*(?=['"`])/g)) {
    const entry = stringAt.get(match.index + match[0].length);
    if (!entry) continue;
    const at = { file: rel, line: lineOf(match.index) };
    if (match[1] === 'test') report.problem({ ...at, rule: 'test-title', message: 'test() instead of it()', fix: "Write it('returns ...') inside describe('<exported name>')." });
    if (!TEST_TITLE.test(entry.value)) report.problem({ ...at, rule: 'test-title', message: `title "${entry.value}" does not start with a third-person verb or "can"`, fix: "Start with a verb: it('returns ...'), it('emits ...'), it('rejects ...')." });
  }
}

function checkDeclarations(rel, scan, report) {
  const { code, stringAt, lineOf } = scan;
  const at = (index) => ({ file: rel, line: lineOf(index) });
  for (const match of code.matchAll(/(?<![\w$.])type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=;]*>)?\s*=(?!=)/g)) {
    const name = match[1];
    if (!isPascal(name)) report.problem({ ...at(match.index), rule: 'type-name', message: `type ${name} is not PascalCase`, fix: 'Name types in PascalCase: TaskList, SettingsState.' });
    else if (/^I[A-Z][a-z]/.test(name)) report.problem({ ...at(match.index), rule: 'type-name', message: `type ${name} has an I prefix`, fix: `Drop the prefix: ${name.slice(1)}.` });
    else if ((name === 'Props' || name === 'State') && !/\.test\.tsx?$/.test(rel)) report.problem({ ...at(match.index), rule: 'type-name', message: `type named plain ${name}`, fix: `Name it after its owner: <Component>${name} (TaskRow${name}), <Domain>${name} (Settings${name}).` });
  }
  for (const match of code.matchAll(/(?<![\w$.])(?:const|let|var|function|class|type)\s+([A-Za-z_$][\w$]*)/g)) {
    if (hasAcronymRun(match[1])) report.problem({ ...at(match.index), rule: 'acronym-case', message: `${match[1]} spells an acronym in capitals`, fix: 'Treat acronyms as words: SqlDriver, isRtl, loadHttpUrl, ApiClient.' });
  }
  const booleans = [
    /(?<![\w$.])(?:const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*boolean\b(?!\s*[|&[])/g,
    /(?<![\w$.])(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:true|false)\s*[;,\n]/g,
    /[(,]\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*boolean\b(?!\s*[|&[])/g,
  ];
  for (const regex of booleans) {
    for (const match of code.matchAll(regex)) {
      if (!hasBooleanPrefix(match[1])) report.problem({ ...at(match.index), rule: 'boolean-name', message: `boolean ${match[1]} has no is/has/can/should/did/will/was prefix`, fix: `Name it as a question: is${match[1].charAt(0).toUpperCase()}${match[1].slice(1)}, has..., can...` });
    }
  }
  for (const match of code.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*/gm)) {
    const valueAt = match.index + match[0].length;
    const rest = code.slice(valueAt, valueAt + 400);
    const isLiteral = /^(?:-?\d[\d_.]*|['"]|\/(?![/*]))/.test(rest) && /^[^\n;]*;/.test(rest);
    const statementEnd = code.indexOf(';', valueAt);
    const isAsConst = /^[[{]/.test(rest) && /\bas\s+const\b(\s+satisfies\s+[^;]+)?\s*$/.test(code.slice(valueAt, statementEnd));
    const name = match[1];
    if ((isLiteral || isAsConst) && !isUpperSnake(name) && !stringAt.get(valueAt)?.quote?.startsWith('`')) {
      report.problem({ ...at(match.index), rule: 'constant-name', message: `module constant ${name} holds fixed data but is not UPPER_CASE`, fix: 'Name module-level fixed data in UPPER_CASE (MAX_TITLE_LENGTH, TASK_PRIORITIES); objects built by a call stay camelCase.' });
    }
  }
  // Handlers are the functions a component declares for its JSX: only .tsx files, and only names
  // declared as functions inside a body (an on* prop may also take a value, e.g. Skia's onSize).
  if (!rel.endsWith('.tsx')) return;
  for (const match of code.matchAll(/\bon[A-Z][\w$]*=\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    const name = match[1];
    const isLocalFunction = new RegExp(`^[ \\t]+(?:function\\s+${name}\\b|(?:const|let)\\s+${name}\\s*(?::[^=;]+)?=\\s*(?:async\\s*)?(?:function\\b|\\([^()]*\\)\\s*(?::\\s*[^=;]+)?=>|[A-Za-z_$][\\w$]*\\s*=>))`, 'm').test(code);
    if (isLocalFunction && !/^(handle|on)[A-Z]/.test(name)) report.problem({ ...at(match.index), rule: 'handler-name', message: `on* prop receives "${name}"`, fix: 'Name the handler handleX (handlePress) or pass the callback prop through (onPress={onPress}).' });
  }
  for (const match of code.matchAll(/^[ \t]+(?:const|let)\s+(on[A-Z][\w$]*)\s*(?::[^=;]+)?=\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=>/gm)) {
    report.problem({ ...at(match.index), rule: 'handler-name', message: `local handler named ${match[1]}`, fix: `Name local handlers handleX (handle${match[1].slice(2)}); onX is for callback props.` });
  }
}

function featureNames(root, ctx) {
  const names = new Set();
  for (const app of ctx.apps) {
    const dir = join(root, app.layout.featuresDir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) names.add(entry.name);
  }
  return names;
}

/** 1-based line of the key "<key>": in a catalog's raw JSON, or 1 when it is spelled with escapes. */
function catalogKeyLine(raw, lineOf, key) {
  const quoted = JSON.stringify(key).replace(/[.*+?^$|()[\]{}\\]/g, '\\$&');
  const match = new RegExp(`${quoted}\\s*:`).exec(raw);
  return match ? lineOf(match.index) : 1;
}

function checkCatalog(rel, root, ctx, namespace, report) {
  const raw = readFileSync(join(root, rel), 'utf8');
  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (error) {
    const line = Number(/line (\d+)/.exec(error.message)?.[1] ?? 1);
    report.problem({ file: rel, line, rule: 'i18n-key', message: `not valid JSON: ${error.message}`, fix: 'Keep catalogs flat JSON objects: key -> ICU message.' });
    return;
  }
  const ownPackage = packageOf(rel, ctx);
  const lineOf = makeLineOf(raw);
  for (const [key, message] of Object.entries(catalog)) {
    const at = { file: rel, line: catalogKeyLine(raw, lineOf, key) };
    const first = key.split('.')[0];
    if (!I18N_KEY.test(key)) {
      report.problem({ ...at, rule: 'i18n-key', message: `key '${key}' breaks the grammar`, fix: 'Use 2-5 dot-separated kebab-case segments, e.g. tasks.add-button.label.' });
    } else if (ownPackage !== null && first !== ownPackage) {
      report.problem({ ...at, rule: 'i18n-key-namespace', message: `package key '${key}' does not start with '${ownPackage}.'`, fix: `Prefix every key of this catalog with ${ownPackage}. so merged catalogs never collide.` });
    } else if (ownPackage === null && namespace.packages.has(first)) {
      report.problem({ ...at, rule: 'i18n-key-namespace', message: `app key '${key}' starts with the package id '${first}'`, fix: `Keys starting with ${first}. belong to the ${first} package's own catalogs; name app keys after a feature or area.` });
    } else if (ownPackage === null && namespace.areas !== null && !namespace.areas.has(first)) {
      report.problem({ ...at, rule: 'i18n-key-namespace', message: `key '${key}' starts with '${first}', which is not a feature folder or a declared key area`, fix: `Start keys with a feature folder name or one of contracts/naming.json "keyAreas" (${[...namespace.areas].sort().join(', ')}), or add the area there.` });
    }
    if (typeof message === 'string') checkPlaceholders(at, key, message, report);
  }
}

function checkPlaceholders(at, key, message, report) {
  let depth = 0;
  for (let i = 0; i < message.length; i += 1) {
    const ch = message[i];
    if (ch === "'" && /['{}]/.test(message[i + 1] ?? '')) {
      i += 1;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        const arg = /^\s*([^,}\s]+)\s*(?:,\s*([a-z]+))?/.exec(message.slice(i + 1));
        const name = arg?.[1] ?? '';
        const type = arg?.[2];
        const where = { ...at, rule: 'i18n-placeholder' };
        if (!/^[a-z][A-Za-z0-9]*$/.test(name)) report.problem({ ...where, message: `'${key}' has placeholder {${name}}`, fix: 'Name placeholders in camelCase after the value: {count, number}, {taskCount, plural, ...}, {listName}.' });
        else if (type === undefined && !/(Name|Text)$/.test(name)) report.problem({ ...where, message: `'${key}' has a plain {${name}}`, fix: 'Type numbers ({count, number}), make counts plurals, or name free text ...Name / ...Text ({listName}, {dueText}).' });
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
}

// Indentation of a YAML line, counting a list dash as indentation ("  - tapOn" is 4).
const yamlIndent = (line) => /^\s*/.exec(line.replace(/^(\s*)-\s/, '$1  '))[0].length;
const isContent = (line) => line.trim() !== '' && !line.trim().startsWith('#');
const unquote = (text) => text.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Index of the nearest line above i with a smaller indentation (its YAML parent), or -1. */
function parentOf(lines, i) {
  const own = yamlIndent(lines[i]);
  for (let j = i - 1; j >= 0; j -= 1) if (isContent(lines[j]) && yamlIndent(lines[j]) < own) return j;
  return -1;
}

/** Indexes of the lines inside the block that starts at line k (deeper indentation). */
function childrenOf(lines, k) {
  const out = [];
  for (let j = k + 1; j < lines.length; j += 1) {
    if (!isContent(lines[j])) continue;
    if (yamlIndent(lines[j]) <= yamlIndent(lines[k])) break;
    out.push(j);
  }
  return out;
}

/** The text of `when: visible: '<text>'` and the texts tapped under `commands:` of one runFlow. */
function guardOf(lines, runFlow) {
  let visible = null;
  const tapped = [];
  for (const j of childrenOf(lines, runFlow)) {
    if (/^\s*when:\s*$/.test(lines[j])) {
      for (const c of childrenOf(lines, j)) visible = /^\s*visible:\s*(.+?)\s*(#.*)?$/.exec(lines[c])?.[1] ?? visible;
    }
    if (/^\s*commands:\s*$/.test(lines[j])) {
      for (const c of childrenOf(lines, j)) {
        const tap = /^\s*-?\s*tapOn:\s*(['"]?)([^'"#{][^'"#]*)\1\s*(#.*)?$/.exec(lines[c]);
        if (tap) tapped.push(tap[2].trim());
      }
    }
  }
  return visible === null ? null : { visible: unquote(visible), tapped };
}

/**
 * True when line i belongs to an OS-dialog guard: a runFlow whose `when: visible:` text equals the
 * text it taps under `commands:` (the dialog is tapped only when it shows).
 */
function isDialogGuard(lines, i, text) {
  for (let k = parentOf(lines, i); k >= 0; k = parentOf(lines, k)) {
    if (!/^\s*-?\s*runFlow:\s*$/.test(lines[k])) continue;
    const guard = guardOf(lines, k);
    return guard !== null && guard.visible === text && guard.tapped.includes(text);
  }
  return false;
}

// "# system-ui: <why>": OS-owned UI with no testID (iOS "Open in ...?" link alert, Android's
// permission dialog, a test ad), on that line or up to 6 lines above.
const SYSTEM_UI = /#\s*system-ui:\s*\S.{5,}/;

function underSystemUi(lines, i) {
  for (let j = i; j >= 0 && j >= i - 6; j -= 1) if (SYSTEM_UI.test(lines[j])) return true;
  return false;
}

function checkFlow(rel, root, report) {
  const lines = readFileSync(join(root, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const at = { file: rel, line: i + 1, rule: 'maestro-selector' };
    const isSystemUi = underSystemUi(lines, i);
    const shorthand = /^\s*-?\s*(tapOn|doubleTapOn|longPressOn|assertVisible|assertNotVisible|scrollUntilVisible|visible|notVisible):\s*(['"]?)([^'"#\s{][^'"#]*)\2\s*(#.*)?$/.exec(line);
    if (shorthand && !isSystemUi && !/system dialog/i.test(shorthand[4] ?? '') && !isDialogGuard(lines, i, shorthand[3].trim())) {
      report.problem({ ...at, message: `${shorthand[1]} selects by text "${shorthand[3].trim()}"`, fix: `Select by id: ${shorthand[1]}: { id: '<screen>.<element>' }; flows must run unchanged in every locale (OS-owned UI without a testID: a "# system-ui: <why>" comment above it, or mark the line "# system dialog").` });
    }
    const id = /^\s*-?\s*id:\s*(['"]?)([^'"#]+)\1\s*$/.exec(line);
    if (id && !/[*+?[\]()\\|^$]/.test(id[2]) && !id[2].includes('${') && !TEST_ID.test(id[2].trim())) {
      report.problem({ ...at, message: `id "${id[2].trim()}" is not a valid testID`, fix: "Use the element's '<screen>.<element>' testID." });
    }
    if (/^\s*-?\s*text:\s/.test(line)) {
      const own = yamlIndent(line);
      let hasId = false;
      for (let j = i - 1; j >= 0 && yamlIndent(lines[j]) >= own && lines[j].trim() !== ''; j -= 1) if (yamlIndent(lines[j]) === own && /^\s*-?\s*id:/.test(lines[j])) hasId = true;
      for (let j = i + 1; j < lines.length && yamlIndent(lines[j]) >= own && lines[j].trim() !== ''; j += 1) if (yamlIndent(lines[j]) === own && /^\s*id:/.test(lines[j])) hasId = true;
      if (!hasId && !isSystemUi) report.problem({ ...at, message: 'selector by text without an id', fix: 'Select by id; a text matcher may only narrow an id selector (id + text). OS-owned UI without a testID goes under a "# system-ui: <why>" comment.' });
    }
  });
}

/**
 * SKIP lines for the catalogs and flows an Expo app adopting the skills has not created yet: one pair
 * per Expo app (the root of a single-app repo; each app workspace of a multi-package repo, never a
 * root or package that is not an Expo app).
 */
function reportNotYetCreated(root, ctx, report) {
  for (const app of ctx.apps.filter((item) => item.isExpoApp)) {
    const catalogs = `${app.layout.i18nDir}/catalogs`;
    const catalogsReason = notYetCreated(root, { file: catalogs, owner: 'i18n-strings-and-catalogs' });
    if (catalogsReason) report.skip({ file: catalogs, rule: 'i18n-key', message: catalogsReason });
    const flowsReason = notYetCreated(root, { file: app.layout.e2eDir, owner: 'e2e-maestro' });
    if (flowsReason) report.skip({ file: app.layout.e2eDir, rule: 'maestro-selector', message: flowsReason });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-code-names', json: options.json });
  const ctx = namingContext(root, { contract: options.contract });
  const note = missingContractNote(ctx);
  if (note) report.note(note);
  const files = walkRepo(root);
  const areas = ctx.contract.keyAreas === null ? null : new Set([...ctx.contract.keyAreas, ...featureNames(root, ctx)]);
  const packages = new Set(ctx.apps.filter((app) => !app.isRoot && !app.isExpoApp).map((app) => app.dir.split('/').at(-1)));
  if (!files.some((rel) => SOURCE.test(rel) && (ctx.isOwned(rel) || /^[^/]+\.tsx?$/.test(rel)))) {
    fail(`nothing to check: no .ts/.tsx files in ${ctx.layout.srcDir}/, ${ctx.layout.testDir}/, ${ctx.layout.scriptsDir}/ or plugins/`, 'Run it from the app repo root, or pass the root: node check-code-names.mjs <repo-root>.');
  }
  reportNotYetCreated(root, ctx, report);
  const namespace = { areas, packages };
  let checked = 0;
  for (const rel of files) {
    const isRootTs = /^[^/]+\.tsx?$/.test(rel);
    if (!ctx.isOwned(rel) && !isRootTs) continue;
    if (SOURCE.test(rel)) {
      checked += 1;
      const text = readFileSync(join(root, rel), 'utf8');
      const scan = scanSource(text);
      const isMock = under(rel, ctx.appOf(rel).layout.mocksDir) || under(rel, ctx.layout.mocksDir);
      if (!ctx.isTooling(rel)) {
        const failedTestIds = checkTestIds(rel, scan, text, report);
        if (rel.endsWith('.tsx') && !ctx.isTest(rel)) checkTestIdRoles(rel, text, ctx, failedTestIds, report);
        checkKinds(rel, scan, ctx, report);
        checkKeyCalls(rel, scan, ctx, namespace, report);
      }
      checkEnv(rel, scan, ctx, report);
      if (/\.test\.tsx?$/.test(rel)) checkTests(rel, scan, report);
      if (!isMock) checkDeclarations(rel, scan, report);
      continue;
    }
    const i18n = ctx.roleOf(rel, 'i18nDir');
    if (i18n !== null && new RegExp(`^${i18n.replaceAll('.', '\\.')}/catalogs/[^/]+\\.json$`).test(rel)) {
      checked += 1;
      checkCatalog(rel, root, ctx, namespace, report);
      continue;
    }
    const e2e = ctx.roleOf(rel, 'e2eDir');
    if (e2e !== null && under(rel, e2e) && /\.ya?ml$/.test(rel) && !/(^|\/)config\.ya?ml$/.test(rel)) {
      checked += 1;
      checkFlow(rel, root, report);
    }
  }
  return report.finish({ checked, unit: 'files' });
});
