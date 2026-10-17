// async-scan.mjs: the async-safety skill's own scanning helpers (a helper, not an entry point):
// reading the app's sources, finding effect blocks and their cleanups, promise-returning functions,
// and what happens to the value a call returns (kept, returned, handed over, or dropped). Works on
// scanSource() output: `code` has comments and string contents blanked, `codeKeep` keeps strings.
// Heuristic by design: a lint-style scan, not a type checker.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readWorkspaces, walkRepo } from '../check-lib.mjs';
import { functionsOf, isTestFile, matchBracket, scanSource } from './source-scan.mjs';

/** Every .ts/.tsx file under `srcDir` (repo-relative), read and scanned; .d.ts files left out. */
export function readAppSources(root, srcDir) {
  const prefix = srcDir === '.' || srcDir === '' ? '' : `${srcDir.replace(/\/$/, '')}/`;
  return walkRepo(root, { include: ['*.ts', '*.tsx'] })
    .filter((rel) => rel.startsWith(prefix) && !rel.endsWith('.d.ts'))
    .map((rel) => {
      const text = readFileSync(join(root, rel), 'utf8');
      return { rel, text, scan: scanSource(text), isTest: isTestFile(rel) };
    });
}

/** The parsed root package.json, null when missing, { invalid: true } when it is not JSON. */
export function readPackageJson(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { invalid: true };
  }
}

function hasDependency(manifest, name) {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((key) => manifest?.[key]?.[name] !== undefined);
}

/** True when the root package.json or any workspace's manifest depends on `name`. */
export function repoDependsOn(root, pkg, name) {
  if (hasDependency(pkg, name)) return true;
  return readWorkspaces(root).some((workspace) => hasDependency(workspace.manifest, name));
}

