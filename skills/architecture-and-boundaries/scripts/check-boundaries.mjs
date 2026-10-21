#!/usr/bin/env node
// check-boundaries.mjs: checks every import of an Expo app after resolving it to a file, a package or
// a Node built-in: dependencies point one way along the src/ zones, src/core is pure, every vendor SDK
// sits behind its adapter and every other SDK is classified, adapters are created only in the
// composition root and fakes only in tests, a game reaches the app only through what it may face, app
// code never reaches Node-world code (and Node code only loads neutral files), server code (Expo Router
// API routes and middleware) stays apart from the bundled app, local Expo modules are reached only from
// an adapter, test-only code is reachable only through its production gate, and there are no parent
// imports, unresolved imports or import cycles. When multi-package, apps never import each other and
// packages never import an app.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-boundaries.mjs [repo-root]

import { dirname, extname } from 'node:path';

import { createReporter, globToRegExp, parseArgs, requireDir, resolveAlias, run } from './check-lib.mjs';
import { SHARED_ZONES, loadArchitecture, readableGlob } from './lib/architecture.mjs';
import { buildGraph, findCycles, reachesAppRuntime, reachesNodeWorld } from './lib/import-graph.mjs';

const SPEC = {
  name: 'check-boundaries',
  summary:
    'Checks every import of the app after resolving it (relative paths, the @/ alias, workspace packages): ' +
    'one-way zones (routes, features, ui, core, services, stores, data, api, games), a pure src/core, vendor SDKs ' +
    'and local Expo modules only in adapters and every other SDK classified, adapters only in the composition root, ' +
    'fakes only in tests, no Node-world code in the app and only neutral files in Node code, server code (+api, ' +
    '+middleware) apart from the app, the test-only production gate, no ../ imports, no unresolved imports and no ' +
    'import cycles. Reads .ts/.tsx and .js/.jsx files under the code folders (root config files are left out).',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The architecture contract (default: contracts/architecture.json when it exists)' },
    'src-dir': { type: 'string', value: 'dir', help: 'The source folder (default: from resolveLayout, src)' },
    'routes-dir': { type: 'string', value: 'dir', help: 'The Expo Router routes folder (default: src/app, or app/ when only it exists)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  route-leaf          a file outside the routes folder imports a route file',
    '  route-thin          a route (not a _layout) imports a store, data, api or service module directly, holds',
    '                      screen state or effects (useState, useReducer, useEffect, useLayoutEffect,',
    '                      useFocusEffect), calls any hook that is not a router hook (expo-router, React',
    '                      Navigation) or imported from src/features/ (useQuery, useMemo, a shared or local hook), or',
    '                      renders no feature: it imports nothing from src/features/ (or nonFeatureScreens, or the',
    '                      test-only gate) and is not a <Redirect> (+not-found, +html, +native-intent are exempt)',
    '  server-boundary     server code (an Expo Router +api file, the root +middleware file, contract serverFiles)',
    '                      imports a React Native or Expo runtime module (expo-server and expo-router/server are',
    '                      fine) or a route, feature, ui, theme, store, game, adapter or local module; or bundled',
    '                      app code imports server code',
    '  layer-direction     a shared layer (ui, theme, services, stores, data, api, i18n, config) imports a feature',
    '  feature-to-feature  a feature imports another feature (record a reasoned exception in allowedImports)',
    '  game-to-game        code of one game (src/games/<game>/) imports another game',
    '  game-facing         game code outside rules/ and levels/ imports app code it may not face (stores, services,',
    '                      features, data, api, config); it may face src/core, src/ui, src/theme, src/i18n,',
    '                      src/canvas, port types, its own folder and the contract\'s gameFacing globs (the seam)',
    '  ui-presentational   src/ui imports a store, data, api or a service other than a port type',
    '  core-pure           src/core (or game rules and levels, or a pure package) imports a framework package',
    '                      or code outside its zone',
    '  no-tooling-import   app code imports scripts/, test/, __mocks__/ or a Node-world package',
    '  node-world-import   app code imports a file that needs Node (app.config.ts, plugins/, a contract',
    '                      nodeWorldFile, or a config file that reaches node:* or expo/config-plugins), even type-only',
    '  node-builtin        app code imports a Node built-in (a bare name the package.json declares, such as the',
    '                      buffer polyfill, is that npm package)',
    '  node-import         Node code imports through a tsconfig alias, without the file extension, or loads an',
    '                      app file that imports React Native or Expo modules or holds JSX',
    '  vendor-sdk          a vendor SDK (subpaths included) or a local Expo module (modules/<name>/) is imported',
    '                      outside its adapter file',
    '  unclassified-sdk    runtime code imports an SDK that is neither in vendorSdks (behind a port) nor in',
    '                      portlessSdks (UI building blocks, read-only facts): a name matching expo-*,',
    '                      react-native-*, *-react-native(-*), @react-native-*/*, @*/react-native(-*),',
    '                      @*/*-react-native(-*) or a contract sdkPackagePatterns entry, or (when node_modules',
    '                      exists) a package that ships native code',
    '  banned-package      a package the architecture replaced with a port or an API is imported',
    '  adapter-import      an adapter is imported outside the composition root, tests and (for src/data drivers)',
    '                      the data layer itself; or create-device-services is imported by anything but the root',
    '                      layout, the composition root and tests (each call builds fresh adapters). A platform',
    '                      file\'s import type of its own base adapter (x-adapter.web.ts -> ./x-adapter) is fine',
    '  fake-import         runtime code imports a fake-*.ts or createTestServices (only tests, test/, other fakes,',
    '                      createTestServices and the test-only entry and its folders may)',
    '  test-only-gate      require() of code outside a src/**/test-only.ts gate (assets such as',
    '                      require(\'@/assets/x.png\') are fine, and so are the forms app-variants-and-environment',
    '                      sanctions: debug tooling such as Reactotron or a devOnlyRequires glob, and a require()',
    '                      decided by another EXPO_PUBLIC_* inclusion flag); a gate require() with no condition at',
    '                      all; test-only-entry imported by anything but its gate; or a value import of a file in a',
    '                      contract testOnlyFolders folder from bundled code other than the entry and those folders',
    '                      (import type is fine). The literal form and polarity of the gate comparison are',
    '                      app-variants-and-environment\'s inclusion-gate rule',
    '  parent-import       an import from "../" outside Node code',
    '  unresolved-import   a relative or alias import that points to no file',
    '  import-cycle        files that import each other in a loop (type-only imports are ignored)',
    '  app-to-app          (multi-package) an app imports another app',
    '  package-direction   (multi-package) a package imports an app',
    '',
    'The zones, vendor SDKs and bans have defaults (the skill\'s assets/architecture-defaults.json);',
    'contracts/architecture.json adds to them (see the skill\'s references/contract-and-config.md).',
    'Example: node check-boundaries.mjs .            (from the app repo root)',
  ].join('\n'),
};

