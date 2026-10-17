// store-rules.mjs: the rules of check-stores.mjs, one function per concern. Each gets the context
// built by the checker: { root, layout, storesDir, files: [{ rel, code, isTest }], contract, ... }
// and reports through ctx.problem(rel, index, rule, message, fix).

import { posix } from 'node:path';

import { isTestFile, resolveImport, valueImports } from './source-scan.mjs';
import { buildsNewValue, closingBracket, endsInPrimitive, enclosingCallee, enclosingParams, findCalls, isIdentitySelector, isStatementCall, localBuilderSelectors, objectBuildingSelectors, openParenAfterGenerics, splitTopLevel, storeInitializers } from './store-scan.mjs';

/** Ports a store may read without it counting as its persistence. */
export const NON_PERSISTENCE_PORTS = ['clock', 'errorLog', 'logger', 'log', 'analytics', 'crashReporter', 'rules', 'haptics', 'audio'];

/** The marker of a store whose state is lost at restart on purpose (reason: 10+ characters). */
export const MEMORY_ONLY = /\/\/\s*memory-only:\s*\S.{9,}/;

const STORE_HOOK = '(?!useSyncExternalStore)use[A-Z][A-Za-z0-9]*Store|useStore';
const SECOND_ENGINES = ['@react-native-async-storage/async-storage', 'react-native-mmkv'];
const NETWORK_PACKAGES = /^(@tanstack\/react-query|@tanstack\/query-core|axios|ky|graphql-request|@apollo\/client|urql)(\/|$)/;
const RUNTIME_PACKAGES = /^(react|react-native|zustand|expo|@expo\/[^/]+|@tanstack\/[^/]+)(\/|$)|^expo-/;
const IMPURE_CALLS = /\b(Date\.now|new\s+Date|Math\.random|performance\.now|crypto\.randomUUID|crypto\.getRandomValues|randomUUID)\s*\(/g;
const ADAPTER_FILE = /(^|-)sql-driver$|^sqlite-|-adapter(\.(ios|android))?$|^app-database$|^open-device-|^document-store$|^fake-/;
const withoutExt = (path) => path.replace(/\.(ts|tsx|js|mjs)$/, '');

const under = (rel, dir) => dir !== null && dir !== undefined && (rel === dir || rel.startsWith(`${dir}/`));
const basename = (rel) => rel.split('/').at(-1);
const stemOf = (rel) => basename(rel).replace(/\.tsx?$/, '');

/** Where an import points: { kind: 'external' | 'local', spec, path } (path repo-relative or null). */
function target(ctx, rel, spec) {
  return resolveImport(rel, spec, { root: ctx.root, aliases: ctx.layout.aliases });
}

// ---------------------------------------------------------------------------------------------
// Imports: second persistence, persistence bypass, server state, purity
// ---------------------------------------------------------------------------------------------

/** A store file: under the stores folder, or any file that holds a store initializer. */
export function isStoreFile(ctx, file) {
  return under(file.rel, ctx.storesDir) || storeInitializers(file.bare).length > 0;
}

/**
 * zustand's persist middleware anywhere in src/ (it only ever persists a store); AsyncStorage and MMKV
 * only in a store file. Outside the stores, which key-value engine the app may use (expo-sqlite/kv-store,
 * or MMKV when contracts/persistence.json "keyValueStore" names it) is persistence-and-migrations' rule.
 */
export function checkSecondPersistence(ctx, file) {
  if (file.isTest || ctx.legacyImports.has(file.rel)) return;
  const inStore = isStoreFile(ctx, file);
  for (const match of file.code.matchAll(/import\s+(?:type\s+)?([^;]*?)\s*from\s*'([^']+)'/g)) {
    const [, clause, spec] = match;
    const isPersistMiddleware = spec === 'zustand/middleware' && /\b(persist|createJSONStorage)\b/.test(clause);
    const isEngineInStore = inStore && SECOND_ENGINES.includes(spec);
    if (!isPersistMiddleware && !isEngineInStore) continue;
    ctx.problem(file.rel, match.index, 'second-persistence', `imports ${isPersistMiddleware ? "zustand's persist middleware" : `${spec} in a store`}: a second place to persist state`, 'Stores persist through the data layer\'s ports (a repository, the document service, a preferences port), hydrated synchronously when the store is created; no zustand persist middleware, and no AsyncStorage or MMKV in a store (a key-value adapter in src/services behind a port is persistence-and-migrations\' business).');
  }
}

