// app-config-ids.mjs: the slug, iOS bundle id, Android package and app-id candidates of one Expo app,
// read from app.config.ts/js/mjs and app.json without running them (a helper of check-file-names.mjs,
// not an entry point).
//
//   readAppConfig(root, app) -> null | { slug, ios, android, ids }   each a list of entries
//     entry = { value, line, file, name?, isConst?, isPartial?, isOpenEnd? }
//   looksReverseDns(value), jsonKeyLine(text, key)
//
// A code config's bundleIdentifier, package and slug are read as the literals they can take:
//   - a string literal, or the literal a name stands for: a const (const id = `${BASE_ID}${suffix}`
//     leads to BASE_ID) or an id property (identity.appId leads to appId: 'com.acme.tasks');
//   - the literals of an expression, in the shapes Expo's own guides use: both branches of a ternary
//     (IS_DEV ? 'com.myapp.dev' : 'com.myapp'), the operands of ?? and || (process.env.BUNDLE_ID ??
//     'com.acme.tasks'), the static start of a template literal (`com.acme.tasks${suffix}`, isPartial;
//     isOpenEnd when its last segment may continue), and the returned literals of a function in the same
//     file that the expression calls (getUniqueIdentifier() from Expo's EAS tutorial);
//   - nothing else, but a key that is set still overrides app.json (Expo passes app.json to the code
//     config as `config`, and the code config's own values win).
// A literal found inside an expression counts only when it could be an id: not empty and no vendor
// characters; a template start needs two or more dot-separated parts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { matchBracket, scanSource } from './source-scan.mjs';

// Where a code config keeps its app id. A const named exactly like an id (BASE_ID, APP_ID, bundleId,
// PACKAGE_NAME) is one unless its value is a vendor id; a longer name ending like one (IOS_BUNDLE_ID,
// ADMOB_IOS_APP_ID, FACEBOOK_APP_ID) is one only when its value looks like reverse-DNS. An object
// property appId/bundleId/applicationId (app-variants-and-environment's identity object
// { appId: 'com.acme.tasks' }) counts when its value looks like reverse-DNS, or when bundleIdentifier
// or package is set from it (bundleIdentifier: identity.appId), whatever its value.
const ID_NAME = '(bundle_?id|app_?id|base_?id|package_?(id|name)|application_?id)';
const ID_NAME_EXACT = new RegExp(`^${ID_NAME}$`, 'i');
const ID_NAME_SUFFIX = new RegExp(`${ID_NAME}$`, 'i');
const ID_PROPERTIES = ['appId', 'bundleId', 'applicationId'];
// AdMob app ids ('ca-app-pub-…~…'), Firebase app ids ('1:…:ios:…'), URLs and e-mails are never bundle ids.
const VENDOR_VALUE = /[~:/@\s]/;

export const looksReverseDns = (value) => !VENDOR_VALUE.test(value) && /^[^.]+(\.[^.]+)+$/.test(value);
const couldBeId = (value) => value !== '' && !VENDOR_VALUE.test(value);

/** 1-based line of the JSON key "<key>" in a manifest's text, or 1 when it is not spelled plainly. */
export function jsonKeyLine(text, key) {
  const index = text.search(new RegExp(`${JSON.stringify(key).replace(/[.*+?^$|()[\]{}\\]/g, '\\$&')}\\s*:`));
  return index === -1 ? 1 : text.slice(0, index).split('\n').length;
}

/** Literal slug and ids of an app.json: { slug, ios, android } entries of { value, line, file }, or null. */
function readAppJson(root, rel) {
  if (!existsSync(join(root, rel))) return null;
  const text = readFileSync(join(root, rel), 'utf8');
  let expo;
  try {
    expo = JSON.parse(text).expo ?? {};
  } catch {
    return null;
  }
  const at = (value, key) => (typeof value === 'string' ? { value, line: jsonKeyLine(text, key), file: rel } : null);
  return { slug: at(expo.slug, 'slug'), ios: at(expo.ios?.bundleIdentifier, 'bundleIdentifier'), android: at(expo.android?.package, 'package') };
}

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
const isTernaryMark = (code, i) => code[i] === '?' && code[i + 1] !== '?' && code[i + 1] !== '.' && code[i - 1] !== '?';

