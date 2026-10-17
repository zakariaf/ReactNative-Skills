// native-scan.mjs: dependency-free readers for the native side of an Expo app, shared by
// check-native-modules.mjs and check-native-libraries.mjs. Swift and Kotlin are read with the
// TypeScript lexer of source-scan.mjs (both languages share // and /* */ comments and "..." strings),
// which is enough for the Expo Modules API DSL: Name(...), Function(...), Events(...) and friends.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { matchBracket, scanSource } from './source-scan.mjs';

/** The definition components whose first string argument names a member JavaScript can reach. */
export const MEMBER_COMPONENTS = Object.freeze(['Function', 'AsyncFunction', 'Property', 'Constant']);
/** Members every Expo native module object has (from NativeModule / EventEmitter), never native. */
export const EMITTER_MEMBERS = Object.freeze(
  new Set(['addListener', 'removeListener', 'removeAllListeners', 'emit', 'listenerCount', 'removeSubscription', 'startObserving', 'stopObserving']),
);
const DSL = /\b(Name|Function|AsyncFunction|Property|Constant|Constants|Events|View|Class|OnStartObserving|OnStopObserving|OnCreate|OnDestroy)\s*([({])/g;
/** Lifecycle components may take a bare trailing closure: OnDestroy { ... }, OnStartObserving { ... }. */
const BARE_CLOSURE = new Set(['OnStartObserving', 'OnStopObserving', 'OnCreate', 'OnDestroy']);

/** Reads a text file, or null when it is missing or not a file. */
export function readMaybe(path) {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Parses JSON; returns { value } or { error }. */
export function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error.message };
  }
}