export function checkPersistenceBypass(ctx, file) {
  if (file.isTest || !isStoreFile(ctx, file)) return;
  for (const match of file.code.matchAll(/import\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/g)) {
    const spec = match[3];
    const resolved = target(ctx, file.rel, spec);
    const isTypeOnly = match[1] !== undefined || /^\{[^}]*\}$/.test(match[2].trim()) && match[2].replace(/[{}\s]/g, '').split(',').every((name) => name.startsWith('type'));
    const local = resolved.kind === 'local' ? resolved.path : null;
    const isDriverOrSlots = local !== null && under(local, ctx.layout.dataDir) && /(^|\/)(sql-driver|document-store)$/.test(withoutExt(local));
    const isSdk = /^(expo-sqlite|expo-secure-store|expo-file-system)(\/|$)/.test(spec);
    const isAdapter = local !== null && (under(local, ctx.layout.dataDir) || under(local, ctx.layout.servicesDir)) && ADAPTER_FILE.test(withoutExt(basename(local)));
    if (isDriverOrSlots || (!isTypeOnly && (isSdk || isAdapter))) {
      ctx.problem(file.rel, match.index, 'store-bypasses-persistence', `imports ${spec}${isDriverOrSlots ? ' (the raw driver or slot store)' : ''}`, 'A store receives a repository, the document service or a preferences port through its factory (createStores(deps)) and calls it; only the data layer talks to SQLite, files or secure storage.');
    }
  }
  for (const match of file.bare.matchAll(/\b(?:data|database|appData|db)\s*\.\s*driver\b|\bdriver\s*\.\s*(run|get|all|exec|transaction)\s*\(/g)) {
    ctx.problem(file.rel, match.index, 'store-bypasses-persistence', 'reaches the SQL driver', 'Add a repository method in the data folder and call it from the store.');
  }
}

export function checkServerState(ctx, file) {
  if (file.isTest || !isStoreFile(ctx, file)) return;
  for (const { spec, index } of valueImports(file.code)) {
    const resolved = target(ctx, file.rel, spec);
    const isApi = resolved.kind === 'local' && under(resolved.path, ctx.layout.apiDir);
    if (!NETWORK_PACKAGES.test(spec) && !isApi) continue;
    ctx.problem(file.rel, index, 'server-state-in-store', `imports ${spec}: server data in a client store`, 'Server state lives in the TanStack Query cache over the ApiClient port (networking-and-server-state); a store holds client state only (local rows, UI state, preferences).');
  }
  for (const match of file.bare.matchAll(/(?<![\w$.])fetch\s*\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/g)) {
    ctx.problem(file.rel, match.index, 'server-state-in-store', `calls ${match[0].replace(/\s*\($/, '')} from a store`, 'Fetch in src/api behind the ApiClient port and read it with useQuery (networking-and-server-state); never from a store.');
  }
}

export function checkPurity(ctx, file) {
  if (file.isTest || !/-(reducer|selectors)\.ts$/.test(file.rel)) return;
  const banned = (local) => [ctx.layout.servicesDir, ctx.layout.apiDir, ctx.layout.featuresDir, ctx.layout.uiDir, ctx.layout.routesDir, `${ctx.layout.srcDir}/hooks`].some((dir) => under(local, dir))
    || (under(local, ctx.layout.dataDir) && !/(^|\/|-)schemas?(\/|$|-)/.test(withoutExt(local)))
    || (under(local, ctx.storesDir) && /-(store|context)$/.test(withoutExt(local)));
  for (const { spec, index } of valueImports(file.code)) {
    const resolved = target(ctx, file.rel, spec);
    const isBanned = resolved.kind === 'external' ? RUNTIME_PACKAGES.test(spec) : resolved.path !== null && banned(resolved.path);
    if (isBanned) ctx.problem(file.rel, index, 'reducer-impure', `imports ${spec}`, 'Reducers and selectors are pure functions over plain data: import only types and other pure modules (schema defaults are fine).');
  }
  for (const match of file.bare.matchAll(IMPURE_CALLS)) {
    ctx.problem(file.rel, match.index, 'reducer-impure', `calls ${match[1].replace(/\s+/g, ' ')}()`, 'Time and ids arrive in the action ({ type: "add-active-time", ms }, a saved row with its id); the clock is the ClockPort, read by the caller.');
  }
}

// ---------------------------------------------------------------------------------------------
// Store creation: singletons, factories called once
// ---------------------------------------------------------------------------------------------