const ROUTE_THIN_ZONES = new Set(['stores', 'data', 'api']);
/** App zones server code never imports: screens and UI, client state, games and device code. */
const SERVER_FORBIDDEN_ZONES = new Set(['routes', 'features', 'ui', 'theme', 'stores', 'games', 'native-module']);
const SERVER_FIX =
  'Server code (an Expo Router +api file, +middleware, contract serverFiles) runs on the server, never in the app: ' +
  'it imports src/core, src/api schemas, src/config, src/data, port types, other server files, expo-server and ' +
  'expo-router/server, and Web APIs (Request, Response, fetch, crypto.subtle). Shared logic moves to src/core; a ' +
  'server helper lives outside the routes folder (src/server/, recorded in srcFolders and serverFiles).';
const sameScopeOf = (a, b) => a.scope === b.scope;
// Layouts are exempt from route-thin: the root layout mounts the composition root and the providers.
const UI_FORBIDDEN_ZONES = new Set(['stores', 'data', 'api']);

/** Problems for one resolved import: [{ rule, message, fix }]. */
function importProblems(ctx, node, info, entry) {
  const { arch, graph } = ctx;
  const out = [];
  const add = (rule, message, fix) => out.push({ rule, message, fix });
  const { spec, target } = entry;
  const isServer = info.zone === 'server';
  if (spec.startsWith('../') && !info.isNode) {
    const intoModule = target.kind === 'file' && arch.classify(target.rel).zone === 'native-module';
    let fix = 'Same folder: ./x; any other folder: the @/ alias (@/features/tasks/task-list). Only Node code (app.config.ts, plugins/, scripts/) uses ../.';
    if (arch.isAssetSpec(spec)) fix = 'Name the asset through the alias: require(\'@/assets/<kind>/<file>\') ("@/assets/*": ["./assets/*"] in tsconfig.json, mapped in jest.config.js before "@/").';
    if (intoModule) fix = `Import the local Expo module through its alias, from its adapter only: "@/modules/*": ["./modules/*"] in tsconfig.json (and jest.config.js, before "@/"), then @/modules/${arch.classify(target.rel).module}.`;
    add('parent-import', `import from "${spec}"`, fix);
  }
  if (info.isNode && !info.isTest && !entry.typeOnly) nodeImportProblems(ctx, node, entry, add);
  if (target.kind === 'builtin') {
    if (info.isRuntime) add('node-builtin', `imports the Node built-in "${spec}"`, 'App code runs on Hermes: move the Node code to scripts/ (a test that needs Node goes to test/integration/).');
    return out;
  }
  if (target.kind === 'package') {
    if (isServer && arch.isRuntimePackage(spec) && !arch.isServerPackage(spec)) {
      add('server-boundary', `server code imports the app runtime module ${spec}`, SERVER_FIX);
    }
    packageProblems(arch, node, info, entry, add);
    return out;
  }
  if (target.kind === 'missing') {
    let hint = '';
    if (spec.startsWith('@/assets/')) hint = ' An asset under assets/ needs "@/assets/*": ["./assets/*"] in tsconfig.json paths (the Expo template default) and the same mapping in jest.config.js, before "@/".';
    if (spec.startsWith('@/modules/')) hint = ' A local Expo module under modules/ needs "@/modules/*": ["./modules/*"] in tsconfig.json paths and the same mapping in jest.config.js, before "@/".';
    if (!spec.startsWith('../')) add('unresolved-import', `"${spec}" resolves to no file (${target.rel})`, `Fix the path: @/ maps to src/ (tsconfig.json paths), ./x is the same folder.${hint}`);
    return out;
  }
  const ti = arch.classify(target.rel);
  if (isServer && ti.scope === info.scope && !arch.isAllowed(node.rel, ti.rel) && (SERVER_FORBIDDEN_ZONES.has(ti.zone) || (ti.zone === 'services' && !arch.isPortFile(ti.rel) && !arch.isAdapter(ti.rel)))) {
    add('server-boundary', `server code imports ${ti.rel} (${ti.zone})`, SERVER_FIX);
  }
  if (info.isBundled && ti.zone === 'server') {
    add('server-boundary', `bundled app code imports the server file ${ti.rel}`, 'Server code never enters the app bundle: the app calls an API route over HTTP (fetch through the ApiClient in src/api/); shared types and schemas live in src/api/ or src/core/, which both import. Test an API route from test/ (the root program has Node types).');
  }
  if (ti.zone === 'native-module' && info.isBundled && !arch.isAdapter(node.rel)) {
    add('vendor-sdk', `imports the local Expo module ${arch.scopeOf(ti.rel).nativeModulesDir}/${ti.module} outside its adapter`, `A local Expo module is native code like any SDK: only its adapter (src/services/<concern>/<module>-<concern>-adapter.ts) imports it, the port hides it, and tests use the fake.`);
  }
  zoneProblems(ctx, node, info, ti, add);
  if (ti.isTooling && info.isRuntime) {
    add('no-tooling-import', `imports ${target.rel}`, 'Tooling, test helpers and mocks are never bundled into the app: move the shared piece into src/ (src/core when it is pure).');
  } else if (info.isBundled) {
    const reason = ti.isNode ? `${target.rel} runs in Node` : ti.zone === 'config' || ti.zone === 'package' ? reachesNodeWorld(graph, arch, target.rel) : null;
    if (reason) add('node-world-import', `imports ${target.rel}, which needs Node (${reason})`, 'App code never imports Node-world files, not even with import type: move the shared type or value to a neutral file in src/config/ that imports nothing from Node.');
  }
  // The data layer composes its own SQL driver (a device opener in src/data/ the composition root calls once).
  const dataComposes = info.zone === 'data' && ti.zone === 'data' && sameScopeOf(info, ti);
  // A platform variant may import its base adapter's types (import type * as Native from './x-adapter' in
  // x-adapter.web.ts) so it is held to the same exports; nothing is bundled.
  const typesOfOwnBase = isPlatformVariantOf(node.rel, target.rel) && isTypeOnlyImport(node, entry);
  if (arch.isAdapter(target.rel) && !info.isTest && !info.isNode && !dataComposes && !typesOfOwnBase && !arch.isCompositionRoot(node.rel) && !arch.isTestOnlyEntry(node.rel)) {
    add('adapter-import', `imports the adapter ${target.rel}`, 'Adapters are created once, in the composition root (src/services/create-device-services.ts), and reach the code through useServices() or a factory argument; tests use the fake.');
  }
  if (arch.isDeviceServicesFactory(target.rel) && info.isBundled && !info.isTest && !arch.isRootLayout(node.rel) && !arch.isCompositionRoot(node.rel)) {
    add('adapter-import', `imports the composition root ${target.rel} outside the root layout`, `createDeviceServices() builds fresh adapters on every call: only the root layout (${info.scope.layout?.routesDir ?? 'src/app'}/_layout.tsx) calls it, once, in a useState initializer, and ServicesProvider hands the ports down; other code reads them with useServices() or receives them as factory arguments. A startup module the root layout calls goes into compositionRoot in contracts/architecture.json.`);
  }
  if (arch.isFake(target.rel) && info.isRuntime && !mayImportFakes(arch, node.rel)) {
    add('fake-import', `imports the fake ${target.rel}`, 'A fake is test code: tests, test/ helpers and createTestServices() use it. Runtime code takes the port from useServices() or a factory argument (the composition root creates the device adapter); a debug build reaches a fake only through the test-only entry.');
  }
  if (arch.isTestServicesFactory(target.rel) && info.isRuntime && !mayImportFakes(arch, node.rel)) {
    add('fake-import', `imports the test services ${target.rel}`, 'createTestServices() is test code: its stand-ins throw on first use. Runtime code takes the ports from useServices() (the root layout mounts createDeviceServices()); a debug build reaches fakes only through the test-only entry.');
  }
  if (arch.isTestOnlyEntry(target.rel) && !info.isTest && !(arch.isTestOnlyGate(node.rel) && dirname(node.rel) === dirname(target.rel))) {
    add('test-only-gate', `imports ${target.rel} directly`, 'Reach test-only code only through TEST_ONLY from the gate (test-only.ts next to the entry), so production bundles drop it.');
  }
  // A testOnlyFolders folder is test-only because only the entry reaches it: any other bundled value
  // import (a route re-exporting the debug screen) puts the folder and what it imports in every build.
  if (arch.isInTestOnlyFolder(target.rel) && !arch.isTestOnlyEntry(target.rel) && info.isRuntime && !arch.isInTestOnlyFolder(node.rel) && !arch.isTestOnlyEntry(node.rel) && !isTypeOnlyImport(node, entry)) {
    add('test-only-gate', `imports ${target.rel}, which sits in a testOnlyFolders folder, outside the test-only entry`, `Code in a testOnlyFolders folder ships only through the gate: export it from test-only-entry and read it from TEST_ONLY (a route renders TEST_ONLY?.DebugScreen from the gate and redirects when it is null); import type stays fine. A static import keeps it, and every fake it imports, in production bundles (Expo Router bundles every route).`);
  }
  return out;
}

