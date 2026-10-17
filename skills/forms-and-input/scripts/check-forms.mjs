#!/usr/bin/env node
// check-forms.mjs: checks the forms and text input of an Expo app: one valibot schema per form behind
// the resolver, catalog keys as every message, a synchronous Hermes-safe schema that reads digits in
// any script, fields bound the React Native way (onChangeText, the ref wired), one labelled field
// component with input presets, and the keyboard (provider, keyboard-aware scrolling, taps that
// survive an open keyboard, a Done bar for the pads that have no return key).
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-forms.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { findCalls, findClosing, findJsxTags, isTestFile, jsxAttributes, literalOf, maskCode, resolveSpecifier } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-forms',
  summary: 'Checks the forms, text fields and keyboard handling of the app source folders (tests excluded).',
  usage: '[repo-root] [options]',
  options: {
    src: { type: 'string', multiple: true, value: 'dir', help: 'Source folder to scan, repo-relative (default: the layout srcDir and routesDir of the app and of every workspace)' },
    'field-dir': { type: 'string', multiple: true, value: 'dir', help: 'Folder of the field components, the only place a raw TextInput may live (default: <uiDir>/form)' },
    catalog: { type: 'string', value: 'file', help: 'Source catalog the message keys must exist in (default: <i18nDir>/catalogs/<SOURCE_LANGUAGE>.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Scans the runtime .ts/.tsx files with the shared repo walk (agent skill folders, generated native folders,',
    'build output and any folder holding a SKILL.md are skipped); tests (*.test.*, *.spec.*, __tests__/, __mocks__/,',
    'the test/ folder) and *.d.ts are left out. A form schema is a module whose schema a valibotResolver(...) call',
    'receives (imported or declared in the same file).',
    '',
    'Rules:',
    '  form-resolver          every useForm(...) passes resolver: valibotResolver(schema); no rules= / rules: on a',
    '                         Controller or useController (validation lives in the one schema)',
    "  form-mode              useForm mode is not 'onChange' or 'all' (errors before the first blur); use 'onTouched'",
    '  focus-error            useForm never sets shouldFocusError: false (a refused submit focuses the first invalid field)',
    '  schema-message-key     every valibot validation action in a form schema carries its message as a string literal',
    '                         that is a key of the source catalog (no message = valibot\'s English default on screen)',
    '  error-message-key      a setError(name, { message }) message is a literal key of the source catalog',
    '  schema-async           a form schema uses no *Async valibot API (pipeAsync, checkAsync, objectAsync ...): the',
    '                         resolver runs the whole schema on every validation, without debounce, cancel or deadline',
    '  schema-segmenter       no graphemes/words actions (minGraphemes, maxWords ...) unless the Intl.Segmenter',
    '                         polyfill is forced in <i18nDir>/intl-polyfills.ts (Hermes has no Intl.Segmenter)',
    '  latin-digits           a form schema that reads digits (\\d or [0-9] in a regex, digits(), decimal(), Number(),',
    '                         parseInt(), parseFloat(), Number.parseInt(), Number.parseFloat(), toNumber(), the',
    '                         point-free transform(Number) / .map(Number)) calls a digit normalizer first: toLatinDigits, or',
    '                         normalizeDecimalInput for a decimal, money or quantity field (keyboards type ٣٠ and ۳۰)',
    '  raw-text-input         TextInput (react-native or gesture-handler) is imported only in the field folder; screens',
    '                         render TextField with a kind',
    '  input-label            every <TextInput> has accessibilityLabel or aria-label, or a spread that supplies it (a',
    '                         placeholder is not a name; accessibilityLabelledBy / aria-labelledby are Android and web',
    '                         only and give VoiceOver no name, so they may sit next to the label but never replace it)',
    '  input-preset           a <TextInput> with secureTextEntry sets autoComplete (or textContentType); one with the',
    "                         email keyboard sets autoCapitalize ('none'); a spread may supply both",
    '  field-on-change        a react-hook-form field reaches an input through onChangeText: never onChange={field.onChange},',
    '                         {...field} or {...register(...)} (a React Native change event has no target.value)',
    '  field-ref              a file that calls useController or renders <Controller> passes the field ref on',
    '                         (setFocus and shouldFocusError call ref.focus())',
    '  keyboard-provider      when any file imports react-native-keyboard-controller, a file renders <KeyboardProvider>',
    '  keyboard-aware-scroll  a file that renders a text field scrolls with KeyboardAwareScrollView, never ScrollView,',
    "                         Animated.ScrollView or React Native's KeyboardAvoidingView (Android edge-to-edge no longer",
    '                         resizes the window); a horizontal ScrollView (a chip row) is not the form\'s scroller and is',
    '                         left alone. A screen file (*-screen.tsx or a route file) that renders two or more text',
    '                         fields and no scroll container at all fails too (a search field above a list passes)',
    '  keyboard-persist-taps  a scroll container in a file that renders a text field sets keyboardShouldPersistTaps',
    '                         ("handled"), so the first tap on Save presses it instead of only closing the keyboard',
    '  pad-done-bar           a feature folder with a pad field (kind integer, decimal, phone or one-time-code, or a',
    '                         TextInput with a numeric, decimal or phone keyboard) renders a Done bar (KeyboardDoneBar, or',
    '                         a tag listed in forms.doneBars): the iOS pads have no return key',
    '',
    'NOT APPLICABLE when no app file imports react-hook-form, TextInput or react-native-keyboard-controller.',
    'SKIP (schema-message-key, error-message-key) while the source catalog does not exist (i18n-strings-and-catalogs).',
    '',
    'rn-skills.config.json keys (all optional; paths repo-relative):',
    '  "forms": { "fieldDirs": ["src/ui/form"], "fieldComponents": ["TextField"], "padKinds": ["integer", "decimal",',
    '             "phone", "one-time-code"], "doneBars": ["KeyboardDoneBar"], "digitNormalizers": ["toLatinDigits",',
    '             "normalizeDecimalInput"], "sourceCatalog": "src/i18n/catalogs/en.json" }',
  ].join('\n'),
};

