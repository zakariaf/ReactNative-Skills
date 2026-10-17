#!/usr/bin/env node
// check-react-rules.mjs: checks the React components and hooks of an Expo app for the rules that are
// easy to break and that lint does not (or not fully) see: memo APIs under React Compiler, the
// 'use no memo' escape hatch, shared values, class components, hook files, read-only props, testIDs,
// Pressable style functions, direction, banned imports, list keys, ScrollView lists, safe-area insets,
// effects that clean up and pure renders. Store selectors are state-management-zustand's (check-stores).
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-react-rules.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { extractBlock } from './lib/object-literal.mjs';
import { findJsxTags, maskCode, matchBracket } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-react-rules',
  summary: 'Checks the runtime .ts/.tsx files of the app source folder (tests excluded) against the React component and hook rules.',
  usage: '[repo-root] [options]',
  options: {
    src: { type: 'string', multiple: true, value: 'dir', help: 'Source folder to scan, repo-relative (default: the layout srcDir and every workspace srcDir)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Scans with the shared repo walk (agent skill folders, generated ios/ and android/, build output, workspace',
    'output folders and any folder holding a SKILL.md are skipped), keeps the files under the source folders and',
    'leaves out tests (*.test.*, *.spec.*, __tests__/, __mocks__/) and *.d.ts.',
    '',
    'Rules:',
    '  no-memo-apis          no useMemo, useCallback or memo while React Compiler is on (a file whose header says',
    '                        "// memo-exemption: <measurement>" is the reviewed exception)',
    "  use-no-memo           'use no memo' only with \"// use-no-memo-test: <test title>\" naming a test that exists",
    '  shared-value-get-set  Reanimated shared values are read and written with .get() / .set(), never .value: names',
    '                        declared with useSharedValue/useDerivedValue or typed SharedValue<>/DerivedValue<> in the',
    '                        file, and any x.value inside useAnimatedStyle, useAnimatedProps, useDerivedValue,',
    '                        useAnimatedReaction, useAnimatedScrollHandler or useFrameCallback',
    '  class-component       function components only; the one kind of class is an error boundary',
    '                        (a class with static getDerivedStateFromError)',
    '  hook-file             an exported hook lives in a hook file: use-<name>.ts(x), or a *-store, *-context or',
    '                        React Navigation *-guards file',
    '  props-readonly        every member of a *Props type is readonly, and arrays are readonly T[] (every object',
    '                        literal of the type, also in an intersection: BaseProps & { ... })',
    '  testid-required       a component in a pressable folder (default src/ui) that renders a Pressable, Touchable*,',
    '                        RectButton, BorderlessButton, BaseButton or PressableSurface takes a required readonly',
    '                        testID: string',
    '  pressed-destructure   write style={(state) => [..., state.pressed && ...]}, not ({ pressed })',
    '  no-isrtl              never read isRTL outside the direction module (default src/i18n/direction.ts)',
    '  banned-import         Dimensions, SafeAreaView from react-native, Text from react-native outside the text',
    '                        primitive (default src/ui/app-text.tsx), and Pressable or Touchable* (react-native) or',
    '                        Pressable, RectButton, BorderlessButton, BaseButton or Touchable*',
    '                        (react-native-gesture-handler) outside the pressable folders',
    '  list-key-index        list keys and keyExtractor results are stable ids, never the array index',
    '  scrollview-list       a ScrollView whose children map data to JSX (.map, ?.map, .flatMap) needs a',
    '                        "bounded-list: <bound>" comment on one of the 3 lines above it (otherwise use FlatList, or',
    '                        FlashList when measured); UPPER_CASE constant lists and Array.from series are bounded',
    '  inset-direction       safe-area insets keep their physical side: never insets.left/right into start/end keys',
    '                        (take both sides symmetrically with paddingInline, or SafeAreaView edges)',
    '  effect-cleanup        an effect (useEffect, useLayoutEffect, useFocusEffect, also useFocusEffect(useCallback(...)))',
    '                        that subscribes (any add*Listener call: addEventListener, addListener,',
    '                        Notifications.addNotification*Listener, Network.addNetworkStateListener,',
    '                        Appearance.addChangeListener; .subscribe; watch*) or starts a timer (setTimeout,',
    '                        setInterval, requestAnimationFrame) returns a cleanup function (a return inside if/else,',
    '                        try or switch counts; one inside a nested function does not); returning the subscription',
    '                        or timer id itself, or an expression body that is the subscribe call, is a leak;',
    '                        APIs that already return the unsubscribe function may be returned directly:',
    '                        navigation.addListener (React Navigation / Expo Router, any receiver named *navigation',
    '                        or *navigationRef), NetInfo.addEventListener and a Zustand store.subscribe',
    '  render-impure         no Date.now(), new Date(), Math.random() or performance.now() in component files',
    '',
    'Store reads (a selector on every store hook, useShallow for built values) are checked by',
    'state-management-zustand (check-stores [selector-missing], [selector-new-object]) and lint storeWithoutSelector.',
    '',
    'React Compiler: on when an app config (app.config.ts/js/mjs/cjs or app.json, at the root or in a workspace)',
    'sets experiments.reactCompiler to true, or when no app config exists (the canonical stack). When an app',
    'config exists and none turns it on, no-memo-apis and use-no-memo are not applied and a note says so.',
    '',
    'rn-skills.config.json keys (all optional, repo-relative paths):',
    '  "reactRules": { "textPrimitive": "src/ui/app-text.tsx", "directionModules": ["src/i18n/direction.ts"],',
    '                  "pressableDirs": ["src/ui"], "reactCompiler": true }',
  ].join('\n'),
};

const APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];
const NOT_RUNTIME = ['**/*.d.ts', '*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx', '__tests__', '__mocks__'];
const PRESSABLE_TAGS = /<(Pressable|PressableSurface|RectButton|BorderlessButton|BaseButton|Touchable[A-Z]\w*)\b/;
const RN_PRESSABLES = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'TouchableNativeFeedback']);
// react-native-gesture-handler's buttons and its Touchable copies; GestureDetector stays allowed.
const RNGH_PRESSABLES = new Set([...RN_PRESSABLES, 'RectButton', 'BorderlessButton', 'BaseButton']);
const PRESSABLE_FIX = 'Compose the shared buttons and rows from src/ui (role, label, state, 44 pt box and press feedback are solved there once).';
// Callbacks Reanimated runs as worklets: inside them every x.value is a shared value.
const WORKLET_HOOKS = /\b(?:useAnimatedStyle|useAnimatedProps|useDerivedValue|useAnimatedReaction|useAnimatedScrollHandler|useFrameCallback)\s*\(/g;

const read = (abs) => readFileSync(abs, 'utf8');
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, (c) => `\\${c}`);
const under = (rel, dir) => dir === '.' || dir === '' || rel === dir || rel.startsWith(`${dir}/`);

/** Named imports of one module: [{ name, index }] (type-only names included, `as` aliases resolved). */
function importsFrom(text, module) {
  const out = [];
  const re = new RegExp(`import\\s+(?:type\\s+)?(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${escapeRe(module)}['"]`, 'g');
  for (const match of text.matchAll(re)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) out.push({ name, index: match.index });
    }
  }
  return out;
}

/** The repo-relative app config files of the root and every workspace. */
function appConfigFiles(root, layout) {
  const dirs = ['', ...layout.workspaces.map((workspace) => workspace.dir)];
  const files = [];
  for (const dir of dirs) {
    for (const name of APP_CONFIGS) {
      const rel = dir === '' ? name : `${dir}/${name}`;
      if (existsSync(join(root, rel))) files.push(rel);
    }
  }
  return files;
}