/** True when `rel` is a platform file (x.web.ts, x.native.ts, x.ios.ts, x.android.ts) of `base` (x.ts). */
function isPlatformVariantOf(rel, base) {
  const stem = (path) => path.replace(/\.(tsx?|jsx?)$/, '');
  const variant = /^(.*)\.(web|native|ios|android)$/.exec(stem(rel));
  return variant !== null && variant[1] === stem(base);
}

/**
 * True when an import brings in types only: `import type` / `export type`, or a braced list whose every
 * name is marked `type` (`import { type A, type B } from`). Both are erased before Metro bundles.
 */
function isTypeOnlyImport(node, entry) {
  if (entry.typeOnly) return true;
  if (entry.form !== 'import' && entry.form !== 'export') return false;
  const before = node.scan.code.slice(Math.max(0, entry.index - 4000), entry.index);
  // entry.index is the opening quote of the specifier.
  const clause = /(?<![\w$.])(?:import|export)\b([^;'"`]*)\bfrom\s*$/.exec(before)?.[1];
  if (clause === undefined) return false;
  const braces = /\{([^}]*)\}/.exec(clause);
  const outside = clause.replace(/\{[^}]*\}/, '').replace(/[\s,]/g, '');
  const names = braces ? braces[1].split(',').map((name) => name.trim()).filter(Boolean) : [];
  return outside === '' && names.length > 0 && names.every((name) => /^type\s/.test(name));
}