const SOURCE_GLOBS = ['*.ts', '*.tsx'];
const RN_MODULES = new Set(['react-native', 'react-native-gesture-handler']);
const KBC = 'react-native-keyboard-controller';
const DEFAULTS = {
  fieldComponents: ['TextField'],
  padKinds: ['integer', 'decimal', 'phone', 'one-time-code'],
  doneBars: ['KeyboardDoneBar'],
  digitNormalizers: ['toLatinDigits', 'normalizeDecimalInput'],
};
// valibot 1.5.0 validation actions and the index of their message argument (from index.d.mts).
const MESSAGE_AT = new Map([
  ...[
    'base64', 'bic', 'creditCard', 'cuid2', 'decimal', 'digits', 'domain', 'email', 'emoji', 'empty', 'finite',
    'hexColor', 'hexadecimal', 'imei', 'integer', 'ip', 'ipv4', 'ipv6', 'isbn', 'isoDate', 'isoDateTime',
    'isoDateTimeSecond', 'isoTime', 'isoTimeSecond', 'isoTimestamp', 'isoWeek', 'isrc', 'jwsCompact', 'ksuid',
    'mac', 'mac48', 'mac64', 'nanoid', 'nonEmpty', 'octal', 'rfcEmail', 'safeInteger', 'slug', 'ulid', 'url', 'uuid',
  ].map((name) => [name, 0]),
  ...[
    'bytes', 'check', 'checkItems', 'codePoints', 'endsWith', 'entries', 'everyItem', 'excludes', 'graphemes',
    'gtValue', 'hash', 'includes', 'length', 'ltValue', 'maxBytes', 'maxCodePoints', 'maxEntries', 'maxGraphemes',
    'maxLength', 'maxSize', 'maxValue', 'mimeType', 'minBytes', 'minCodePoints', 'minEntries', 'minGraphemes',
    'minLength', 'minSize', 'minValue', 'multipleOf', 'notBytes', 'notCodePoints', 'notEntries', 'notGraphemes',
    'notLength', 'notSize', 'notValue', 'notValues', 'regex', 'size', 'someItem', 'startsWith', 'value', 'values',
  ].map((name) => [name, 1]),
  ...['maxWords', 'minWords', 'notWords', 'partialCheck', 'words'].map((name) => [name, 2]),
]);
const SEGMENTER_ACTIONS = new Set(['graphemes', 'maxGraphemes', 'minGraphemes', 'notGraphemes', 'words', 'maxWords', 'minWords', 'notWords']);
const SCROLLERS = new Set(['ScrollView', 'KeyboardAwareScrollView', 'FlatList', 'SectionList', 'FlashList', 'Animated.ScrollView', 'Animated.FlatList']);
const PAD_INPUT_MODES = new Set(['numeric', 'decimal', 'tel']);
const PAD_KEYBOARDS = new Set(['number-pad', 'decimal-pad', 'phone-pad', 'numeric']);
const DIGIT_READS = [
  /\\d/,
  /\[0-9/,
  /(?<![\w$.])(?:Number|parseInt|parseFloat)\s*\(/,
  // Number.parseInt(text, 10) / Number.parseFloat(text): the member forms of the same conversion.
  /\bNumber\s*\.\s*parse(?:Int|Float)\s*\(/,
  // The point-free forms: v.transform(Number), text.split(',').map(Number).
  /\b(?:transform|map)\s*\(\s*(?:Number(?:\s*\.\s*parse(?:Int|Float))?|parseInt|parseFloat)\s*\)/,
  /\.\s*(?:digits|decimal|toNumber)\s*\(/,
  /(?<![\w$.])(?:digits|decimal|toNumber)\s*\(/,
];
/** Containers that scroll a form; any of them (or an alias ending in one) is the screen's scroller. */
const SCROLLER_TAIL = /(?:^|\.)(?:ScrollView|KeyboardAwareScrollView|FlatList|SectionList|FlashList|VirtualizedList)$/;

const read = (abs) => readFileSync(abs, 'utf8');
const under = (rel, dir) => dir === '.' || dir === '' || rel === dir || rel.startsWith(`${dir}/`);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, (c) => `\\${c}`);

/** Import statements of one module: [{ index, typeOnly, names: [{ local, imported, typeOnly }], namespace }]. */
function importsOf(text, module, masked = null) {
  const out = [];
  const re = new RegExp(`import\\s+(type\\s+)?([^;]*?)\\s+from\\s*['"]${escapeRe(module)}['"]`, 'g');
  for (const match of text.matchAll(re)) {
    if (masked !== null && masked.slice(match.index, match.index + 6) !== 'import') continue; // inside a string
    const clause = match[2];
    const typeOnly = match[1] !== undefined;
    const namespace = /\*\s+as\s+([\w$]+)/.exec(clause)?.[1] ?? null;
    const braces = /\{([^}]*)\}/.exec(clause);
    const names = (braces ? braces[1].split(',') : []).map((part) => part.trim()).filter(Boolean).map((part) => {
      const isType = /^type\s+/.test(part);
      const [imported, local] = part.replace(/^type\s+/, '').split(/\s+as\s+/).map((name) => name.trim());
      return { imported, local: local ?? imported, typeOnly: typeOnly || isType };
    });
    out.push({ index: match.index, typeOnly, names, namespace });
  }
  return out;
}

/** Top-level argument ranges [{ from, to }] of the call whose parentheses are at open/close in masked code. */
function argsOf(masked, open, close) {
  const args = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push({ from, to: i });
      from = i + 1;
    }
  }
  if (masked.slice(from, close).trim() !== '') args.push({ from, to: close });
  return args;
}

/** Calls of `name`, also with type arguments (useForm<Input, unknown, Output>(...)): [{ start, open, close }]. */
function callsOf(masked, name) {
  const calls = [];
  for (const match of masked.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(name)}\\b`, 'g'))) {
    let i = match.index + match[0].length;
    while (/\s/.test(masked[i] ?? '')) i += 1;
    if (masked[i] === '<') {
      let depth = 0;
      for (; i < masked.length; i += 1) {
        if (masked[i] === '<') depth += 1;
        else if (masked[i] === '>' && masked[i - 1] !== '=') depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
      while (/\s/.test(masked[i] ?? '')) i += 1;
    }
    if (masked[i] !== '(') continue;
    const close = findClosing(masked, i);
    if (close !== -1) calls.push({ start: match.index, open: i, close });
  }
  return calls;
}

/** The value of a plain string literal ('x', "x", `x` without ${}), or null. */
function stringLiteral(text) {
  const match = /^(['"`])([\s\S]*)\1$/.exec(text.trim());
  if (!match || (match[1] === '`' && match[2].includes('${'))) return null;
  return match[2];
}

