// store-scan.mjs: text helpers for the store checks (no TypeScript parser needed).
// Every function works on comment-masked source (check-lib maskComments keeps strings and line
// breaks), so indexes map to the right lines.

/** Index just after the bracket that closes the one at `open` ((, [ or {), or -1. Skips strings. */
export function closingBracket(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(source, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function skipString(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') i += 1;
    i += 1;
  }
  return i;
}

/** Splits the text between two brackets into top-level pieces at commas: [{ text, start }]. */
export function splitTopLevel(inner, offset = 0) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const push = (end) => {
    const raw = inner.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim() !== '') parts.push({ text: raw.trim(), start: offset + start + lead });
  };
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(inner, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(inner.length);
  return parts;
}

/** Every call of a callee pattern: [{ index, callee, open, close, args: string[], argStarts: number[] }]. */
export function findCalls(source, calleePattern) {
  const calls = [];
  const re = new RegExp(`(?<![\\w$])(${calleePattern})\\s*\\(`, 'g');
  for (const match of source.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const close = closingBracket(source, open);
    if (close === -1) continue;
    const parts = splitTopLevel(source.slice(open + 1, close - 1), open + 1);
    calls.push({ index: match.index, callee: match[1], open, close, args: parts.map((part) => part.text), argStarts: parts.map((part) => part.start) });
  }
  return calls;
}