// Route files the router reads for something other than a screen: no feature to render.
const NO_SCREEN_ROUTE = /(^|\/)\+(not-found|html|native-intent)\.[cm]?[jt]sx?$/;
// Screen state and effects belong in the feature's model hook; router param hooks stay in the route.
const SCREEN_HOOKS = /(?<![\w$])(?:React\s*\.\s*)?(useState|useReducer|useEffect|useLayoutEffect|useFocusEffect)\s*(?:<[^()]*>)?\s*\(/g;
const SCREEN_HOOK_NAMES = new Set(['useState', 'useReducer', 'useEffect', 'useLayoutEffect', 'useFocusEffect']);
// Any other hook call (useQuery, useMemo, useT, React.useContext): `X.` is a namespace import's member.
const HOOK_CALL = /(?<![\w$.])(?:([A-Za-z_$][\w$]*)\s*\.\s*)?(use[A-Z][\w$]*)\s*(?:<[^()]*>)?\s*\(/g;
const REDIRECT_IMPORT = /import\s*\{[^}]*\bRedirect\b[^}]*\}\s*from\s*['"]expo-router['"]/;
const ROUTE_HOOK_FIX =
  'A route renders its screen and calls the feature\'s own hooks (the model hook reads and parses the router ' +
  'params); every other hook (data fetching such as useQuery, React\'s hooks, a shared hook) ' +
  'runs in src/features/<feature>/use-<feature>-model.ts, and a screen title goes on <Stack.Screen> in the ' +
  'group\'s _layout.';

/** Local names a file imports as values, each with its specifier: import { a, b as c }, import d, import * as e. */
function importBindings(scan) {
  const bindings = new Map();
  for (const match of scan.codeKeep.matchAll(/(?<![\w$.])import\s+(?!type\s)([^;'"`]*?)\s*from\s*(['"])([^'"\n]*)\2/g)) {
    const [, clause, , spec] = match;
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const part of braces ? braces[1].split(',') : []) {
      const name = part.trim();
      if (name === '' || /^type\s/.test(name)) continue;
      const [imported, local] = name.split(/\s+as\s+/);
      bindings.set((local ?? imported).trim(), spec);
    }
    const outside = clause.replace(/\{[^}]*\}/, ' ');
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(outside);
    if (namespace) bindings.set(namespace[1], spec);
    const def = /^\s*([A-Za-z_$][\w$]*)\s*(,|$)/.exec(outside);
    if (def) bindings.set(def[1], spec);
  }
  return bindings;
}

/**
 * route-thin for the hooks a route calls: router hooks (expo-router, React Navigation) and hooks from
 * src/features/ (the model hook), nonFeatureScreens files or an allowedImports target. Everything else
 * is screen logic that belongs in the model hook.
 */
function routeHookProblems(arch, node, info) {
  const out = [];
  const bindings = importBindings(node.scan);
  for (const match of node.scan.code.matchAll(HOOK_CALL)) {
    const [, owner, hook] = match;
    if (SCREEN_HOOK_NAMES.has(hook)) continue;
    // A hook declared in the route (function useX() {...}) is reported where it is called.
    if (/\bfunction\s*\*?\s*$/.test(node.scan.code.slice(Math.max(0, match.index - 20), match.index))) continue;
    const spec = bindings.get(owner ?? hook);
    if (owner !== undefined && spec === undefined) continue;
    const line = node.scan.lineOf(match.index);
    if (spec === undefined) {
      out.push({ line, rule: 'route-thin', message: `the route calls ${hook}(), a hook it does not import from src/features/ or expo-router`, fix: ROUTE_HOOK_FIX });
      continue;
    }
    const target = node.imports.find((entry) => entry.spec === spec)?.target;
    if (target?.kind === 'package' && (target.name === 'expo-router' || target.name.startsWith('@react-navigation/'))) continue;
    if (target?.kind === 'file') {
      const ti = arch.classify(target.rel);
      if ((ti.zone === 'features' && ti.scope === info.scope) || arch.anyGlob(target.rel, arch.settings.nonFeatureScreens) || arch.isAllowed(node.rel, target.rel)) continue;
    }
    out.push({ line, rule: 'route-thin', message: `the route calls ${owner ? `${owner}.` : ''}${hook}() from ${spec}`, fix: ROUTE_HOOK_FIX });
  }
  return out;
}

