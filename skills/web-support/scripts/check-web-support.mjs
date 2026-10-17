#!/usr/bin/env node
// check-web-support.mjs: proves an Expo app's web target is declared and its web bundle holds only
// code that works in a browser: platform files that resolve and match, no native-only module or
// React Native API react-native-web lacks in the web graph, no browser global in native code, and
// expo-sqlite's web set-up (wasm, isolation headers, warm-up before synchronous calls).
// Zero dependencies; Node 22+. Run: node ${CLAUDE_SKILL_DIR}/scripts/check-web-support.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, createReporter, lineOf, notYetCreated, parseArgs, resolveAlias, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { findJsxTags, importsOf, isTestFile, maskCode, matchBracket, scanSource } from './lib/source-scan.mjs';
import { HOSTS, OUTPUTS, contractProblems, notWebTargetReason, read, readAppConfig, readJson, webOutputOf } from './lib/web-target.mjs';

const SPEC = {
  name: 'check-web-support',
  summary: 'Checks the web target of an Expo app: declared output, platform files, the web bundle graph, browser globals and the expo-sqlite web set-up.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'The Expo app folder inside the repo (default: the repo root; for a monorepo app, e.g. apps/mobile)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Web target: app.config platforms includes web, or platforms is unset and react-dom is installed.',
    'Otherwise the check is NOT APPLICABLE. Rules:',
    '  web-target          react-native-web is installed; app.config sets web.output and it equals contracts/web.json',
    '  web-contract        contracts/web.json exists and is well-formed',
    '  web-platform-pair   every .web/.native/.ios/.android file has a base file of the same extension (Metro',
    '                      tries x.ts before x.web.tsx); platform route files need their base route',
    '  web-variant-exports a .web file exports exactly the value names of its base file',
    '  web-variant-typed   a .web file holds itself to its base with a type-only import of it',
    '  web-module-support  no file of the web bundle imports a package that fails on the web',
    '                      (assets/web-support-table.json, plus contract nativeOnlyPackages)',
    '  web-rn-api          no file of the web bundle uses a React Native export or member react-native-web',
    '                      lacks, ignores or answers wrongly (I18nManager.isRTL, isScreenReaderEnabled), unless',
    '                      a Platform.OS check keeps it off the web (!== web, === ios, === ios || === android,',
    '                      an early return on the web, combined with && || !), it sits in a function value of a',
    '                      Platform.select key the web never picks (ios, android, native; default when a web key',
    '                      exists), or the file feature-detects it with typeof',
    '  web-browser-global  window, document, navigator, localStorage, sessionStorage, indexedDB, matchMedia',
    '                      appear only in .web files',
    '  web-ssr-scope       with static or server output, a .web file of the bundle reads no browser global',
    '                      at module scope without a typeof guard (Expo evaluates it in Node)',
    '  web-token-storage   the .web sibling of an expo-secure-store adapter keeps no secret in web storage',
    '                      (localStorage, sessionStorage, indexedDB with or without window./globalThis./self.,',
    '                      document.cookie, AsyncStorage)',
    '  web-sqlite-setup    expo-sqlite on the web: wasm asset and dev isolation headers in metro.config.js,',
    '                      deployed isolation headers from the contract host, with COEP require-corp',
    '                      (Safari and every iOS browser ignore credentialless)',
    '  web-sqlite-warm-up  expo-sqlite in the web bundle: the root layout returns <WebStorageGate> with a warm-up',
    '                      as its outermost element (warm-up before synchronous calls, one tab, the unsupported',
    '                      notice, a first render that matches the static HTML), and no adapter the layout',
    '                      creates itself reads expo-sqlite synchronously (it runs before the gate)',
    '  web-error-net       the web bundle records uncaught errors from window events: a module that reads',
    '                      ErrorUtils / HermesInternal (readGlobalErrorHooks) has a .web sibling',
    '  web-static-routes   static output on a static host: each dynamic route exports generateStaticParams',
    '                      or is listed in contract clientRoutes',
  ].join('\n'),
};

