// repo-rules.mjs: the repo-wide rules of check-persistence (every scanned file): where SQLite may be imported,
// a second persistence engine, a second validator, and SQL text outside the data layer.

import { isTestFile, resolveSpecifier } from './source-scan.mjs';
import { boundNames, chainStart, codeMatches, driverStatementOf, firstArgument, sqlStrings } from './persistence-source.mjs';

/** Other storage engines for app data. Each has no place next to the app database. */
export const SECOND_ENGINES = new Map([
  ['@react-native-async-storage/async-storage', 'AsyncStorage has no transactions, no schema and no version'],
  ['realm', 'a second database engine has its own schema, version and backup story'],
  ['@nozbe/watermelondb', 'a second database engine has its own schema, version and backup story'],
  ['react-native-sqlite-storage', 'a second SQLite binding opens the file behind the SqlDriver port'],
  ['@op-engineering/op-sqlite', 'a second SQLite binding opens the file behind the SqlDriver port'],
  ['react-native-quick-sqlite', 'a second SQLite binding opens the file behind the SqlDriver port'],
]);
export const KEY_VALUE_STORES = ['expo-sqlite/kv-store', 'react-native-mmkv'];
/**
 * `import 'expo-sqlite/localStorage/install'` puts kv-store's default instance on the global
 * localStorage (expo-sqlite 57: `new Storage(KVStorage)` over the same ExpoSQLiteStorage database),
 * so it is the kv-store, not a second store.
 */
export const LOCAL_STORAGE_INSTALL = 'expo-sqlite/localStorage/install';
export const keyValueStoreOf = (spec) => (spec === LOCAL_STORAGE_INSTALL ? 'expo-sqlite/kv-store' : spec);
const VALIDATORS = ['zod', 'yup', 'superstruct', 'io-ts', 'joi', 'ajv', 'arktype', '@sinclair/typebox'];

const under = (rel, dir) => dir !== '' && (rel === dir || rel.startsWith(`${dir}/`));

/** Code that may hold SQL and import SQLite: the data folder, root tests, Node scripts and test files. */
function isDataSide(ctx, rel) {
  return under(rel, ctx.dataDir) || under(rel, ctx.layout.testDir) || under(rel, ctx.layout.scriptsDir) || isTestFile(rel);
}

/** Root tests, Node scripts and test files: they may hold any store to test it. */
function isTestSide(ctx, rel) {
  return under(rel, ctx.layout.testDir) || under(rel, ctx.layout.scriptsDir) || isTestFile(rel);
}

/**
 * A preferences adapter: services/<concern>/...-adapter.ts (platform variants included), the one place
 * kv-store, its localStorage install and the global localStorage are touched. It is also the file
 * architecture-and-boundaries' vendor-sdk rule lets import expo-sqlite, so both checkers agree.
 */
function isPreferencesAdapter(ctx, rel) {
  return under(rel, ctx.layout.servicesDir) && /-adapter(\.(ios|android|native|web))?\.tsx?$/.test(rel) && !isTestFile(rel);
}

function checkSqliteImport(ctx, src, entry) {
  const { rel } = src;
  if (entry.spec === LOCAL_STORAGE_INSTALL) {
    if (isTestSide(ctx, rel) || isPreferencesAdapter(ctx, rel)) return;
    ctx.add({ file: rel, line: entry.line, rule: 'sqlite-outside-data', message: `imports ${LOCAL_STORAGE_INSTALL} outside a preferences adapter`, fix: `Make the install the first import of the adapter that reads it, ${ctx.layout.servicesDir}/<concern>/local-storage-<concern>-adapter.ts (behind its port, created by the composition root): the global then exists before any read, and no layout or entry imports the SDK.` });
    return;
  }
  if (entry.spec === 'expo-sqlite/kv-store') {
    if (isTestSide(ctx, rel) || isPreferencesAdapter(ctx, rel)) return;
    ctx.add({ file: rel, line: entry.line, rule: 'sqlite-outside-data', message: 'imports expo-sqlite/kv-store outside a preferences adapter', fix: `Read small preferences through a port whose adapter lives in ${ctx.layout.servicesDir}/<concern>/kv-<concern>-adapter.ts; app data goes through a repository in ${ctx.dataDir}/.` });
    return;
  }
  if (isDataSide(ctx, rel)) return;
  ctx.add({ file: rel, line: entry.line, rule: 'sqlite-outside-data', message: `imports ${entry.spec} outside ${ctx.dataDir}/`, fix: `Only ${ctx.dataDir}/ (the drivers, repositories and migrations) talks to SQLite; everything else calls a repository or the document service.` });
}