/**
 * route-thin for the whole route file: it renders a screen from src/features/ (or a nonFeatureScreens
 * file, or test-only code through the gate) or redirects, and holds no state, effects or other hooks of
 * its own (router hooks and the feature's hooks are fine).
 */
function routeFileProblems(arch, node, info) {
  if (info.zone !== 'routes' || info.isTest || arch.isLayoutRoute(node.rel)) return [];
  const out = [];
  for (const match of node.scan.code.matchAll(SCREEN_HOOKS)) {
    out.push({ line: node.scan.lineOf(match.index), rule: 'route-thin', message: `the route calls ${match[1]}()`, fix: 'A route only renders its screen: state and effects live in the feature\'s use-<feature>-model.ts (including reading the router params: the model hook parses them).' });
  }
  out.push(...routeHookProblems(arch, node, info));
  if (NO_SCREEN_ROUTE.test(node.rel)) return out;
  const rendersScreen = node.imports.some(({ target }) => {
    if (target.kind !== 'file') return false;
    const ti = arch.classify(target.rel);
    return (ti.zone === 'features' && ti.scope === info.scope) || arch.anyGlob(target.rel, arch.settings.nonFeatureScreens) || arch.isTestOnlyGate(target.rel) || arch.isAllowed(node.rel, target.rel);
  });
  if (!rendersScreen && !REDIRECT_IMPORT.test(node.scan.codeKeep)) {
    const features = info.scope.layout?.featuresDir ?? 'src/features';
    out.push({ line: 1, rule: 'route-thin', message: `the route renders no screen from ${features}/`, fix: `Move the screen into ${features}/<feature>/<feature>-screen.tsx with its use-<feature>-model.ts and render it here (export { TasksScreen as default } from '@/features/tasks/tasks-screen'; works too); a route that only redirects renders <Redirect href="..." /> from expo-router.` });
  }
  return out;
}

/** Files that may import a fake: other fakes, createTestServices, the test-only entry and its folders. */
function mayImportFakes(arch, rel) {
  return arch.isFake(rel) || arch.isTestOnlyEntry(rel) || arch.isInTestOnlyFolder(rel) || (arch.isCompositionRoot(rel) && /(^|\/)create-test-[a-z0-9-]*\.tsx?$/.test(rel));
}

const UNCLASSIFIED_FIX =
  'Decide first (stop and ask the developer): a side effect (device API, storage, network, notifications, system ' +
  'sheets, analytics) goes into vendorSdks in contracts/architecture.json with its port, and only its adapter ' +
  'imports it; a UI building block or a read-only fact goes into portlessSdks with the reason. Mirror a vendor ' +
  'SDK in eslint.config.mjs VENDOR_SDK_PATHS. A server SDK (firebase-admin, firebase-functions: listed in ' +
  'sdkPackagePatterns so bundled code cannot import it) is never classified: that code belongs in the Node backend ' +
  'workspace (functions/), which imports it freely.';

/** Where a ban is recorded, for the fix: the install policy, the contract, or the defaults. */
function bannedFix(arch, name) {
  if (arch.settings.bannedSources[name] === 'policy') return `Use what the message names; the ban is doNotAdd in ${arch.settings.policyFile} (dependency-management), the one list this checker also reads; mirror it in eslint.config.mjs BANNED_PACKAGE_PATHS.`;
  return `Use what the message names; the list is bannedPackages in ${arch.contract.rel} (with doNotAdd in ${arch.settings.policyFile}, and the same list in eslint.config.mjs).`;
}