function readSettings(layout, options) {
  const raw = layout.config?.forms ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('rn-skills.config.json "forms" must be an object', 'Write "forms": { "fieldDirs": ["src/ui/form"] } or remove the key.');
  const list = (key, fallback) => {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) fail(`rn-skills.config.json "forms.${key}" must be a list of non-empty strings`, `Write "forms": { "${key}": [...] } or remove the key.`);
    return value;
  };
  const text = (key, fallback) => {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value === '') fail(`rn-skills.config.json "forms.${key}" must be a non-empty string`, `Write "forms": { "${key}": "..." } or remove the key.`);
    return value;
  };
  return {
    fieldDirs: options['field-dir']?.length ? options['field-dir'] : list('fieldDirs', null),
    fieldComponents: list('fieldComponents', DEFAULTS.fieldComponents),
    padKinds: list('padKinds', DEFAULTS.padKinds),
    doneBars: list('doneBars', DEFAULTS.doneBars),
    digitNormalizers: list('digitNormalizers', DEFAULTS.digitNormalizers),
    sourceCatalog: options.catalog ?? text('sourceCatalog', null),
  };
}

/** The apps of the repo: the root app and each workspace, with their folders. */
function appsOf(layout, settings, options) {
  const apps = [{ dir: '', layout }, ...layout.workspaces.map((workspace) => ({ dir: workspace.dir, layout: workspace.layout }))];
  return apps.map((app) => ({
    dir: app.dir,
    srcDirs: [...new Set(options.src?.length ? options.src : [app.layout.srcDir, app.layout.routesDir])],
    fieldDirs: settings.fieldDirs ?? [`${app.layout.uiDir}/form`],
    featuresDir: app.layout.featuresDir,
    routesDir: app.layout.routesDir,
    i18nDir: app.layout.i18nDir,
  }));
}

/** SOURCE_LANGUAGE of <i18nDir>/languages.ts, or 'en'. */
function sourceLanguage(root, i18nDir) {
  const abs = join(root, i18nDir, 'languages.ts');
  if (!existsSync(abs)) return 'en';
  const match = /\bSOURCE_LANGUAGE\b[^=]*=\s*['"]([^'"]+)['"]/.exec(maskComments(read(abs)));
  return match ? match[1] : 'en';
}