/** Patterns that make a new object or array on every call (the "Maximum update depth" trap). */
const BUILDS_NEW = [
  /=>\s*\(\s*\{/, // (s) => ({ ... })
  /=>\s*\[/, // (s) => [ ... ]
  /\breturn\s*\{/, // return { ... }
  /\breturn\s*\[/, // return [ ... ]
  /\.(map|filter|slice|concat|flatMap|toSorted|toReversed|toSpliced|sort|reverse)\s*\(/,
  /\bObject\.(entries|keys|values|fromEntries|assign|groupBy)\s*\(/,
  /\bArray\.from\s*\(/,
  /\bnew\s+(Map|Set|Date)\s*\(/,
  /\{\s*\.\.\./,
  /\[\s*\.\.\./,
];

/** Ends in a primitive: `.length` or `.size` (maybe compared), or a boolean test (.some, .every, .includes, .has). */
const ENDS_PRIMITIVE = /(\.length|\.size|\.(some|every|includes|has)\s*\([\s\S]*\))\s*(?:(?:===?|!==?|<=?|>=?)\s*[\w.$'"-]+\s*)?\)?\s*;?\s*$/;

/**
 * The expression's own top level: a wrapping pair of parentheses is removed and every call's
 * arguments are emptied, so a nested callback (`.filter((key) => key.length > 0)`) cannot make the
 * outer expression look primitive. `a.filter((x) => x.ok).length > 0` becomes `a.filter().length > 0`.
 */
export function topLevelExpression(text) {
  let trimmed = text.trim().replace(/;\s*$/, '');
  while (trimmed.startsWith('(') && closingBracket(trimmed, 0) === trimmed.length) trimmed = trimmed.slice(1, -1).trim();
  let out = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(trimmed, i);
      out += trimmed.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '(') {
      const close = closingBracket(trimmed, i);
      if (close === -1) return trimmed;
      out += '()';
      i = close - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** True when an expression ends in a primitive value (and is not an object or array literal). */
export function endsInPrimitive(text) {
  const trimmed = text.trim();
  return !/^\(?\s*[{[]/.test(trimmed) && ENDS_PRIMITIVE.test(topLevelExpression(trimmed));
}

/** True when an expression (a selector body) builds a new object or array on every call. */
export function buildsNewValue(text) {
  if (BUILDS_NEW.slice(0, 4).some((re) => re.test(text))) return true; // an object or array literal
  if (ENDS_PRIMITIVE.test(topLevelExpression(text.replace(/^\s*=>/, '')))) return false;
  return BUILDS_NEW.some((re) => re.test(text));
}

const PRIMITIVE_TYPE = /^(?:number|string|boolean|bigint|null|undefined|void|true|false|'[^']*'|"[^"]*"|\d+)(?:\s*\|\s*(?:number|string|boolean|bigint|null|undefined|true|false|'[^']*'|"[^"]*"|\d+))*$/;

/**
 * Exported selectors of a *-selectors.ts file that build a new value: Map<name, index>. A selector
 * whose declared return type is a primitive (`: number`, `: boolean`) never counts.
 */
export function objectBuildingSelectors(source) {
  const found = new Map();
  const starts = [...source.matchAll(/export\s+(?:function\s+(select\w+)|const\s+(select\w+)\s*=)/g)];
  starts.forEach((match, n) => {
    const name = match[1] ?? match[2];
    const end = n + 1 < starts.length ? starts[n + 1].index : source.length;
    const decl = source.slice(match.index, end);
    const open = decl.indexOf('(');
    const close = open === -1 ? -1 : closingBracket(decl, open);
    if (close === -1) return;
    const afterParams = decl.slice(close);
    const returnType = /^\s*:\s*([^=]+?)\s*(?:=>|\{)/.exec(afterParams)?.[1]?.trim();
    if (returnType !== undefined && PRIMITIVE_TYPE.test(returnType)) return;
    const body = afterParams.replace(/^\s*:\s*[^=]+?(?==>|\{)/, '');
    if (buildsNewValue(body)) found.set(name, match.index);
  });
  return found;
}

/** True when a selector returns its own parameter: `(s) => s`, `s => s`, `(state: S) => { return state; }`. */
export function isIdentitySelector(text) {
  return /^\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)=]*)?\)?\s*(?::[^=]+)?=>\s*(?:\(\s*)?(?:\1|\{\s*return\s+\1\s*;?\s*\})\s*\)?$/.test(text.trim());
}

/**
 * Module-level selector functions declared in any file (column 0: `const selectOpen = (s: S) => ...`,
 * `function selectOpen(s: S) {...}`, exported or not) that build a new value: Map<name, index>. The body
 * ends at the arrow's block, or at the first ";" at bracket depth 0.
 */
export function localBuilderSelectors(source) {
  const found = new Map();
  const decl = /^(?:export\s+)?(?:function\s+([A-Za-z_$][\w$]*)\s*(?=[(<])|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?=\(|[A-Za-z_$][\w$]*\s*=>))/gm;
  for (const match of source.matchAll(decl)) {
    const name = match[1] ?? match[2];
    const start = match.index + match[0].length;
    const open = source.indexOf('(', start);
    if (open === -1 || /[;{]/.test(source.slice(start, open))) continue;
    const close = closingBracket(source, open);
    if (close === -1) continue;
    const afterParams = source.slice(close);
    const returnType = /^\s*:\s*([^=]+?)\s*(?:=>|\{)/.exec(afterParams)?.[1]?.trim();
    if (returnType !== undefined && PRIMITIVE_TYPE.test(returnType)) continue;
    const typeLength = /^\s*:\s*[^=]+?(?==>|\{)/.exec(afterParams)?.[0].length ?? 0;
    let bodyStart = close + typeLength;
    if (source.startsWith('=>', source.slice(bodyStart).search(/\S/) + bodyStart)) bodyStart = source.indexOf('=>', bodyStart) + 2;
    const first = source.slice(bodyStart).search(/\S/) + bodyStart;
    let end;
    if (source[first] === '{') end = closingBracket(source, first);
    else {
      end = source.length;
      let depth = 0;
      for (let i = first; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '"' || ch === "'" || ch === '`') i = skipString(source, i);
        else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
        else if (ch === ';' && depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const body = source.slice(first, end);
    // A block whose last return ends in a primitive (`return open.length;`) builds nothing it returns.
    const lastReturn = source[first] === '{' ? body.lastIndexOf('return') : -1;
    if (lastReturn !== -1 && endsInPrimitive(body.slice(lastReturn + 6, -1))) continue;
    if (buildsNewValue(`=> ${body}`)) found.set(name, match.index);
  }
  return found;
}

/** The index of the "(" after optional type arguments (<T>, nested <A<B>> and (x) => y inside), or -1. */
export function openParenAfterGenerics(source, from) {
  let i = from;
  while (/\s/.test(source[i] ?? '')) i += 1;
  if (source[i] === '(') return i;
  if (source[i] !== '<') return -1;
  let depth = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '<') depth += 1;
    else if (ch === '>' && source[i - 1] !== '=') {
      depth -= 1;
      if (depth === 0) break;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      const end = closingBracket(source, i);
      if (end === -1) return -1;
      i = end - 1;
    } else if (ch === ';') return -1;
  }
  i += 1;
  while (/\s/.test(source[i] ?? '')) i += 1;
  return source[i] === '(' ? i : -1;
}

/**
 * Every Zustand store initializer: createStore<...>()((set, get) => ({ ... })) or createStore((set) => ...).
 * Returns [{ index, setter, getter, objectStart, objectEnd, entries: [{ key, start, end, text }] }];
 * `entries` are the top-level members of the returned object literal.
 */
export function storeInitializers(source) {
  const found = [];
  const calls = [];
  for (const match of source.matchAll(/(?<![\w$.])createStore\s*(?=[<(])/g)) {
    const open = openParenAfterGenerics(source, match.index + match[0].length);
    if (open === -1) continue;
    const close = closingBracket(source, open);
    if (close === -1) continue;
    const parts = splitTopLevel(source.slice(open + 1, close - 1), open + 1);
    calls.push({ index: match.index, open, close, args: parts.map((part) => part.text), argStarts: parts.map((part) => part.start) });
  }
  for (const call of calls) {
    let arrowCall = call;
    // createStore<T>()(initializer): the initializer is the argument of the second call.
    if (call.args.length === 0) {
      const next = /^\s*\(/.exec(source.slice(call.close));
      if (next === null) continue;
      const open = call.close + next[0].length - 1;
      const close = closingBracket(source, open);
      if (close === -1) continue;
      const parts = splitTopLevel(source.slice(open + 1, close - 1), open + 1);
      arrowCall = { ...call, open, close, args: parts.map((part) => part.text), argStarts: parts.map((part) => part.start) };
    }
    const init = arrowCall.args[0];
    if (init === undefined) continue;
    const params = /^\(?\s*([A-Za-z_$][\w$]*)?\s*(?:,\s*([A-Za-z_$][\w$]*))?[^)]*\)?\s*=>/.exec(init);
    if (params === null) continue;
    const initStart = arrowCall.argStarts[0];
    const arrow = source.indexOf('=>', initStart);
    const bodyOpen = source.slice(arrow + 2).search(/\S/) + arrow + 2;
    // (set) => ({ ... }) or (set) => { return { ... } }
    let objectOpen = -1;
    if (source[bodyOpen] === '(' && source.slice(bodyOpen + 1).trimStart().startsWith('{')) objectOpen = source.indexOf('{', bodyOpen);
    else if (source[bodyOpen] === '{') {
      const ret = /\breturn\s*\{/.exec(source.slice(bodyOpen, closingBracket(source, bodyOpen)));
      if (ret !== null) objectOpen = bodyOpen + ret.index + ret[0].length - 1;
    }
    if (objectOpen === -1) continue;
    const objectEnd = closingBracket(source, objectOpen);
    if (objectEnd === -1) continue;
    const entries = splitTopLevel(source.slice(objectOpen + 1, objectEnd - 1), objectOpen + 1).map((part) => {
      const key = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*[:(]/.exec(part.text)?.[1] ?? null;
      return { key, start: part.start, end: part.start + part.text.length, text: part.text };
    });
    found.push({ index: call.index, setter: params[1] ?? null, getter: params[2] ?? null, objectStart: objectOpen, objectEnd, entries });
  }
  return found;
}

const KEYWORDS_BEFORE_PAREN = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'typeof', 'await', 'yield', 'new', 'delete', 'void', 'in', 'of', 'case']);

/** The index of the first token after an optional `: ReturnType` that starts at `from` (brackets balanced), or -1. */
function skipReturnType(source, from) {
  let i = from;
  while (/\s/.test(source[i] ?? '')) i += 1;
  if (source[i] !== ':') return i;
  i += 1;
  let angle = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') i = skipString(source, i);
    else if (ch === '(' || ch === '[' || (ch === '{' && angle > 0)) {
      const end = closingBracket(source, i);
      if (end === -1) return -1;
      i = end - 1;
    } else if (ch === '<') angle += 1;
    else if (ch === '>' && source[i - 1] !== '=') angle -= 1;
    else if (angle === 0 && (source.startsWith('=>', i) || ch === '{')) return i;
    else if (angle === 0 && /[;,)}=]/.test(ch)) return -1;
  }
  return -1;
}

/** Where an arrow's or function's body ends: its closing brace, or the end of an expression body. */
function bodyEnd(source, bodyStart) {
  if (source[bodyStart] === '{') return closingBracket(source, bodyStart);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') i = skipString(source, i);
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) return i;
    } else if (depth === 0 && (ch === ';' || ch === ',')) return i;
  }
  return source.length;
}

/** Local names a parameter list binds: `({ a, b: c, ...rest }: T)` gives a, c, rest; `(deps: T, x)` gives deps, x. */
function boundNames(inner) {
  const trimmed = inner.trim();
  if (trimmed === '') return [];
  return splitTopLevel(trimmed).flatMap((part) => {
    if (!part.text.startsWith('{')) return [/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(part.text)?.[1]].filter(Boolean);
    const end = closingBracket(part.text, 0);
    return splitTopLevel(part.text.slice(1, end - 1))
      .map((member) => /^(?:\.\.\.)?([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*)\b(?!\s*[.(]))?/.exec(member.text))
      .filter(Boolean)
      .map((match) => match[2] ?? match[1]);
  });
}

/**
 * Every function in `source` with its parameter list and body:
 * [{ name, params: string, bodyStart, bodyEnd }]. Covers `function name(...) {}`, function expressions,
 * arrows (`(a, b): T => ...`, `deps => ...`) and object or class methods (`name(deps) { ... }`).
 */
function functionsIn(source) {
  const found = [];
  for (let open = source.indexOf('('); open !== -1; open = source.indexOf('(', open + 1)) {
    const close = closingBracket(source, open);
    if (close === -1) continue;
    const before = source.slice(Math.max(0, open - 120), open);
    const decl = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(?:<[^()]*>)?\s*$/.exec(before);
    const next = skipReturnType(source, close);
    if (next === -1) continue;
    let bodyStart;
    let name = null;
    if (source.startsWith('=>', next)) {
      bodyStart = source.slice(next + 2).search(/\S/) + next + 2;
      name = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^()]*>\s*)?$/.exec(before)?.[1] ?? null;
    } else if (source[next] === '{') {
      const method = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*$/.exec(before);
      if (decl === null && (method === null || KEYWORDS_BEFORE_PAREN.has(method[1]))) continue;
      bodyStart = next;
      name = decl === null ? method[1] : decl[1] ?? /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?function\b[^(]*$/.exec(before)?.[1] ?? null;
    } else continue;
    found.push({ name, params: source.slice(open + 1, close - 1), bodyStart, bodyEnd: bodyEnd(source, bodyStart) });
  }
  // Single-parameter arrows without parentheses: `deps => ...` (not a `): Type =>` return type).
  for (const match of source.matchAll(/(?<![\w$.:])(?<!:\s+)([A-Za-z_$][\w$]*)\s*=>/g)) {
    if (/\)\s*:\s*$/.test(source.slice(Math.max(0, match.index - 40), match.index))) continue;
    const arrow = match.index + match[0].length;
    const bodyStart = source.slice(arrow).search(/\S/) + arrow;
    const name = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?$/.exec(source.slice(Math.max(0, match.index - 120), match.index))?.[1] ?? null;
    found.push({ name, params: match[1], bodyStart, bodyEnd: bodyEnd(source, bodyStart) });
  }
  return found;
}

/**
 * The names the function that encloses `index` binds from its parameters: { name, params }. The
 * enclosing function is the innermost one of any form (declaration, `const f = (deps) =>`, function
 * expression, method) whose body holds `index`. Destructured names count (`({ a, b }: T)` gives a, b),
 * and so do names the body destructures or reads off a parameter before `index`
 * (`const { tasks } = deps;`, `const tasks = deps.tasks;`). [] for `()` or no enclosing function.
 */
export function enclosingParams(source, index) {
  const enclosing = functionsIn(source)
    .filter((fn) => fn.bodyStart <= index && index < fn.bodyEnd)
    .sort((a, b) => b.bodyStart - a.bodyStart)[0];
  if (enclosing === undefined) return { name: null, params: [] };
  const params = boundNames(enclosing.params);
  const prelude = source.slice(enclosing.bodyStart, index);
  for (const param of [...params]) {
    const esc = param.replace(/\$/g, '\\$');
    for (const match of prelude.matchAll(new RegExp(`(?:const|let|var)\\s*(\\{[^{}]*\\})\\s*=\\s*${esc}(?![\\w$.])`, 'g'))) params.push(...boundNames(match[1]));
    for (const match of prelude.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${esc}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*[;\\n]`, 'g'))) params.push(match[1]);
  }
  return { name: enclosing.name, params: [...new Set(params)] };
}

/** The identifier of the call that encloses `index` (the callee before the nearest unclosed "("), or null. */
export function enclosingCallee(source, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) {
        if (ch !== '(') return null;
        return /([A-Za-z_$][\w$.]*)\s*$/.exec(source.slice(Math.max(0, i - 80), i))?.[1] ?? null;
      }
      depth -= 1;
    }
  }
  return null;
}

/** True when the call starting at `index` is a whole statement (its result is dropped). */
export function isStatementCall(source, index, close) {
  const before = source.slice(0, index).replace(/\s+$/, '');
  const prev = before.at(-1) ?? '';
  const after = source.slice(close).replace(/^[ \t]+/, '');
  const isStatementStart = prev === '' || prev === ';' || prev === '{' || prev === '}';
  return isStatementStart && /^(;|\n|\r|$|\})/.test(after);
}