export function checkSingletons(ctx, file) {
  if (file.isTest) return;
  for (const match of file.code.matchAll(/import\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*'zustand'/g)) {
    ctx.problem(file.rel, match.index, 'store-singleton', "imports create from 'zustand' (a module-level hook store)", "Use createStore from 'zustand/vanilla' inside a create<Domain>Store(deps) factory, created once by createStores and handed down by StoresProvider.");
  }
  if (ctx.osMirrors.has(file.rel)) return;
  for (const match of file.bare.matchAll(/^(?:export\s+)?(?:const|let|var)\s+[\w$]+(?:\s*:[^=]+)?\s*=\s*(createStore\b|create[A-Z]\w*Store\s*\()/gm)) {
    ctx.problem(file.rel, match.index, 'store-singleton', 'a store created at module level (one store shared by every test, and created again after a reload)', 'Create it in a factory called once at startup (createStores in AppRoot\'s startApp, a useState initializer); only an OS mirror listed in contracts/stores.json osMirrorStores may live at module level.');
  }
}

/** True when a parameter (`store: SessionStore<...>`, `api: StoreApi<S>`, a bare `store`) is a store, not a selector. */
function isStoreParam(param) {
  const parsed = /^([A-Za-z_$][\w$]*)\s*\??\s*(?::\s*([\s\S]*))?$/.exec(param.trim());
  if (parsed === null) return false;
  const [, name, type] = parsed;
  if (type === undefined) return /^(store|api)$/i.test(name);
  return !type.includes('=>') && /\b(StoreApi|[A-Z]\w*Store)\b/.test(type);
}

/**
 * Every store hook declared in the scanned files (`function useXStore(` or `const useXStore = (`):
 * name -> { takesStore, file }. takesStore is true when its first parameter is a store, the
 * (store, selector) shape of useUndoableSessionStore; false for a domain hook that takes the selector.
 */
export function storeHookShapes(files) {
  const shapes = new Map();
  for (const file of files) {
    if (file.isTest) continue;
    const declared = /(?<![\w$.])(?:function\s+(use[A-Z]\w*Store)\b|(?:const|let)\s+(use[A-Z]\w*Store)\s*(?::[^=]+)?=\s*(?:function\b\s*)?)/g;
    for (const match of file.bare.matchAll(declared)) {
      const open = openParenAfterGenerics(file.bare, match.index + match[0].length);
      if (open === -1) continue;
      const close = closingBracket(file.bare, open);
      if (close === -1) continue;
      const first = splitTopLevel(file.bare.slice(open + 1, close - 1))[0]?.text ?? '';
      shapes.set(match[1] ?? match[2], { takesStore: isStoreParam(first), file: file.rel });
    }
  }
  return shapes;
}

/**
 * Every exported domain store factory (`export function createXStore(` or `export const createXStore = (...) =>`):
 * name -> declaring file. A per-session factory is left out: one declared in a file that also declares a
 * hook taking the store as its first parameter (createSessionStore next to useUndoableSessionStore(store,
 * selector)). The name decides nothing: an auth createSessionStore is a domain store.
 */
export function domainFactories(files, hookShapes = storeHookShapes(files)) {
  const perSessionFiles = new Set([...hookShapes.values()].filter((shape) => shape.takesStore).map((shape) => shape.file));
  const factories = new Map();
  for (const file of files) {
    if (file.isTest || perSessionFiles.has(file.rel)) continue;
    const declared = /export\s+(?:function\s+(create[A-Z]\w*Store|createStores)\s*[(<]|const\s+(create[A-Z]\w*Store|createStores)\s*(?::[^=]+)?=\s*(?:<[^>]*>\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>))/g;
    for (const match of file.bare.matchAll(declared)) factories.set(match[1] ?? match[2], file.rel);
  }
  return factories;
}

export function checkCreatedOnce(ctx) {
  const renderDirs = [ctx.layout.featuresDir, ctx.layout.uiDir, `${ctx.layout.srcDir}/hooks`];
  // The startup skeleton (AppRoot's startApp, app-startup-and-bootstrap) is the composition home.
  const startupDir = `${ctx.layout.featuresDir}/root-navigator`;
  for (const [factory] of ctx.factories) {
    const callers = [];
    for (const file of ctx.files) {
      if (file.isTest) continue;
      for (const call of findCalls(file.bare, factory)) {
        if (/function\s+$/.test(file.bare.slice(Math.max(0, call.index - 12), call.index))) continue;
        callers.push({ file, call });
      }
    }
    const files = [...new Set(callers.map(({ file }) => file.rel))];
    for (const { file, call } of callers) {
      if (renderDirs.some((dir) => under(file.rel, dir)) && !under(file.rel, startupDir)) {
        ctx.problem(file.rel, call.index, 'store-created-twice', `calls ${factory} in feature or UI code (a new store per mount, invisible to every other screen)`, 'Create domain stores once at startup (createStores in AppRoot\'s startApp, a useState initializer) and read them with use<Domain>Store(selector).');
      } else if (files.length > 1) {
        ctx.problem(file.rel, call.index, 'store-created-twice', `${factory} is called in ${files.length} files (${files.join(', ')})`, 'Call each domain factory in one composition file only (createStores); everything else reads the store through its provider.');
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The store pattern: persist before publish, checked writes, reducers, synchronous
// ---------------------------------------------------------------------------------------------

function evidenceIn(text, deps) {
  const found = [];
  for (const dep of deps) {
    const isDepsObject = !NON_PERSISTENCE_PORTS.includes(dep);
    const member = new RegExp(`(?<![\\w$.])${dep}((?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)+)\\s*\\(`, 'g');
    for (const match of text.matchAll(member)) {
      const chain = match[1].replace(/\s/g, '').split('.').filter(Boolean);
      const port = chain.length > 1 ? chain[0] : dep;
      if (!isDepsObject || NON_PERSISTENCE_PORTS.includes(port)) continue;
      const open = match.index + match[0].length - 1;
      found.push({ index: match.index, close: closingBracket(text, open), isCall: true });
    }
    if (NON_PERSISTENCE_PORTS.includes(dep)) continue;
    for (const match of text.matchAll(new RegExp(`(?<![\\w$.])${dep}\\s*\\(`, 'g'))) {
      found.push({ index: match.index, close: closingBracket(text, match.index + match[0].length - 1), isCall: true });
    }
    for (const match of text.matchAll(new RegExp(`(?<=[(,]\\s*)${dep}(?=\\s*[,)])`, 'g'))) {
      const callee = enclosingCallee(text, match.index);
      if (callee !== null && !/Reducer$/.test(callee)) found.push({ index: match.index, close: -1, isCall: false });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function isChecked(text, write, firstSet) {
  if (/\bif\s*\(\s*!?\s*$/.test(text.slice(Math.max(0, write.index - 12), write.index))) return true;
  const assigned = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(text.slice(Math.max(0, write.index - 60), write.index));
  if (assigned === null) return !isStatementCall(text, write.index, write.close);
  const between = text.slice(write.close, firstSet === -1 ? text.length : firstSet);
  const name = assigned[1];
  return new RegExp(`(!\\s*${name}\\b|\\b${name}\\s*\\.\\s*ok\\b|\\b${name}\\s*[!=]==|if\\s*\\(\\s*${name}\\s*\\))`).test(between);
}

function reducerVariables(text) {
  return new Set([...text.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*Reducer\s*\(/g)].map((match) => match[1]));
}

function publishesReducerResult(arg, reducerVars) {
  if (/[\w$]Reducer\s*\(/.test(arg)) return true;
  if ([...reducerVars].some((name) => new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(arg))) return true;
  const literal = /^\{([\s\S]*)\}$/.exec(arg.trim());
  if (literal === null) return false;
  const keys = [...literal[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,]|$)/g)].map((match) => match[1]);
  return keys.length > 0 && keys.every((key) => /(Failure|Error)$/.test(key));
}

export function checkStorePattern(ctx, file) {
  if (file.isTest || ctx.osMirrors.has(file.rel)) return [];
  const isMemoryOnly = MEMORY_ONLY.test(file.raw);
  const persisting = [];
  for (const init of storeInitializers(file.bare)) {
    if (init.setter === null) continue;
    const { params } = enclosingParams(file.bare, init.index);
    let persists = false;
    for (const entry of init.entries) {
      const sets = findCalls(entry.text, init.setter).filter((call) => !/\.\s*$/.test(entry.text.slice(0, call.index)));
      if (sets.length === 0) continue;
      const at = (index) => entry.start + index;
      const reducerVars = reducerVariables(entry.text);
      for (const call of sets) {
        if (!publishesReducerResult(call.args.join(', '), reducerVars)) {
          ctx.problem(file.rel, at(call.index), 'store-logic-outside-reducer', `${entry.key ?? 'a method'} publishes a value no reducer produced`, 'Compute the next state with the pure <domain>Reducer(state, action) and publish its result (set(next)); recording a write failure (set({ lastWriteFailure })) is the one other publish.');
        }
      }
      const evidence = evidenceIn(entry.text, params);
      persists ||= evidence.length > 0;
      if (isMemoryOnly) continue;
      const firstSet = sets[0].index;
      if (evidence.length === 0) {
        ctx.problem(file.rel, at(firstSet), 'store-persist-order', `${entry.key ?? 'a method'} publishes a change it never persists (it is lost at the next launch)`, 'Write through the port the factory receives (repository, document service, preferences) before set(); a store whose state is meant to be lost at restart says so with "// memory-only: <why>".');
        continue;
      }
      if (evidence[0].index > firstSet) {
        ctx.problem(file.rel, at(firstSet), 'store-persist-order', `${entry.key ?? 'a method'} publishes (${init.setter}) before it persists`, 'Reduce, persist (committed when it returns ok), then publish: the screen must never show a value that is not on disk.');
        continue;
      }
      for (const write of evidence.filter((item) => item.isCall && item.index < firstSet)) {
        if (!isChecked(entry.text, write, firstSet)) {
          ctx.problem(file.rel, at(write.index), 'store-unchecked-write', `${entry.key ?? 'a method'} ignores the write's result, so a failed write is still published`, 'Keep the result (const saved = repo.write(...)) and return it before set() when !saved.ok (or record the failure); publish only what reached the disk.');
        }
      }
    }
    if (persists && !isMemoryOnly) persisting.push(init);
  }
  return persisting;
}

export function checkAsync(ctx, file) {
  if (file.isTest || !isStoreFile(ctx, file) || ctx.osMirrors.has(file.rel)) return;
  for (const match of file.bare.matchAll(/\basync\b|\bawait\b|\.then\s*\(/g)) {
    ctx.problem(file.rel, match.index, 'store-async', `${match[0].replace(/\s*\($/, '(')} in a store`, 'Stores are synchronous: the data layer\'s ports commit before they return, and network work belongs to TanStack Query (networking-and-server-state). An async action races itself and can publish a stale answer last.');
  }
}

export function checkSetOutside(ctx, file) {
  if (file.isTest || /\bcreateStore\b/.test(file.bare)) return;
  for (const match of file.bare.matchAll(/(?<!this)\.\s*setState\s*\(/g)) {
    ctx.problem(file.rel, match.index, 'store-set-outside', 'sets a store\'s state from outside the store', 'Change state only through the store\'s own methods (which reduce and persist first); after a write that spans stores, call updateAndPublish, which asks each store to reload.');
  }
}

// ---------------------------------------------------------------------------------------------
// Names, selectors, tests, cross-store writes
// ---------------------------------------------------------------------------------------------

/** First words that name a command: with one of these, a past participle at the end is a field or flag (set-completed, toggle-pinned). */
export const IMPERATIVE_VERBS = ['add', 'append', 'apply', 'archive', 'assign', 'cancel', 'change', 'clear', 'close', 'collapse', 'complete', 'copy', 'create', 'decrement', 'delete', 'disable', 'dismiss', 'duplicate', 'edit', 'enable', 'expand', 'export', 'fill', 'filter', 'finish', 'focus', 'grant', 'hide', 'import', 'increment', 'insert', 'load', 'mark', 'merge', 'move', 'open', 'pause', 'pin', 'purge', 'record', 'redo', 'remove', 'rename', 'reorder', 'replace', 'reset', 'restore', 'resume', 'retry', 'revoke', 'save', 'schedule', 'select', 'set', 'share', 'show', 'skip', 'snooze', 'sort', 'start', 'stop', 'submit', 'toggle', 'undo', 'unpin', 'update', 'use'];
const EVENT_PREFIXES = ['on', 'handle', 'did', 'was', 'has', 'is', 'should', 'will'];
/** Last words that always report an outcome, even after a command verb (load-succeeded, save-failed). */
const OUTCOME_WORDS = ['failed', 'succeeded'];
const PAST = /(?<!e)ed$/;

/**
 * An event name: a past-tense or event first word, an outcome last word (load-failed), or a past-tense
 * last word after a noun (task-added, theme-changed).
 */
export function isEventName(name) {
  const words = name.split('-');
  const first = words[0] ?? '';
  const last = words.at(-1) ?? '';
  if (PAST.test(first) || EVENT_PREFIXES.includes(first)) return true;
  if (words.length > 1 && OUTCOME_WORDS.includes(last)) return true;
  return words.length > 1 && PAST.test(last) && !IMPERATIVE_VERBS.includes(first);
}

/** Where the body of \`type Name<...> =\` starts (just after "="), given the index after the name; -1 when it is not an alias. */
function aliasBodyStart(bare, afterName) {
  let i = afterName;
  while (/\s/.test(bare[i] ?? '')) i += 1;
  if (bare[i] === '<') {
    let depth = 0;
    for (; i < bare.length; i += 1) {
      if (bare[i] === '<') depth += 1;
      else if (bare[i] === '>' && bare[i - 1] !== '=') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i += 1;
    while (/\s/.test(bare[i] ?? '')) i += 1;
  }
  return bare[i] === '=' ? i + 1 : -1;
}

function typeAliasEnd(bare, from) {
  let depth = 0;
  let i = from;
  for (; i < bare.length; i += 1) {
    const ch = bare[i];
    if ('([{<'.includes(ch)) depth += 1;
    else if (')]}>'.includes(ch) && bare[i - 1] !== '=') depth -= 1;
    else if (ch === ';' && depth <= 0) break;
    else if (ch === '\n' && depth <= 0 && !/^\s*[|&]/.test(bare.slice(i + 1, i + 200)) && /\S/.test(bare.slice(from, i))) break;
  }
  return i;
}

/** [start, end) of a local \`type Name = ...\` or \`interface Name { ... }\`, or null. */
function declarationRange(bare, name) {
  const alias = new RegExp(`\\btype\\s+${name}\\b`).exec(bare);
  const body = alias ? aliasBodyStart(bare, alias.index + alias[0].length) : -1;
  if (body !== -1) return [alias.index, typeAliasEnd(bare, body)];
  const iface = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(bare);
  if (iface) return [iface.index, closingBracket(bare, iface.index + iface[0].length - 1)];
  return null;
}

/**
 * [start, end) ranges of the action unions in a file: \`type <Name>Action = ...\` up to its closing
 * semicolon or the next top-level line, plus each local type or interface the union names
 * (\`type TasksAction = AddTask | SetDone\`).
 */
export function actionUnionRanges(bare) {
  const ranges = [];
  for (const match of bare.matchAll(/\btype\s+[A-Z]\w*Action\b/g)) {
    const body = aliasBodyStart(bare, match.index + match[0].length);
    if (body === -1) continue;
    const range = [match.index, typeAliasEnd(bare, body)];
    ranges.push(range);
    const members = new Set(bare.slice(body, range[1]).match(/\b[A-Z]\w*\b/g) ?? []);
    for (const member of members) {
      const declared = declarationRange(bare, member);
      if (declared && declared[1] > declared[0]) ranges.push(declared);
    }
  }
  return ranges;
}

export function checkActionNames(ctx, file) {
  const isReducer = /-reducer\.ts$/.test(file.rel);
  const isStoreFile = under(file.rel, ctx.storesDir) && /-(store|types)\.ts$/.test(file.rel);
  if (file.isTest || !(isReducer || isStoreFile)) return;
  // Only the action union is named here: a failure object ({ type: 'write-failed' }) or an action a
  // store builds is not a declaration. A reducer or types file without a named union falls back to
  // every `type: '...'` literal; a store file without one is skipped (its reducer declares the union).
  const ranges = actionUnionRanges(file.bare);
  if (ranges.length === 0 && /-store\.ts$/.test(file.rel)) return;
  const inUnion = (index) => ranges.length === 0 || ranges.some(([from, to]) => index >= from && index < to);
  for (const match of file.code.matchAll(/\btype\s*:\s*'([^']+)'/g)) {
    if (!inUnion(match.index)) continue;
    const name = match[1];
    if (!/^[a-z]+(-[a-z0-9]+)*$/.test(name)) {
      ctx.problem(file.rel, match.index, 'action-name', `action "${name}" is not kebab-case`, 'Use lowercase words joined by hyphens: set-filter, add-task, record-load-failure.');
    } else if (isEventName(name)) {
      ctx.problem(file.rel, match.index, 'action-name', `action "${name}" names an event, not a command`, 'Start with the verb: add-task (not task-added), set-theme (not theme-changed); set-<field>, toggle-<flag>, add-<thing>, remove-<thing>, reset-<thing>, record-<fact>.');
    }
  }
}

export function collectBuilders(files) {
  const builders = new Map();
  for (const file of files) {
    if (file.isTest || !file.rel.endsWith('-selectors.ts')) continue;
    for (const [name] of objectBuildingSelectors(file.bare)) builders.set(name, file.rel);
  }
  return builders;
}

function abbreviate(text) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 48 ? `${flat.slice(0, 45)}...` : flat;
}

/** A selector argument: a select… name, an arrow or function expression, or a useShallow(...) call. */
function isSelectorArg(arg) {
  return /^(?:[\w$]+\s*\.\s*)*select[A-Z_$][\w$]*$/.test(arg)
    || /^useShallow\s*\(/.test(arg)
    || /^(?:async\s+)?function\b/.test(arg)
    || /^(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/.test(arg);
}

/**
 * Whether a store hook call has the (store, selector) shape: zustand's useStore, a hook declared in the
 * scanned files with a store as its first parameter, or (declared elsewhere) a …Session…Store hook given
 * two arguments or one that is not a selector. Every other hook is a domain hook: useXStore(selector).
 */
function takesStore(ctx, callee, args) {
  if (callee === 'useStore') return true;
  const shape = ctx.hookShapes?.get(callee);
  if (shape !== undefined) return shape.takesStore;
  if (!/Session/.test(callee)) return false;
  return args.length >= 2 || (args.length === 1 && !isSelectorArg(args[0]));
}

export function checkSelectors(ctx, file) {
  if (file.isTest) return;
  for (const match of file.code.matchAll(/from\s+'zustand\/traditional'|\bcreateWithEqualityFn\b/g)) {
    ctx.problem(file.rel, match.index, 'shallow-v4', 'an equality-function store (zustand/traditional)', 'Select a primitive, or wrap a built value in useShallow from zustand/shallow; one rule for every store.');
  }
  const localBuilders = [...localBuilderSelectors(file.bare).keys()];
  for (const call of findCalls(file.bare, STORE_HOOK)) {
    const { callee, args } = call;
    const isDomainHook = !takesStore(ctx, callee, args);
    if (isDomainHook && args.length === 0) {
      ctx.problem(file.rel, call.index, 'selector-missing', `${callee}() without a selector re-renders on every change`, `Pass a selector: ${callee}((state) => state.some.primitive).`);
      continue;
    }
    if (!isDomainHook && args.length < 2) {
      ctx.problem(file.rel, call.index, 'selector-missing', `${callee}(store) without a selector returns the whole state`, `Pass a selector: ${callee}(store, (state) => ...).`);
      continue;
    }
    if (args.length > (isDomainHook ? 1 : 2)) {
      ctx.problem(file.rel, call.index, 'shallow-v4', `${callee} with an equality argument (Zustand 4 style)`, 'Zustand 5 has no equality argument: wrap the selector in useShallow instead.');
    }
    const selector = isDomainHook ? args[0] : args[1];
    if (selector === undefined) continue;
    const unwrapped = /^useShallow\s*\(([\s\S]*)\)$/.exec(selector)?.[1] ?? selector;
    if (isIdentitySelector(unwrapped)) {
      ctx.problem(file.rel, call.index, 'selector-missing', `${callee}(${abbreviate(selector)}) selects the whole state, so it re-renders on every change`, `Select what is shown: ${callee}((state) => state.some.primitive), or several values through useShallow.`);
      continue;
    }
    if (/^useShallow\s*\(/.test(selector)) continue;
    const arrow = selector.indexOf('=>');
    const body = arrow === -1 ? selector : selector.slice(arrow);
    if (arrow !== -1 && endsInPrimitive(body.slice(2))) continue;
    const builder = [...ctx.builders.keys(), ...localBuilders].find((name) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(selector));
    if (builder !== undefined || (arrow !== -1 && buildsNewValue(body))) {
      ctx.problem(file.rel, call.index, 'selector-new-object', `${callee}(${abbreviate(selector)}) builds a new ${builder ? `value (${builder})` : 'object or array'} on every call`, `Wrap it: ${callee}(useShallow((state) => ...)) with useShallow from 'zustand/shallow', or select primitives one by one.`);
    }
  }
}

export function checkQueryCopies(ctx, file) {
  if (file.isTest || !/\buse(Suspense|Infinite)?Quer(y|ies)\s*\(|@tanstack\/react-query/.test(file.code)) return;
  const storeSetters = [...file.bare.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*use[A-Z]\w*Store\s*\(\s*(?:\(\s*\w+\s*\)|\w+)\s*=>\s*\w+\.\w+\s*\)/g)].map((match) => match[1]);
  // const { data: remote } = useQuery(...): the effect copies `remote`.
  const aliases = [...file.bare.matchAll(/\{([^{}]*)\}\s*=\s*use(?:Suspense|Infinite)?Quer(?:y|ies)\s*\(/g)]
    .flatMap((match) => [...match[1].matchAll(/\bdata\s*:\s*([A-Za-z_$][\w$]*)/g)].map((alias) => alias[1]));
  const dataPattern = new RegExp(['\\bdata\\b', ...aliases.map((name) => `(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`)].join('|'));
  for (const effect of findCalls(file.bare, 'useEffect|useLayoutEffect')) {
    const body = effect.args[0] ?? '';
    const copies = /\.\s*setState\s*\(|\bdispatch\s*\(|\.getState\s*\(\s*\)\s*\.\s*\w+\s*\(/.test(body) || storeSetters.some((name) => new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(body));
    if (copies && dataPattern.test(body)) {
      ctx.problem(file.rel, effect.index, 'query-data-copied', 'an effect copies query data into a store (two copies of server state that drift apart)', 'Read server data straight from useQuery where it is shown, derive from it during render, and keep only client choices (filters, drafts) in a store.');
    }
  }
}

export function checkTests(ctx, persistingFiles) {
  const rels = new Set(ctx.files.map((file) => file.rel));
  const hasTest = (rel) => {
    const dir = posix.dirname(rel);
    const stem = stemOf(rel);
    return ['ts', 'tsx'].some((ext) => rels.has(`${dir}/${stem}.test.${ext}`));
  };
  for (const file of ctx.files) {
    if (file.isTest) continue;
    if (/-reducer\.ts$/.test(file.rel) && !hasTest(file.rel)) {
      ctx.problem(file.rel, 0, 'reducer-untested', `${basename(file.rel)} has no ${stemOf(file.rel)}.test.ts`, 'Write the test next to the reducer: it runs the cases table (caseProblem) plus fast-check properties for ranges and idempotence.');
    }
    if (persistingFiles.has(file.rel) && !hasTest(file.rel)) {
      ctx.problem(file.rel, 0, 'reducer-untested', `${basename(file.rel)} persists but has no ${stemOf(file.rel)}.test.ts`, 'Add a thin store test: a subscriber already sees the value on disk, a failed write publishes nothing, a no-op writes nothing.');
    }
  }
}

export function checkCrossStoreWrites(ctx, file) {
  const names = ctx.contract.crossStoreWrites;
  if (file.isTest || names.length === 0 || under(file.rel, ctx.layout.dataDir) || basename(file.rel) === 'update-and-publish.ts') return;
  const publishCalls = findCalls(file.bare, 'updateAndPublish');
  const spans = publishCalls.map((call) => [call.open, call.close]);
  // A write held in a const (const write = () => tasks.removeList(id)) counts when that name is what
  // updateAndPublish receives in the same file.
  const passed = new Set(publishCalls.flatMap((call) => call.args.slice(1)).filter((arg) => /^[A-Za-z_$][\w$]*$/.test(arg)));
  for (const match of file.bare.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/g)) {
    if (!passed.has(match[1])) continue;
    const bodyStart = match.index + match[0].length;
    const open = file.bare.slice(bodyStart).search(/\S/) + bodyStart;
    const end = /[({[]/.test(file.bare[open]) ? closingBracket(file.bare, open) : file.bare.indexOf('\n', open);
    if (end !== -1) spans.push([open - 1, end]);
  }
  const pattern = names.map((name) => name.replace(/[$]/g, '\\$')).join('|');
  for (const call of findCalls(file.bare, `(?:[\\w$]+\\s*\\.\\s*)*(?:${pattern})`)) {
    const name = call.callee.split('.').at(-1).trim();
    const isDefinition = /function\s+$/.test(file.bare.slice(Math.max(0, call.index - 12), call.index)) || /^\s*(:|\{)/.test(file.bare.slice(call.close));
    if (isDefinition || spans.some(([open, close]) => call.index > open && call.index < close)) continue;
    ctx.problem(file.rel, call.index, 'cross-store-write', `calls ${name}(...) outside updateAndPublish, so the other stores keep showing the old rows`, `Call updateAndPublish(stores, () => ${name}(...)): one transaction, then every store re-reads what is on disk (contracts/stores.json lists ${name} under crossStoreWrites).`);
  }
}

export { isTestFile };