function loadCatalog(root, rel) {
  if (!existsSync(join(root, rel))) return null;
  try {
    const data = JSON.parse(read(join(root, rel)));
    if (typeof data !== 'object' || data === null || Array.isArray(data)) fail(`${rel} is not a JSON object of messages`, 'Keep the catalog a flat JSON object of key to message.');
    return new Set(Object.keys(data));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${rel} is not valid JSON: ${error.message}`, 'Fix the catalog JSON (i18n-strings-and-catalogs).');
    throw error;
  }
}

/** One scanned source file. */
function scanFile(root, rel) {
  const source = read(join(root, rel));
  const masked = maskCode(source);
  const noComments = maskComments(source);
  const tags = rel.endsWith('.tsx') ? findJsxTags(source, masked) : [];
  return { rel, source, masked, noComments, tags, attrsOf: (tag) => jsxAttributes(source, tag, masked) };
}

const importsModule = (file, module) => fileImports(file, module).length > 0;
/** Import statements of a module in a scanned file (none inside strings or comments). */
const fileImports = (file, module) => importsOf(file.noComments, module, file.masked);
const hasSpread = (attrs) => [...attrs.values()].some((attr) => attr.kind === 'spread');
const tagNamed = (file, names) => file.tags.filter((tag) => names.has(tag.name));

/** The value-imported TextInput locals and namespaces of react-native / gesture-handler. */
function textInputImports(file) {
  const found = [];
  for (const module of RN_MODULES) {
    for (const statement of fileImports(file, module)) {
      for (const name of statement.names) if (name.imported === 'TextInput' && !name.typeOnly) found.push({ index: statement.index, local: name.local, module });
      if (statement.namespace && !statement.typeOnly) found.push({ index: statement.index, namespace: statement.namespace, module });
    }
  }
  return found;
}

/** Tag names that render a text field in this file: TextInput locals, NS.TextInput, the field components. */
function fieldTagNames(file, settings) {
  const names = new Set(settings.fieldComponents);
  for (const found of textInputImports(file)) {
    if (found.local) names.add(found.local);
    if (found.namespace) names.add(`${found.namespace}.TextInput`);
  }
  return names;
}

function textInputTagNames(file) {
  const names = new Set();
  for (const found of textInputImports(file)) {
    if (found.local) names.add(found.local);
    if (found.namespace) names.add(`${found.namespace}.TextInput`);
  }
  return names;
}

// ------------------------------------------------------------------------------------------------
// Rules
// ------------------------------------------------------------------------------------------------

function checkRawTextInput(ctx, file, app) {
  if (app.fieldDirs.some((dir) => under(file.rel, dir))) return;
  for (const found of textInputImports(file)) {
    if (found.local) {
      ctx.problem(file, found.index, 'raw-text-input', `TextInput imported from ${found.module} outside the field folder (${app.fieldDirs.join(', ')})`, 'Render TextField with a kind (label, error, keyboard and autofill come with it); a new input look becomes a field component in the field folder.');
    }
  }
  for (const tag of file.tags) {
    if (tag.name.endsWith('.TextInput')) ctx.problem(file, tag.start, 'raw-text-input', `<${tag.name}> rendered outside the field folder (${app.fieldDirs.join(', ')})`, 'Render TextField with a kind instead of a raw TextInput.');
  }
}

function checkInputs(ctx, file) {
  for (const tag of tagNamed(file, textInputTagNames(file))) {
    const attrs = file.attrsOf(tag);
    const spread = hasSpread(attrs);
    const named = ['accessibilityLabel', 'aria-label'].some((key) => attrs.has(key));
    if (!named && !spread) {
      const labelledBy = ['accessibilityLabelledBy', 'aria-labelledby'].find((key) => attrs.has(key));
      const why = labelledBy
        ? `is named only by ${labelledBy}, which is Android and web only: VoiceOver gets no name`
        : attrs.has('placeholder') ? 'has only a placeholder, which VoiceOver and TalkBack stop reading once text is typed' : 'has no accessible name';
      ctx.problem(file, tag.start, 'input-label', `<${tag.name}> ${why}`, 'Give the input its visible label as accessibilityLabel (TextField does this from its label prop; on Android it points at the label with accessibilityLabelledBy instead).');
    }
    if (spread) continue;
    const secure = attrs.get('secureTextEntry');
    const isSecure = secure !== undefined && !(secure.kind === 'expr' && secure.value === 'false');
    if (isSecure && !attrs.has('autoComplete') && !attrs.has('textContentType')) {
      ctx.problem(file, tag.start, 'input-preset', `<${tag.name}> hides its text but sets no autoComplete`, "Set autoComplete='current-password' or 'new-password' (React Native maps it to iOS textContentType and the Android autofill hint), or use a password kind.");
    }
    const keyboard = literalOf(attrs.get('keyboardType')) ?? literalOf(attrs.get('inputMode'));
    if ((keyboard === 'email-address' || keyboard === 'email') && !attrs.has('autoCapitalize')) {
      ctx.problem(file, tag.start, 'input-preset', `<${tag.name}> has the email keyboard but no autoCapitalize`, "Set autoCapitalize='none' (and autoComplete='email'), or use the email kind: every address would start with a capital letter.");
    }
  }
}

function checkFieldBinding(ctx, file) {
  if (!importsModule(file, 'react-hook-form')) return;
  for (const tag of file.tags) {
    const attrs = file.attrsOf(tag);
    const onChange = attrs.get('onChange');
    if (onChange?.kind === 'expr' && /(^|\.)onChange$/.test(onChange.value)) {
      ctx.problem(file, onChange.index, 'field-on-change', `onChange={${onChange.value}} on <${tag.name}>`, 'Pass onChangeText={field.onChange}: react-hook-form reads event.target.value, which a React Native change event lacks, so the field would hold undefined.');
    }
    for (const attr of attrs.values()) {
      if (attr.kind === 'spread' && /^\s*\.\.\.\s*(?:field|register\s*\()/.test(attr.value)) {
        ctx.problem(file, attr.index, 'field-on-change', `{${attr.value.trim()}} spread onto <${tag.name}>`, 'Bind value, onChangeText, onBlur and ref one by one (useTextField does it): the spread passes onChange, and register() needs a DOM input.');
      }
    }
  }
  const usesController = callsOf(file.masked, 'useController').length > 0 || file.tags.some((tag) => tag.name === 'Controller');
  if (usesController && !/\.\s*ref\b(?!\s*\()|[{,]\s*ref\s*[,}]|\.\.\.\s*field\b/.test(file.masked)) {
    const at = callsOf(file.masked, 'useController')[0]?.start ?? file.tags.find((tag) => tag.name === 'Controller')?.start ?? 0;
    ctx.problem(file, at, 'field-ref', 'a controlled field whose ref is never passed on', 'Pass field.ref to the input (ref={field.ref}): setFocus and shouldFocusError call ref.focus().');
  }
  for (const tag of file.tags.filter((item) => item.name === 'Controller')) {
    const rules = file.attrsOf(tag).get('rules');
    if (rules) ctx.problem(file, rules.index, 'form-resolver', 'validation rules on a Controller', 'Move the check into the form schema (valibot), so one schema gives the type and every message.');
  }
  for (const call of callsOf(file.masked, 'useController')) {
    const rules = /\brules\s*:/.exec(file.masked.slice(call.open, call.close));
    if (rules) ctx.problem(file, call.open + rules.index, 'form-resolver', 'validation rules on useController', 'Move the check into the form schema (valibot).');
  }
}

function checkUseForm(ctx, file) {
  for (const call of callsOf(file.masked, 'useForm')) {
    const args = file.masked.slice(call.open + 1, call.close);
    const original = file.source.slice(call.open + 1, call.close);
    if (!/\bresolver\s*:|\bresolver\b\s*[,}]/.test(args)) {
      ctx.problem(file, call.start, 'form-resolver', 'useForm without a resolver', 'Pass resolver: valibotResolver(schema): one valibot schema gives the form its types, its checks and its message keys.');
    }
    const mode = /\bmode\s*:\s*(['"`])(\w+)\1/.exec(original);
    if (mode && (mode[2] === 'onChange' || mode[2] === 'all')) {
      ctx.problem(file, call.open + 1 + mode.index, 'form-mode', `useForm mode '${mode[2]}' shows an error while the first character is typed`, "Use mode: 'onTouched' (quiet until the first blur, then live).");
    }
    const focus = /\bshouldFocusError\s*:\s*false\b/.exec(args);
    if (focus) ctx.problem(file, call.open + 1 + focus.index, 'focus-error', 'shouldFocusError: false', 'Keep the default: a refused submit then focuses the first invalid field, and VoiceOver and TalkBack move there.');
  }
}

