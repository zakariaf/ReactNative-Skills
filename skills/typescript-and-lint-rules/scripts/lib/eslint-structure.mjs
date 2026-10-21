// eslint-structure.mjs: reads the structure of an eslint.config.mjs without running it: the top-level
// consts, the config items of defineConfig([...]) with the files each block reaches, and a whitespace-free
// form of any code range for verbatim comparison. Owned by typescript-and-lint-rules (not synced);
// check-configs.mjs compares the app's config with the skill's own templates/eslint.config.mjs through it.

import { matchBracket, scanSource } from './source-scan.mjs';

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** Characters that make a path segment a glob rather than a literal name. */
const GLOB_CHARS = /[*?[\]{}()!]/;

/** True when a glob names files by their literal name (src/i18n/direction.ts, src/**\/test-only.ts). */
export function isExactGlob(glob) {
  const leaf = String(glob).split('/').pop();
  return leaf !== '' && !GLOB_CHARS.test(leaf);
}

/** Splits the text between `open` and its partner bracket at the commas of depth 0 ([{ start, end }]). */
export function elementsOf(code, open) {
  const close = matchBracket(code, open);
  if (close === -1) return { close: -1, items: [] };
  const items = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      items.push({ start, end: i });
      start = i + 1;
    }
  }
  if (code.slice(start, close).trim() !== '') items.push({ start, end: close });
  return { close, items };
}

/** A range [start, end) without its surrounding whitespace. */
function trimRange(code, start, end) {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(code[from])) from += 1;
  while (to > from && /\s/.test(code[to - 1])) to -= 1;
  return { start: from, end: to };
}

/** The index after a value that starts at `from`: up to the comma, semicolon or closing bracket of depth 0. */
function valueEnd(code, from, stops = ',;') {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (depth === 0 && stops.includes(c)) return i;
  }
  return code.length;
}

/**
 * Builds the model of one config file. `prefixes` are workspace folder prefixes ('apps/<star>/') a
 * multi-package config puts in front of the canonical globs; they are stripped from every string, so
 * 'apps/<star>/src/api/**' compares equal to 'src/api/**'.
 */