const TABLE = JSON.parse(readFileSync(new URL('../assets/web-support-table.json', import.meta.url), 'utf8'));
/** Metro's source extensions in the order it tries them (Expo SDK 57 getDefaultConfig). */
const EXT_ORDER = ['ts', 'tsx', 'mjs', 'js', 'jsx', 'cjs'];
const PLATFORM_FILE = /^(?<stem>.+?)(?:\.(?<platform>ios|android|native|web))?\.(?<ext>tsx?|m?jsx?|cjs)$/;
const BROWSER_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'matchMedia'];
const WEB_STORAGE = /(?<![\w$.])(?:(?:window|globalThis|self)\s*(?:\?\.|\.)\s*)?(localStorage|sessionStorage|indexedDB)\b|\bdocument\s*\.\s*cookie\b/;
/** AsyncStorage keeps its values in localStorage on the web. */
const ASYNC_STORAGE_IMPORT = /['"]@react-native-async-storage\/async-storage['"]/;
const SQLITE_SYNC = /(?<![\w$])(openDatabaseSync|deleteDatabaseSync|backupDatabaseSync|deserializeDatabaseSync)\s*\(|\.\s*(getItemSync|setItemSync|removeItemSync|getAllKeysSync|clearSync|getKeyByIndexSync|getLengthSync)\s*\(/;
const PLATFORM_CHECK = /Platform\s*\.\s*OS\s*[!=]==?\s*['"]\w+['"]|['"]\w+['"]\s*[!=]==?\s*Platform\s*\.\s*OS/g;
const COEP = 'Cross-Origin-Embedder-Policy';
/** Where templates/scripts/metro/web-sqlite-metro.ts lives in the app: CROSS_ORIGIN_ISOLATION_HEADERS and withWebSqlite. */
const METRO_HELPER = 'scripts/metro/web-sqlite-metro.ts';
const COOP = 'Cross-Origin-Opener-Policy';
/** The COEP value every browser isolates with (Safari 15.2+, Chrome 83+, Firefox 79+). */
const COEP_VALUE = 'require-corp';
/** What may render around WebStorageGate in the root layout: nothing that mounts. */
const OUTSIDE_GATE = new Set(['Fragment', 'React.Fragment']);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'new', 'with']);

const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const isLocalSpec = (spec, aliases) => spec.startsWith('./') || spec.startsWith('../') || spec === '.' || resolveAlias(spec, aliases) !== null;

/** Ranges of masked code that run later than the module body: function and method bodies, arrow bodies. */
function deferredRanges(masked) {
  const ranges = [];
  const blockAfter = (from) => {
    const brace = masked.indexOf('{', from);
    return brace === -1 ? null : [brace, matchBracket(masked, brace)];
  };
  for (const match of masked.matchAll(/=>\s*/g)) {
    const start = match.index + match[0].length;
    if (masked[start] === '{') {
      const end = matchBracket(masked, start);
      if (end !== -1) ranges.push([start, end]);
      continue;
    }
    // An expression body ends at the first , ; ) ] } outside its own brackets.
    let depth = 0;
    let end = start;
    for (; end < masked.length; end += 1) {
      const ch = masked[end];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if ((ch === ',' || ch === ';') && depth === 0) break;
    }
    ranges.push([start, end]);
  }
  for (const match of masked.matchAll(/\bfunction\b[^(]*\(/g)) {
    const close = matchBracket(masked, match.index + match[0].length - 1);
    const block = close === -1 ? null : blockAfter(close);
    if (block && block[1] !== -1) ranges.push(block);
  }
  // Methods and getters: name(...) { ... } that is not a control statement or a call.
  for (const match of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (KEYWORDS.has(match[1])) continue;
    const close = matchBracket(masked, match.index + match[0].length - 1);
    if (close === -1) continue;
    const after = /^\s*(?::\s*[^{;=]+)?\{/.exec(masked.slice(close + 1, close + 200));
    if (!after) continue;
    const brace = close + after[0].length;
    const end = matchBracket(masked, brace);
    if (end !== -1) ranges.push([brace, end]);
  }
  return ranges;
}

const insideAny = (ranges, index) => ranges.some(([from, to]) => index > from && index < to);
const innermost = (ranges, index) => ranges.filter(([from, to]) => index > from && index < to).sort((a, b) => b[0] - a[0])[0] ?? null;

/** Value names a module exports ('default' included); null when it re-exports everything (export *). */
function valueExportsOf(text) {
  const masked = maskCode(text);
  if (/(^|[;\n])\s*export\s+\*\s+from/.test(masked)) return null;
  const names = new Set();
  for (const m of masked.matchAll(/(^|[;\n])\s*export\s+(default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[2] ? 'default' : m[3]);
  }
  if (/(^|[;\n])\s*export\s+default\b/.test(masked)) names.add('default');
  for (const m of masked.matchAll(/(^|[;\n])\s*export\s+(type\s+)?\{([^}]*)\}/g)) {
    if (m[2]) continue;
    for (const part of m[3].split(',')) {
      const entry = part.trim();
      if (entry === '' || entry.startsWith('type ')) continue;
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(entry);
      names.add(alias ? alias[1] : entry);
    }
  }
  return names;
}

/** Locally declared names (parameters, variables) that shadow a browser global in this file. */
function shadowedGlobals(masked) {
  return new Set(BROWSER_GLOBALS.filter((name) => new RegExp(`(?:\\b(?:const|let|var|function|class)\\s+${name}\\b)|(?:[(,]\\s*(?:readonly\\s+)?${name}\\s*[:,)=?])`).test(masked)));
}

/** Uses of browser globals: [{ name, index }] (property access or call, not a typeof alone). */
function browserGlobalUses(masked) {
  const shadowed = shadowedGlobals(masked);
  const uses = [];
  for (const m of masked.matchAll(new RegExp(`(?<![\\w$.])(${BROWSER_GLOBALS.join('|')})\\b(?=\\s*(?:\\?\\.|\\.|\\(|\\[))`, 'g'))) {
    if (!shadowed.has(m[1])) uses.push({ name: m[1], index: m.index });
  }
  return uses;
}

/** [from, to] of the statement that starts at or after `pos`: a { block } or up to its semicolon. */
function statementAfter(masked, pos) {
  const start = masked.slice(pos).search(/\S/);
  if (start === -1) return null;
  const at = pos + start;
  if (masked[at] === '{') {
    const end = matchBracket(masked, at);
    return end === -1 ? null : [at, end];
  }
  const end = masked.indexOf(';', at);
  return end === -1 ? null : [at, end];
}

/** The '(' of the if (...) whose condition holds the text at `from`, or -1. Looks through at most three nested parentheses. */
function ifConditionOpen(masked, from) {
  let pos = from;
  for (let level = 0; level < 3; level += 1) {
    let depth = 0;
    let open = -1;
    for (let i = pos - 1; i >= 0; i -= 1) {
      const ch = masked[i];
      if (ch === ')') depth += 1;
      else if (ch === '(') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth -= 1;
      } else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) return -1;
    }
    if (open === -1) return -1;
    const before = masked.slice(Math.max(0, open - 12), open);
    if (/\bif\s*$/.test(before)) return open;
    if (/[\w$]\s*$/.test(before)) return -1; // a call: f(Platform.OS ...) decides nothing here
    pos = open;
  }
  return -1;
}

/** The opening bracket that matches the closing one at `close`, scanning backwards, or -1. */
function openingBracket(masked, close) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (let i = close; i >= 0; i -= 1) {
    const ch = masked[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Splits [from, to) at a top-level operator (outside brackets): [[from, to], ...]. */
function splitTop(masked, from, to, op) {
  const parts = [];
  let depth = 0;
  let last = from;
  for (let i = from; i < to; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0 && masked.startsWith(op, i)) {
      parts.push([last, i]);
      i += op.length - 1;
      last = i + 1;
    }
  }
  parts.push([last, to]);
  return parts;
}

const PLATFORM_ATOM = /^Platform\s*\.\s*OS\s*([!=])==?\s*(['"])(\w+)\2$|^(['"])(\w+)\4\s*([!=])==?\s*Platform\s*\.\s*OS$/;

/**
 * What the condition in [from, to) is in the web bundle, where Platform.OS is 'web': 'T', 'F' or 'U'
 * (unknown). Platform.OS comparisons are known; everything else is unknown; && || ! and parentheses
 * combine them. A top-level ternary is unknown.
 */
function valueOnWeb(masked, keep, from, to) {
  while (from < to && /\s/.test(masked[from])) from += 1;
  while (to > from && /\s/.test(masked[to - 1])) to -= 1;
  if (from >= to) return 'U';
  const ors = splitTop(masked, from, to, '||');
  if (ors.length > 1) {
    const values = ors.map(([a, b]) => valueOnWeb(masked, keep, a, b));
    return values.includes('T') ? 'T' : values.every((v) => v === 'F') ? 'F' : 'U';
  }
  const ands = splitTop(masked, from, to, '&&');
  if (ands.length > 1) {
    const values = ands.map(([a, b]) => valueOnWeb(masked, keep, a, b));
    return values.includes('F') ? 'F' : values.every((v) => v === 'T') ? 'T' : 'U';
  }
  if (splitTop(masked, from, to, '?').some(([, b]) => b < to && masked[b + 1] !== '.' && masked[b + 1] !== '?' && masked[b - 1] !== '?')) return 'U';
  if (masked[from] === '!' && masked[from + 1] !== '=') {
    const inner = valueOnWeb(masked, keep, from + 1, to);
    return inner === 'U' ? 'U' : inner === 'T' ? 'F' : 'T';
  }
  if (masked[from] === '(' && matchBracket(masked, from) === to - 1) return valueOnWeb(masked, keep, from + 1, to - 1);
  const atom = PLATFORM_ATOM.exec(keep.slice(from, to));
  if (!atom) return 'U';
  const [platform, op] = atom[3] ? [atom[3], atom[1]] : [atom[5], atom[6]];
  return (platform === 'web') !== (op === '!') ? 'T' : 'F';
}

/**
 * True when the Platform.OS comparison at [from, to) keeps the code at `index` out of the web: in the
 * body of an if whose condition is false on the web (Platform.OS !== 'web', === 'ios', === 'ios' ||
 * === 'android'), in the else of one that is true there, after an `if (...) { ... return }` true
 * there in the same function (Platform.OS === 'web' or !== 'ios'), or in the operand of a &&, || or
 * ? : that never runs on the web.
 */
function platformCheckGuards(masked, keep, ranges, from, to, index) {
  const open = ifConditionOpen(masked, from);
  if (open !== -1) {
    const close = matchBracket(masked, open);
    if (close === -1) return false;
    const value = valueOnWeb(masked, keep, open + 1, close);
    const body = statementAfter(masked, close + 1);
    if (!body || value === 'U') return false;
    if (value === 'F') return index >= body[0] && index <= body[1];
    const elseMatch = /^\s*else\b/.exec(masked.slice(body[1] + 1));
    if (elseMatch) {
      const elseBody = statementAfter(masked, body[1] + 1 + elseMatch[0].length);
      if (elseBody && index >= elseBody[0] && index <= elseBody[1]) return true;
    }
    const sameFunction = innermost(ranges, from) === innermost(ranges, index) || insideRange(innermost(ranges, from), index);
    return index > body[1] && sameFunction && /\b(return|throw)\b/.test(masked.slice(body[0], body[1] + 1));
  }
  // An expression: widen to the parenthesized group the comparison closes, then &&, || or ?.
  let start = from;
  let end = to;
  let value = valueOnWeb(masked, keep, from, to);
  for (;;) {
    const lead = /^\s*/.exec(masked.slice(end))[0].length;
    if (masked[end + lead] !== ')') break;
    const groupOpen = openingBracket(masked, end + lead);
    if (groupOpen === -1 || /[\w$]\s*$/.test(masked.slice(Math.max(0, groupOpen - 12), groupOpen))) return false; // a call decides nothing here
    value = valueOnWeb(masked, keep, groupOpen + 1, end + lead);
    start = groupOpen;
    end = end + lead + 1;
  }
  for (let bang = /!\s*$/.exec(masked.slice(Math.max(0, start - 8), start)); bang; bang = /!\s*$/.exec(masked.slice(Math.max(0, start - 8), start))) {
    start -= bang[0].length;
    value = value === 'T' ? 'F' : value === 'F' ? 'T' : 'U';
  }
  if (value === 'U') return false;
  const lead = /^\s*/.exec(masked.slice(end))[0];
  const opMatch = /^(&&|\|\||\?(?![.?]))/.exec(masked.slice(end + lead.length));
  if (!opMatch) return false;
  const op = opMatch[1];
  // A neighbour on the left changes what decides: (x && check) || call(), (x || check) ? a() : b().
  const prev = /(&&|\|\|)\s*$/.exec(masked.slice(Math.max(0, start - 40), start))?.[1];
  if (prev === '&&' && (op === '||' || (op === '?' && value === 'T'))) return false;
  if (prev === '||' && op === '?' && value === 'F') return false;
  let depth = 0;
  let sawElse = false;
  for (let i = end + lead.length + op.length; i < index; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (depth < 0 || (depth === 0 && (ch === ';' || ch === ','))) return false;
    if (ch === ':' && depth === 0 && op === '?') sawElse = true;
  }
  if (op === '&&') return value === 'F';
  if (op === '||') return value === 'T';
  return value === 'F' ? !sawElse : sawElse;
}

const insideRange = (range, index) => range !== null && index > range[0] && index < range[1];

const FUNCTION_VALUE = /^\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/;
const NATIVE_KEYS = new Set(['ios', 'android', 'native', 'macos', 'windows']);

/**
 * Ranges inside Platform.select({ ... }) calls that never run in the browser. react-native-web picks
 * obj.web when the key exists, else obj.default, but every value of the object literal is evaluated on
 * every platform before select picks one: only a function value (arrow, function expression or method)
 * under a key the web never picks defers its body. A function under ios/android/native is guarded;
 * one under default is guarded only when a web key exists. A plain value (PlatformColor('label')) runs
 * on the web wherever it sits.
 */
function selectGuardRanges(masked, codeKeep) {
  const ranges = [];
  for (const m of masked.matchAll(/Platform\s*\.\s*select\s*(?:<[^>()]*>)?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(masked, open);
    if (close === -1) continue;
    const brace = masked.slice(open + 1, close).search(/\S/);
    const objOpen = brace === -1 ? -1 : open + 1 + brace;
    if (objOpen === -1 || masked[objOpen] !== '{') continue;
    const objClose = matchBracket(masked, objOpen);
    if (objClose === -1) continue;
    const entries = splitTop(masked, objOpen + 1, objClose, ',').map(([from, to]) => {
      const method = /^\s*(?:async\s+)?(['"]?)([A-Za-z_$][\w$]*)\1\s*\(/.exec(codeKeep.slice(from, to));
      if (method) return { key: method[2], fn: true, from, to };
      const colon = splitTop(masked, from, to, ':');
      const key = /^\s*(['"]?)([A-Za-z_$][\w$]*)\1\s*$/.exec(codeKeep.slice(from, colon[0][1]))?.[2] ?? null;
      const valueFrom = colon.length > 1 ? colon[1][0] : to;
      return { key, fn: colon.length > 1 && FUNCTION_VALUE.test(masked.slice(valueFrom, to)), from: valueFrom, to };
    });
    const hasWeb = entries.some((e) => e.key === 'web');
    for (const entry of entries) {
      if (entry.fn && (NATIVE_KEYS.has(entry.key) || (entry.key === 'default' && hasWeb))) ranges.push([entry.from - 1, entry.to]);
    }
  }
  return ranges;
}

/** [from, to] of the body of a module's default-exported function component, or null. */
function defaultExportBody(masked) {
  let open = -1;
  const direct = /export\s+default\s+function\s*[A-Za-z_$]?[\w$]*\s*\(/.exec(masked);
  if (direct) open = direct.index + direct[0].length - 1;
  else {
    const name = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(masked)?.[1];
    const decl = name ? new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?\\()`).exec(masked) : null;
    if (decl) open = decl.index + decl[0].length - 1;
  }
  if (open === -1) return null;
  const close = matchBracket(masked, open);
  const brace = close === -1 ? -1 : masked.slice(close).search(/\{/);
  if (brace === -1) return null;
  const bodyStart = close + brace;
  const bodyEnd = matchBracket(masked, bodyStart);
  return bodyEnd === -1 ? null : [bodyStart, bodyEnd];
}

/**
 * Where WebStorageGate sits in the root layout's default export: { gate } when it is the outermost
 * element (a Fragment around it aside), { outside: tag } for the first element that renders outside
 * it, { childless: tag } for a gate without children, or null when the layout renders no gate this
 * can read.
 */
function gatePlacement(text) {
  const masked = maskCode(text);
  const body = defaultExportBody(masked);
  if (!body) return null;
  const tags = findJsxTags(text, masked).filter((tag) => tag.start > body[0] && tag.start < body[1]);
  const gate = tags.find((tag) => tag.name === 'WebStorageGate');
  if (!gate) return null;
  if (gate.selfClosing) return { childless: gate };
  const closeAt = masked.indexOf('</WebStorageGate', gate.end);
  const gateEnd = closeAt === -1 ? body[1] : closeAt;
  const encloses = (tag) => !tag.selfClosing && tag.start < gate.start && masked.indexOf(`</${tag.name}`, gateEnd) !== -1;
  const outside = tags.find((tag) => tag !== gate && !(tag.start > gate.start && tag.start < gateEnd) && !(OUTSIDE_GATE.has(tag.name) && encloses(tag)));
  return outside ? { outside } : { gate };
}

/** The value of the Cross-Origin-Embedder-Policy header a config or headers file sets, or null. */
function coepValueIn(text) {
  const at = text.indexOf(COEP);
  if (at === -1) return null;
  return /\b(require-corp|credentialless|unsafe-none)\b/.exec(text.slice(at + COEP.length, at + COEP.length + 80))?.[1] ?? null;
}

/** Resolves an import the way Metro does for the web: x.web.<ext> before x.<ext>, per extension. */
function webResolver(root, aliases) {
  const isFile = (rel) => existsSync(join(root, rel)) && !rel.endsWith('/');
  const probe = (base) => {
    if (/\.(tsx?|m?jsx?|cjs|json)$/.test(base) && isFile(base)) return base;
    for (const ext of EXT_ORDER) {
      if (isFile(`${base}.web.${ext}`)) return `${base}.web.${ext}`;
      if (isFile(`${base}.${ext}`)) return `${base}.${ext}`;
    }
    for (const ext of EXT_ORDER) {
      if (isFile(`${base}/index.web.${ext}`)) return `${base}/index.web.${ext}`;
      if (isFile(`${base}/index.${ext}`)) return `${base}/index.${ext}`;
    }
    return null;
  };
  return (fromRel, spec) => {
    const bases = spec.startsWith('.') ? [posix.normalize(posix.join(posix.dirname(fromRel), spec))] : (resolveAlias(spec, aliases) ?? []).map((p) => posix.normalize(p));
    for (const base of bases) {
      const found = probe(base);
      if (found) return found;
    }
    return null;
  };
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repoRoot = positionals[0] ?? '.';
  const appDir = toPosix(options['app-dir'] ?? '.').replace(/\/$/, '');
  const root = join(repoRoot, appDir);
  const shown = (rel) => (appDir === '.' ? rel : `${appDir}/${rel}`);
  const report = createReporter({ name: SPEC.name, json: options.json });
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root, or pass --app-dir for an app inside a monorepo.');
  const pkg = readJson(join(root, 'package.json'), shown('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const appConfig = deps['react-native'] || deps.expo ? readAppConfig(root) : null;
  const notTarget = notWebTargetReason(deps, appConfig);
  if (notTarget) return report.notApplicable(notTarget);

  const layout = resolveLayout(root);
  const add = (rel, line, rule, message, fix) => report.problem({ file: shown(rel), line, rule, message, fix });

  // web-target, web-contract
  if (!deps['react-native-web']) add('package.json', 1, 'web-target', 'the app builds for the web but react-native-web is not installed', 'Run npx expo install react-native-web react-dom, or set app.config platforms to ["ios", "android"] when the app ships no web build.');
  const contractRel = posix.join(layout.contractsDir, 'web.json');
  let contract = { output: null, host: 'eas-hosting', smokeRoutes: [], clientRoutes: [], nativeOnlyPackages: [] };
  if (existsSync(join(root, contractRel))) {
    contract = { ...contract, ...readJson(join(root, contractRel), shown(contractRel)) };
    contractProblems(contract, shown(contractRel), report);
  } else {
    add(contractRel, 1, 'web-contract', 'the app builds for the web but has no web contract', `Copy templates/contracts/web.json and web.schema.json to ${layout.contractsDir}/ and fill in output, host and smokeRoutes.`);
  }
  let output = contract.output;
  if (!appConfig) {
    const reason = notYetCreated(root, { file: 'app.config.ts', owner: 'expo-project-bootstrap' });
    report.skip({ file: shown('app.config.ts'), rule: 'web-target', message: reason ?? 'not yet created' });
  } else {
    const web = webOutputOf(appConfig);
    if (web.value === null) add(appConfig.file, web.line, 'web-target', 'web.output is not set, so Expo falls back to single without anyone deciding', `Set web: { output: '${OUTPUTS.includes(contract.output) ? contract.output : contract.host === 'static-host' ? 'single' : 'static'}' } (static on EAS Hosting, the default; single only on a static host that reads a headers file).`);
    else if (!OUTPUTS.includes(web.value)) add(appConfig.file, web.line, 'web-target', `web.output "${web.value}" is not one of ${OUTPUTS.join(', ')}`, 'Use single, static or server.');
    else if (OUTPUTS.includes(contract.output) && web.value !== contract.output) add(appConfig.file, web.line, 'web-target', `web.output is "${web.value}" but contracts/web.json says "${contract.output}"`, 'Make the contract and the app config agree.');
    if (web.value !== null) output = web.value;
  }

  // The app's runtime files.
  const srcPrefix = `${layout.srcDir}/`;
  const files = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'] }).filter((rel) => rel.startsWith(srcPrefix) && !isTestFile(rel) && !rel.endsWith('.d.ts'));
  const texts = new Map(files.map((rel) => [rel, readFileSync(join(root, rel), 'utf8')]));
  const routesPrefix = `${layout.routesDir}/`;
  const isServerFile = (rel) => rel.startsWith(routesPrefix) && /(\+api|\+middleware)\.[tj]sx?$/.test(rel);
  const isRootHtml = (rel) => rel.startsWith(routesPrefix) && /\+html(\.web)?\.[tj]sx?$/.test(rel);

  // web-platform-pair, web-variant-exports, web-variant-typed, web-token-storage
  const groups = new Map();
  for (const rel of files) {
    const m = PLATFORM_FILE.exec(rel);
    if (!m) continue;
    const group = groups.get(m.groups.stem) ?? { bases: [], variants: [] };
    if (m.groups.platform) group.variants.push({ rel, platform: m.groups.platform, ext: m.groups.ext });
    else group.bases.push({ rel, ext: m.groups.ext });
    groups.set(m.groups.stem, group);
  }
  for (const [stem, group] of groups) {
    const name = posix.basename(stem);
    const isRoute = stem.startsWith(routesPrefix);
    for (const variant of group.variants) {
      if (group.bases.length === 0) {
        const others = group.variants.map((v) => v.platform);
        const why = isRoute ? 'Expo Router accepts a platform route only beside a route of the same name without a platform' : variant.platform === 'web' || others.includes('web') ? `TypeScript and ${others.includes('web') ? 'any platform without a variant' : 'the iOS and Android bundles'} resolve './${name}' to nothing` : `the web bundle cannot resolve './${name}'`;
        add(variant.rel, 1, 'web-platform-pair', `${posix.basename(variant.rel)} has no base file ${name}.${variant.ext}: ${why}`, `Add ${name}.${variant.ext} (the shared or native implementation) beside it; keep platform-only code in the variants.`);
        continue;
      }
      const shadow = group.bases.find((base) => EXT_ORDER.indexOf(base.ext) < EXT_ORDER.indexOf(variant.ext));
      if (shadow) add(variant.rel, 1, 'web-platform-pair', `Metro resolves ${posix.basename(shadow.rel)} before ${posix.basename(variant.rel)} (it tries every platform for .${shadow.ext} first), so the variant never loads`, `Give the variant the base file's extension (.${variant.platform}.${shadow.ext}), or the base the variant's.`);
      if (variant.platform !== 'web') continue;
      const base = group.bases[0];
      const webText = texts.get(variant.rel);
      const baseText = texts.get(base.rel);
      const webNames = valueExportsOf(webText);
      const baseNames = valueExportsOf(baseText);
      if (webNames && baseNames) {
        const missing = [...baseNames].filter((n) => !webNames.has(n));
        const extra = [...webNames].filter((n) => !baseNames.has(n));
        if (missing.length > 0) add(variant.rel, 1, 'web-variant-exports', `does not export ${missing.join(', ')}, which ${posix.basename(base.rel)} exports: importers type-check against the base and get undefined in the browser`, 'Export the same value names as the base file.');
        if (extra.length > 0) add(variant.rel, 1, 'web-variant-exports', `exports ${extra.join(', ')}, which ${posix.basename(base.rel)} does not: no importer can reach it through './${name}'`, 'Move it to its own module, or add it to the base file too.');
      }
      const typed = new RegExp(`import\\s+type\\s+[^;]*?from\\s*['"](?:\\./|[^'"]*/)${name.replace(/[.$+]/g, '\\$&')}['"]|typeof\\s+import\\(\\s*['"]\\./${name.replace(/[.$+]/g, '\\$&')}['"]\\s*\\)`).test(webText);
      if (!typed) add(variant.rel, 1, 'web-variant-typed', `does not hold itself to ${posix.basename(base.rel)}: nothing type-checks the web file against what importers expect`, `Add \`import type * as Native from './${name}';\` and type each export with typeof Native.<name>.`);
      if (/['"]expo-secure-store['"]/.test(baseText) && (WEB_STORAGE.test(maskCode(webText)) || ASYNC_STORAGE_IMPORT.test(webText))) {
        const storageAt = maskCode(webText).search(WEB_STORAGE);
        const index = storageAt === -1 ? webText.search(ASYNC_STORAGE_IMPORT) : storageAt;
        add(variant.rel, lineOf(webText, index), 'web-token-storage', 'keeps what the native file stores in expo-secure-store in browser storage, which any script on the page can read', 'Keep the session in an httpOnly cookie the server sets, or in memory only (signed out on reload); auth-and-secure-storage owns the session rules.');
      }
    }
  }

  // web-browser-global: native code never touches the DOM.
  for (const rel of files) {
    if (/\.web\.[^.]+$/.test(rel) || isRootHtml(rel) || isServerFile(rel)) continue;
    const text = texts.get(rel);
    for (const use of browserGlobalUses(maskCode(text))) {
      add(rel, lineOf(text, use.index), 'web-browser-global', `uses ${use.name} in a file iOS and Android load too, where it does not exist (TypeScript accepts it: the tsconfig lib includes DOM)`, `Move the browser code into ${posix.basename(rel).replace(/\.([^.]+)$/, '.web.$1')} beside this file, or behind a port whose .web adapter uses it.`);
    }
  }

  // The web bundle: what Metro reaches from the entry and every route, preferring .web files.
  const resolveWeb = webResolver(root, layout.aliases);
  const starts = [];
  const main = typeof pkg.main === 'string' ? pkg.main.replace(/^\.\//, '') : null;
  if (main && !main.startsWith('expo-router') && existsSync(join(root, main))) starts.push(main);
  for (const [stem, group] of groups) {
    if (!stem.startsWith(routesPrefix)) continue;
    const web = group.variants.find((v) => v.platform === 'web');
    const pick = web?.rel ?? group.bases[0]?.rel;
    if (pick && !isServerFile(pick) && !isRootHtml(pick)) starts.push(pick);
  }
  const reachable = new Map();
  const queue = [...starts];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (reachable.has(rel)) continue;
    const text = texts.get(rel) ?? read(root, rel);
    if (text === null || !/\.(tsx?|m?jsx?|cjs)$/.test(rel)) continue;
    const imports = importsOf(scanSource(text)).filter((entry) => !entry.typeOnly);
    reachable.set(rel, { text, imports });
    for (const entry of imports) {
      if (!isLocalSpec(entry.spec, layout.aliases)) continue;
      const target = resolveWeb(rel, entry.spec);
      if (target && !reachable.has(target)) queue.push(target);
    }
  }

  // web-module-support, web-rn-api, web-ssr-scope, sqlite facts
  const nativeOnly = new Set(contract.nativeOnlyPackages ?? []);
  const rn = TABLE.reactNative;
  const missingExports = new Set(rn.missingExports.names);
  const memberGaps = new Map();
  for (const [kind, table] of [['missing', rn.missingMembers], ['silent', rn.silentMembers], ['wrong', rn.wrongMembers]]) {
    for (const [api, members] of Object.entries(table)) {
      if (api.startsWith('$')) continue;
      for (const member of Array.isArray(members) ? members : Object.keys(members)) memberGaps.set(`${api}.${member}`, { kind, answer: Array.isArray(members) ? null : members[member] });
    }
  }
  let sqliteFile = null;
  let sqliteSyncFile = null;
  for (const [rel, { text, imports }] of reachable) {
    const masked = maskCode(text);
    const { codeKeep } = scanSource(text);
    const ranges = deferredRanges(masked);
    for (const entry of imports) {
      if (isLocalSpec(entry.spec, layout.aliases) || entry.spec.startsWith('node:')) continue;
      const name = packageOf(entry.spec);
      if (name === 'expo-sqlite') {
        sqliteFile ??= rel;
        if (SQLITE_SYNC.test(masked)) sqliteSyncFile ??= rel;
      }
      const known = TABLE.packages[entry.spec] ?? TABLE.packages[name];
      const pattern = TABLE.specPatterns.find((p) => new RegExp(p.pattern).test(entry.spec));
      const verdict = nativeOnly.has(name) ? { behaviour: 'it is listed in contracts/web.json nativeOnlyPackages', fix: 'import it only from a .native file, or give this file a .web sibling' } : known?.support === 'none' ? known : pattern ?? null;
      if (verdict) add(rel, entry.line, 'web-module-support', `the web bundle reaches ${entry.spec}: ${verdict.behaviour}`, `${verdict.fix[0].toUpperCase()}${verdict.fix.slice(1)} (references/module-support.md).`);
    }
    // React Native names this file uses: named imports (with their local alias) and namespaces.
    const locals = new Map();
    const namespaces = [];
    const importRanges = [];
    for (const m of text.matchAll(/(^|\n)\s*import\s+(?!type\b)([^;]*?)\s+from\s+['"]react-native['"]/g)) {
      importRanges.push([m.index, m.index + m[0].length]);
      const clause = m[2];
      const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
      if (ns) namespaces.push(ns[1]);
      const braces = /\{([^}]*)\}/.exec(clause);
      for (const part of braces ? braces[1].split(',') : []) {
        const entry = part.trim();
        if (entry === '' || entry.startsWith('type ')) continue;
        const [imported, alias] = entry.split(/\s+as\s+/);
        locals.set(alias ?? imported, imported);
      }
    }
    const usesOf = (pattern) => [...masked.matchAll(pattern)];
    const selects = selectGuardRanges(masked, codeKeep);
    const platformChecks = [...codeKeep.matchAll(PLATFORM_CHECK)].map((m) => ({ from: m.index, to: m.index + m[0].length }));
    const escape = (name) => name.replace(/[$.]/g, '\\$&');
    /** True when the use at `index` never runs on the web, or the file feature-detects `probe` with typeof. */
    const guarded = (index, probe) => {
      if (new RegExp(`typeof\\s+${escape(probe)}\\b`).test(masked)) return true;
      if (selects.some((range) => insideRange(range, index))) return true;
      return platformChecks.some((check) => check.to <= index && platformCheckGuards(masked, codeKeep, ranges, check.from, check.to, index));
    };
    const reportMember = (index, api, member, local) => {
      const gap = memberGaps.get(`${api}.${member}`);
      if (!gap || guarded(index, `${local}.${member}`)) return;
      const what = gap.kind === 'missing' ? 'is undefined in react-native-web, so the call throws in the browser' : gap.kind === 'silent' ? 'does nothing in react-native-web, so the feature silently disappears in the browser' : `misleads in react-native-web: it ${gap.answer}`;
      const wrongFix = api === 'I18nManager'
        ? `Read it only off the web (behind a Platform.OS check with the web answer), or give ${posix.basename(rel)} a .web sibling that reads the browser instead (templates/src/i18n/direction.web.ts for the layout direction; references/rn-api-gaps.md).`
        : `Read it only off the web with the web answer beside it: Platform.OS === 'web' ? Promise.resolve(false) : ${api}.${member}() (references/rn-api-gaps.md).`;
      const fix = gap.kind === 'wrong' ? wrongFix : "Call it inside if (Platform.OS !== 'web') { ... } (or a check for 'ios' or 'android'), after an early return on the web, or move it into a .native file with a .web sibling that does the web equivalent (references/rn-api-gaps.md).";
      add(rel, lineOf(text, index), 'web-rn-api', `${api}.${member} ${what}`, fix);
    };
    // A missing export is undefined, not a throw, until it is used: report each unguarded use.
    const exportFix = "Use it only behind a Platform.OS check for 'ios' or 'android' (or after an early return on the web), in a .native file, or behind a port with a .web adapter; references/rn-api-gaps.md lists what to use on the web.";
    for (const [local, imported] of locals) {
      if (missingExports.has(imported)) {
        const lines = new Set();
        for (const m of usesOf(new RegExp(`(?<![\\w$.])${escape(local)}\\b(?!\\s*:)`, 'g'))) {
          if (importRanges.some(([from, to]) => m.index >= from && m.index < to) || guarded(m.index, local)) continue;
          const line = lineOf(text, m.index);
          if (lines.has(line)) continue;
          lines.add(line);
          add(rel, line, 'web-rn-api', `uses ${imported} from react-native, which react-native-web does not export: it is undefined in the browser`, exportFix);
        }
        continue;
      }
      for (const m of usesOf(new RegExp(`(?<![\\w$.])${escape(local)}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`, 'g'))) reportMember(m.index, imported, m[1], local);
    }
    for (const ns of namespaces) {
      for (const m of usesOf(new RegExp(`(?<![\\w$.])${escape(ns)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)(?:\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*))?`, 'g'))) {
        if (missingExports.has(m[1])) {
          if (!guarded(m.index, `${ns}.${m[1]}`)) add(rel, lineOf(text, m.index), 'web-rn-api', `uses ${ns}.${m[1]}, which react-native-web does not export: it is undefined in the browser`, exportFix);
        } else if (m[2]) reportMember(m.index, m[1], m[2], `${ns}.${m[1]}`);
      }
    }
    // web-error-net: ErrorUtils and HermesInternal do not exist in a browser.
    const nativeHooks = /(?<!function\s+)(?<![\w$.])readGlobalErrorHooks\s*\(|\bErrorUtils\s*\.\s*setGlobalHandler\b|\bHermesInternal\s*(?:\?\.|\.)\s*enablePromiseRejectionTracker\b/.exec(masked);
    if (nativeHooks) add(rel, lineOf(text, nativeHooks.index), 'web-error-net', 'the web bundle installs the error net through ErrorUtils and HermesInternal, which react-native-web does not have: uncaught errors and rejections in the browser go unrecorded', `Add ${posix.basename(rel).replace(/\.([^.]+)$/, '.web.$1')} that builds the net from window events (templates/src/services/error-net/app-error-net.web.ts and window-error-hooks.ts).`);
    // web-ssr-scope: Expo evaluates every module of the web bundle in Node for static and server output.
    if ((output === 'static' || output === 'server') && /\.web\.[^.]+$/.test(rel)) {
      for (const use of browserGlobalUses(masked)) {
        if (insideAny(ranges, use.index)) continue;
        const lineStart = codeKeep.lastIndexOf('\n', use.index) + 1;
        const lineEnd = codeKeep.indexOf('\n', use.index);
        if (new RegExp(`typeof\\s+${use.name}\\b`).test(codeKeep.slice(lineStart, lineEnd === -1 ? undefined : lineEnd))) continue;
        add(rel, lineOf(text, use.index), 'web-ssr-scope', `reads ${use.name} at module scope, but with web.output "${output}" Expo runs this module in Node at export time, where ${use.name} does not exist`, `Read it inside a function or effect, or guard the statement: typeof ${use.name} === 'undefined' ? fallback : ${use.name}...`);
      }
    }
  }

  // web-sqlite-setup, web-sqlite-warm-up
  if (sqliteFile) {
    const metroFile = ['metro.config.js', 'metro.config.cjs', 'metro.config.ts'].find((f) => existsSync(join(root, f)));
    const metro = metroFile ? read(root, metroFile) : null;
    const viaHelper = metro !== null && /withWebSqlite\s*\(/.test(metro);
    if (metro === null) add('metro.config.js', 1, 'web-sqlite-setup', `the web bundle uses expo-sqlite (${sqliteFile}) but there is no metro.config.js to add the wasm asset extension and the isolation headers`, 'Run npx expo customize metro.config.js, then wrap the config: module.exports = withWebSqlite(config) (templates/scripts/metro/web-sqlite-metro.ts).');
    else {
      if (!viaHelper && !(/assetExts/.test(metro) && /['"]wasm['"]/.test(metro))) add(metroFile, 1, 'web-sqlite-setup', 'expo-sqlite on the web imports wa-sqlite.wasm, but Metro does not treat .wasm as an asset: the web bundle fails', 'Wrap the config with withWebSqlite(config) from scripts/metro/web-sqlite-metro.ts (or push "wasm" to config.resolver.assetExts).');
      if (!viaHelper && !(/enhanceMiddleware/.test(metro) && metro.includes(COEP) && metro.includes(COOP))) add(metroFile, 1, 'web-sqlite-setup', 'the dev server does not send the cross-origin isolation headers, so SharedArrayBuffer is missing and expo-sqlite fails in the browser', 'Wrap the config with withWebSqlite(config), which adds both headers in enhanceMiddleware.');
    }
    const viaConstant = (text) => /CROSS_ORIGIN_ISOLATION_HEADERS/.test(text);
    const hasBoth = (text) => text !== null && ((text.includes(COEP) && text.includes(COOP)) || viaConstant(text));
    const reportedCredentialless = new Set();
    const credentiallessAt = (file, text) => {
      if (reportedCredentialless.has(file)) return;
      reportedCredentialless.add(file);
      add(file, lineOf(text, text.indexOf(COEP)), 'web-sqlite-setup', `${COEP} is credentialless, which Safari and every iOS browser ignore (MDN browser-compat-data 8.1.6: safari and safari_ios false, verified 2026-10-16): those visitors get no SharedArrayBuffer and no storage`, `Send ${COEP}: ${COEP_VALUE} (every browser isolates with it); give cross-origin resources a Cross-Origin-Resource-Policy header or load them with crossorigin (references/sqlite-on-web.md section 3).`);
    };
    /** A literal COEP value wins (a key after ...CROSS_ORIGIN_ISOLATION_HEADERS overrides it); else the helper's constant. */
    const credentiallessProblem = (file, text) => {
      if (text === null) return;
      const literal = coepValueIn(scanSource(text).codeKeep);
      if (literal === 'credentialless') credentiallessAt(file, text);
      else if (literal === null && (viaConstant(text) || /withWebSqlite\s*\(/.test(text))) {
        const helper = read(root, METRO_HELPER);
        if (helper !== null && coepValueIn(scanSource(helper).codeKeep) === 'credentialless') credentiallessAt(METRO_HELPER, helper);
      }
    };
    if (contract.host === 'eas-hosting') {
      if (output === 'single') add(appConfig?.file ?? contractRel, 1, 'web-sqlite-setup', 'expo-sqlite needs cross-origin isolation headers, but a single export writes no _expo/.routes.json, so EAS Hosting never receives the expo-router plugin headers', "Use web.output 'static' (or 'server') on EAS Hosting, or deploy the single export to a host that reads a headers file (host static-host).");
      if (appConfig && !hasBoth(appConfig.text)) add(appConfig.file, 1, 'web-sqlite-setup', 'the deployed site will not be cross-origin isolated: the expo-router plugin sets no Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy headers', `Add headers to the expo-router plugin options: ['expo-router', { headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS } }] from scripts/metro/web-sqlite-metro.ts, or the two literals ('${COEP}': '${COEP_VALUE}', '${COOP}': 'same-origin').`);
      else if (appConfig) credentiallessProblem(appConfig.file, appConfig.text);
    } else if (HOSTS.includes(contract.host)) {
      const headersFile = contract.headersFile ?? 'public/_headers';
      const headersText = read(root, headersFile);
      if (!hasBoth(headersText)) add(headersFile, 1, 'web-sqlite-setup', `the deployed site will not be cross-origin isolated: ${headersFile} does not set both ${COEP} and ${COOP}`, `Set ${COEP}: ${COEP_VALUE} and ${COOP}: same-origin for every path in ${headersFile} (references/hosting-and-headers.md has the file for each host).`);
      else credentiallessProblem(headersFile, headersText);
    }
    if (metro !== null) credentiallessProblem(metroFile, metro);
  }
  if (sqliteFile) {
    const layoutRel = ['_layout.web.tsx', '_layout.tsx', '_layout.web.ts', '_layout.ts', '_layout.js'].map((f) => `${layout.routesDir}/${f}`).find((f) => existsSync(join(root, f)));
    const layoutText = layoutRel ? read(root, layoutRel) : null;
    const gated = layoutText !== null && /<WebStorageGate\b/.test(layoutText) && !/warmUp=\{\s*null\s*\}/.test(layoutText);
    const gateFix = 'Return <WebStorageGate warmUp={storageWarmUp} ...> as the root layout\'s outermost element, around DirectionGate, with storageWarmUp from useState(openDeviceWebStorage) (templates/src/features/root-navigator/web-storage-gate.tsx, references/sqlite-on-web.md section 4).';
    const why = sqliteSyncFile ? `${sqliteSyncFile} calls expo-sqlite synchronously, and the first synchronous call in a browser times out while the SQLite worker starts` : `the web bundle opens expo-sqlite (${sqliteFile}), and a second tab of the app cannot open the database files (exclusive access handles): only the gate's tab lock tells that tab before it fails`;
    if (!gated) add(layoutRel ?? `${layout.routesDir}/_layout.tsx`, 1, 'web-sqlite-warm-up', why, gateFix);
    else {
      // Outermost: anything outside the gate renders in the static HTML and on the first client render.
      const placement = gatePlacement(layoutText);
      if (placement?.childless) add(layoutRel, lineOf(layoutText, placement.childless.start), 'web-sqlite-warm-up', 'WebStorageGate has no children, so the app it should hold back renders elsewhere, before the warm-up', gateFix);
      if (placement?.outside) add(layoutRel, lineOf(layoutText, placement.outside.start), 'web-sqlite-warm-up', `the root layout renders <${placement.outside.name}> outside WebStorageGate, so it renders before the warm-up and in the static HTML: a synchronous storage read there (DirectionGate's guard, a store or settings read) times out in the browser, and DirectionGate's restart screen for a right-to-left visitor differs from the static HTML (hydration error #418)`, `Return <WebStorageGate> as the outermost element and move <${placement.outside.name}> into its children (references/sqlite-on-web.md section 4).`);
    }
    // What the root layout itself reads on its first render runs before the gate (a saved language).
    if (layoutRel) {
      const layoutEntry = reachable.get(layoutRel) ?? { imports: importsOf(scanSource(layoutText)).filter((entry) => !entry.typeOnly) };
      for (const entry of layoutEntry.imports) {
        if (!isLocalSpec(entry.spec, layout.aliases)) continue;
        const target = resolveWeb(layoutRel, entry.spec);
        const targetText = target ? (texts.get(target) ?? read(root, target)) : null;
        if (!target || targetText === null || !/-adapter\.[tj]sx?$/.test(target)) continue;
        const masked = maskCode(targetText);
        if (!/['"]expo-sqlite(?:\/[^'"]*)?['"]/.test(targetText) || !SQLITE_SYNC.test(masked)) continue;
        add(layoutRel, entry.line, 'web-sqlite-warm-up', `the root layout creates ${posix.basename(target)} itself, and it reads expo-sqlite synchronously (${target}:${lineOf(targetText, masked.search(SQLITE_SYNC))}): the layout reads it on its first render, before the warm-up, and in a browser that read times out`, `Give ${posix.basename(target)} a .web sibling that keeps the value in localStorage (a preference, never a secret), the way references/sqlite-on-web.md section 4 shows for the settings text.`);
      }
    }
  }

  // web-static-routes
  if (output === 'static' && contract.host === 'static-host') {
    const clientRoutes = new Set(contract.clientRoutes ?? []);
    for (const [stem, group] of groups) {
      if (!stem.startsWith(routesPrefix) || !/\[[^\]]+\]/.test(stem)) continue;
      const rel = group.bases[0]?.rel ?? group.variants[0]?.rel;
      if (!rel || isServerFile(rel)) continue;
      const id = stem.slice(routesPrefix.length);
      const hasParams = /export\s+(?:async\s+)?function\s+generateStaticParams\b|export\s+const\s+generateStaticParams\b/.test(texts.get(rel));
      if (!hasParams && !clientRoutes.has(id)) add(rel, 1, 'web-static-routes', `the dynamic route ${id} has no generateStaticParams, so a static export has no page for /…/<id> and a static host answers 404 on reload`, `Export generateStaticParams, or add "${id}" to contracts/web.json clientRoutes and set up the host's rewrite (references/hosting-and-headers.md).`);
    }
  }

  return report.finish({ checked: files.length, unit: 'source files' });
});