/** valibot names in a file: { namespaces: [...], named: Map(local -> imported) }. */
function valibotNames(file) {
  const namespaces = [];
  const named = new Map();
  for (const statement of fileImports(file, 'valibot')) {
    if (statement.typeOnly) continue;
    if (statement.namespace) namespaces.push(statement.namespace);
    for (const name of statement.names) if (!name.typeOnly) named.set(name.local, name.imported);
  }
  return { namespaces, named };
}

/** Calls of valibot functions in a file: [{ name, start, open, close }]. */
function valibotCalls(file) {
  const { namespaces, named } = valibotNames(file);
  const calls = [];
  for (const ns of namespaces) {
    for (const match of file.masked.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(ns)}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'))) {
      const open = match.index + match[0].length - 1;
      calls.push({ name: match[1], start: match.index, open, close: findClosing(file.masked, open) });
    }
  }
  for (const [local, imported] of named) {
    for (const call of findCalls(file.masked, escapeRe(local))) calls.push({ name: imported, ...call });
  }
  return calls.filter((call) => call.close !== -1);
}

/** Files whose schema reaches valibotResolver(...): Map(rel -> resolver file rel). */
function formSchemaFiles(root, files) {
  const byRel = new Map(files.map((file) => [file.rel, file]));
  const schemas = new Map();
  for (const file of files) {
    for (const call of callsOf(file.masked, 'valibotResolver')) {
      const first = argsOf(file.masked, call.open, call.close)[0];
      const name = first ? /^\s*([A-Za-z_$][\w$]*)/.exec(file.source.slice(first.from, first.to))?.[1] : undefined;
      if (!name) continue;
      let target = file.rel;
      for (const match of file.noComments.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        const locals = match[1].split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim());
        if (!locals.includes(name)) continue;
        const resolved = resolveSpecifier(file.rel, match[2], { root });
        if (resolved && byRel.has(resolved)) target = resolved;
      }
      if (!schemas.has(target)) schemas.set(target, file.rel);
    }
  }
  return schemas;
}