function packageProblems(arch, node, info, entry, add) {
  const name = entry.target.name;
  const allowIn = arch.settings.bannedAllowIn[name] ?? [];
  const banned = arch.anyGlob(node.rel, allowIn) ? null : arch.settings.bannedPackages[name];
  if (banned) add('banned-package', `imports ${name}: ${banned}${allowIn.length > 0 ? ` (only ${allowIn.join(', ')} may import it)` : ''}`, bannedFix(arch, name));
  if (info.isBundled) {
    const port = arch.settings.vendorSdks[name];
    const onlyFiles = arch.vendorFilesFor(node.rel, name);
    if (port && !arch.isAdapter(node.rel)) {
      const home = info.zone === 'data' ? `${info.scope.layout.dataDir}/**/<library>-<concern>-adapter.ts (the data layer's own ports)` : `${info.scope.layout?.servicesDir ?? 'src/services'}/<concern>/<library>-<concern>-adapter.ts`;
      add('vendor-sdk', `imports the vendor SDK ${entry.spec} outside its adapter`, `Only the ${port} adapter imports ${name}. If this file is that adapter, name it ${home}; otherwise take the port from useServices() or a factory argument.`);
    } else if (port && Array.isArray(onlyFiles) && !arch.anyGlob(node.rel, onlyFiles)) {
      const files = onlyFiles.map(readableGlob).join(', ');
      add('vendor-sdk', `imports ${name}, which only ${files} may import`, `Ask through the ${port} (useServices()); only ${files} imports ${name}.`);
    }
    const sdk = arch.sdkClass(name, node.rel);
    if (sdk === 'local' && !arch.isAdapter(node.rel)) {
      add('vendor-sdk', `imports the local Expo module ${name} (${arch.localModuleOf(node.rel, name)}) outside its adapter`, 'A local Expo module is native code like any SDK: only its adapter imports it, the port hides it, and tests use the fake.');
    }
    // A test imports what its subject imports (and test libraries such as @testing-library/react-native):
    // the decision is forced where runtime code first imports the SDK.
    if (!banned && sdk === 'unclassified' && info.isRuntime) {
      add('unclassified-sdk', `imports ${name}, an SDK that is neither behind a port (vendorSdks) nor recorded as portless (portlessSdks)`, UNCLASSIFIED_FIX);
    }
  }
  if (info.isPure && arch.isFramework(name, node.rel)) {
    add('core-pure', `imports ${name}`, 'src/core (and game rules and levels) is pure TypeScript: no React, React Native, Expo, Skia, stores or navigation; it runs in plain Node and Jest. Pass values in instead.');
  }
}

/** core-pure for an import of a repo file from a pure zone. */
function pureTargetAllowed(info, ti) {
  if (info.zone === 'core') return ti.zone === 'core' || (info.isTest && ti.zone === 'test-helpers');
  if (info.zone === 'games') {
    if (ti.zone === 'core' || (info.isTest && ti.zone === 'test-helpers')) return true;
    if (ti.zone !== 'games' || ti.game !== info.game) return false;
    // A rules test may drive the game's own board or timeline code (a replay check); rules and levels
    // themselves, and every levels file, stay in the pure zone (generators and solvers run them headless).
    return ['rules', 'levels'].includes(ti.gamePart) || (info.isTest && info.gamePart === 'rules');
  }
  if (info.zone === 'package') return ti.scope === info.scope || (ti.zone === 'package' && ti.isPure);
  return true;
}

/** App zones a game's code may reach only through gameFacing (packages have their own direction rules). */
const APP_CODE_ZONES = new Set(['routes', 'features', 'ui', 'theme', 'core', 'services', 'stores', 'data', 'api', 'i18n', 'config', 'src']);

function zoneProblems(ctx, node, info, ti, add) {
  const { arch } = ctx;
  const to = ti.rel;
  const allowed = arch.isAllowed(node.rel, to);
  const sameScope = ti.scope === info.scope;
  const isGame = sameScope && info.zone === 'games' && info.game !== null;
  const faces = isGame && arch.isGameFacing(info, to);
  const otherGame = isGame && ti.zone === 'games' && ti.game !== null && ti.game !== info.game && !faces && !allowed;
  // A file directly in src/games/ is open to games only through gameFacing, like any app code.
  const gamesShelf = ti.zone === 'games' && ti.game === null;
  if (otherGame) {
    add('game-to-game', `game ${info.game} imports game ${ti.game} (${to})`, 'Games never import each other: move the shared piece into src/core (pure rules, geometry) or src/ui, or record the shared seam in gameFacing in contracts/architecture.json.');
  }
  const gameFacingProblem = isGame && !info.isPure && !info.isTest && !faces && !allowed && (APP_CODE_ZONES.has(ti.zone) || gamesShelf);
  if (gameFacingProblem) {
    add('game-facing', `game ${info.game} imports ${to}, which games do not face`, 'A game reaches the app only through its seam: it imports src/core, src/ui, src/theme, src/i18n, src/canvas, port types and its own folder, and receives stores and services from the host as values. The seam files the host defines (game-session-host) go into gameFacing in contracts/architecture.json.');
  }
  if (info.isPure && !allowed && !otherGame && !pureTargetAllowed(info, ti)) {
    const who = info.zone === 'games' ? 'rules/levels import' : 'imports';
    add('core-pure', `${who} ${to}`, info.zone === 'games' ? 'Rules and levels import only src/core and their own game\'s rules/ and levels/; pass anything else in as a value.' : 'src/core is the bottom layer: it imports only src/core (a pure package only itself and other pure packages).');
  }
  if (sameScope && ti.zone === 'routes' && info.zone !== 'routes' && !info.isTest) {
    add('route-leaf', `imports the route file ${to}`, 'Routes are leaves: move the shared code into src/features/<feature>/ or src/ui/ and import it from there (Expo Router reads route files; nothing else should).');
  }
  if (sameScope && info.zone === 'routes' && !info.isTest && !arch.isLayoutRoute(node.rel) && !allowed && (ROUTE_THIN_ZONES.has(ti.zone) || ti.zone === 'services')) {
    add('route-thin', `the route imports ${to}`, 'Route files only render a screen from src/features/; the feature\'s use-<feature>-model.ts reads stores, data and services.');
  }
  // A game importing a feature already got game-facing for this import: one import, one problem.
  if (sameScope && SHARED_ZONES.has(info.zone) && !info.isTest && ti.zone === 'features' && !allowed && !gameFacingProblem && !arch.isTestOnlyEntry(node.rel)) {
    add('layer-direction', `the ${info.zone} layer imports the feature file ${to}`, 'Features sit above every shared layer: move the shared piece down (src/ui, src/core, src/stores, src/services) and import it from both.');
  }
  if (sameScope && info.zone === 'features' && ti.zone === 'features' && info.feature !== ti.feature && !allowed) {
    add('feature-to-feature', `feature ${info.feature} imports feature ${ti.feature} (${to})`, 'Features never import each other: move the shared piece into src/ui, src/core or src/stores, or navigate by route; a deliberate exception goes into allowedImports with its reason.');
  }
  if (sameScope && info.zone === 'ui' && !info.isTest && !allowed && (UI_FORBIDDEN_ZONES.has(ti.zone) || (ti.zone === 'services' && !arch.isPortFile(to)))) {
    add('ui-presentational', `src/ui imports ${to}`, 'src/ui is presentational: data and callbacks arrive through props (a port type may be a prop type); the feature\'s model hook reads stores and services.');
  }
  if (info.scope.kind === 'app' && ti.scope.kind === 'app' && !sameScope) {
    add('app-to-app', `app ${info.scope.dir} imports app ${ti.scope.dir} (${to})`, 'Apps never import each other: move the shared code into a package under packages/.');
  }
  if (info.scope.kind === 'package' && ti.scope.kind === 'app') {
    add('package-direction', `package ${info.scope.dir} imports the app file ${to}`, 'Packages sit below the apps: an app hands what a package needs in as a value or a port.');
  }
}