/** Every file under dir (relative posix paths), skipping build output; [] when dir is missing. */
export function listFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['node_modules', 'build', '.gradle', 'Pods', '.cxx'].includes(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Brace/paren/bracket depth before every index of `code` between from and to (exclusive). */
function depthAt(code, from, to) {
  const depth = new Int32Array(Math.max(0, to - from) + 1);
  let d = 0;
  for (let i = from; i < to; i += 1) {
    depth[i - from] = d;
    const c = code[i];
    if (c === '{' || c === '(' || c === '[') d += 1;
    else if (c === '}' || c === ')' || c === ']') d -= 1;
  }
  depth[to - from] = d;
  return (index) => depth[index - from];
}

/** String literal values that start inside [from, to) of a scanned file, in order. */
export function stringsIn(scan, from, to) {
  return scan.strings.filter((entry) => entry.index >= from && entry.index < to && entry.quote !== '`').map((entry) => entry.value);
}

/**
 * The classes of a Swift or Kotlin file: [{ name, supers: [..], isPublic, index, line, bodyStart, bodyEnd, package }].
 * Kotlin primary constructors and Swift generic clauses are skipped; supers are bare type names.
 */
export function classesOf(text, language) {
  const scan = scanSource(text);
  const { code } = scan;
  const pkg = language === 'kotlin' ? (/^\s*package\s+([\w.]+)/m.exec(code)?.[1] ?? '') : '';
  const classes = [];
  const re = /\b((?:(?:public|open|final|internal|private|fileprivate|abstract|data|sealed)\s+)*)class\s+([A-Za-z_]\w*)/g;
  for (const match of code.matchAll(re)) {
    const after = match.index + match[0].length;
    const brace = code.indexOf('{', after);
    const headerEnd = brace === -1 ? code.length : brace;
    let header = code.slice(after, headerEnd);
    // Kotlin: class X private constructor(...) : Base()   Swift: class X<T>: Base
    header = header.replace(/^\s*<[^>]*>/, '');
    if (language === 'kotlin') {
      header = header.replace(/^\s*(?:(?:private|internal|public|protected)\s+)?(?:constructor\s*)?/, '');
      if (header.trimStart().startsWith('(')) {
        const open = after + (code.slice(after, headerEnd).indexOf('('));
        const close = matchBracket(code, open);
        header = close === -1 ? '' : code.slice(close + 1, headerEnd);
      }
    }
    const colon = header.indexOf(':');
    const supers = colon === -1 ? [] : header.slice(colon + 1).split(',').map((part) => part.trim().replace(/\(.*$/s, '').replace(/<.*$/s, '').replace(/\s+where\s.*$/s, '').trim()).filter(Boolean);
    const bodyEnd = brace === -1 ? -1 : matchBracket(code, brace);
    classes.push({
      name: match[2],
      supers,
      isPublic: /\b(public|open)\b/.test(match[1]),
      index: match.index,
      line: scan.lineOf(match.index),
      bodyStart: brace,
      bodyEnd,
      package: pkg,
    });
  }
  return { scan, classes };
}

/**
 * The module definition of one Swift or Kotlin Module class:
 *   { name, nameLine, members: Map<name, { kind, line, component, closureStart, closureEnd, runsOnMain }>,
 *     events: Map<name, line>, hasView, usesConstants, defStart, defEnd }
 * Only components at the top level of the definition count (a View's or Class's own Events and
 * AsyncFunctions belong to the view or class).
 */
export function moduleDefinition(text, scan, cls, language) {
  const { code } = scan;
  if (cls.bodyStart === -1 || cls.bodyEnd === -1) return null;
  const body = code.slice(cls.bodyStart, cls.bodyEnd);
  const defMatch = language === 'swift'
    ? /func\s+definition\s*\(\s*\)\s*->\s*ModuleDefinition\s*\{/.exec(body)
    : /fun\s+definition\s*\(\s*\)\s*(?::\s*ModuleDefinition\s*)?=\s*ModuleDefinition\s*\{/.exec(body);
  if (!defMatch) return null;
  const defStart = cls.bodyStart + defMatch.index + defMatch[0].length - 1;
  const defEnd = matchBracket(code, defStart);
  if (defEnd === -1) return null;
  const depth = depthAt(code, defStart + 1, defEnd);
  const out = { name: null, nameLine: null, members: new Map(), events: new Map(), hasView: false, usesConstants: false, defStart, defEnd, components: [] };
  const segment = code.slice(defStart + 1, defEnd);
  for (const match of segment.matchAll(DSL)) {
    const at = defStart + 1 + match.index;
    if (depth(at) !== 0) continue;
    const component = match[1];
    const line = scan.lineOf(at);
    const bracket = at + match[0].length - 1;
    let open = bracket;
    let close;
    let args;
    let closureStart = -1;
    let closureEnd = -1;
    if (match[2] === '{') {
      // A bare trailing closure with no argument list: OnDestroy { ... }.
      if (!BARE_CLOSURE.has(component)) continue;
      closureStart = bracket;
      closureEnd = matchBracket(code, closureStart);
      if (closureEnd === -1) continue;
      open = -1;
      close = closureEnd;
      args = [];
    } else {
      close = matchBracket(code, open);
      if (close === -1) continue;
      args = stringsIn(scan, open, close);
      // A trailing closure (Swift and Kotlin) after the call: Function("x") { ... }.
      const rest = code.slice(close + 1, close + 200);
      const trailing = /^\s*(?:Coroutine\s*)?\{/.exec(rest);
      if (trailing) {
        closureStart = close + 1 + trailing[0].length - 1;
        closureEnd = matchBracket(code, closureStart);
      }
    }
    const tailFrom = closureEnd === -1 ? close + 1 : closureEnd + 1;
    const runsOnMain = /^\s*\.runOnQueue\s*\(\s*(?:\.main|Queues\.MAIN|DispatchQueue\.main)\s*\)/.test(code.slice(tailFrom, tailFrom + 80));
    out.components.push({ component, line, args, open, close, closureStart, closureEnd, runsOnMain });
    if (component === 'Name') {
      if (args[0] !== undefined) {
        out.name = args[0];
        out.nameLine = line;
      }
    } else if (MEMBER_COMPONENTS.includes(component)) {
      if (args[0] !== undefined && !out.members.has(args[0])) out.members.set(args[0], { kind: component, line, closureStart, closureEnd, runsOnMain });
    } else if (component === 'Class') {
      const typeName = args[0] ?? /([A-Za-z_]\w*)\s*(?:\.self|::class)/.exec(code.slice(open, close))?.[1];
      if (typeName && !out.members.has(typeName)) out.members.set(typeName, { kind: 'Class', line, closureStart, closureEnd, runsOnMain });
    } else if (component === 'Events') {
      for (const event of args) if (!out.events.has(event)) out.events.set(event, line);
    } else if (component === 'View') {
      out.hasView = true;
    } else if (component === 'Constants') {
      out.usesConstants = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The TypeScript side: binding calls and binding types
// ---------------------------------------------------------------------------------------------

/** Binding callees and whether each one throws when the module is missing. */
export const BINDING_CALLEES = Object.freeze({
  requireNativeModule: { throws: true, kind: 'module' },
  requireOptionalNativeModule: { throws: false, kind: 'module' },
  requireNativeView: { throws: false, kind: 'view' },
  requireNativeViewManager: { throws: false, kind: 'view' },
  'TurboModuleRegistry.getEnforcing': { throws: true, kind: 'turbo' },
  'TurboModuleRegistry.get': { throws: false, kind: 'turbo' },
});
const BINDING_RE = /(?<![\w$.])(requireOptionalNativeModule|requireNativeModule|requireNativeViewManager|requireNativeView|TurboModuleRegistry\s*\.\s*getEnforcing|TurboModuleRegistry\s*\.\s*get)\s*(<)?/g;

/** Index of the ">" that closes the "<" at `open`, skipping "=>" arrows; -1 when unbalanced. */
function closeAngle(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === '<') depth += 1;
    else if (c === '>' && code[i - 1] !== '=') {
      depth -= 1;
      if (depth === 0) return i;
    } else if (c === ';' || (c === '(' && depth === 0)) return -1;
  }
  return -1;
}

/** Index of the ">" closing the "<" at `open` in a type header; brackets inside are skipped whole. */
function skipAngle(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === '<') depth += 1;
    else if (c === '>' && code[i - 1] !== '=') {
      depth -= 1;
      if (depth === 0) return i;
    } else if (c === '{' || c === '(' || c === '[') {
      const end = matchBracket(code, i);
      if (end === -1) return -1;
      i = end;
    }
  }
  return -1;
}

/**
 * Binding calls of a scanned TS/JS file:
 *   [{ callee, index, line, typeArg, name (string literal or null), atTopLevel, inParams }]
 * atTopLevel: the call runs when the module is imported (not inside a function body, a class body or
 * a function's parameter list).
 */
export function bindingCalls(scan) {
  const { code } = scan;
  const calls = [];
  const depth = depthAt(code, 0, code.length);
  for (const match of code.matchAll(BINDING_RE)) {
    const callee = match[1].replace(/\s+/g, '');
    let cursor = match.index + match[0].length;
    let typeArg = null;
    if (match[2] === '<') {
      const open = cursor - 1;
      const close = closeAngle(code, open);
      if (close === -1) continue;
      typeArg = scan.codeKeep.slice(open + 1, close).trim();
      cursor = close + 1;
    }
    const paren = /^\s*\(/.exec(code.slice(cursor));
    if (!paren) continue;
    const open = cursor + paren[0].length - 1;
    const close = matchBracket(code, open);
    if (close === -1) continue;
    const first = scan.strings.find((entry) => entry.index > open && entry.index < close);
    const firstToken = code.slice(open + 1, close).trim();
    const name = first && first.quote !== '`' && firstToken.startsWith(first.quote) ? first.value : null;
    calls.push({ callee, index: match.index, line: scan.lineOf(match.index), typeArg, name, ...placement(code, match.index, depth) });
  }
  return calls;
}

/** Whether the code at `index` runs at import time: braces depth 0 and not inside a parameter list. */
function placement(code, index, depth) {
  let braces = 0;
  const parens = [];
  for (let i = 0; i < index; i += 1) {
    const c = code[i];
    if (c === '{') braces += 1;
    else if (c === '}') braces -= 1;
    else if (c === '(') parens.push(i);
    else if (c === ')') parens.pop();
  }
  if (braces > 0) return { atTopLevel: false, inParams: false };
  // Inside an open parenthesis at the top level: a parameter list when the matching ")" is followed
  // by "=>" or "{" (an arrow or a function), possibly after a return type annotation.
  for (const open of parens) {
    const close = matchBracket(code, open);
    if (close === -1) continue;
    const after = code.slice(close + 1, close + 400);
    if (/^\s*(?::[^=;{]*?)?(=>|\{)/.test(after)) return { atTopLevel: false, inParams: true };
  }
  void depth;
  return { atTopLevel: true, inParams: false };
}

/** Members of an object type body "{ a(): T; b?: U; readonly c: V }": [{ name, optional, line, text }]. */
export function typeMembers(scan, open, close) {
  const { code } = scan;
  const members = [];
  const depth = depthAt(code, open + 1, close);
  let start = open + 1;
  const flush = (end) => {
    const raw = code.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*[(:<]/.exec(raw.trimStart());
    if (m) members.push({ name: m[1], optional: m[2] === '?', line: scan.lineOf(start + lead), start: start + lead, end });
    start = end + 1;
  };
  for (let i = open + 1; i < close; i += 1) {
    if (depth(i) !== 0) continue;
    if (code[i] === ';' || code[i] === ',' || code[i] === '\n') {
      if (code.slice(start, i).trim() !== '') flush(i);
      else start = i + 1;
    }
  }
  if (code.slice(start, close).trim() !== '') flush(close);
  // A member split over lines (a method whose parameters wrap) was cut at a newline inside parens:
  // depth handles that, so a fragment without a name pattern was simply skipped.
  return members;
}

/**
 * Resolves a binding type declared in the same file: `type T = ...`, `interface T {...}` or
 * `declare class T extends NativeModule<E> {...}`. Returns { members, events, line } or null.
 * Events come from NativeModule<E> (E an object type or a local type alias) and from the first
 * argument of an addListener member ('onX' | 'onY').
 */
export function resolveBindingType(scan, typeName) {
  const { code } = scan;
  if (!/^[A-Za-z_$][\w$]*$/.test(typeName)) return null;
  const decl = new RegExp(`\\b(?:type\\s+${typeName}\\s*(?:<[^=]*>)?\\s*=|interface\\s+${typeName}\\b|(?:declare\\s+)?class\\s+${typeName}\\b)`).exec(code);
  if (!decl) return null;
  let headerEnd = decl.index + decl[0].length;
  if (!/^type\b/.test(decl[0])) {
    // class/interface: the body is the first "{" outside balanced <...> (extends NativeModule<{ onX: ... }>).
    while (headerEnd < code.length && code[headerEnd] !== '{') {
      if (code[headerEnd] === '<') {
        const close = skipAngle(code, headerEnd);
        if (close === -1) return null;
        headerEnd = close;
      } else if (code[headerEnd] === ';') return null;
      headerEnd += 1;
    }
  }
  const header = code.slice(decl.index, headerEnd);
  const from = headerEnd;
  const bodies = [];
  let generic = null;
  if (/^type\b/.test(header)) {
    // The alias text runs to the first ";" at depth 0 (or a blank line); collect its top-level {...}.
    let i = from;
    let angle = 0;
    for (; i < code.length; i += 1) {
      const c = code[i];
      if (c === '<') angle += 1;
      else if (c === '>' && code[i - 1] !== '=') angle -= 1;
      else if (c === '{' && angle === 0) {
        const end = matchBracket(code, i);
        if (end === -1) break;
        bodies.push([i, end]);
        i = end;
      } else if (c === '(' || c === '[') {
        const end = matchBracket(code, i);
        if (end === -1) break;
        i = end;
      } else if (c === ';' && angle === 0) break;
      else if (c === '\n' && /^\s*\n/.test(code.slice(i + 1, i + 3)) && angle === 0) break;
    }
    generic = /NativeModule\s*<\s*([^>]+?)\s*>/.exec(code.slice(from, i))?.[1] ?? null;
  } else {
    const open = from;
    if (code[open] !== '{') return null;
    const end = matchBracket(code, open);
    if (end === -1) return null;
    bodies.push([open, end]);
    generic = /NativeModule\s*<\s*([^>]+?)\s*>/.exec(header)?.[1] ?? null;
  }
  const members = [];
  const events = new Map();
  for (const [open, close] of bodies) {
    for (const member of typeMembers(scan, open, close)) {
      if (member.name === 'addListener') {
        const paren = code.indexOf('(', member.start);
        const firstComma = code.indexOf(',', paren);
        for (const event of stringsIn(scan, paren, firstComma === -1 ? member.end : firstComma)) events.set(event, member.line);
        continue;
      }
      if (EMITTER_MEMBERS.has(member.name)) continue;
      members.push(member);
    }
  }
  if (generic) {
    const inline = generic.startsWith('{');
    const eventsAlias = inline ? null : new RegExp(`\\btype\\s+${generic.replace(/[^\w$]/g, '')}\\s*=\\s*\\{`).exec(code);
    let open = -1;
    if (inline) open = code.indexOf('{', decl.index + header.search(/NativeModule\s*</));
    else if (eventsAlias) open = eventsAlias.index + eventsAlias[0].length - 1;
    if (open !== -1) {
      const close = matchBracket(code, open);
      if (close !== -1) for (const member of typeMembers(scan, open, close)) events.set(member.name, member.line);
    }
  }
  return { members, events, line: scan.lineOf(decl.index) };
}

// ---------------------------------------------------------------------------------------------
// Packages: what kind of native code a dependency ships
// ---------------------------------------------------------------------------------------------

/**
 * Classifies an installed package folder:
 *   'js'          no native code (no podspec, no android/build.gradle, no expo-module.config.json)
 *   'expo-module' an Expo module (expo-module.config.json): New Architecture by construction
 *   'new'         codegenConfig in package.json: a Turbo Module or Fabric component
 *   'nitro'       a Nitro module (nitro.json, or react-native-nitro-modules in dependencies or
 *                 peerDependencies): JSI hybrid objects generated by nitrogen, New Architecture only
 *   'interop'     native code without any of these: legacy architecture code, run through the interop layer
 * NATIVE_KINDS holds the kinds that run on the New Architecture natively.
 */
export const NATIVE_KINDS = Object.freeze(new Set(['expo-module', 'new', 'nitro']));
export function classifyPackage(dir) {
  const manifest = parseJson(readMaybe(join(dir, 'package.json')) ?? 'null').value;
  if (!manifest || typeof manifest !== 'object') return { kind: 'missing', manifest: null };
  const has = (rel) => existsSync(join(dir, rel));
  const podspec = (sub) => {
    try {
      return readdirSync(join(dir, sub)).some((name) => name.endsWith('.podspec'));
    } catch {
      return false;
    }
  };
  const isExpo = has('expo-module.config.json');
  const isNative = isExpo || podspec('.') || podspec('ios') || podspec('apple') || has('android/build.gradle') || has('android/build.gradle.kts');
  if (!isNative) return { kind: 'js', manifest };
  if (isExpo) return { kind: 'expo-module', manifest };
  if (manifest.codegenConfig && typeof manifest.codegenConfig === 'object') return { kind: 'new', manifest };
  const listsNitro = (field) => manifest[field] && typeof manifest[field] === 'object' && 'react-native-nitro-modules' in manifest[field];
  if (has('nitro.json') || listsNitro('dependencies') || listsNitro('peerDependencies')) return { kind: 'nitro', manifest };
  return { kind: 'interop', manifest };
}