export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EFFECT = /\b(useEffect|useLayoutEffect|useInsertionEffect|useFocusEffect)\s*\(/g;
const EFFECT_FN = /^\s*(?:useCallback\s*\(\s*)?\(\s*\)\s*=>\s*\{/;

/** Effect calls whose callback has a block body: [{ hook, index, open, close, inner }]. */
export function effectBlocks(code) {
  const out = [];
  for (const match of code.matchAll(EFFECT)) {
    const after = match.index + match[0].length;
    const fn = EFFECT_FN.exec(code.slice(after, after + 200));
    if (!fn) continue;
    const open = after + fn[0].length - 1;
    const close = matchBracket(code, open);
    if (close === -1) continue;
    out.push({ hook: match[1], index: match.index, open, close, inner: code.slice(open + 1, close) });
  }
  return out;
}

/**
 * The effect's cleanup: the text after the last `return <expr>` at the top level of a block (between
 * its braces), or null when there is none. A bare top-level `return;` (or `return undefined;`) is a
 * guard clause, such as the braceless `if (id === null) return;`, and scanning goes on past it: the
 * cleanup further down is the one every run that started work returns.
 */
export function topLevelCleanup(code, open, close) {
  let depth = 0;
  let cleanup = null;
  for (let i = open + 1; i < close; i += 1) {
    const ch = code[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && ch === 'r' && /^return\b/.test(code.slice(i, i + 7)) && !/[\w$.]/.test(code[i - 1] ?? ' ')) {
      const text = code.slice(i + 6, close);
      if (!/^[ \t]*(?:undefined[ \t]*)?(?:;|\n|$)/.test(text)) cleanup = text;
    }
  }
  return cleanup;
}

/** `const save = useCallback(async (` or `useCallback(async function (`: the name the hook result takes. */
const CALLBACK_WRAPPED = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*(?:React\s*\.\s*)?useCallback\s*(?:<[^()]*>\s*)?\(\s*async\s*(?:function\s*\*?\s*[\w$]*\s*)?(?:<[^()]*>\s*)?$/;

/**
 * Promise-returning functions declared in a scanned file: `async function f`, `const f = async (`,
 * `const f = useCallback(async (...) => ...)`, and any function whose return annotation is
 * Promise<...>. Returns [{ name, bodyStart, bodyEnd }].
 */
export function promiseFunctions(scan) {
  const { code } = scan;
  const out = [];
  for (const fn of functionsOf(scan)) {
    const before = code.slice(Math.max(0, fn.index - 120), fn.index);
    const wrapped = CALLBACK_WRAPPED.exec(before);
    if (wrapped) {
      out.push({ name: wrapped[1], bodyStart: fn.bodyStart, bodyEnd: fn.bodyEnd });
      continue;
    }
    if (!fn.name || fn.name === '(anonymous)') continue;
    const isAsync = /\basync\s+function\s*\*?\s*[\w$]*\s*(?:<[^()]*>)?\s*$|\basync\s*(?:<[^()]*>)?\s*$/.test(before);
    const close = matchBracket(code, fn.index);
    const head = close === -1 ? '' : code.slice(close + 1, fn.bodyStart === -1 ? close + 200 : fn.bodyStart);
    const annotation = /^\s*:\s*(?:Promise|PromiseLike)\s*</.test(head);
    if (isAsync || annotation) out.push({ name: fn.name, bodyStart: fn.bodyStart, bodyEnd: fn.bodyEnd });
  }
  return out;
}

/**
 * Names whose call writes state: useState / useReducer setters, and what a Zustand hook hands out in
 * the same file (`const select = useTaskStore((s) => s.select)`, `const { select } = useTaskStore(...)`).
 * A selected value is never called, so only actions count as writes.
 */
export function stateSetters(code) {
  const names = new Set();
  for (const match of code.matchAll(/\[\s*[A-Za-z_$][\w$]*\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*(?:React\s*\.\s*)?use(?:State|Reducer)\b/g)) {
    names.add(match[1]);
  }
  for (const match of code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*use[A-Z][\w$]*Store\s*\(/g)) names.add(match[1]);
  for (const match of code.matchAll(/\b(?:const|let)\s*\{([^{}]*)\}\s*=\s*use[A-Z][\w$]*Store\s*\(/g)) {
    for (const part of match[1].split(',')) {
      const name = /([A-Za-z_$][\w$]*)\s*(?:=[^,]*)?$/.exec(part.trim());
      if (name) names.add(name[1]);
    }
  }
  return names;
}

/** Type members that return a promise, and those that do not, across files: { promise, other }. */
export function memberReturnIndex(files) {
  const promise = new Set();
  const other = new Set();
  const member = /(?<![\w$.])([A-Za-z_$][\w$]*)\??\s*:\s*(?:<[^<>()]*>\s*)?\((?:[^()]|\([^()]*\))*\)\s*=>\s*([A-Za-z_$][\w$]*)?/g;
  for (const file of files) {
    for (const match of file.scan.code.matchAll(member)) {
      const returns = match[2] ?? '';
      (/^(?:Promise|PromiseLike)$/.test(returns) ? promise : other).add(match[1]);
    }
  }
  for (const name of other) promise.delete(name);
  return promise;
}

/** Index of the bracket that opens the `)` or `]` at `close`, scanning backwards; -1 when none. */
function reverseMatch(code, close) {
  let depth = 0;
  for (let k = close; k >= 0; k -= 1) {
    const ch = code[k];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * Index where the member chain that holds the dot (or identifier) at `at` begins:
 * `Notifications.addX(` → the N, `a?.b().c.addListener(` → the a.
 */
export function chainStart(code, at) {
  let i = at;
  for (let guard = 0; guard < 64; guard += 1) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(code[j])) j -= 1;
    const isDot = code[i] === '.' || (code[i] === '?' && code[i + 1] === '.');
    if (isDot) {
      while (j >= 0 && (code[j] === ')' || code[j] === ']')) {
        const openAt = reverseMatch(code, j);
        if (openAt < 0) return i;
        j = openAt - 1;
        while (j >= 0 && /\s/.test(code[j])) j -= 1;
      }
      let k = j;
      while (k >= 0 && /[\w$]/.test(code[k])) k -= 1;
      if (k === j) return i;
      i = k + 1;
      continue;
    }
    if (j >= 0 && code[j] === '.') {
      i = j > 0 && code[j - 1] === '?' ? j - 1 : j;
      continue;
    }
    return i;
  }
  return i;
}

/**
 * What happens to the value of the call that starts at `start`:
 *   { kind: 'named', name } assigned to a variable or a property path,
 *   { kind: 'returned' } returned, or an arrow function's expression body (not a promise callback),
 *   { kind: 'handed' } passed as an argument, put in an array or object, or used in an expression,
 *   { kind: 'dropped' } a bare statement, or the expression body of a Promise executor / .then callback.
 */
export function holderOf(code, start) {
  const prefix = code.slice(Math.max(0, start - 240), start).replace(/\s+$/, '');
  let named = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:await\s+)?$/.exec(prefix);
  if (named) return { kind: 'named', name: named[1] };
  if (/(?:const|let|var)\s+[[{][^=;]*=\s*(?:await\s+)?$/.test(prefix)) return { kind: 'handed' };
  named = /(?<![=!<>])([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*=\s*(?:await\s+)?$/.exec(prefix);
  if (named && !/=\s*>\s*$/.test(prefix)) return { kind: 'named', name: named[1].replace(/\s+/g, '') };
  if (/\breturn\s*(?:await\s+)?$/.test(prefix)) return { kind: 'returned' };
  if (/=>\s*$/.test(prefix)) {
    const promiseCallback = /(?:new\s+Promise\s*(?:<[^>]*>)?\s*\(|\.(?:then|catch|finally)\s*\(|\bforEach\s*\()\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>\s*$/;
    return promiseCallback.test(prefix) ? { kind: 'dropped' } : { kind: 'returned' };
  }
  if (/(?:[(,[:?]|\?\?|\|\||&&|\byield)\s*$/.test(prefix)) return { kind: 'handed' };
  return { kind: 'dropped' };
}

/**
 * True when `name` (a variable or a property path) is released, called, returned or handed over
 * anywhere in the file: a release often sits in a closure written above the assignment
 * (`const stop = () => { subscription?.remove(); };`).
 */
export function isReleased(code, name, releaseCalls) {
  const n = escapeRegExp(name).replace(/\\\./g, '\\s*\\??\\.\\s*');
  const rest = code;
  const patterns = [
    new RegExp(`(?<![\\w$.])${n}\\s*(?:\\?\\.|\\.)\\s*(?:${releaseCalls})\\s*\\(`),
    new RegExp(`(?<![\\w$.])${n}\\s*(?:\\?\\.)?\\s*\\(`),
    new RegExp(`\\breturn\\s+${n}\\s*[;})\\n]`),
    new RegExp(`=>\\s*${n}\\s*[;,)}\\n]`),
    new RegExp(`[:(,[]\\s*${n}\\s*[,)\\]}]`),
  ];
  return patterns.some((pattern) => pattern.test(rest));
}

/** The top-level arguments of the call whose "(" is at `open`: [{ text, start }]. */
export function callArguments(code, open) {
  const close = matchBracket(code, open);
  if (close === -1) return [];
  const args = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push({ text: code.slice(from, i), start: from });
      from = i + 1;
    }
  }
  if (code.slice(from, close).trim() !== '') args.push({ text: code.slice(from, close), start: from });
  return args;
}

/** True when `index` sits inside one of the [from, to] regions. */
export function inRegions(regions, index) {
  return regions.some(([from, to]) => index > from && index < to);
}