/** node-import: what Node itself (expo config, node scripts/x.ts) cannot resolve or load. */
function nodeImportProblems(ctx, node, entry, add) {
  const { arch, graph } = ctx;
  const { spec, target } = entry;
  if (target.kind === 'builtin' || target.kind === 'package') return;
  const viaAlias = !spec.startsWith('.') && resolveAlias(spec, arch.aliasesFor(node.rel)) !== null;
  if (viaAlias) {
    add('node-import', `imports "${spec}" through a tsconfig alias`, 'Node ignores tsconfig paths (expo config fails with "Cannot find module", verified on SDK 57): import by relative path with the extension, for example ./src/config/app-variant.ts.');
  } else if (spec.startsWith('.') && extname(spec) === '' && target.kind === 'file') {
    add('node-import', `imports "${spec}" without its file extension`, `Node resolves no extensions (expo config fails with "Cannot find module", verified): write "${spec}${extname(target.rel)}".`);
  }
  if (target.kind !== 'file') return;
  const ti = arch.classify(target.rel);
  if (!ti.isBundled) return;
  const reason = reachesAppRuntime(graph, arch, target.rel);
  if (reason) add('node-import', `imports ${target.rel}, which Node cannot load (${reason})`, 'A file Node code imports stays neutral: plain TypeScript, no JSX, no React Native or Expo module imports (expo config failed with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING when one imported expo-constants, verified).');
}

const GATE_CYCLE_FIX =
  'Code that test-only-entry reaches is test-only itself: import the member it needs straight from that member\'s ' +
  'own file, never the gate (test-only.ts) or a helper that imports the gate. Code outside the entry keeps using TEST_ONLY.';

/** True when the loop runs through a gate's require() of its own entry. */
function passesTestOnlyGate(arch, loop) {
  return loop.some((rel, index) => arch.isTestOnlyGate(rel) && loop[index + 1] !== undefined && arch.isTestOnlyEntry(loop[index + 1]) && dirname(rel) === dirname(loop[index + 1]));
}

// Debug-bundle tooling whose documented gate is __DEV__ (Reactotron, why-did-you-render): not test-only
// code. app-variants-and-environment sanctions it (its rule 9) and reads the same devOnlyRequires key.
const DEV_TOOLING = /reactotron|why-did-you-render/i;

/** The `{` that opens the block holding `index` in masked code, or -1 at module level. */
function enclosingBrace(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) depth -= 1;
      else if (ch === '{') return i;
    }
  }
  return -1;
}

/** What opens the block at `brace`: the `(condition)` of an if, 'else', or '' (a function body, a plain block). */
function blockHead(code, brace) {
  const before = code.slice(0, brace).trimEnd();
  if (/\belse$/.test(before)) return 'else';
  if (!before.endsWith(')')) return '';
  let level = 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (before[i] === ')') level += 1;
    else if (before[i] === '(' && --level === 0) return /\bif\s*$/.test(before.slice(0, i)) ? before.slice(i) : '';
  }
  return '';
}

/**
 * What decides a require() at `index`: the text of its statement before the call (a ternary or
 * && condition) and the heads of every if (or else) whose block holds it, at any position in the
 * block (a __DEV__ if whose block sets something up first, then requires the tooling).
 * `conditional` is false for a require() nothing decides.
 */