export function configModel(text, { prefixes = [] } = {}) {
  const scan = scanSource(text);
  const { code, codeKeep } = scan;
  const stringAt = scan.stringAt;
  const strip = (value) => {
    for (const prefix of prefixes) {
      if (value.startsWith(prefix)) return value.slice(prefix.length);
      if (value.startsWith(`./${prefix}`)) return `./${value.slice(prefix.length + 2)}`;
    }
    return value;
  };
  /** The range with whitespace and comments removed outside strings, trailing commas dropped. */
  const norm = (start, end) => {
    let out = '';
    let chunk = '';
    const flush = () => {
      out += chunk.replace(/,([\]})])/g, '$1');
      chunk = '';
    };
    for (let i = start; i < end; i += 1) {
      const entry = stringAt.get(i);
      if (entry !== undefined) {
        flush();
        // Prefixes hold no escapes, so they are stripped from the raw text (escapes stay as written).
        const raw = codeKeep.slice(i, entry.end);
        out += entry.quote === '`' || prefixes.length === 0 ? raw : `${entry.quote}${strip(raw.slice(1, -1))}${entry.quote}`;
        i = entry.end - 1;
      } else if (!/\s/.test(codeKeep[i])) chunk += codeKeep[i];
    }
    flush();
    return out;
  };
  const stringValue = (range) => {
    const entry = stringAt.get(range.start);
    return entry !== undefined && entry.end === range.end && entry.quote !== '`' ? strip(entry.value) : null;
  };

  // Top-level consts: `const NAME = value;` at column 0.
  const consts = new Map();
  for (const match of code.matchAll(/^const ([A-Za-z_$][\w$]*)\s*=\s*/gm)) {
    const start = match.index + match[0].length;
    const end = valueEnd(code, start, ';');
    consts.set(match[1], { name: match[1], start: match.index, valueStart: start, valueEnd: end, line: scan.lineOf(match.index), text: norm(start, end) });
  }
  /** The strings of a const array (spreads of other const arrays included), or null when it is not one. */
  const constGlobs = (name, seen = new Set()) => {
    const decl = consts.get(name);
    if (decl === undefined || seen.has(name)) return null;
    seen.add(name);
    const range = trimRange(code, decl.valueStart, decl.valueEnd);
    const single = stringValue(range);
    if (single !== null) return { kind: 'string', globs: [single] };
    if (code[range.start] !== '[' || matchBracket(code, range.start) !== range.end - 1) return null;
    const globs = [];
    for (const item of elementsOf(code, range.start).items) {
      const element = trimRange(code, item.start, item.end);
      const value = stringValue(element);
      const spread = /^\.\.\.([A-Za-z_$][\w$]*)$/.exec(code.slice(element.start, element.end));
      if (value !== null) globs.push(value);
      else if (spread) {
        const inner = constGlobs(spread[1], seen);
        if (inner === null) return null;
        globs.push(...inner.globs);
      } else return null;
    }
    return { kind: 'array', globs };
  };

  /** The units a files/ignores value reaches: { units: [{ unit, globs, group }], unresolved: [text] }. */
  const scopeOf = (range) => {
    const value = trimRange(code, range.start, range.end);
    const text = codeKeep.slice(value.start, value.end).trim();
    const units = [];
    const unresolved = [];
    const addIdent = (name, raw) => {
      const resolved = IDENT.test(name) ? constGlobs(name) : null;
      if (resolved === null) unresolved.push(raw);
      else if (resolved.kind === 'string') units.push({ unit: resolved.globs[0], globs: resolved.globs, group: null });
      else units.push({ unit: `@${name}`, globs: resolved.globs, group: name });
    };
    if (IDENT.test(text)) addIdent(text, text);
    else if (code[value.start] === '[' && matchBracket(code, value.start) === value.end - 1) {
      for (const item of elementsOf(code, value.start).items) {
        const element = trimRange(code, item.start, item.end);
        const raw = codeKeep.slice(element.start, element.end);
        const literal = stringValue(element);
        if (literal !== null) units.push({ unit: literal, globs: [literal], group: null });
        else addIdent(raw.replace(/^\.\.\./, ''), raw);
      }
    } else unresolved.push(text);
    return { units, unresolved };
  };

  /** The properties of the object literal at `open`: [{ key, start (key), valueStart, valueEnd }]. */
  const propertiesOf = (open) =>
    elementsOf(code, open).items.map((item) => {
      const range = trimRange(code, item.start, item.end);
      const head = codeKeep.slice(range.start, range.end);
      const key = /^(?:(['"])([^'"\n]+)\1|([A-Za-z_$][\w$]*))\s*:/.exec(head);
      if (key === null) return { key: `...${norm(range.start, range.end).replace(/^\.\.\./, '')}`, start: range.start, valueStart: range.start, valueEnd: range.end, spread: true };
      return { key: key[2] ?? key[3], start: range.start, valueStart: range.start + key[0].length, valueEnd: range.end, spread: false };
    });

  // The items of defineConfig([...]).
  const items = [];
  let arrayRange = null;
  const at = code.search(/defineConfig\s*\(\s*\[/);
  if (at !== -1) {
    const open = code.indexOf('[', at);
    const { close, items: elements } = elementsOf(code, open);
    arrayRange = { start: open, end: close };
    for (const element of elements) {
      const range = trimRange(code, element.start, element.end);
      const line = scan.lineOf(range.start);
      if (code[range.start] !== '{' || matchBracket(code, range.start) !== range.end - 1) {
        const head = /^(?:\.\.\.)?([A-Za-z_$][\w$.]*)/.exec(codeKeep.slice(range.start, range.end));
        items.push({ kind: 'other', line, start: range.start, end: range.end, head: head ? head[1] : norm(range.start, range.end), text: norm(range.start, range.end) });
        continue;
      }
      const block = { kind: 'block', line, start: range.start, end: range.end, files: null, ignores: null, keys: new Map(), rules: new Map(), dupes: [], zones: null };
      for (const property of propertiesOf(range.start)) {
        if (property.key === 'files' || property.key === 'ignores') {
          block[property.key] = scopeOf({ start: property.valueStart, end: property.valueEnd });
          block[`${property.key}Line`] = scan.lineOf(property.start);
        } else if (property.key === 'rules' && code[trimRange(code, property.valueStart, property.valueEnd).start] === '{') {
          const rulesOpen = trimRange(code, property.valueStart, property.valueEnd).start;
          for (const rule of propertiesOf(rulesOpen)) {
            if (block.rules.has(rule.key)) block.dupes.push(rule.key);
            block.rules.set(rule.key, zonesSplit(rule) ?? norm(rule.valueStart, rule.valueEnd));
          }
        } else {
          if (block.keys.has(property.key)) block.dupes.push(property.key);
          block.keys.set(property.key, norm(property.valueStart, property.valueEnd));
        }
      }
      items.push(block);
    }
  }

  /** import/no-restricted-paths: the value with its zones list emptied, plus each zone (extra zones only add bans). */
  function zonesSplit(rule) {
    if (rule.key !== 'import/no-restricted-paths') return null;
    const slice = code.slice(rule.valueStart, rule.valueEnd);
    const match = /zones\s*:\s*\[/.exec(slice);
    if (match === null) return null;
    const open = rule.valueStart + match.index + match[0].length - 1;
    const { close, items: zones } = elementsOf(code, open);
    if (close === -1) return null;
    return { value: `${norm(rule.valueStart, open + 1)}${norm(close, rule.valueEnd)}`, zones: zones.map((zone) => norm(zone.start, zone.end)) };
  }

  return { scan, consts, items, arrayRange, norm, constGlobs, elementsOf: (open) => elementsOf(code, open), trimRange: (start, end) => trimRange(code, start, end) };
}

/** A block's scope as one comparable key: the files units and the ignores units, sorted. */
export function scopeKey(block) {
  const part = (scope) => (scope === null ? '' : [...new Set(scope.units.map((entry) => entry.unit))].sort().join(','));
  return `${part(block.files)}|${part(block.ignores)}`;
}

/** A short human label for a block's scope: "files: RUNTIME, ignores: TESTS". */
export function scopeLabel(block) {
  const part = (scope) => scope.units.map((entry) => (entry.group === null ? `'${entry.unit}'` : entry.group)).join(', ');
  const files = block.files === null ? 'every file (no files key)' : `files: ${part(block.files)}`;
  return block.ignores === null ? files : `${files}, ignores: ${part(block.ignores)}`;
}

/**
 * How an app block differs from the canonical block with the same scope ([] when it does not). The
 * import resolver settings may list more tsconfigs when multi-package, the zones rule may hold more
 * zones (they only add bans), and a rule may take one of its sanctioned `alternatives` values verbatim.
 */
export function blockDifferences(canonical, app, { multiPackage = false, alternatives = {} } = {}) {
  const differences = [];
  const keys = new Set([...canonical.keys.keys(), ...app.keys.keys()]);
  for (const key of keys) {
    if (key === 'settings' && multiPackage) continue;
    if (!app.keys.has(key)) differences.push(`lacks ${key}`);
    else if (!canonical.keys.has(key)) differences.push(`adds ${key}`);
    else if (app.keys.get(key) !== canonical.keys.get(key)) differences.push(`changes ${key}`);
  }
  for (const [rule, want] of canonical.rules) {
    const got = app.rules.get(rule);
    if (got === undefined) differences.push(`lacks the rule '${rule}'`);
    else if (typeof want === 'object' && typeof got === 'object') {
      if (got.value !== want.value || want.zones.some((zone) => !got.zones.includes(zone))) differences.push(`changes the rule '${rule}'`);
    } else if (JSON.stringify(got) !== JSON.stringify(want) && !(alternatives[rule] ?? []).some((entry) => entry.value === got)) differences.push(`changes the rule '${rule}'`);
  }
  for (const rule of app.rules.keys()) if (!canonical.rules.has(rule)) differences.push(`adds the rule '${rule}'`);
  for (const key of app.dupes) differences.push(`declares '${key}' twice (the last one wins)`);
  return differences;
}

/** True when two blocks with the same scope are the same canonical block in a changed form. */
export function sameBlockFamily(canonical, app) {
  if (canonical.rules.size === 0) return [...canonical.keys.keys()].some((key) => app.keys.has(key));
  return [...canonical.rules.keys()].some((rule) => app.rules.has(rule));
}
