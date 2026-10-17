#!/usr/bin/env node
// check-feature.mjs: proves that every screen feature of an Expo Router app is complete as one unit:
// the feature folder's four files with their names, a thin route that wires the model hook to the pure
// view, the route test, the params parser of a dynamic route read only by the model hook, a view that
// reads nothing, every message key in every catalog, no template placeholder left, and the feature
// registered in the route and screen contracts. Zero dependencies (node: built-ins only).
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-feature.mjs . [--feature <name>]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  createReporter,
  lineOf,
  maskComments,
  notYetCreated,
  parseArgs,
  parseJsonc,
  resolveLayout,
  run,
  UsageError,
  walk,
  walkRepo,
} from './check-lib.mjs';
import { isLanguageTag, isStarterSource, sourceLanguageOf } from './lib/feature-app.mjs';
import { findClosing, isTestFile, maskCode, resolveSpecifier, valueImports } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-feature',
  summary:
    'Checks that each screen feature (src/features/<feature>/ with <feature>-screen.tsx, or a feature a route renders) is complete: files and names, route wiring and its test, typed params, a pure view, message keys in every catalog, no placeholder left, and its entries in contracts/navigation.json and contracts/screens.json.',
  usage: '[repo-root] [--feature <name>]... [options]',
  options: {
    feature: { type: 'string', multiple: true, value: 'name', help: 'Check only this feature folder (kebab-case); repeatable. Default: every screen feature' },
    orphans: { type: 'boolean', help: 'Also fail catalog keys under "<feature>." that no code in the repo uses (run after renaming or deleting part of a feature)' },
    'source-language': { type: 'string', value: 'tag', help: 'The source catalog --orphans reads (default: SOURCE_LANGUAGE in <i18nDir>/languages.ts, else en, else the first catalog)' },
    'routes-dir': { type: 'string', value: 'dir', help: 'The Expo Router routes folder (default: from resolveLayout, src/app)' },
    'features-dir': { type: 'string', value: 'dir', help: 'The features folder (default: from resolveLayout, src/features)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (references/generator-and-checker.md explains each one and its fix):',
    '  feature-files        <f>-screen.tsx, use-<f>-model.ts, <f>-screen.test.tsx or use-<f>-model.test.ts(x) is missing',
    '  feature-names        the view does not export <F>Screen, or the model hook does not export use<F>Model and type <F>Model',
    '  component-placement  a component file sits in the feature root beside the screen instead of components/',
    '  starter-screen       the starter screen of a new app (expo-project-bootstrap) is still here; one line instead of',
    '                       the rules below, which it does not meet',
    '  route-wiring         no route renders the feature (unless its screens.json entry is not a route: embedded, sheet,',
    '                       overlay, dialog), or a route that imports it does not call use<F>Model() and render <F>Screen',
    '  route-test           a route that renders the feature has no route test in the feature (a test that imports the route',
    '                       file and renders it with renderRouterWithProviders) and no "// device-only:" marker',
    '  params-parser        a dynamic route has no <f>-params.ts with its test, or the parser does not name every [param]',
    '  params-in-model      the model hook does not read the params through the parser with useLocalSearchParams (the',
    '                       global hook re-renders on every URL change), or the route or the view reads them',
    '  view-pure            the view or a components/ file imports or calls a router, store, service, data, api or t()',
    '  message-key-missing  a t(\'<key>\') of the feature or its route is missing from a catalog',
    '  message-key-orphan   (--orphans) a catalog key under "<f>." that no code uses',
    '  placeholder-left     an unfilled __UPPER_SNAKE__ template placeholder in a feature, route or catalog entry, or in a path',
    '  nav-contract         the route is not in contracts/navigation.json routes, or a dynamic route\'s paramParsers entry is not the parser',
    '  screen-contract      contracts/screens.json has no entry whose view is the screen, or its model or route differs',
    '',
    'NOT APPLICABLE when expo-router is not in package.json. SKIP lines: the catalogs (i18n-strings-and-catalogs creates',
    'them), contracts/navigation.json (navigation-and-routing) and contracts/screens.json (screen-contracts) while absent.',
    'rn-skills.config.json keys read: the layout keys (srcDir, routesDir, featuresDir, i18nDir, contractsDir, storesDir,',
    'servicesDir, dataDir, apiDir) and "navigationContract", "screensContract".',
    '',
    'Examples:',
    '  node check-feature.mjs .                          every screen feature',
    '  node check-feature.mjs . --feature notes          one feature, which must exist',
    '  node check-feature.mjs . --feature notes --orphans  after a rename: also the unused keys',
  ].join('\n'),
};