/** A string constant declared in the file: `const NAME = 'x'`, or null. */
function constantValue(file, name) {
  const match = new RegExp(`\\bconst\\s+${escapeRe(name)}\\s*(?::[^=]+)?=\\s*(['"\`])([^'"\`$]*)\\1`).exec(file.noComments);
  return match ? match[2] : null;
}

function checkMessageArgument(ctx, file, call, catalog, rule) {
  const at = MESSAGE_AT.get(call.name);
  if (at === undefined) return;
  const args = argsOf(file.masked, call.open, call.close);
  const where = `${call.name}(...)`;
  if (args.length <= at) {
    ctx.problem(file, call.start, rule, `${where} has no message: valibot's English default would reach the screen`, `Pass a catalog key as the message: ${call.name}(${at > 0 ? '..., ' : ''}'<feature>.<field>.<problem>').`);
    return;
  }
  const text = file.source.slice(args[at].from, args[at].to).trim();
  const value = stringLiteral(text) ?? (/^[A-Za-z_$][\w$]*$/.test(text) ? constantValue(file, text) : null);
  if (value === null) {
    ctx.problem(file, call.start, rule, `${where} message ${text} is not a literal catalog key`, 'Write the key as a string literal so the checkers, the catalog parity check and the reviewer can see it.');
  } else if (catalog !== null && !catalog.keys.has(value)) {
    ctx.problem(file, call.start, rule, `${where} message '${value}' is not a key of ${catalog.rel}`, 'Add the key to every catalog (i18n-strings-and-catalogs), or use an existing key.');
  }
}

function checkSchemas(ctx, root, files, catalogs, settings) {
  const skipped = new Set();
  for (const [rel] of formSchemaFiles(root, files)) {
    const file = files.find((item) => item.rel === rel);
    const catalog = catalogs(rel);
    const calls = valibotCalls(file);
    for (const call of calls) {
      if (catalog.skip === null) checkMessageArgument(ctx, file, call, catalog, 'schema-message-key');
      if (/Async$/.test(call.name)) {
        ctx.problem(file, call.start, 'schema-async', `${call.name}(...) in a form schema`, 'Keep the schema synchronous; run the check with useAsyncFieldCheck (debounced, latest wins, a deadline, cancelled on unmount) and let the server judge again at write time.');
      }
    }
    const digits = DIGIT_READS.map((re) => re.exec(file.noComments)).filter(Boolean).sort((a, b) => a.index - b.index)[0];
    const normalizers = settings.digitNormalizers;
    // An import alone does not normalize anything (the call was deleted, the import left behind).
    const code = file.masked.replace(/\bimport\s[^;]*?\bfrom\s*['"][^'"]*['"]\s*;?/g, (statement) => ' '.repeat(statement.length));
    if (digits && !normalizers.some((name) => new RegExp(`\\b${escapeRe(name)}\\b`).test(code))) {
      const [first, ...others] = normalizers;
      const named = others.length === 0 ? first : `${first} or ${others.join(' or ')}`;
      ctx.problem(file, digits.index, 'latin-digits', `the schema reads digits without ${named}`, `Transform the text with ${first} before the check (v.transform(${first}))${normalizers.includes('normalizeDecimalInput') ? '; a decimal, money or quantity field uses normalizeDecimalInput (value-objects-money-and-units)' : ''}: Arabic, Persian and Devanagari keyboards type their own digits, which \\d and Number() refuse.`);
    }
    if (catalog.skip !== null && !skipped.has(catalog.rel)) {
      skipped.add(catalog.rel);
      ctx.skip({ file: catalog.rel, rule: 'schema-message-key', message: catalog.skip });
    }
  }
}

function checkSetError(ctx, file, catalog) {
  for (const call of findCalls(file.masked, '(?:[\\w$]+\\s*\\.\\s*)?setError')) {
    const args = argsOf(file.masked, call.open, call.close);
    if (args.length < 2) continue;
    const options = file.masked.slice(args[1].from, args[1].to);
    const message = /\bmessage\s*:/.exec(options);
    if (!message) continue;
    const after = args[1].from + message.index + message[0].length;
    const rest = file.masked.slice(after, args[1].to);
    const end = after + (/[,}]/.exec(rest)?.index ?? rest.length);
    const text = file.source.slice(after, end).trim();
    if (catalog.skip !== null) continue;
    if (/^(?:t|translate|intl\s*\.\s*formatMessage|formatMessage)\s*\(/.test(text)) {
      ctx.problem(file, call.start, 'error-message-key', `setError message ${text} is already translated`, 'Pass the catalog key itself: the field translates it (fieldMessageKey), and translated text would show the generic message.');
      continue;
    }
    if (text.startsWith('`')) {
      ctx.problem(file, call.start, 'error-message-key', `setError message ${text} is built from a template`, 'Pass one literal catalog key, or a value of a Record<Code, MessageKey> table.');
      continue;
    }
    const value = stringLiteral(text) ?? (/^[A-Za-z_$][\w$]*$/.test(text) ? constantValue(file, text) : null);
    // Anything else is a typed value (MESSAGES[code], failure.messageKey): tsc proves it is a MessageKey.
    if (value !== null && !catalog.keys.has(value)) {
      ctx.problem(file, call.start, 'error-message-key', `setError message '${value}' is not a key of ${catalog.rel}`, 'Pass a catalog key; the field shows the generic text for anything else.');
    }
  }
}