/** Expression reading over a scanned file: `code` has string contents blanked, `stringAt` holds the literals. */
function expressionReader(scan, rel, properties, consts) {
  const { code, stringAt, lineOf } = scan;
  const skipSpace = (i, end) => {
    let at = i;
    while (at < end && isSpace(code[at])) at += 1;
    return at;
  };
  // Calls visit(i) for every character at bracket depth 0 outside strings; returns the first i it accepts, or -1.
  const topLevel = (start, end, visit) => {
    let depth = 0;
    for (let i = start; i < end; ) {
      const literal = stringAt.get(i);
      if (literal) {
        i = literal.end;
        continue;
      }
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      else if (depth === 0 && visit(i)) return i;
      i += 1;
    }
    return -1;
  };
  // End (exclusive) of the expression that starts at `from`: a top-level , or ;, an unopened closing
  // bracket, or a line break once the expression is complete (Prettier breaks a ternary before ? and :).
  const expressionEnd = (from) => {
    let depth = 0;
    let i = from;
    while (i < code.length) {
      const literal = stringAt.get(i);
      if (literal) {
        i = literal.end;
        continue;
      }
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && (ch === ',' || ch === ';')) break;
      else if (depth === 0 && ch === '\n') {
        let last = i - 1;
        while (last >= from && isSpace(code[last])) last -= 1;
        const after = skipSpace(i, code.length);
        const isOpen = last < from || '?:|&+=>.('.includes(code[last]);
        if (!isOpen && !/^(\?|:|\|\||&&|\+|\.)/.test(code.slice(after, after + 2))) break;
      }
      i += 1;
    }
    return i;
  };

  const entry = (value, index, extra = {}) => ({ value, line: lineOf(index), file: rel, at: index, ...extra });

  // The block or expression body of a function declared in this file: function name() {...}, const name =
  // () => {...}, const name = () => expr, const name = function () {...}.
  const functionBody = (name) => {
    const blockAfterParams = (open) => {
      const close = matchBracket(code, open);
      const brace = close === -1 ? -1 : code.indexOf('{', close);
      const end = brace === -1 ? -1 : matchBracket(code, brace);
      return end === -1 ? null : { block: [brace + 1, end] };
    };
    const declared = new RegExp(`(?<![\\w$])function\\s*\\*?\\s*${name.replace(/\$/g, '\\$')}\\s*(<[^>(]*>)?\\s*\\(`).exec(code);
    if (declared) return blockAfterParams(declared.index + declared[0].length - 1);
    const start = consts.get(name);
    if (start === undefined) return null;
    const end = expressionEnd(start);
    const keyword = /^\s*(async\s+)?function\b[^(]*\(/.exec(code.slice(start, end));
    if (keyword) return blockAfterParams(start + keyword[0].length - 1);
    const arrow = topLevel(start, end, (i) => code[i] === '=' && code[i + 1] === '>');
    if (arrow === -1) return null;
    const body = skipSpace(arrow + 2, end);
    if (code[body] !== '{') return { expression: [body, end] };
    const close = matchBracket(code, body);
    return close === -1 ? null : { block: [body + 1, close] };
  };

  /**
   * The literals an expression in [start, end) can take. `inExpression` is set once the walk passed a
   * ternary, ?? / ||, or a function call: from then on only literals that could be an id count.
   */
  const collect = (start, end, state) => {
    let s = skipSpace(start, end);
    let e = end;
    while (e > s && isSpace(code[e - 1])) e -= 1;
    if (s >= e || state.depth > 8) return [];
    const next = { ...state, depth: state.depth + 1 };
    const question = topLevel(s, e, (i) => isTernaryMark(code, i));
    if (question !== -1) {
      let pending = 1;
      const colon = topLevel(question + 1, e, (i) => {
        if (isTernaryMark(code, i)) pending += 1;
        else if (code[i] === ':') pending -= 1;
        return pending === 0;
      });
      if (colon === -1) return [];
      const branches = { ...next, inExpression: true };
      return [...collect(question + 1, colon, branches), ...collect(colon + 1, e, branches)];
    }
    const cuts = [];
    topLevel(s, e, (i) => {
      if ((code[i] === '?' && code[i + 1] === '?') || (code[i] === '|' && code[i + 1] === '|')) cuts.push(i);
      return false;
    });
    if (cuts.length > 0) {
      const operands = { ...next, inExpression: true };
      const bounds = [s, ...cuts.map((cut) => cut + 2)];
      return bounds.flatMap((from, k) => collect(from, k < cuts.length ? cuts[k] : e, operands));
    }
    // An operand's own wrapping: (expr), expr as T, expr satisfies T, expr!
    for (let stripped = true; stripped; ) {
      stripped = false;
      const tail = /(\s+(as|satisfies)\s+[A-Za-z_$][\w$.<>,\s[\]]*|!)$/.exec(code.slice(s, e));
      if (tail && tail.index > 0) {
        e = s + tail.index;
        stripped = true;
      }
      if (code[s] === '(' && matchBracket(code, s) === e - 1) {
        return collect(s + 1, e - 1, next);
      }
    }
    const literal = stringAt.get(s);
    if (literal && literal.end === e) {
      if (literal.quote !== '`' || literal.parts.length === 1) {
        const value = literal.quote === '`' ? literal.parts[0] : literal.value;
        return !state.inExpression || couldBeId(value) ? [entry(value, s)] : [];
      }
      if (literal.parts[0] === '') {
        // `${BASE_ID}${suffix}`: the literal the leading name stands for.
        const lead = /^`\$\{\s*([A-Za-z_$][\w$.?]*)\s*\}/.exec(code.slice(s, e));
        return lead ? collect(s + lead[0].indexOf(lead[1]), s + lead[0].indexOf(lead[1]) + lead[1].length, next) : [];
      }
      const head = literal.parts[0].replace(/\.+$/, '');
      return looksReverseDns(head) ? [entry(head, s, { isPartial: true, isOpenEnd: !literal.parts[0].endsWith('.') })] : [];
    }
    const text = code.slice(s, e);
    if (/^[A-Za-z_$][\w$]*$/.test(text)) {
      const at = consts.get(text);
      if (at === undefined || state.seen.has(`const:${text}`)) return [];
      return collect(at, expressionEnd(at), { ...next, seen: new Set([...state.seen, `const:${text}`]) });
    }
    const member = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\??\.([A-Za-z_$][\w$]*)$/.exec(text);
    if (member) {
      const candidates = properties.filter((item) => item.name === member[1] && (!state.inExpression || couldBeId(item.value)));
      const chosen = candidates.find((item) => looksReverseDns(item.value)) ?? candidates[0];
      return chosen ? [chosen] : [];
    }
    const call = /^([A-Za-z_$][\w$]*)\s*(<[^>(]*>)?\s*\(/.exec(text);
    if (call && matchBracket(code, s + call[0].length - 1) === e - 1 && !state.seen.has(`fn:${call[1]}`)) {
      const body = functionBody(call[1]);
      const inner = { ...next, inExpression: true, seen: new Set([...state.seen, `fn:${call[1]}`]) };
      if (body?.expression) return collect(body.expression[0], body.expression[1], inner);
      if (!body?.block) return [];
      const [from, to] = body.block;
      const found = [];
      for (const match of code.slice(from, to).matchAll(/(?<![\w$.])return\b/g)) {
        const begin = from + match.index + match[0].length;
        found.push(...collect(begin, Math.min(expressionEnd(begin), to), inner));
      }
      return found;
    }
    return [];
  };

  return { collect, expressionEnd };
}

/** Slug, platform ids and app-id candidates of an app.config.ts/js/mjs, or null when there is none. */
function readAppConfigCode(root, dirPrefix) {
  const rel = ['app.config.ts', 'app.config.js', 'app.config.mjs'].map((name) => `${dirPrefix}${name}`).find((file) => existsSync(join(root, file)));
  if (rel === undefined) return null;
  const scan = scanSource(readFileSync(join(root, rel), 'utf8'));
  const { code, codeKeep, stringAt, lineOf } = scan;
  const consts = new Map();
  for (const match of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=(?!>)\s*/g)) {
    if (!consts.has(match[1])) consts.set(match[1], match.index + match[0].length);
  }
  const quotedAt = (index) => {
    const literal = stringAt.get(index);
    return literal && literal.quote !== '`' ? literal.value : undefined;
  };
  const properties = [...codeKeep.matchAll(new RegExp(`(?<![\\w$.])(['"]?)(${ID_PROPERTIES.join('|')})\\1\\s*:\\s*(?=['"])`, 'g'))]
    .map((match) => ({ value: quotedAt(match.index + match[0].length), line: lineOf(match.index), file: rel, name: match[2], at: match.index }))
    .filter((item) => item.value !== undefined);
  const reader = expressionReader(scan, rel, properties, consts);
  // Every literal the key can take, over every place the code config sets it; [] when it is set but
  // nothing is known (it still overrides app.json); null when it is not set. A type member
  // (bundleIdentifier: string) resolves to nothing and is passed over.
  const field = (key) => {
    let isSet = false;
    const found = new Map();
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.'"])${key}\\s*\\??:\\s*`, 'g'))) {
      isSet = true;
      const at = match.index + match[0].length;
      for (const item of reader.collect(at, reader.expressionEnd(at), { depth: 0, inExpression: false, seen: new Set() })) {
        if (!found.has(`${item.at}:${item.value}`)) found.set(`${item.at}:${item.value}`, item);
      }
    }
    return isSet ? [...found.values()] : null;
  };
  const named = [...consts.entries()]
    .map(([name, at]) => {
      const value = quotedAt(at);
      return value === undefined ? null : { value, line: lineOf(at), file: rel, name, isConst: true };
    })
    .filter((item) => item !== null && (ID_NAME_EXACT.test(item.name) ? !VENDOR_VALUE.test(item.value) : ID_NAME_SUFFIX.test(item.name) && looksReverseDns(item.value)));
  const ids = [...named, ...properties.filter((item) => looksReverseDns(item.value))];
  return { slug: field('slug'), ios: field('bundleIdentifier'), android: field('package'), ids };
}

/**
 * The literal slug and ids of one app: app.config.ts/js/mjs and app.json together, because Expo
 * passes app.json to the code config as `config` and the code config's own values win. Each entry
 * remembers its file and line.
 */
export function readAppConfig(root, app) {
  const dirPrefix = app.isRoot ? '' : `${app.dir}/`;
  const json = readAppJson(root, `${dirPrefix}app.json`);
  const code = readAppConfigCode(root, dirPrefix);
  if (json === null && code === null) return null;
  const pick = (key) => {
    const own = code?.[key] ?? null;
    if (own !== null) return own;
    return json?.[key] ? [json[key]] : [];
  };
  return { slug: pick('slug'), ios: pick('ios'), android: pick('android'), ids: code?.ids ?? [] };
}