const FEATURE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CODE_FILE = /\.(tsx?|jsx?)$/;
const NOT_ROUTES = /^(_layout|\+html|\+native-intent|\+middleware)$|\+api$/;
const PLATFORM_SUFFIX = /\.(ios|android|native|web)$/;
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;
const REAL_GLOBALS = new Set(['__DEV__']);
const PARAM_SEGMENT = /^\[(?:\.\.\.)?([A-Za-z][A-Za-z0-9]*)\]$/;
const T_CALL = /(?<![A-Za-z0-9_$.])t\(\s*(['"])([^'"\\\n]+)\1/g;
const PARAMS_HOOKS = /(?<![A-Za-z0-9_$.])use(Local|Global)SearchParams\s*[<(]/g;
const ROUTED_PRESENTATIONS = new Set(['route', 'modal-route']);
const VIEW_PACKAGES = [/^expo-router(\/|$)/, /^@react-navigation\//, /^zustand(\/|$)/, /^@tanstack\/react-query/, /^react-intl$/];
const VIEW_CALLS = /(?<![A-Za-z0-9_$.])(useT|useIntl|useRouter|useNavigation|useServices|useQuery|useMutation|use[A-Z][A-Za-z0-9]*Store)\s*\(/g;

const pascal = (kebab) => kebab.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);

/** Route files of the routes folder: [{ rel, id }], layouts and server files left out. */
function routeFiles(root, routesDir) {
  if (!isDir(join(root, routesDir))) return [];
  return walk(join(root, routesDir), { pruneDirsContaining: ['SKILL.md'] })
    .filter((rel) => CODE_FILE.test(rel) && !isTestFile(rel) && !rel.endsWith('.d.ts'))
    .map((rel) => ({ rel: `${routesDir}/${rel}`, id: rel.replace(CODE_FILE, '').replace(PLATFORM_SUFFIX, '') }))
    .filter((route) => !NOT_ROUTES.test(basename(route.id)));
}

/** The names an import clause brings in (`import A, { B, type C } from`). */
function importedNames(clause) {
  const names = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  const def = /^\s*import\s+(?!type\b)([A-Za-z_$][\w$]*)/.exec(clause);
  if (def) names.push(def[1]);
  return names;
}

const IMPORT_RE = /(^|\n)[ \t]*import\s+([^'";]*?)\s*from\s*(['"])([^'"]+)\3/g;

/** Imports of a file resolved to repo paths: [{ spec, path, names, index, isTypeOnly }]. */
function resolvedImports(root, layout, rel, source) {
  const out = [];
  const values = new Set(valueImports(source).map((entry) => entry.index));
  for (const match of source.matchAll(IMPORT_RE)) {
    const index = match.index + match[1].length;
    const lineStart = source.lastIndexOf('\n', index) + 1;
    const path = resolveSpecifier(rel, match[4], { root, aliases: layout.aliases });
    out.push({ spec: match[4], path, names: importedNames(`import ${match[2]}`), index, isTypeOnly: !values.has(lineStart) && !values.has(index) });
  }
  return out;
}

function featureOfPath(path, featuresDir) {
  if (path === null || !path.startsWith(`${featuresDir}/`)) return null;
  const name = path.slice(featuresDir.length + 1).split('/')[0];
  return FEATURE_NAME.test(name) ? name : null;
}

/** Every catalog of the app: [{ rel, data, text }] (invalid JSON: data null). */
function readCatalogs(root, i18nDir) {
  const dir = `${i18nDir}/catalogs`;
  if (!isDir(join(root, dir))) return null;
  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const rel = `${dir}/${name}`;
      const text = readFileSync(join(root, rel), 'utf8');
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      return { rel, text, data };
    });
}

function lineOfKey(text, key) {
  const at = text.indexOf(`"${key}"`);
  return at === -1 ? 1 : lineOf(text, at);
}

function readContract(root, rel) {
  const text = read(root, rel);
  if (text === null) return { exists: false };
  try {
    return { exists: true, data: parseJsonc(text) };
  } catch (error) {
    return { exists: true, error: error.message };
  }
}

/** Files of a feature folder, repo-relative, sorted. */
function featureFiles(root, dir) {
  return isDir(join(root, dir)) ? walk(join(root, dir)).map((rel) => `${dir}/${rel}`) : [];
}

function checkPlaceholderPaths(root, layout, report) {
  const seen = new Set();
  for (const dir of [layout.routesDir, layout.featuresDir]) {
    if (!isDir(join(root, dir))) continue;
    for (const rel of walk(join(root, dir), { pruneDirsContaining: ['SKILL.md'] })) {
      const segments = rel.split('/');
      const at = segments.findIndex((segment) => [...segment.matchAll(PLACEHOLDER)].some((m) => !REAL_GLOBALS.has(m[0])));
      if (at === -1) continue;
      const path = `${dir}/${segments.slice(0, at + 1).join('/')}`;
      if (seen.has(path)) continue;
      seen.add(path);
      report.problem({ file: path, rule: 'placeholder-left', message: 'a path still holds a template placeholder (templates copied by hand, never filled)', fix: 'Delete it and generate the feature with scaffold-feature.mjs, which fills every placeholder in paths and contents.' });
    }
  }
}

function checkPlaceholderText(rel, text, report) {
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (REAL_GLOBALS.has(match[0])) continue;
    report.problem({ file: rel, line: lineOf(text, match.index), rule: 'placeholder-left', message: `unfilled template placeholder ${match[0]}`, fix: 'Replace it with the feature\'s value (scaffold-feature.mjs fills every placeholder), then rerun.' });
  }
}

function checkNames(ctx, report) {
  const { screenRel, modelRel, P, screenSource, modelSource } = ctx;
  if (screenSource !== null && !new RegExp(`export\\s+(function|const)\\s+${P}Screen\\b`).test(screenSource)) {
    report.problem({ file: screenRel, line: 1, rule: 'feature-names', message: `the view does not export ${P}Screen`, fix: `Name the view after its file: export function ${P}Screen({ model }: ${P}ScreenProps) (naming-conventions).` });
  }
  if (modelSource !== null) {
    if (!new RegExp(`export\\s+(function|const)\\s+use${P}Model\\b`).test(modelSource)) {
      report.problem({ file: modelRel, line: 1, rule: 'feature-names', message: `the model hook does not export use${P}Model`, fix: `Export the hook named after its file: export function use${P}Model(): ${P}Model.` });
    }
    if (!new RegExp(`export\\s+type\\s+${P}Model\\b`).test(modelSource)) {
      report.problem({ file: modelRel, line: 1, rule: 'feature-names', message: `the model hook does not export the type ${P}Model`, fix: `Export what the view renders as a type beside the hook: export type ${P}Model = { readonly title: string; ... }.` });
    }
  }
}

function checkPlacement(ctx, files, report) {
  const allowed = new RegExp(`^${ctx.f}-screen(\\.(ios|android|native|web))?\\.(tsx|jsx)$`);
  for (const rel of files) {
    const rest = rel.slice(ctx.dir.length + 1);
    if (rest.includes('/') || !/\.(tsx|jsx)$/.test(rest) || isTestFile(rel) || allowed.test(rest)) continue;
    report.problem({ file: rel, line: 1, rule: 'component-placement', message: `${rest} sits in the feature root beside the screen`, fix: `Move it to ${ctx.dir}/components/ (a dialog with its own model to ${ctx.dir}/<dialog>/); the root holds the screen, its model hook, pure logic and their tests.` });
  }
}

function checkViewPure(root, layout, ctx, files, report) {
  const viewFiles = files.filter((rel) => !isTestFile(rel) && CODE_FILE.test(rel) && (rel === ctx.screenRel || rel.startsWith(`${ctx.dir}/components/`)));
  const banned = [layout.storesDir, layout.servicesDir, layout.dataDir, layout.apiDir].filter(Boolean);
  for (const rel of viewFiles) {
    const source = read(root, rel);
    if (source === null) continue;
    const masked = maskComments(source);
    for (const entry of resolvedImports(root, layout, rel, masked)) {
      if (entry.isTypeOnly) continue;
      const pkg = entry.path === null && VIEW_PACKAGES.some((re) => re.test(entry.spec));
      const own = entry.path !== null && (banned.some((dir) => entry.path.startsWith(`${dir}/`)) || /\/i18n\/(t-context|t|t-bridge)(\.tsx?)?$/.test(entry.path) || entry.path.startsWith(`${ctx.dir}/use-`));
      if (!pkg && !own) continue;
      report.problem({ file: rel, line: lineOf(source, entry.index), rule: 'view-pure', message: `the view imports ${entry.spec}`, fix: `Read it in ${ctx.modelRel} and hand the value or handler to the view through the model (a type-only import is fine).` });
    }
    for (const match of masked.matchAll(VIEW_CALLS)) {
      report.problem({ file: rel, line: lineOf(source, match.index), rule: 'view-pure', message: `the view calls ${match[1]}()`, fix: `Call it in ${ctx.modelRel}; the view renders the model it is given (texts arrive translated).` });
    }
  }
}

function routeRendersFeature(route, ctx) {
  const P = ctx.P;
  const masked = maskComments(route.source);
  const names = route.imports.filter((entry) => featureOfPath(entry.path, ctx.featuresDir) === ctx.f).flatMap((entry) => entry.names);
  const callsHook = new RegExp(`(?<![\\w$.])use${P}Model\\s*\\(`).test(masked) && names.includes(`use${P}Model`);
  const rendersView = new RegExp(`<${P}Screen\\b`).test(masked) && names.includes(`${P}Screen`);
  return { callsHook, rendersView };
}

function checkRouteTest(root, layout, ctx, route, files, report) {
  const head = route.source.split('\n').slice(0, 6).join('\n');
  if (/\/\/\s*device-only:/.test(head)) return;
  const tests = files.filter((rel) => isTestFile(rel) && CODE_FILE.test(rel));
  const covered = tests.some((rel) => {
    const source = read(root, rel) ?? '';
    const masked = maskComments(source);
    const importsRoute = resolvedImports(root, layout, rel, masked).some((entry) => entry.path === route.rel);
    return importsRoute && /(?<![\w$.])renderRouterWithProviders\s*\(/.test(masked);
  });
  if (covered) return;
  report.problem({ file: route.rel, line: 1, rule: 'route-test', message: `no route test renders this route (${ctx.f})`, fix: `Add ${ctx.dir}/${ctx.f}-navigation.test.tsx: import the route's default export from '@/app/${route.id}' and open it with renderRouterWithProviders at its URL (templates/src/features/__FEATURE__/__FEATURE__-navigation.test.tsx).` });
}

/**
 * The text of the parser's object schemas (`v.object({ ... })`, `strictObject`, `looseObject`), where
 * the param keys must be; the whole file when it builds no object schema (another validation style).
 */
function schemaText(parser) {
  const comments = maskComments(parser);
  const code = maskCode(parser);
  const parts = [];
  for (const match of code.matchAll(/(?<![\w$])(?:v\.)?(?:object|strictObject|looseObject)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(code, open);
    if (close !== -1) parts.push(comments.slice(open, close + 1));
  }
  return parts.length > 0 ? parts.join('\n') : comments;
}

function checkParams(root, layout, ctx, route, files, report) {
  const params = route.id.split('/').map((segment) => PARAM_SEGMENT.exec(segment)?.[1]).filter(Boolean);
  const paramsRel = `${ctx.dir}/${ctx.f}-params.ts`;
  const routeMasked = maskComments(route.source);
  for (const match of routeMasked.matchAll(PARAMS_HOOKS)) {
    report.problem({ file: route.rel, line: lineOf(route.source, match.index), rule: 'params-in-model', message: 'the route reads the URL params itself', fix: `Read them in ${ctx.modelRel} through ${ctx.f}-params.ts; the route only calls the model hook and renders the view.` });
  }
  if (params.length === 0) return null;
  const parser = read(root, paramsRel);
  if (parser === null) {
    report.problem({ file: paramsRel, rule: 'params-parser', message: `the dynamic route ${route.id} has no params parser`, fix: `Create it from templates/src/features/__DETAIL__/__DETAIL__-params.ts: a valibot schema naming ${params.join(', ')}, returning a Result.` });
    return paramsRel;
  }
  if (!files.some((rel) => rel === `${ctx.dir}/${ctx.f}-params.test.ts`)) {
    report.problem({ file: paramsRel, line: 1, rule: 'params-parser', message: 'the params parser has no test beside it', fix: `Add ${ctx.f}-params.test.ts: a valid id, extra query keys, the length limit, and the rejected shapes (missing, empty, an array, a path).` });
  }
  const schema = schemaText(parser);
  for (const name of params) {
    if (!new RegExp(`(^|[\\s{,])['"]?${name}['"]?\\s*:`).test(schema)) {
      report.problem({ file: paramsRel, line: 1, rule: 'params-parser', message: `the parser does not name the route param "${name}" (the route ${route.id})`, fix: `The schema key must equal the bracket name in the route file ([${name}]); otherwise every link opens the invalid-link state.` });
    }
  }
  const hookFiles = files.filter((rel) => !isTestFile(rel) && new RegExp(`^${ctx.dir}/use-${ctx.f}(-[a-z0-9-]+)?\\.ts$`).test(rel));
  const hooks = hookFiles.map((rel) => {
    const source = maskComments(read(root, rel) ?? '');
    return { rel, source, importsParser: resolvedImports(root, layout, rel, source).some((entry) => entry.path === paramsRel) };
  });
  const readsThroughParser = hooks.some((hook) => hook.importsParser && /(?<![\w$.])useLocalSearchParams\s*\(/.test(hook.source));
  const global = hooks.find((hook) => /(?<![\w$.])useGlobalSearchParams\s*\(/.test(hook.source));
  if (!readsThroughParser && global !== undefined) {
    const at = global.source.search(/(?<![\w$.])useGlobalSearchParams\s*\(/);
    report.problem({ file: global.rel, line: lineOf(global.source, at), rule: 'params-in-model', message: `the model hook reads the params of ${route.id} with useGlobalSearchParams, which re-renders the screen on every URL change, even another screen's`, fix: `const params = parse${ctx.P}Params(useLocalSearchParams()); the local hook updates only while this route is focused.` });
  } else if (!readsThroughParser) {
    report.problem({ file: ctx.modelRel, line: 1, rule: 'params-in-model', message: `the model hook does not read the params of ${route.id} through ${ctx.f}-params.ts`, fix: `const params = parse${ctx.P}Params(useLocalSearchParams()); show the invalid-link state when params.ok is false.` });
  }
  return paramsRel;
}

function checkViewParams(root, ctx, files, report) {
  for (const rel of files.filter((path) => !isTestFile(path) && (path === ctx.screenRel || path.startsWith(`${ctx.dir}/components/`)))) {
    const source = read(root, rel) ?? '';
    for (const match of maskComments(source).matchAll(PARAMS_HOOKS)) {
      report.problem({ file: rel, line: lineOf(source, match.index), rule: 'params-in-model', message: 'the view reads the URL params', fix: `Read them in ${ctx.modelRel} through ${ctx.f}-params.ts and pass the parsed value in the model.` });
    }
  }
}

function checkMessageKeys(root, ctx, files, routes, catalogs, report) {
  if (catalogs === null || catalogs.length === 0) return;
  const sources = [...files.filter((rel) => !isTestFile(rel) && CODE_FILE.test(rel)), ...routes.map((route) => route.rel)];
  for (const rel of sources) {
    const source = read(root, rel);
    if (source === null) continue;
    for (const match of maskComments(source).matchAll(T_CALL)) {
      const key = match[2];
      if (/__[A-Z]/.test(key)) continue;
      for (const catalog of catalogs) {
        if (catalog.data === null || Object.hasOwn(catalog.data, key)) continue;
        report.problem({ file: rel, line: lineOf(source, match.index), rule: 'message-key-missing', message: `'${key}' is missing from ${catalog.rel}`, fix: `Add "${key}" to every catalog, the source language first (i18n-strings-and-catalogs); scaffold-feature.mjs adds the scaffold's keys to each catalog.` });
      }
    }
  }
  for (const catalog of catalogs) {
    if (catalog.data !== null) continue;
    report.problem({ file: catalog.rel, line: 1, rule: 'message-key-missing', message: 'the catalog is not valid JSON, so no key can be found in it', fix: 'Fix the JSON (one flat object of strings), then rerun.' });
  }
  for (const catalog of catalogs) {
    for (const key of Object.keys(catalog.data ?? {})) {
      if (!key.startsWith(`${ctx.f}.`)) continue;
      const line = lineOfKey(catalog.text, key);
      const lineText = catalog.text.split('\n')[line - 1] ?? '';
      checkPlaceholderText(catalog.rel, `${'\n'.repeat(line - 1)}${lineText}`, report);
    }
  }
}

let repoCodeCache = null;
function repoCode(root) {
  if (repoCodeCache === null) {
    repoCodeCache = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'] }).map((rel) => readFileSync(join(root, rel), 'utf8')).join('\n');
  }
  return repoCodeCache;
}

function checkOrphans(root, ctx, catalogs, sourceLanguage, report) {
  if (catalogs === null) return;
  const code = repoCode(root);
  const source = catalogs.find((catalog) => basename(catalog.rel) === `${sourceLanguage}.json`) ?? catalogs[0];
  if (!source?.data) return;
  for (const key of Object.keys(source.data)) {
    if (!key.startsWith(`${ctx.f}.`)) continue;
    if (code.includes(`'${key}'`) || code.includes(`"${key}"`) || code.includes(`\`${key}\``)) continue;
    report.problem({ file: source.rel, line: lineOfKey(source.text, key), rule: 'message-key-orphan', message: `"${key}" is used by no code`, fix: 'Delete it from every catalog (a renamed key keeps only its new name), or use it where the text belongs.' });
  }
}

function checkNavContract(ctx, route, paramsRel, contract, report) {
  if (contract.error) {
    report.problem({ file: contract.rel, line: 1, rule: 'nav-contract', message: `not valid JSON: ${contract.error}`, fix: 'Fix the JSON (navigation-and-routing\'s schema), then rerun.' });
    return;
  }
  const routes = Array.isArray(contract.data?.routes) ? contract.data.routes : [];
  if (!routes.includes(route.id)) {
    report.problem({ file: contract.rel, line: 1, rule: 'nav-contract', message: `"${route.id}" is not in routes`, fix: `Add "${route.id}" to routes (a route change starts in the contract; scaffold-feature.mjs adds it).` });
  }
  if (paramsRel === null) return;
  const parsers = contract.data?.paramParsers ?? {};
  if (parsers[route.id] !== paramsRel) {
    report.problem({ file: contract.rel, line: 1, rule: 'nav-contract', message: `paramParsers["${route.id}"] is ${JSON.stringify(parsers[route.id] ?? null)}, not "${paramsRel}"`, fix: `Map the dynamic route to its parser: "paramParsers": { "${route.id}": "${paramsRel}" }.` });
  }
}

function checkScreenContract(ctx, wired, contract, report) {
  if (contract.error) {
    report.problem({ file: contract.rel, line: 1, rule: 'screen-contract', message: `not valid JSON: ${contract.error}`, fix: 'Fix the JSON (screen-contracts\' schema), then rerun.' });
    return;
  }
  const screens = Array.isArray(contract.data?.screens) ? contract.data.screens : [];
  const entry = screens.find((screen) => screen?.view === ctx.screenRel);
  if (!entry) {
    report.problem({ file: contract.rel, line: 1, rule: 'screen-contract', message: `no screen entry has "view": "${ctx.screenRel}"`, fix: `Add the entry (id "${ctx.f}", route, model, view, states, elements); scaffold-feature.mjs writes it, screen-contracts says what each field holds.` });
    return;
  }
  if (entry.model !== ctx.modelRel) {
    report.problem({ file: contract.rel, line: 1, rule: 'screen-contract', message: `screen "${entry.id}" names the model ${JSON.stringify(entry.model ?? null)}, not "${ctx.modelRel}"`, fix: `Set "model": "${ctx.modelRel}".` });
  }
  const isRouted = entry.presentation === 'route' || entry.presentation === 'modal-route';
  if (isRouted && wired.length > 0 && !wired.some((route) => route.rel === entry.route)) {
    report.problem({ file: contract.rel, line: 1, rule: 'screen-contract', message: `screen "${entry.id}" names the route ${JSON.stringify(entry.route ?? null)}, not ${wired.map((route) => `"${route.rel}"`).join(' or ')}`, fix: `Set "route": "${wired[0].rel}".` });
  }
}

function checkFeature(root, layout, f, routes, env, report) {
  const dir = `${layout.featuresDir}/${f}`;
  const P = pascal(f);
  const ctx = { f, P, dir, featuresDir: layout.featuresDir, screenRel: `${dir}/${f}-screen.tsx`, modelRel: `${dir}/use-${f}-model.ts` };
  const files = featureFiles(root, dir);
  const has = (rel) => files.includes(rel);
  ctx.screenSource = read(root, ctx.screenRel);
  if (isStarterSource(ctx.screenSource)) {
    const starterRoutes = routes.filter((route) => isStarterSource(route.source) || route.imports.some((entry) => featureOfPath(entry.path, layout.featuresDir) === f)).map((route) => route.rel);
    report.problem({ file: ctx.screenRel, line: 1, rule: 'starter-screen', message: `${f} is the starter screen of a new app (expo-project-bootstrap), not a feature: it has no model hook, no route test and no contract entry`, fix: `Delete ${[...starterRoutes, `${dir}/`].join(' and ')}, then generate the first feature at its route: scaffold-feature.mjs . --feature <name> --route ${starterRoutes.length > 0 ? `"${starterRoutes[0].slice(layout.routesDir.length + 1).replace(CODE_FILE, '')}"` : 'index'} --title "<Title>" --write.` });
    return;
  }
  const required = [ctx.screenRel, ctx.modelRel, `${dir}/${f}-screen.test.tsx`];
  for (const rel of required) {
    if (!has(rel)) report.problem({ file: rel, rule: 'feature-files', message: `${f}: ${basename(rel)} is missing`, fix: `Generate the feature with scaffold-feature.mjs (or copy the template of the same name); every screen feature has the view, the model hook and a test for each.` });
  }
  if (!has(`${dir}/use-${f}-model.test.ts`) && !has(`${dir}/use-${f}-model.test.tsx`)) {
    report.problem({ file: `${dir}/use-${f}-model.test.tsx`, rule: 'feature-files', message: `${f}: the model hook has no test`, fix: 'Add use-<feature>-model.test.tsx: render the hook with the app\'s I18nProvider (and a router when it reads params) and assert every field and handler.' });
  }
  ctx.modelSource = read(root, ctx.modelRel);
  checkNames(ctx, report);
  checkPlacement(ctx, files, report);
  checkViewPure(root, layout, ctx, files, report);
  checkViewParams(root, ctx, files, report);
  const importing = routes.filter((route) => route.imports.some((entry) => featureOfPath(entry.path, layout.featuresDir) === f));
  const wired = [];
  for (const route of importing) {
    const { callsHook, rendersView } = routeRendersFeature(route, ctx);
    if (callsHook && rendersView) wired.push(route);
    else report.problem({ file: route.rel, line: 1, rule: 'route-wiring', message: `the route imports the ${f} feature but does not ${callsHook ? `render <${P}Screen>` : `call use${P}Model()`}`, fix: `Keep the route to two lines of work: const model = use${P}Model(); return <${P}Screen model={model} /> (both imported from @/features/${f}/).` });
  }
  const entry = env.screenContract.data?.screens?.find?.((screen) => screen?.view === ctx.screenRel);
  const isUnrouted = typeof entry?.presentation === 'string' && !ROUTED_PRESENTATIONS.has(entry.presentation);
  if (importing.length === 0 && !isUnrouted) {
    report.problem({ file: ctx.screenRel, line: 1, rule: 'route-wiring', message: `no route renders ${P}Screen`, fix: `Add the route file under ${layout.routesDir}/ (scaffold-feature.mjs --route "<route id>"): it calls use${P}Model() and renders <${P}Screen model={model} />.` });
  }
  for (const route of wired) {
    checkRouteTest(root, layout, ctx, route, files, report);
    const paramsRel = checkParams(root, layout, ctx, route, files, report);
    if (env.navContract.exists) checkNavContract(ctx, route, paramsRel, env.navContract, report);
  }
  if (env.screenContract.exists) checkScreenContract(ctx, wired, env.screenContract, report);
  checkMessageKeys(root, ctx, files, wired, env.catalogs, report);
  if (env.orphans) checkOrphans(root, ctx, env.catalogs, env.sourceLanguage, report);
  for (const rel of [...files.filter((path) => /\.(tsx?|jsx?|json)$/.test(path)), ...wired.map((route) => route.rel)]) {
    const text = read(root, rel);
    if (text !== null) checkPlaceholderText(rel, text, report);
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root, or pass it: node check-feature.mjs <repo-root>.');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch (error) {
    throw new UsageError(`package.json is not valid JSON: ${error.message}`, 'Fix package.json, then rerun.');
  }
  const report = createReporter({ name: 'check-feature', json: options.json });
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  if (deps['expo-router'] === undefined) return report.notApplicable('expo-router is not in package.json (this skill scaffolds Expo Router features)');
  const layout = resolveLayout(root, { routesDir: options['routes-dir'], featuresDir: options['features-dir'] });
  const wanted = options.feature ?? [];
  if (options['source-language'] !== undefined && !isLanguageTag(options['source-language'])) {
    throw new UsageError(`--source-language "${options['source-language']}" is not a language tag`, 'Pass the tag of the source catalog file, e.g. --source-language en.');
  }
  for (const name of wanted) {
    if (!FEATURE_NAME.test(name)) throw new UsageError(`--feature "${name}" is not a kebab-case feature folder name`, 'Pass the folder name under src/features, e.g. --feature task-detail.');
  }
  const routes = routeFiles(root, layout.routesDir).map((route) => {
    const source = read(root, route.rel);
    return { ...route, source, imports: resolvedImports(root, layout, route.rel, maskComments(source)) };
  });
  const discovered = new Set();
  if (isDir(join(root, layout.featuresDir))) {
    for (const name of readdirSync(join(root, layout.featuresDir))) {
      const dir = join(root, layout.featuresDir, name);
      // A folder holding a SKILL.md is an installed or vendored skill, never the app's feature.
      if (FEATURE_NAME.test(name) && existsSync(join(dir, `${name}-screen.tsx`)) && !existsSync(join(dir, 'SKILL.md'))) discovered.add(name);
    }
  }
  for (const route of routes) {
    for (const entry of route.imports) {
      const name = featureOfPath(entry.path, layout.featuresDir);
      if (name !== null) discovered.add(name);
    }
  }
  const features = wanted.length > 0 ? wanted : [...discovered].sort();
  if (features.length === 0) throw new UsageError(`nothing to check: 0 screen features found (no ${layout.featuresDir}/<feature>/<feature>-screen.tsx and no route that renders a feature)`, 'Generate one with scaffold-feature.mjs, or pass the root of the app that has features.');
  const navRel = layout.config?.navigationContract ?? `${layout.contractsDir}/navigation.json`;
  const screensRel = layout.config?.screensContract ?? `${layout.contractsDir}/screens.json`;
  const env = {
    orphans: Boolean(options.orphans),
    sourceLanguage: sourceLanguageOf(root, layout, options['source-language']).language,
    catalogs: readCatalogs(root, layout.i18nDir),
    navContract: { rel: navRel, ...readContract(root, navRel) },
    screenContract: { rel: screensRel, ...readContract(root, screensRel) },
  };
  const skips = [
    [env.catalogs === null || env.catalogs.length === 0, `${layout.i18nDir}/catalogs`, 'message-key-missing', 'i18n-strings-and-catalogs'],
    [!env.navContract.exists, navRel, 'nav-contract', 'navigation-and-routing'],
    [!env.screenContract.exists, screensRel, 'screen-contract', 'screen-contracts'],
  ];
  for (const [isMissing, file, rule, owner] of skips) {
    if (!isMissing) continue;
    const reason = notYetCreated(root, { file, owner }) ?? `holds no catalog (${owner} creates them)`;
    report.skip({ file, rule, message: reason });
  }
  checkPlaceholderPaths(root, layout, report);
  for (const f of features) checkFeature(root, layout, f, routes, env, report);
  return report.finish({ checked: features.length, unit: 'features' });
});