function checkSegmenter(ctx, root, file, app) {
  const calls = valibotCalls(file).filter((call) => SEGMENTER_ACTIONS.has(call.name));
  if (calls.length === 0) return;
  const polyfills = join(root, app.i18nDir, 'intl-polyfills.ts');
  if (existsSync(polyfills) && /intl-segmenter/.test(maskComments(read(polyfills)))) return;
  for (const call of calls) {
    ctx.problem(file, call.start, 'schema-segmenter', `${call.name}(...) needs Intl.Segmenter, which Hermes lacks (it throws on the phone while Jest passes)`, 'Bound the text with maxLength, or force @formatjs/intl-segmenter in intl-polyfills.ts (i18n-strings-and-catalogs).');
  }
}

function checkKeyboardViews(ctx, file, settings, app) {
  const fieldNames = fieldTagNames(file, settings);
  const fields = file.tags.filter((tag) => fieldNames.has(tag.name));
  if (fields.length === 0) return;
  // A form screen with no scroller at all: the keyboard covers the lower fields and nothing scrolls
  // them into view. One field (a search box above a list) is not a form.
  if (fields.length >= 2 && isScreenFile(file.rel, app) && !file.tags.some((tag) => SCROLLER_TAIL.test(tag.name))) {
    ctx.problem(file, fields[0].start, 'keyboard-aware-scroll', `${fields.length} text fields with no KeyboardAwareScrollView`, `Wrap the form in KeyboardAwareScrollView from ${KBC} (keyboardShouldPersistTaps="handled"): every screen with text fields scrolls in it, even a short form, because the keyboard and large text cover the lower fields.`);
  }
  const rnScrolls = new Set();
  for (const module of RN_MODULES) {
    for (const statement of fileImports(file, module)) {
      for (const name of statement.names) if (!name.typeOnly && (name.imported === 'ScrollView' || (module === 'react-native' && name.imported === 'KeyboardAvoidingView'))) rnScrolls.add(name.local);
      if (statement.namespace) ['ScrollView', 'KeyboardAvoidingView'].forEach((name) => rnScrolls.add(`${statement.namespace}.${name}`));
    }
  }
  for (const tag of file.tags) {
    if ((rnScrolls.has(tag.name) || tag.name === 'Animated.ScrollView') && !isHorizontal(file.attrsOf(tag))) {
      ctx.problem(file, tag.start, 'keyboard-aware-scroll', `<${tag.name}> around text fields`, `Use KeyboardAwareScrollView from ${KBC}: it keeps the focused field above the keyboard on iOS and on Android's edge-to-edge window, which no longer resizes.`);
    }
    if (SCROLLERS.has(tag.name) || rnScrolls.has(tag.name) && tag.name.endsWith('ScrollView')) {
      const attrs = file.attrsOf(tag);
      const persist = attrs.get('keyboardShouldPersistTaps');
      if (hasSpread(attrs) && !persist) continue;
      const value = literalOf(persist);
      if (!persist || value === 'never') {
        ctx.problem(file, tag.start, 'keyboard-persist-taps', `<${tag.name}> holds text fields without keyboardShouldPersistTaps`, 'Set keyboardShouldPersistTaps="handled": otherwise the first tap on Save only closes the keyboard.');
      }
    }
  }
}

/** A screen view: `<name>-screen.tsx`, or a file in the routes folder. */
function isScreenFile(rel, app) {
  return /(?:^|\/)[\w.-]*-screen\.tsx$/.test(rel) || app.srcDirs.some((dir) => dir === app.routesDir && under(rel, dir) && rel.endsWith('.tsx'));
}

/** A `horizontal` prop that is not {false}: a chip or tag row, not the form's scroller. */
function isHorizontal(attrs) {
  const horizontal = attrs.get('horizontal');
  return horizontal !== undefined && !(horizontal.kind === 'expr' && horizontal.value.trim() === 'false');
}

/** Index of the first pad field in a file, or -1. */
function padFieldAt(file, settings) {
  const kinds = settings.padKinds.map(escapeRe).join('|');
  const kind = new RegExp(`\\bkind\\s*[:=]\\s*\\{?\\s*(['"\`])(?:${kinds})\\1`).exec(file.noComments);
  let at = kind ? kind.index : -1;
  for (const tag of tagNamed(file, textInputTagNames(file))) {
    const attrs = file.attrsOf(tag);
    const mode = literalOf(attrs.get('inputMode'));
    const keyboard = literalOf(attrs.get('keyboardType'));
    if ((mode && PAD_INPUT_MODES.has(mode)) || (keyboard && PAD_KEYBOARDS.has(keyboard))) at = at === -1 ? tag.start : Math.min(at, tag.start);
  }
  return at;
}