function requireCondition(code, index) {
  let depth = 0;
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']') depth += 1;
    else if ((ch === '(' || ch === '[') && depth > 0) depth -= 1;
    else if (ch === '}' && depth > 0) depth += 1;
    else if (ch === '{' && depth > 0) depth -= 1;
    else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) {
      start = i + 1;
      break;
    }
  }
  const statement = code.slice(start, index);
  const heads = [];
  for (let brace = enclosingBrace(code, index); brace !== -1; brace = enclosingBrace(code, brace)) {
    const head = blockHead(code, brace);
    if (head !== '') heads.push(head);
  }
  const text = `${heads.join(' ')} ${statement}`;
  return { text, conditional: heads.length > 0 || /\?(?![.?:])|&&|\|\||\bif\s*\(/.test(statement) };
}

const isPackageSpec = (spec) => !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('@/') && !spec.startsWith('~/');

/**
 * test-only-gate, the import side: test-only code is reached through one src/**\/test-only.ts gate.
 * What the gate's comparison looks like (the literal, the polarity) is app-variants-and-environment's
 * inclusion-gate rule; here a gate only needs a condition at all.
 */
function checkTestOnly(arch, graph, report) {
  const variable = arch.settings.testOnlyVariable;
  const devOnly = arch.settings.devOnlyRequires.map((glob) => globToRegExp(glob));
  const gateForm = `process.env.${variable} === 'production' ? null : require('./test-only-entry')`;
  for (const node of graph.nodes.values()) {
    const info = arch.classify(node.rel);
    if (!info.isRuntime) continue;
    const isGate = arch.isTestOnlyGate(node.rel);
    for (const match of node.scan.code.matchAll(/(?<![\w$.])require\s*\(/g)) {
      const literal = /^require\s*\(\s*(['"])([^'"\n]*)\1\s*\)/.exec(node.scan.codeKeep.slice(match.index));
      const spec = literal ? literal[2] : null;
      // An asset is required by its file: Metro bundles images, fonts and sounds this way (no module to import).
      if (spec !== null && arch.isAssetSpec(spec)) continue;
      const line = node.scan.lineOf(match.index);
      const what = spec === null ? 'require() of a computed path' : `require() of '${spec}'`;
      const decided = requireCondition(node.scan.code, match.index);
      if (isGate) {
        if (!decided.conditional) report.problem({ file: node.rel, line, rule: 'test-only-gate', message: `${what} has no condition: the gate ships its entry in every bundle`, fix: `Write the gate as one expression: ${gateForm} (app-variants-and-environment's inclusion-gate checks the literal comparison; its bundle check proves the strip).` });
        continue;
      }
      // Debug-bundle tooling behind __DEV__ (app-variants-and-environment rule 9): Reactotron,
      // why-did-you-render, a devOnlyRequires glob, or any package required under a __DEV__ condition.
      if (spec !== null && (DEV_TOOLING.test(spec) || devOnly.some((re) => re.test(spec)))) continue;
      if (spec !== null && isPackageSpec(spec) && /\b__DEV__\b/.test(decided.text)) continue;
      const flags = [...decided.text.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)].map((m) => m[1]);
      if (flags.includes(variable)) {
        report.problem({ file: node.rel, line, rule: 'test-only-gate', message: `${what} is decided by ${variable} outside a test-only.ts gate`, fix: `Test-only code has one way in: src/test-only.ts (beside test-only-entry.ts) holds ${gateForm}, and the app reads TEST_ONLY from it; move this module into what the entry exports.` });
      } else if (decided.conditional && flags.length > 0) {
        // Another inclusion flag (process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true' ? require(...) : null):
        // app-variants-and-environment's inclusion-gate checks that its literal comparison folds.
        continue;
      } else {
        report.problem({ file: node.rel, line, rule: 'test-only-gate', message: `${what} in app code`, fix: `Import modules statically. Only a test-only.ts gate requires test-only code (${gateForm}); an asset is required by its file, through the alias (@/assets/<kind>/<file>); debug tooling behind __DEV__ is named in rn-skills.config.json devOnlyRequires.` });
      }
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const arch = loadArchitecture(root, { contract: options.contract, overrides: { srcDir: options['src-dir'], routesDir: options['routes-dir'] } });
  const report = createReporter({ name: 'check-boundaries', json: options.json });
  if (arch.contract.data === null) report.note(`note: no ${arch.contract.rel}; the default zones, vendor SDKs and bans apply`);
  const graph = buildGraph(root, arch);
  const ctx = { arch, graph };
  for (const node of graph.nodes.values()) {
    const info = arch.classify(node.rel);
    for (const entry of node.imports) {
      for (const problem of importProblems(ctx, node, info, entry)) report.problem({ file: node.rel, line: entry.line, ...problem });
    }
    for (const problem of routeFileProblems(arch, node, info)) report.problem({ file: node.rel, ...problem });
  }
  checkTestOnly(arch, graph, report);
  for (const cycle of findCycles(graph)) {
    const loop = [...cycle, cycle[0]];
    if (passesTestOnlyGate(arch, loop)) {
      report.problem({ file: cycle[0], line: 1, rule: 'import-cycle', message: `import cycle through the test-only gate: ${loop.join(' -> ')}`, fix: GATE_CYCLE_FIX });
    } else {
      report.problem({ file: cycle[0], line: 1, rule: 'import-cycle', message: `import cycle: ${loop.join(' -> ')}`, fix: 'Break the loop: move the shared piece (usually a type) down into its own file that both import.' });
    }
  }
  return report.finish({ checked: graph.files.length, unit: 'TypeScript and JavaScript files' });
});