function checkEngineImport(ctx, src, entry) {
  const reason = SECOND_ENGINES.get(entry.spec);
  const keyValue = ctx.contract.keyValueStore ?? ctx.keyValueStore ?? 'expo-sqlite/kv-store';
  // contracts/persistence.json legacyImports: the one-time importer of an older store, for the releases it lives.
  if (reason !== undefined && (ctx.contract.legacyImports ?? []).includes(src.rel)) return;
  if (reason !== undefined) {
    ctx.add({ file: src.rel, line: entry.line, rule: 'second-persistence', message: `imports ${entry.spec}: ${reason}`, fix: 'Keep app data in the app database (tables and repositories, or the document appendix); small preferences in the one key-value store the contract names.' });
  } else if (KEY_VALUE_STORES.includes(keyValueStoreOf(entry.spec)) && keyValueStoreOf(entry.spec) !== keyValue) {
    ctx.add({ file: src.rel, line: entry.line, rule: 'second-persistence', message: `imports ${entry.spec}, but contracts/persistence.json names ${keyValue} as the key-value store`, fix: 'One key-value store for small preferences: use the one the contract names, or change keyValueStore on purpose.' });
  }
}

/** zustand's persist middleware writes a second, unversioned copy of state. */
function checkZustandPersist(ctx, src) {
  for (const match of src.scan.codeKeep.matchAll(/import\s*\{([^}]*)\}\s*from\s*(['"])zustand\/middleware\2/g)) {
    if (/\b(persist|createJSONStorage)\b/.test(match[1])) {
      ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'second-persistence', message: 'imports persist from zustand/middleware: a second, unversioned copy of app state', fix: 'Stores write through a repository (or the document service) and publish after the commit; drop the persist middleware.' });
    }
  }
}

/** Files outside the data folder that may own SQL: the SQLite error log adapter, and contract sqlAllowed. */
function sqlAllowedFiles(ctx) {
  return [`${ctx.layout.servicesDir}/error-log/sqlite-error-log-adapter.ts`, ...(ctx.contract.sqlAllowed ?? [])];
}

/** The SqlDriver port outside the data folder: a feature that holds the driver can run any statement. */
function checkDriverImport(ctx, src, entry) {
  if (isDataSide(ctx, src.rel) || sqlAllowedFiles(ctx).includes(src.rel)) return;
  if (!entry.spec.startsWith('.') && !ctx.layout.aliases.some((alias) => entry.spec.startsWith(alias.pattern.replace(/\*$/, '')))) return;
  const target = resolveSpecifier(src.rel, entry.spec, { root: ctx.root, aliases: ctx.layout.aliases });
  if (target !== `${ctx.dataDir}/sql-driver.ts`) return;
  ctx.add({ file: src.rel, line: entry.line, rule: 'sqlite-outside-data', message: `imports the SqlDriver port (${ctx.dataDir}/sql-driver.ts) outside ${ctx.dataDir}/`, fix: `Call a repository method instead of holding the driver; only ${ctx.dataDir}/ (and an adapter listed in contracts/persistence.json sqlAllowed) runs statements.` });
}

/** true when the file imports a module of the data folder (how a feature gets hold of the data layer). */
function importsDataModule(ctx, src) {
  return src.imports.some((entry) => {
    if (!entry.spec.startsWith('.') && !ctx.layout.aliases.some((alias) => entry.spec.startsWith(alias.pattern.replace(/\*$/, '')))) return false;
    return under(resolveSpecifier(src.rel, entry.spec, { root: ctx.root, aliases: ctx.layout.aliases }) ?? '', ctx.dataDir);
  });
}