/** Whether React Compiler is on, and why (for the note line). */
function compilerState(root, layout, settings) {
  if (typeof settings.reactCompiler === 'boolean') {
    return { isOn: settings.reactCompiler, why: `rn-skills.config.json reactRules.reactCompiler is ${settings.reactCompiler}` };
  }
  const configs = appConfigFiles(root, layout);
  if (configs.length === 0) return { isOn: true, why: null };
  const enabling = configs.filter((rel) => /\breactCompiler\b['"]?\s*:\s*true\b/.test(maskComments(read(join(root, rel)))));
  if (enabling.length > 0) return { isOn: true, why: null };
  return { isOn: false, why: `no experiments.reactCompiler: true in ${configs.join(', ')}` };
}

function readSettings(layout) {
  const raw = layout.config?.reactRules ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('rn-skills.config.json "reactRules" must be an object', 'Write "reactRules": { "textPrimitive": "src/ui/app-text.tsx" } or remove the key.');
  const list = (key) => {
    const value = raw[key];
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) fail(`rn-skills.config.json reactRules.${key} must be a list of repo-relative paths`, `Write "${key}": ["src/..."].`);
    return value.map((entry) => toPosix(entry).replace(/^\.\//, '').replace(/\/+$/, ''));
  };
  if (raw.textPrimitive !== undefined && typeof raw.textPrimitive !== 'string') fail('rn-skills.config.json reactRules.textPrimitive must be a repo-relative path', 'Write "textPrimitive": "src/ui/app-text.tsx".');
  if (raw.reactCompiler !== undefined && typeof raw.reactCompiler !== 'boolean') fail('rn-skills.config.json reactRules.reactCompiler must be true or false', 'Remove it to read the app config, or write true/false.');
  return {
    textPrimitives: raw.textPrimitive === undefined ? null : [toPosix(raw.textPrimitive).replace(/^\.\//, '')],
    directionModules: list('directionModules'),
    pressableDirs: list('pressableDirs'),
    reactCompiler: raw.reactCompiler,
  };
}

/** The layout (root or workspace) a file belongs to. */
function layoutOf(rel, layout) {
  const workspace = layout.workspaces.find((candidate) => under(rel, candidate.dir));
  return workspace ? workspace.layout : layout;
}

/** The facts the rules need about one file. */
function fileContext(rel, layout, settings) {
  const own = layoutOf(rel, layout);
  const textPrimitives = settings.textPrimitives ?? [`${own.uiDir}/app-text.tsx`];
  const directionModules = settings.directionModules ?? [`${own.i18nDir}/direction.ts`, `${own.i18nDir}/direction.tsx`];
  const pressableDirs = settings.pressableDirs ?? [own.uiDir];
  return {
    isTextPrimitive: textPrimitives.includes(rel),
    isDirectionModule: directionModules.includes(rel),
    isPressableHome: pressableDirs.some((dir) => under(rel, dir)),
  };
}

function checkImports(ctx, file) {
  const { text } = file;
  const add = (index, rule, message, fix) => ctx.problem(file, index, rule, message, fix);
  if (ctx.isCompilerOn && !/memo-exemption:/.test(file.raw)) {
    for (const { name, index } of importsFrom(text, 'react')) {
      if (['useMemo', 'useCallback', 'memo'].includes(name)) add(index, 'no-memo-apis', `imports ${name}`, 'Delete it: React Compiler memoizes JSX, handlers and derived values. A measured need gets "// memo-exemption: <measurement>" in the file header and a reviewed lint exemption.');
    }
    for (const match of file.code.matchAll(/\bReact\.(useMemo|useCallback|memo)\s*\(/g)) add(match.index, 'no-memo-apis', `calls React.${match[1]}`, 'Delete it: React Compiler memoizes.');
  }
  for (const { name, index } of importsFrom(text, 'react-native')) {
    if (name === 'Dimensions') add(index, 'banned-import', 'imports Dimensions', 'Use useWindowDimensions() or useWindowClass() (re-renders on rotation, split screen, foldables and resizable windows), or onLayout.');
    if (name === 'SafeAreaView') add(index, 'banned-import', "imports SafeAreaView from 'react-native' (deprecated, iOS only)", 'Put the screen in ScreenFrame, or use SafeAreaView from react-native-safe-area-context (iOS and Android).');
    if (name === 'Text' && !file.facts.isTextPrimitive) add(index, 'banned-import', 'imports Text from react-native outside the text primitive', 'Render text with the app text primitive (AppText): direction, font, scaling cap and header role live in one place.');
    if (RN_PRESSABLES.has(name) && !file.facts.isPressableHome) add(index, 'banned-import', `imports ${name} outside the UI primitives folder`, PRESSABLE_FIX);
  }
  if (file.facts.isPressableHome) return;
  for (const { name, index } of importsFrom(text, 'react-native-gesture-handler')) {
    if (RNGH_PRESSABLES.has(name)) add(index, 'banned-import', `imports ${name} from react-native-gesture-handler outside the UI primitives folder`, PRESSABLE_FIX);
  }
}

/** Where a list callback or keyExtractor keys items by the index parameter. */
function indexKeys(text) {
  const hits = [];
  const first = String.raw`(?:[A-Za-z_$][\w$]*|\{[^{}]*\}|\[[^\[\]]*\])\s*(?::[^,()]+)?`;
  const callbacks = new RegExp(String.raw`\.(?:map|flatMap)\(\s*(?:\(\s*${first},\s*([A-Za-z_$][\w$]*)|function\s*\(\s*${first},\s*([A-Za-z_$][\w$]*))`, 'g');
  for (const match of text.matchAll(callbacks)) {
    const name = escapeRe(match[1] ?? match[2]);
    const open = text.indexOf('(', match.index);
    const call = extractBlock(text, open);
    const body = call === null ? text.slice(open) : call.inner;
    const keyed = new RegExp(`\\bkey=\\{\\s*(?:${name}|String\\(\\s*${name}\\s*\\)|${name}\\.toString\\(\\s*\\)|\`[^\`]*\\$\\{\\s*(?:String\\(\\s*)?${name}\\b[^\`]*\`)\\s*\\}`, 'g');
    for (const key of body.matchAll(keyed)) hits.push({ index: open + 1 + key.index, what: 'a list key is the array index' });
  }
  const extractors = new RegExp(String.raw`\bkeyExtractor\s*(?:=\s*\{|:)\s*(?:\(\s*${first},\s*([A-Za-z_$][\w$]*)\s*(?::\s*number)?\s*\)|function\s*\(\s*${first},\s*([A-Za-z_$][\w$]*)\s*(?::\s*number)?\s*\))`, 'g');
  for (const match of text.matchAll(extractors)) {
    const name = match[1] ?? match[2];
    const rest = text.slice(match.index + match[0].length);
    const end = rest.search(/[\n}]\s*(?:\n|[A-Za-z]+=|\/?>)/);
    const body = end === -1 ? rest : rest.slice(0, end);
    if (new RegExp(`\\b${escapeRe(name)}\\b`).test(body)) hits.push({ index: match.index, what: 'keyExtractor returns the array index' });
  }
  return hits;
}

/** The index of the opener that matches the closer at `close`, scanning backwards, or -1. */
function matchBackward(text, close) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (let i = close; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch in pairs) stack.push(pairs[ch]);
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The receiver expression that ends just before `dot` (tasks, model.tasks, [...tasks].sort(...)), or null. */
function receiverBefore(text, dot) {
  let i = dot - 1;
  const skipSpace = () => {
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
  };
  skipSpace();
  const end = i + 1;
  while (i >= 0) {
    if (text[i] === '!') {
      i -= 1;
      continue;
    }
    if (text[i] === ')' || text[i] === ']') {
      const open = matchBackward(text, i);
      if (open === -1) return null;
      i = open - 1;
      skipSpace();
      if (/[\w$)\]]/.test(text[i] ?? '')) continue;
      break;
    }
    if (!/[\w$]/.test(text[i])) break;
    while (i >= 0 && /[\w$]/.test(text[i])) i -= 1;
    const afterName = i;
    skipSpace();
    if (text[i] !== '.') {
      i = afterName;
      break;
    }
    i -= text[i - 1] === '?' ? 2 : 1;
    skipSpace();
  }
  const receiver = text.slice(i + 1, end).trim();
  return receiver === '' ? null : receiver;
}

/** A receiver for a message: call arguments shortened to (...), no whitespace ([...tasks].sort(...)). */
function compactReceiver(receiver) {
  let out = '';
  for (let i = 0; i < receiver.length; i += 1) {
    if (receiver[i] === '(') {
      const close = matchBracket(receiver, i);
      out += '(...)';
      if (close === -1) break;
      i = close;
    } else if (!/\s/.test(receiver[i])) out += receiver[i];
  }
  return out.length > 48 ? `${out.slice(0, 45)}...` : out;
}

/** A receiver whose length is fixed by definition: an UPPER_CASE constant, or a positional Array series. */
function isBoundedReceiver(receiver) {
  return (
    /^[A-Z][A-Z0-9_]*$/.test(receiver) ||
    /^Object\.(?:keys|values|entries)\(\s*[A-Z][A-Z0-9_]*\s*\)$/.test(receiver) ||
    /^(?:Array\.from|new Array|Array)\s*\(/.test(receiver) ||
    /^\[\s*\.\.\.\s*Array\s*\(/.test(receiver)
  );
}

/** The first `list.map(...)` / `list?.map(...)` / `list.flatMap(...)` in `inner` whose callback returns JSX. */
function firstJsxListCall(inner) {
  for (const match of inner.matchAll(/(\?\.|\.)\s*(map|flatMap)\s*\(/g)) {
    const receiver = receiverBefore(inner, match.index);
    if (receiver === null || isBoundedReceiver(receiver)) continue;
    const open = match.index + match[0].length - 1;
    const close = matchBracket(inner, open);
    const args = inner.slice(open, close === -1 ? inner.length : close);
    if (/(?:=>|\breturn\b)\s*\(?\s*<[A-Za-z>]/.test(args)) return `${compactReceiver(receiver)}${match[1]}${match[2]}`;
  }
  return null;
}

/** The index of the closing tag of a non-self-closing JSX tag (nested tags of the same name included), or -1. */
function closingTagIndex(code, tag, tags) {
  const events = [
    ...tags.filter((other) => other.name === tag.name && !other.selfClosing && other.start > tag.end).map((other) => ({ at: other.start, step: 1 })),
    ...[...code.matchAll(new RegExp(`</${escapeRe(tag.name)}\\s*>`, 'g'))].filter((match) => match.index > tag.end).map((match) => ({ at: match.index, step: -1 })),
  ].sort((a, b) => a.at - b.at);
  let depth = 1;
  for (const event of events) {
    depth += event.step;
    if (depth === 0) return event.at;
  }
  return -1;
}

/** ScrollViews whose children map data to JSX without a bounded-list comment just above them. */
function unboundedScrollLists(code, raw) {
  const hits = [];
  const tags = findJsxTags(raw, code);
  for (const tag of tags) {
    if (tag.selfClosing || !/^(?:Animated\.)?\w*ScrollView$/.test(tag.name)) continue;
    const close = closingTagIndex(code, tag, tags);
    if (close === -1) continue;
    const list = firstJsxListCall(code.slice(tag.end + 1, close));
    if (list === null) continue;
    const lineStart = raw.lastIndexOf('\n', tag.start) + 1;
    let from = lineStart;
    for (let i = 0; i < 3 && from > 0; i += 1) from = raw.lastIndexOf('\n', from - 2) + 1;
    const lineEnd = raw.indexOf('\n', tag.start);
    if (/bounded-list:/.test(raw.slice(from, lineEnd === -1 ? raw.length : lineEnd))) continue;
    hits.push({ index: tag.start, tag: tag.name, list });
  }
  return hits;
}

/** Shared-value .value reads and writes: [{ index, name }] (deduplicated by position). */
function sharedValueUses(code) {
  const hits = new Map();
  const names = new Set();
  for (const decl of code.matchAll(/\bconst\s+([\w$]+)\s*=\s*use(?:Shared|Derived)Value\s*[(<]/g)) names.add(decl[1]);
  for (const typed of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\??\s*:\s*(?:Readonly<\s*)?(?:SharedValue|DerivedValue)\s*</g)) names.add(typed[1]);
  for (const name of names) {
    for (const use of code.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(name)}\\s*[?!]?\\.value\\b`, 'g'))) hits.set(use.index, name);
  }
  for (const hook of code.matchAll(WORKLET_HOOKS)) {
    const open = hook.index + hook[0].length - 1;
    const close = matchBracket(code, open);
    const body = code.slice(open, close === -1 ? code.length : close);
    for (const use of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*[?!]?\.value\b/g)) {
      if (!hits.has(open + use.index)) hits.set(open + use.index, use[1]);
    }
  }
  return [...hits].map(([index, name]) => ({ index, name }));
}

function checkPatterns(ctx, file) {
  const { text, code, raw, rel } = file;
  const add = (index, rule, message, fix) => ctx.problem(file, index, rule, message, fix);
  if (ctx.isCompilerOn) {
    const directive = text.search(/['"]use no memo['"]/);
    if (directive !== -1) {
      const marker = /use-no-memo-test:\s*(.+?)\s*(?:\*\/)?$/m.exec(raw);
      if (!marker) add(directive, 'use-no-memo', "'use no memo' without its failing test", 'Write the failing test that shows the compiler bug first, then add "// use-no-memo-test: <test title>" and remove both together once the compiler is fixed.');
      else if (!ctx.testTitleExists(marker[1])) add(directive, 'use-no-memo', `'use no memo' names a test that does not exist: "${marker[1]}"`, 'Name the exact title of the failing test (an it() title in a *.test.ts(x) file), or remove the directive.');
    }
  }
  for (const use of sharedValueUses(code)) add(use.index, 'shared-value-get-set', `${use.name}.value`, `Use ${use.name}.get() / ${use.name}.set(...): React Compiler cannot see .value reads and writes.`);
  for (const match of code.matchAll(/\bclass\s+(\w+)\s+extends\s+(?:React\.)?(?:Component|PureComponent)\b/g)) {
    const brace = code.indexOf('{', match.index + match[0].length + (code.slice(match.index + match[0].length).match(/^\s*<[^{]*?>/)?.[0].length ?? 0));
    const body = brace === -1 ? null : extractBlock(code, brace);
    if (body === null || !/\bstatic\s+getDerivedStateFromError\b/.test(body.inner)) add(match.index, 'class-component', `class ${match[1]} is a class component`, 'Write a function component; the only class is an error boundary (static getDerivedStateFromError + componentDidCatch), because React 19 has no hook for it.');
  }
  for (const match of code.matchAll(/\(\s*\{\s*pressed\s*\}\s*\)/g)) add(match.index, 'pressed-destructure', 'destructures ({ pressed })', 'Write style={(state) => [styles.base, state.pressed && styles.pressed]} (a destructured boolean must read as a question).');
  if (!file.facts.isDirectionModule) {
    for (const match of code.matchAll(/\bisRTL\b/g)) add(match.index, 'no-isrtl', 'reads isRTL', 'Read the direction from the app direction context (rtl-and-direction) in components, or from the one direction module outside React.');
  }
  for (const hit of indexKeys(code)) add(hit.index, 'list-key-index', hit.what, 'Key by a stable id (the task id, the row id): an index key remounts the wrong rows when the list is filtered, sorted or grows.');
  for (const hit of unboundedScrollLists(code, raw)) add(hit.index, 'scrollview-list', `${hit.tag} renders ${hit.list}(...) with no stated bound`, 'Render data that grows with the user in a FlatList (FlashList when profiling shows the need) with keyExtractor; a short list that can never grow keeps the ScrollView with "// bounded-list: <the bound and why>" on the line above.');
  for (const match of code.matchAll(/\b(marginStart|marginEnd|paddingStart|paddingEnd|start|end|insetInlineStart|insetInlineEnd|marginInlineStart|marginInlineEnd|paddingInlineStart|paddingInlineEnd)\s*:\s*[^,}\n]*?\b[\w$]*[iI]nsets\.(left|right)\b/g)) {
    add(match.index, 'inset-direction', `${match[1]} takes insets.${match[2]}`, 'Take the sides symmetrically: paddingInline: Math.max(gutter, insets.left, insets.right), or SafeAreaView edges={[\'left\', \'right\']}. The notch, the camera cutout and the gesture bar do not move when the layout mirrors for RTL, and paddingLeft is no escape: React Native swaps it to paddingStart in a right-to-left layout.');
  }
  if (rel.endsWith('.tsx')) {
    for (const match of code.matchAll(/\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bMath\.random\s*\(|\bperformance\.now\s*\(/g)) {
      add(match.index, 'render-impure', `${match[0].replace(/\s+/g, ' ').replace(/\s*\(\s*\)?$/, '')}() in a component file`, 'Take time from the injected clock (ClockPort) and randomness from the seeded RNG in the model hook or a handler, never during render.');
    }
  }
}

/** Control-flow keywords whose `(...)` is followed by a block, not a function body. */
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/**
 * Whether the `{` at `open` (masked code) opens a function body: an arrow `=> {`, a function
 * expression or declaration, or a method `name(...) {`, optionally with a return type. Blocks of
 * if/else, for, while, switch, try/catch/finally and do are not.
 */
function opensFunctionBody(code, open) {
  const before = code.slice(Math.max(0, open - 400), open);
  if (/=>\s*$/.test(before)) return true;
  const typed = /\)\s*(?::\s*[\w$.<>[\]|&,\s'"]+)?\s*$/.exec(before);
  if (!typed) return false;
  const closeParen = open - before.length + typed.index;
  const openParen = matchBackward(code, closeParen);
  if (openParen === -1) return false;
  const word = /([\w$]+)\s*$/.exec(code.slice(Math.max(0, openParen - 40), openParen));
  return !(word && CONTROL_KEYWORDS.has(word[1]));
}

/**
 * A subscribe or timer call at the start of an expression; group 1 is the last receiver name, if any.
 * The add*Listener family covers addEventListener, addListener and the named Expo / React Native forms
 * (Notifications.addNotificationResponseReceivedListener, Network.addNetworkStateListener,
 * Appearance.addChangeListener), the same family async-safety treats as a subscription.
 */
const SUBSCRIBE_CALL = /^\(?\s*(?:([\w$]+)\s*\??\.\s*)*(?:add(?:[A-Z][\w$]*)?Listener|setTimeout|setInterval|requestAnimationFrame)\s*\(/;

/**
 * Receivers whose add*Listener already returns the unsubscribe function, so returning the result is the
 * cleanup: React Navigation's navigation.addListener (useNavigation(), a navigation prop, a navigationRef)
 * and @react-native-community/netinfo's NetInfo.addEventListener.
 */
const UNSUBSCRIBE_RECEIVERS = /^(?:\w*navigation(?:Ref)?|NetInfo)$/i;

/** True when the expression is a call whose result is a subscription object or a timer id, never a cleanup function. */
function isHandleCall(expression) {
  const match = SUBSCRIBE_CALL.exec(expression);
  return Boolean(match) && !(match[1] && UNSUBSCRIBE_RECEIVERS.test(match[1]));
}

/**
 * What an effect body returns: 'cleanup' for a `return` that is not inside a nested function body
 * (a listener's `return true` does not count; one inside if/else, try or switch does) and returns
 * something other than nothing, undefined or null; 'handle' when every such return hands back a
 * subscription object or timer id itself (`return subscription;` after `const subscription =
 * AppState.addEventListener(...)`), which React does not call; 'none' otherwise.
 */
function effectReturn(inner) {
  const nested = [];
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] !== '{' || !opensFunctionBody(inner, i)) continue;
    const close = matchBracket(inner, i);
    if (close !== -1) nested.push([i, close]);
  }
  let sawHandle = false;
  for (const match of inner.matchAll(/(?<![\w$.])return\b/g)) {
    if (nested.some(([from, to]) => match.index > from && match.index < to)) continue;
    const rest = inner.slice(match.index);
    if (/^return\s*(?:;|\}|undefined\b|null\b|$)/.test(rest)) continue;
    const value = /^return\s+(.*)/s.exec(rest)[1];
    const name = /^([\w$]+)\s*(?:;|\}|$)/.exec(value);
    const assigned = name && new RegExp(`(?:const|let|var)\\s+${name[1].replace(/\$/g, '\\$')}\\s*=\\s*([^;]*)`).exec(inner);
    if (isHandleCall(value) || (assigned && isHandleCall(assigned[1].trim()))) {
      sawHandle = true;
      continue;
    }
    return 'cleanup';
  }
  return sawHandle ? 'handle' : 'none';
}

const RETURN_A_FUNCTION = 'Return a function that cleans up (() => subscription.remove(), () => clearTimeout(id)): React calls only a returned function, so a returned subscription object or timer id leaks the listener.';

function checkEffects(ctx, file) {
  const { code } = file;
  const head = String.raw`\b(useEffect|useLayoutEffect|useFocusEffect)\s*\(\s*(?:(?:React\.)?useCallback\s*\(\s*)?`;
  const noParams = String.raw`\(\s*\)\s*(?::\s*[\w$]+\s*)?`;
  const effects = new RegExp(`${head}(?:${noParams}=>|function\\s*[\\w$]*\\s*${noParams})\\s*\\{`, 'g');
  for (const match of code.matchAll(effects)) {
    const block = extractBlock(code, match.index + match[0].length - 1);
    if (!block) continue;
    const subscribes = /\badd(?:[A-Z][\w$]*)?Listener\s*\(|\.subscribe\s*\(|\bwatch[A-Z]\w*\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(|\brequestAnimationFrame\s*\(/.test(block.inner);
    if (!subscribes) continue;
    const returned = effectReturn(block.inner);
    if (returned === 'none') ctx.problem(file, match.index, 'effect-cleanup', `the ${match[1]} subscribes or starts a timer but returns no cleanup`, 'Return the cleanup (subscription.remove(), unsubscribe(), clearTimeout(id), cancelAnimationFrame(id)): a leaked listener keeps firing after unmount and after Fast Refresh.');
    else if (returned === 'handle') ctx.problem(file, match.index, 'effect-cleanup', `the ${match[1]} returns the subscription or timer id instead of a cleanup function`, RETURN_A_FUNCTION);
  }
  // An expression-bodied effect returns whatever its one call returns.
  const expressionEffects = new RegExp(`${head}${noParams}=>(?!\\s*\\{)\\s*`, 'g');
  for (const match of code.matchAll(expressionEffects)) {
    if (isHandleCall(code.slice(match.index + match[0].length, match.index + match[0].length + 200))) {
      ctx.problem(file, match.index, 'effect-cleanup', `the ${match[1]} body is a bare subscribe or timer call, so it returns the subscription or timer id instead of a cleanup function`, RETURN_A_FUNCTION);
    }
  }
}

function checkHooksAndProps(ctx, file) {
  const { code, rel } = file;
  const name = basename(rel).replace(/\.(tsx?)$/, '');
  const isHookHost = name.startsWith('use-') || /-(store|context|guards)$/.test(name);
  if (!isHookHost) {
    for (const match of code.matchAll(/export\s+(?:async\s+)?(?:function\s+(use[A-Z]\w*)|const\s+(use[A-Z]\w*)\s*[=:])/g)) {
      const hook = match[1] ?? match[2];
      const file2 = hook.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      ctx.problem(file, match.index, 'hook-file', `exports ${hook} from ${basename(rel)}`, `Move it to its own ${file2}.ts (the hooks and compiler lint find hooks by the use prefix; readers find them by file name).`);
    }
  }
  for (const match of code.matchAll(/(?:export\s+)?type\s+(\w+Props)\s*(?:<[^=]*?>)?\s*=\s*/g)) {
    const parts = typeLiteralParts(code, match.index + match[0].length);
    for (const block of parts.blocks) checkPropsBlock(ctx, file, match[1], block);
    const hasTestId = parts.blocks.some((block) => /readonly\s+testID\s*:\s*string\b/.test(block.inner));
    // With a referenced type in the intersection (BaseProps & { ... }) the testID may live there: not judged.
    if (file.facts.isPressableHome && PRESSABLE_TAGS.test(code) && parts.blocks.length > 0 && parts.references.length === 0 && !hasTestId) {
      ctx.problem(file, match.index, 'testid-required', `${match[1]} has no required testID`, 'Add readonly testID: string and derive part ids from it (`${testID}.label`): E2E flows and screen contracts select by testID on iOS and Android.');
    }
  }
}

function checkPropsBlock(ctx, file, typeName, block) {
  for (const member of topLevelMembers(block.inner, block.open + 1)) {
    const body = member.text;
    if (/^\[/.test(body)) continue;
    if (/^[A-Za-z_$][\w$]*\??\s*\(/.test(body)) {
      ctx.problem(file, member.index, 'props-readonly', `${typeName}.${body.split(/[?(]/)[0]} is a method signature`, 'Write it as a readonly property: readonly onPress: () => void.');
      continue;
    }
    const field = /^(readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*([\s\S]*)$/.exec(body);
    if (!field) continue;
    if (!field[1]) ctx.problem(file, member.index, 'props-readonly', `${typeName}.${field[2]} is not readonly`, 'Prefix every prop with readonly: mutating a prop then fails tsc (lint does not see props.items.push()).');
    else if (/(?:^|[|&(,<]\s*)(?!readonly\s)[\w$.]+(?:<[^<>]*>)?\s*\[\]|\bArray</.test(field[3])) ctx.problem(file, member.index, 'props-readonly', `${typeName}.${field[2]} is a mutable array`, 'Write readonly T[] (or ReadonlyArray<T>): a readonly field still lets the callee push into the array.');
  }
}

/** The index of the `>` closing the generic `<` at `open`, or -1 (`=>` inside does not count). */
function matchAngle(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '<') depth += 1;
    else if (code[i] === '>' && code[i - 1] !== '=') {
      depth -= 1;
      if (depth === 0) return i;
    } else if (code[i] === ';') return -1;
  }
  return -1;
}

/**
 * The parts of a type alias's right-hand side joined by depth-0 `&`: object literals
 * ({ open, inner }) and referenced types (BaseProps, Omit<AppTextProps, 'children'>).
 */
function typeLiteralParts(code, from) {
  const blocks = [];
  const references = [];
  let i = from;
  const skipSpace = () => {
    while (/\s/.test(code[i] ?? '')) i += 1;
  };
  for (;;) {
    skipSpace();
    if (code[i] === '{') {
      const close = matchBracket(code, i);
      if (close === -1) break;
      blocks.push({ open: i, inner: code.slice(i + 1, close) });
      i = close + 1;
    } else {
      const name = /^[A-Za-z_$][\w$.]*/.exec(code.slice(i, i + 200));
      if (!name) break;
      references.push(name[0]);
      i += name[0].length;
      skipSpace();
      if (code[i] === '<') {
        const close = matchAngle(code, i);
        if (close === -1) break;
        i = close + 1;
      }
    }
    skipSpace();
    if (code[i] !== '&') break;
    i += 1;
  }
  return { blocks, references };
}

/** The depth-0 members of a type literal's inner text, split at ; , or newline: [{ text, index }]. */
function topLevelMembers(inner, offset) {
  const members = [];
  let depth = 0;
  let start = 0;
  const flush = (end) => {
    const part = inner.slice(start, end);
    const trimmed = part.trim();
    if (trimmed) members.push({ text: trimmed, index: offset + start + part.indexOf(trimmed) });
    start = end + 1;
  };
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const close = inner.indexOf(ch, i + 1);
      i = close === -1 ? inner.length : close;
      continue;
    }
    if ('{([<'.includes(ch)) depth += 1;
    else if ('})]'.includes(ch) || (ch === '>' && inner[i - 1] !== '=')) depth -= 1;
    else if (depth === 0 && (ch === ';' || ch === ',' || ch === '\n')) {
      const next = inner.slice(i + 1).match(/^\s*([|&])/);
      if (ch === '\n' && (next || /[|&:=]\s*$/.test(inner.slice(start, i)))) continue;
      flush(i);
    }
  }
  flush(inner.length);
  return members;
}

/** Test titles, read once from every test file of the repo (for use-no-memo). */
function testTitleIndex(root) {
  let titles = null;
  return (title) => {
    if (titles === null) {
      titles = [];
      for (const rel of walkRepo(root, { include: ['*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx'] })) titles.push(read(join(root, rel)));
    }
    const needle = title.replace(/^['"`]|['"`]$/g, '');
    return titles.some((text) => text.includes(`'${needle}'`) || text.includes(`"${needle}"`) || text.includes(`\`${needle}\``));
  };
}

/** The source folders to scan, repo-relative. */
function sourceRoots(root, layout, given) {
  if (given && given.length > 0) {
    return given.map((dir) => {
      const rel = toPosix(dir).replace(/^\.\//, '').replace(/\/+$/, '') || '.';
      if (rel.split('/').includes('..') || dir.startsWith('/')) fail(`--src ${dir} must be a repo-relative folder`, 'Pass a folder inside the repo, for example --src src.');
      if (!existsSync(join(root, rel))) fail(`nothing to check: --src ${dir} does not exist`, 'Pass an existing source folder.');
      return rel;
    });
  }
  const dirs = [layout.srcDir, ...layout.workspaces.map((workspace) => workspace.layout.srcDir)].filter((dir) => existsSync(join(root, dir)));
  if (dirs.length === 0) fail(`nothing to check: no source folder (${layout.srcDir}/${layout.workspaces.length > 0 ? ' or a workspace src/' : ''}) in ${root}`, 'Run from the app repo root, set "srcDir" in rn-skills.config.json, or pass --src <dir>.');
  return [...new Set(dirs)];
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(root)) fail(`nothing to check: ${root} does not exist`, 'Pass the app repo root.');
  const layout = resolveLayout(root);
  const settings = readSettings(layout);
  const roots = sourceRoots(layout.root, layout, options.src);
  const compiler = compilerState(layout.root, layout, settings);
  const report = createReporter({ name: 'check-react-rules', json: options.json });
  if (!compiler.isOn) report.note(`note: React Compiler is off (${compiler.why}): no-memo-apis and use-no-memo are not applied`);
  const ctx = {
    isCompilerOn: compiler.isOn,
    testTitleExists: testTitleIndex(layout.root),
    problem: (target, index, rule, message, fix) => report.problem({ file: target.rel, line: lineOf(target.text, index), rule, message, fix }),
  };
  const files = walkRepo(layout.root, { include: ['*.ts', '*.tsx'], ignore: NOT_RUNTIME }).filter((rel) => roots.some((dir) => under(rel, dir)));
  for (const rel of files) {
    const raw = read(join(layout.root, rel));
    const file = { rel, raw, text: maskComments(raw), code: maskCode(raw), facts: fileContext(rel, layout, settings) };
    checkImports(ctx, file);
    checkPatterns(ctx, file);
    checkEffects(ctx, file);
    checkHooksAndProps(ctx, file);
  }
  return report.finish({ checked: files.length, unit: 'files' });
});