function checkPadDoneBars(ctx, files, apps, settings) {
  const groups = new Map();
  for (const file of files) {
    const app = appFor(apps, file.rel);
    const featureRoot = under(file.rel, app.featuresDir) ? `${app.featuresDir}/${file.rel.slice(app.featuresDir.length + 1).split('/')[0]}` : file.rel.split('/').slice(0, -1).join('/');
    if (!groups.has(featureRoot)) groups.set(featureRoot, []);
    groups.get(featureRoot).push(file);
  }
  const bars = new Set(settings.doneBars);
  for (const [, group] of groups) {
    const pads = group.map((file) => ({ file, at: padFieldAt(file, settings) })).filter((item) => item.at !== -1);
    if (pads.length === 0) continue;
    if (group.some((file) => file.tags.some((tag) => bars.has(tag.name)))) continue;
    const first = pads[0];
    if (apps.some((app) => app.fieldDirs.some((dir) => under(first.file.rel, dir)))) continue;
    ctx.problem(first.file, first.at, 'pad-done-bar', 'a number, decimal or phone pad field with no Done bar in its feature', `Render ${settings.doneBars[0]} in the screen: the iOS pads have no return key, so the keyboard could not be closed.`);
  }
}

function checkKeyboardProvider(ctx, files, apps) {
  for (const app of apps) {
    const own = files.filter((file) => appFor(apps, file.rel) === app);
    const users = own.filter((file) => fileImports(file, KBC).some((statement) => !statement.typeOnly && statement.names.some((name) => !name.typeOnly && name.imported !== 'KeyboardProvider' && name.imported !== 'KeyboardController')));
    if (users.length === 0) continue;
    if (own.some((file) => file.tags.some((tag) => tag.name === 'KeyboardProvider'))) continue;
    const first = users[0];
    ctx.problem(first, fileImports(first, KBC)[0].index, 'keyboard-provider', `${KBC} is used but no file renders <KeyboardProvider>`, 'Wrap the root stack in <KeyboardProvider> (inside GestureHandlerRootView): without it the keyboard-aware views and hooks do nothing.');
  }
}

function appFor(apps, rel) {
  return apps.filter((app) => app.dir !== '' && under(rel, app.dir)).sort((a, b) => b.dir.length - a.dir.length)[0] ?? apps[0];
}

// ------------------------------------------------------------------------------------------------

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(root)) fail(`nothing to check: ${root} does not exist`, 'Pass the app repo root.');
  const layout = resolveLayout(root);
  const settings = readSettings(layout, options);
  const apps = appsOf(layout, settings, options);
  const report = createReporter({ name: 'check-forms', json: options.json });
  const scanDirs = [...new Set(apps.flatMap((app) => app.srcDirs))].filter((dir) => existsSync(join(root, dir)));
  if (scanDirs.length === 0) fail(`nothing to check: no source folder (${apps.flatMap((app) => app.srcDirs).join(', ')})`, 'Run from the app repo root, or pass --src <dir>.');
  const rels = walkRepo(root, { include: SOURCE_GLOBS, ignore: ['**/*.d.ts'] }).filter((rel) => scanDirs.some((dir) => under(rel, dir)) && !isTestFile(rel));
  const files = rels.map((rel) => scanFile(root, rel));
  const isUsed = files.some((file) => importsModule(file, 'react-hook-form') || importsModule(file, '@hookform/resolvers/valibot') || importsModule(file, KBC) || textInputImports(file).length > 0);
  if (!isUsed) return report.notApplicable('no form or text input: no app file imports react-hook-form, TextInput or react-native-keyboard-controller');

  const ctx = {
    problem: (file, index, rule, message, fix) => report.problem({ file: file.rel, line: lineOf(file.source, index), rule, message, fix }),
    skip: (entry) => report.skip(entry),
  };
  const catalogCache = new Map();
  const catalogs = (rel) => {
    const app = appFor(apps, rel);
    if (catalogCache.has(app)) return catalogCache.get(app);
    const catalogRel = settings.sourceCatalog ?? `${app.i18nDir}/catalogs/${sourceLanguage(root, app.i18nDir)}.json`;
    const skip = notYetCreated(root, { file: catalogRel, owner: 'i18n-strings-and-catalogs' });
    const entry = { rel: catalogRel, skip, keys: skip === null ? loadCatalog(root, catalogRel) : null };
    catalogCache.set(app, entry);
    return entry;
  };

  for (const file of files) {
    const app = appFor(apps, file.rel);
    checkRawTextInput(ctx, file, app);
    checkInputs(ctx, file);
    checkFieldBinding(ctx, file);
    checkUseForm(ctx, file);
    checkSetError(ctx, file, catalogs(file.rel));
    checkSegmenter(ctx, root, file, app);
    checkKeyboardViews(ctx, file, settings, app);
  }
  checkSchemas(ctx, root, files, catalogs, settings);
  checkPadDoneBars(ctx, files, apps, settings);
  checkKeyboardProvider(ctx, files, apps);
  return report.finish({ checked: files.length, unit: 'source files' });
}

run(main);