/** Calls that hand out the data layer: the context hook and the device openers. */
const DATA_SOURCE_CALL = /(?<![\w$.])(?:useAppData|openDeviceData|openDeviceDatabase|openAppDatabase)\s*\(/;
/** The data layer's own types: a value annotated or cast to one of them carries (or once carried) the driver. */
const DATA_TYPE = /(?<![\w$])(?:AppData|AppDatabase)(?![\w$])/;

/**
 * Names in the file that hold the data layer: annotated AppData/AppDatabase, assigned (or destructured)
 * from useAppData()/an opener or a cast to those types, and aliases of such names (`const db = data.database`).
 */
function dataLayerNames(src) {
  const { code } = src;
  const names = new Set();
  for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\??\s*:\s*(?:Readonly<\s*|Pick<\s*|Partial<\s*)*(?:AppData|AppDatabase)\b/g)) names.add(match[1]);
  const declarations = [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*|\{[^=;]*?\}|\[[^=;]*?\])\s*(?::[^=;]+)?=\s*([^;\n]*)/g)];
  for (let grew = true; grew; ) {
    grew = false;
    for (const [, pattern, init] of declarations) {
      const root = /^\(*\s*([A-Za-z_$][\w$]*)/.exec(init)?.[1];
      if (!DATA_SOURCE_CALL.test(init) && !DATA_TYPE.test(init) && !(root !== undefined && names.has(root))) continue;
      for (const name of boundNames(pattern.trim())) {
        if (names.has(name)) continue;
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
}

/**
 * true when `.driver` at `dot` is the data layer's driver: its receiver chain starts at useAppData(),
 * an opener, an AppData/AppDatabase cast or a name that holds the data layer, or the value is cast or
 * annotated SqlDriver. Any other `.driver` (a delivery driver on an Order) is the app's own noun.
 */
function isDataLayerDriver(src, dot, names) {
  const { code } = src;
  const start = chainStart(code, dot);
  const receiver = code.slice(start, dot);
  const root = /^\(*\s*([A-Za-z_$][\w$]*)/.exec(receiver)?.[1];
  if (DATA_SOURCE_CALL.test(receiver) || DATA_TYPE.test(receiver) || (root !== undefined && names.has(root))) return true;
  const after = code.slice(dot).replace(/^(?:\?\.|!\.|\.)\s*driver\b/, '');
  return /^\s*!?\s*as\s+(?:unknown\s+as\s+)?(?:Closable)?SqlDriver\b/.test(after) || /:\s*(?:Closable)?SqlDriver\s*=\s*$/.test(code.slice(Math.max(0, start - 60), start));
}

/**
 * The raw driver outside the data folder: `.driver` on the data layer (useAppData(), an AppData or
 * AppDatabase value, or a value cast to SqlDriver), or a statement call on a driver-named receiver, in
 * a file that reaches the data layer. AppData carries no driver; a feature that digs one out (a cast,
 * an old AppDatabase) can run any statement past every repository rule.
 */
function checkDriverUse(ctx, src) {
  if (isDataSide(ctx, src.rel) || sqlAllowedFiles(ctx).includes(src.rel) || !importsDataModule(ctx, src)) return;
  const fix = `Call a repository method (useAppData().<area>) instead; only ${ctx.dataDir}/ (and an adapter listed in contracts/persistence.json sqlAllowed) holds the driver.`;
  const seen = new Set();
  const names = dataLayerNames(src);
  for (const { index } of codeMatches(src, /(?:\?\.|!\.|\.)\s*driver\b(?!\s*:)/g)) {
    if (!isDataLayerDriver(src, index, names)) continue;
    const line = src.lineOf(index);
    if (seen.has(line)) continue;
    seen.add(line);
    ctx.add({ file: src.rel, line, rule: 'sqlite-outside-data', message: `reaches the raw SqlDriver (.driver) outside ${ctx.dataDir}/`, fix });
  }
  for (const { index, match } of codeMatches(src, /(?<![\w$.])(driver|db|sqlDriver)\s*(?:\?\.|!\.|\.)\s*(run|exec|get|all|transaction)\s*\(/g)) {
    const line = src.lineOf(index);
    if (seen.has(line)) continue;
    seen.add(line);
    ctx.add({ file: src.rel, line, rule: 'sqlite-outside-data', message: `calls ${match[1]}.${match[2]}() outside ${ctx.dataDir}/`, fix });
  }
}

/**
 * The web build's direction module (web-support's direction.web.ts): the browser's own localStorage
 * holds the forced layout direction across the direction restart's reload, the web counterpart of the
 * native forceRTL flag that I18nManager keeps outside every port.
 */
function isWebDirectionModule(ctx, rel) {
  const i18nDir = ctx.layout.i18nDir ?? `${ctx.layout.srcDir}/i18n`;
  return rel === `${i18nDir}/direction.web.ts` || rel === `${i18nDir}/direction.web.tsx`;
}

/** The global localStorage (kv-store's default instance once installed) is read behind a port, like kv-store. */
function checkLocalStorageUse(ctx, src) {
  if (isTestSide(ctx, src.rel) || isPreferencesAdapter(ctx, src.rel) || isWebDirectionModule(ctx, src.rel) || !under(src.rel, ctx.layout.srcDir)) return;
  const isWeb = /\.web\.[jt]sx?$/.test(src.rel);
  const what = isWeb
    ? "in a .web file localStorage is the browser's own Web Storage (synchronous, no schema, no version, readable by any script on the page)"
    : "on iOS and Android localStorage is expo-sqlite's kv-store once expo-sqlite/localStorage/install runs (synchronous, no schema, no version)";
  for (const { index, match } of codeMatches(src, /(?<![\w$.])(?:(?:globalThis|window|self)\.)?localStorage\s*(?:\?\.|\.|\[)\s*(\w*)/g)) {
    ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'sqlite-outside-data', message: `uses the global localStorage${match[1] ? ` (.${match[1]})` : ''} outside a preferences adapter`, fix: `${what[0].toUpperCase()}${what.slice(1)}: read small preferences through a port whose adapter is ${ctx.layout.servicesDir}/<concern>/local-storage-<concern>-adapter${isWeb ? '.web' : ''}.ts; app data goes through a repository in ${ctx.dataDir}/.` });
  }
}

export function checkRepoFiles(ctx) {
  for (const src of ctx.sources.values()) {
    checkDriverUse(ctx, src);
    checkLocalStorageUse(ctx, src);
    for (const entry of src.imports) {
      if (/^(expo-sqlite(\/.*)?|node:sqlite)$/.test(entry.spec)) checkSqliteImport(ctx, src, entry);
      checkDriverImport(ctx, src, entry);
      checkEngineImport(ctx, src, entry);
      const validator = VALIDATORS.find((name) => entry.spec === name || entry.spec.startsWith(`${name}/`));
      if (validator !== undefined) {
        ctx.add({ file: src.rel, line: entry.line, rule: 'single-validator', message: `imports ${entry.spec}: a second schema language next to valibot`, fix: 'Write the schema with valibot (one schema gives the type and the runtime check; no eval or new Function on Hermes).' });
      }
    }
    checkZustandPersist(ctx, src);
    checkSqlText(ctx, src);
  }
}

function checkSqlText(ctx, src) {
  const { rel } = src;
  // The SQLite error log adapter owns its SQL by design; contracts/persistence.json sqlAllowed adds others.
  if (isDataSide(ctx, rel) || sqlAllowedFiles(ctx).includes(rel)) return;
  const fix = `Move the statement into a repository in ${ctx.dataDir}/ (or list this file in contracts/persistence.json sqlAllowed when it is an adapter that must own its SQL).`;
  const found = sqlStrings(src, ctx.tables);
  for (const entry of found) {
    ctx.add({ file: rel, line: entry.line, rule: 'sql-outside-data', message: `holds SQL (${entry.statement}) outside ${ctx.dataDir}/`, fix });
  }
  // A statement handed to a driver call counts in any case and on any table (sqlite_master, PRAGMA).
  const reported = new Set(found.map((entry) => entry.value));
  for (const { index, match } of codeMatches(src, /\.(run|get|all|exec)\s*\(/g)) {
    const argument = firstArgument(src, index + match[0].length - 1, ctx);
    const statement = argument.sql === null ? null : driverStatementOf(argument.sql);
    if (statement === null || reported.has(argument.sql)) continue;
    reported.add(argument.sql);
    ctx.add({ file: rel, line: src.lineOf(index), rule: 'sql-outside-data', message: `runs SQL through .${match[1]}() (${statement}) outside ${ctx.dataDir}/`, fix });
  }
}

/** Document appendix: the slots are written only by the document service and its store. */
export function checkDocumentWriters(ctx) {
  const documentDir = `${ctx.dataDir}/document`;
  for (const src of ctx.sources.values()) {
    if (under(src.rel, documentDir) || isTestFile(src.rel) || under(src.rel, ctx.layout.testDir)) continue;
    for (const { index, match } of codeMatches(src, /\b(\w*[sS]tore\.write\s*\(\s*\{\s*(?:current|backup)\b|UPSERT_SLOT_SQL)/g)) {
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'write-outside-service', message: `writes document slots directly (${match[1].replace(/\s*\(.*$/s, '')})`, fix: 'Call document.update(recipe, { refreshBackup }) so the document is guarded, validated and written in one transaction.' });
    }
  }
}
