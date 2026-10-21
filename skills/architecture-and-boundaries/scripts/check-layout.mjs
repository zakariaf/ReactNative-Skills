#!/usr/bin/env node
// check-layout.mjs: checks where files live in an Expo app: the canonical src/ folders, route files
// that really are routes, a port and a tested fake next to every adapter, a composition root once
// adapters exist, every kind of file in its home, no work at import time, a thin entry and the @/
// alias. When multi-package: the workspaces, the package manifests, one React and native modules in
// every app.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-layout.mjs [repo-root]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createReporter, fail, parseArgs, parseJsonc, requireDir, run, walkRepo } from './check-lib.mjs';
import { loadArchitecture, under } from './lib/architecture.mjs';
import { findCalls, functionsOf, importsOf, resolveImport, scanSource } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-layout',
  summary:
    'Checks the layout of an Expo app: the canonical src/ folders, route files, port/adapter/fake triples, ' +
    'the composition root, file placement, work at import time, the entry and the @/ alias; when ' +
    'multi-package, the workspaces, manifests, one React and native modules in every app.',
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
    '  folders           a src/ folder outside the canonical set (and contract srcFolders), a file directly in src/',
    '                    (a web stylesheet such as global.css belongs in src/theme/),',
    '                    a non-composition-root file directly in src/services/, a script directly in scripts/, or a',
    '                    scripts/ area that is not a kebab-case noun',
    '  route-file        a file in the routes folder that is a test (or a __tests__/ helper), a screen/hook/store/model,',
    '                    or has no default export (export default, or export { X as default } from ...): Expo Router',
    '                    bundles every file there as a route (+api files, +middleware and +native-intent export',
    '                    handlers); a route test goes to src/features/<feature>/<feature>-navigation.test.tsx',
    '  port-triple       a services/<concern>/ folder with an adapter lacks <concern>-port.ts, a fake-*.ts, or the',
    '                    fake\'s test',
    '  composition-root  adapters exist but no composition root creates them (src/services/create-device-services.ts);',
    '                    or create-device-services.ts exists but the root layout (or a file it imports) never',
    '                    calls createDeviceServices in a useState initializer or never renders <ServicesProvider>',
    '  placement         a screen, port, adapter, fake, store, reducer, config plugin or Node-API test in the wrong place',
    '                    (an OS mirror store, fed by a platform listener, may sit beside the code it serves)',
    '  import-time-work  module-level code opens a database, creates an AudioContext, an adapter, the services, a',
    '                    zustand store or a store through a factory, reloads the app or switches the layout',
    '                    direction (an OS mirror\'s vanilla store with a plain object literal is fine); code with',
    '                    or without semicolons splits into statements the same way',
    '  app-entry         package.json main is not expo-router/entry (or a thin entry file that only imports)',
    '  app-files         tsconfig.json lacks the @/* alias to src/ (or maps @/assets/* elsewhere than ./assets/*), the',
    '                    routes folder lacks _layout.tsx, or Jest maps "@/" before a folder alias such as',
    '                    "@/assets/*" that tsconfig.json declares or the code requires: jest.config.js lists',
    '                    "^@/(.*)$" first (or without the folder mapping), or, with no "@/" mapping of its own,',
    '                    jest-expo derives the map from tsconfig.json paths, which list "@/*" first',
    '  one-react         root overrides pin react or react-native to another version than the app uses',
    '  workspaces        (multi-package) package.json workspaces is not ["apps/*", "packages/*"] plus the folder of',
    '                    each Node backend the contract records (packages[].dir outside packages/, such as',
    '                    "functions"), there is no contract, or a package is not recorded (a workspace outside',
    '                    packages/ that is no Expo app is a Node backend: { "name", "dir", "world": "node" })',
    '  manifest          (multi-package) a package lacks "type": "module" or its exports map or has "main"; a Node',
    '                    backend lacks "type": "module" (its "main" is the deploy bundle, no exports map needed); an',
    '                    app lacks "main" or has "type": "module" next to a CommonJS metro.config.js',
    '  native-deps       (multi-package) a package peer dependency is missing from an app, or apps pin different versions',
    '',
    'NOT APPLICABLE when no app depends on expo (the entry and route rules assume an Expo app).',
    'Example: node check-layout.mjs .            (from the app repo root)',
  ].join('\n'),
};

const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/;
/** An adapter file, platform variants included (expo-haptics-adapter.ios.ts). */
const ADAPTER_NAME = /-adapter(\.(ios|android|native|web))?\.tsx?$/;
const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const prefixed = (dir, rel) => (dir === '' ? rel : `${dir}/${rel}`);

/** Visible entries of a folder; a folder that holds a SKILL.md (an installed or vendored skill) is never read. */
function entriesOf(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .filter((entry) => !(entry.isDirectory() && existsSync(join(path, entry.name, 'SKILL.md'))))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

function checkFolders(root, arch, scope, report) {
  const L = scope.layout;
  const { srcFolders, srcFiles } = arch.settings;
  for (const entry of entriesOf(join(root, L.srcDir))) {
    const rel = `${L.srcDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'assets' && !srcFolders.includes(entry.name)) {
        report.problem({ file: `${rel}/`, rule: 'folders', message: '"assets" is not a src/ folder', fix: 'Images, fonts and sounds live in assets/<kind>/ at the repo root (the Expo template layout) and are required as require(\'@/assets/<kind>/<file>\') through the "@/assets/*": ["./assets/*"] alias.' });
      } else if (!srcFolders.includes(entry.name) && rel !== L.routesDir) {
        report.problem({ file: `${rel}/`, rule: 'folders', message: `"${entry.name}" is not a src/ folder`, fix: `Use one of ${srcFolders.join(', ')} (components go to src/ui or a feature's components/, hooks next to their feature); a new top-level folder is an architecture decision: stop and ask, then record it in srcFolders.` });
      }
    } else if (/\.css$/.test(entry.name)) {
      report.problem({ file: rel, rule: 'folders', message: 'a stylesheet directly in src/', fix: `A web stylesheet belongs to the theme: move it to ${L.themeDir}/${entry.name} and import it from the theme module (the SDK 57 template ships src/global.css, imported by its theme); a CSS module sits beside its component.` });
    } else if (!srcFiles.includes(entry.name)) {
      report.problem({ file: rel, rule: 'folders', message: 'a file directly in src/', fix: `Put it in its folder (src/features/<feature>/, src/ui/, src/services/<concern>/, ...); only ${srcFiles.join(', ')} sit at the top.` });
    }
  }
  for (const entry of entriesOf(join(root, L.servicesDir))) {
    const rel = `${L.servicesDir}/${entry.name}`;
    if (entry.isFile() && CODE_FILE.test(entry.name) && !TEST_NAME.test(entry.name) && !arch.isCompositionRoot(rel)) {
      report.problem({ file: rel, rule: 'folders', message: 'a file directly in src/services/ that is not the composition root', fix: 'Services live in src/services/<concern>/ (port, adapter, fake); only the composition root (services-context.tsx, create-device-services.ts, create-test-services.ts) sits at the top.' });
    }
  }
  checkScriptsFolder(root, L.scriptsDir, report);
}

function checkScriptsFolder(root, scriptsDir, report) {
  for (const entry of entriesOf(join(root, scriptsDir))) {
    const rel = `${scriptsDir}/${entry.name}`;
    if (entry.isDirectory() && !KEBAB.test(entry.name)) {
      report.problem({ file: `${rel}/`, rule: 'folders', message: `scripts area "${entry.name}" is not a kebab-case noun`, fix: 'Name areas like quality, release, i18n, data: scripts/<area>/<verb>-<noun>.ts.' });
    } else if (entry.isFile() && CODE_FILE.test(entry.name)) {
      report.problem({ file: rel, rule: 'folders', message: 'a script directly in scripts/', fix: 'Scripts live in an area folder: scripts/<area>/<verb>-<noun>.ts (scripts/package.json stays at the top).' });
    }
  }
}

function checkPorts(root, servicesDir, report) {
  for (const folder of entriesOf(join(root, servicesDir)).filter((entry) => entry.isDirectory())) {
    const concern = folder.name;
    const dir = `${servicesDir}/${concern}`;
    const files = entriesOf(join(root, dir)).filter((entry) => entry.isFile()).map((entry) => entry.name);
    const adapters = files.filter((name) => ADAPTER_NAME.test(name) && !TEST_NAME.test(name));
    if (adapters.length === 0) continue;
    if (!files.includes(`${concern}-port.ts`)) {
      report.problem({ file: `${dir}/`, rule: 'port-triple', message: `has an adapter (${adapters[0]}) but no port file (${concern}-port.ts)`, fix: `Write the vendor-neutral port type first, in ${dir}/${concern}-port.ts.` });
    }
    const fakes = files.filter((name) => /^fake-[a-z0-9-]+\.tsx?$/.test(name) && !TEST_NAME.test(name));
    if (fakes.length === 0) {
      report.problem({ file: `${dir}/`, rule: 'port-triple', message: `has an adapter (${adapters[0]}) but no fake-<concern>.ts`, fix: 'Write the in-memory fake (createFake<Port>) so tests never touch the SDK.' });
    }
    for (const fake of fakes) {
      const stem = fake.replace(/\.tsx?$/, '');
      if (!files.includes(`${stem}.test.ts`) && !files.includes(`${stem}.test.tsx`)) {
        report.problem({ file: `${dir}/${fake}`, rule: 'port-triple', message: `the fake has no test (${stem}.test.ts)`, fix: 'Test the fake like any unit: every test that passes it relies on it behaving like the port.' });
      }
    }
  }
}

/**
 * Where a test found in the routes folder goes: the placement unit-and-component-tests teaches (its
 * check-test-setup `test-in-routes` fix says the same), with the app's own features folder.
 */
function routeTestFix(featuresDir) {
  return (
    `A screen or model test goes next to its unit in ${featuresDir}/<feature>/; a route test (a link, a deep link, a redirect, back) ` +
    `goes to ${featuresDir}/<feature>/<feature>-navigation.test.tsx and renders the route files' default exports with ` +
    'renderRouterWithProviders (@test/render-router-with-providers, unit-and-component-tests), never Expo Router\'s renderRouter; ' +
    'a shared test helper goes to test/. The route file needs no test beside it: that route test covers it, or it carries ' +
    '"// device-only: covered by <flow>".'
  );
}

function checkRouteFile(root, rel, featuresDir, report) {
  const name = basename(rel);
  // API routes and the router's special files export named handlers, not a component.
  if (/\+api\.[cm]?[jt]sx?$/.test(name) || /^\+(middleware|native-intent)\.[cm]?[jt]sx?$/.test(name)) return;
  const bundled = 'Expo Router bundles every .ts/.tsx/.js file in the routes folder as a route (verified on SDK 57: a test file and a helper there shipped in the production bundle).';
  if (TEST_NAME.test(name)) {
    report.problem({ file: rel, rule: 'route-file', message: 'a test inside the routes folder', fix: `${bundled} ${routeTestFix(featuresDir)}` });
  } else if (/(^|\/)__tests__\//.test(rel)) {
    report.problem({ file: rel, rule: 'route-file', message: 'a test helper inside the routes folder (__tests__/)', fix: `${bundled} ${routeTestFix(featuresDir)}` });
  } else if (/-screen\.tsx?$|^use-[a-z0-9-]+\.tsx?$|-(store|model|selectors|reducer)\.tsx?$/.test(name)) {
    report.problem({ file: rel, rule: 'route-file', message: 'a screen, hook or store file inside the routes folder', fix: `${bundled} Move it to src/features/<feature>/ and keep only the thin route file here.` });
  } else {
    const { code } = scanSource(readFileSync(join(root, rel), 'utf8'));
    // export default X · export { X as default } [from '...'] · export { default } from '...'
    if (!/(^|[\s;}])export\s+default\b/.test(code) && !/(^|[\s;}])export\s*\{[^}]*\bdefault\b[^}]*\}/.test(code)) {
      report.problem({ file: rel, rule: 'route-file', message: 'no default export', fix: `${bundled} A route default-exports its component; a helper belongs in src/features/ or src/ui/.` });
    }
  }
}

function checkPlacement(root, arch, rel, report) {
  const info = arch.classify(rel);
  if (info.zone === 'outside' || info.zone === 'node' || info.zone === 'test-helpers' || info.zone === 'mocks') return null;
  const L = info.scope.layout;
  const name = basename(rel);
  const isTest = TEST_NAME.test(name);
  const inTestOnly = arch.isInTestOnlyFolder(rel);
  const text = readFileSync(join(root, rel), 'utf8');
  const bad = (message, fix) => report.problem({ file: rel, rule: 'placement', message, fix });
  const servicesDir = info.zone === 'package' ? `${info.scope.dir}/src/services` : L.servicesDir;
  if (/-screen\.tsx$/.test(name) && info.zone !== 'routes' && info.zone !== 'features' && !inTestOnly && !arch.anyGlob(rel, arch.settings.nonFeatureScreens)) {
    bad('a screen outside src/features/<feature>/', 'Screens live in src/features/<feature>/<feature>-screen.tsx with their use-<feature>-model.ts; the route in src/app renders them.');
  }
  const isPortish = ADAPTER_NAME.test(name) || /-port\.tsx?$/.test(name) || /^fake-/.test(name);
  const inConcernFolder = new RegExp(`^${servicesDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/[^/]+$`).test(rel);
  if (isPortish && !isTest && !inTestOnly && !inConcernFolder && !under(rel, L.dataDir)) {
    bad('a port, adapter or fake outside src/services/<concern>/', 'A port, its adapters and its fake live together in src/services/<concern>/; the data layer keeps its own driver and repository ports, adapters and fakes in src/data/.');
  }
  // A port, adapter or fake of a concern that ends in "store" (fake-secure-store.ts, expo-secure-store-adapter.ts) is a service file, not a store.
  const isServiceFile = /^fake-|-port\.tsx?$|-adapter\.tsx?$/.test(name);
  if (/-(store|selectors)\.tsx?$/.test(name) && !isServiceFile && !isTest && !inTestOnly && !under(rel, L.storesDir) && !under(rel, L.dataDir) && info.zone !== 'package' && !isOsMirror(text)) {
    bad('a store outside src/stores/', 'Stores and their selectors live in src/stores/ (a big domain gets src/stores/<domain>/); features read them through their model hook. Only an OS mirror (a vanilla store with a plain initial state, fed by a platform listener, like src/ui/a11y/system-a11y-store.ts) sits beside the code it serves.');
  }
  if (/-reducer\.tsx?$/.test(name) && !isTest && !under(rel, L.storesDir) && info.zone !== 'games' && info.zone !== 'package') {
    bad('a reducer outside src/stores/', 'Reducers are pure functions next to their store in src/stores/ (game rules use their own engine in src/games/<game>/rules/).');
  }
  if (/from\s+['"](expo\/config-plugins(\.js)?|@expo\/config-plugins)['"]/.test(text)) {
    bad('a config plugin outside plugins/', 'Local Expo config plugins are Node code: plugins/with-<capability>.ts (default export), named by path in app.config.ts.');
  }
  if (isTest && info.isBundled && /from\s+['"]node:/.test(text)) {
    bad('a test that needs Node APIs inside src/', 'Move it to test/integration/<area>/ (the root program has Node types; src/ is the app program).');
  }
  return info;
}

// Work that must never happen when a module is imported: a reload re-runs every module.
const IMPORT_TIME_HAZARDS = [
  { pattern: /\b(openDatabaseSync|openDatabaseAsync)\s*\(/, what: 'opens a database' },
  { pattern: /\bnew\s+AudioContext\s*\(/, what: 'creates an AudioContext' },
  { pattern: /\bcreate[A-Z][\w$]*(Adapter|SqlDriver|SaveStore|Repository)\s*\(/, what: 'creates an adapter' },
  { pattern: /\bcreate[A-Z][\w$]*Services\s*\(/, what: 'builds the services (the composition root)' },
  // A project store factory (createTasksStore, createStores) called at module level is a global store.
  { pattern: /\bcreate(?![\w$]*SaveStores?\s*\()[A-Z][\w$]*Stores?\s*\(/, what: 'creates a store through a factory' },
  { pattern: /\breloadAppAsync\s*\(/, what: 'reloads the app' },
  { pattern: /\bI18nManager\.(forceRTL|allowRTL|swapLeftAndRightInRTL)\s*\(/, what: 'switches the layout direction' },
];
const GENERIC = '(?:<(?:[^<>]|<[^<>]*>)*>)?';
// A hook store (create from 'zustand') at module level is always a global store.
const ZUSTAND_HOOK_IMPORT = /import\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*['"]zustand['"]/;
const ZUSTAND_HOOK_CREATE = { pattern: new RegExp(`(?<![\\w$.])create\\s*${GENERIC}\\s*\\(`), what: 'creates a global zustand store' };
// A vanilla store at module level too, unless it is an OS mirror (see isOsMirror).
const ZUSTAND_VANILLA_IMPORT = /import\s*\{[^}]*\bcreateStore\b[^}]*\}\s*from\s*['"]zustand(\/vanilla)?['"]/;
const ZUSTAND_VANILLA_CREATE = { pattern: new RegExp(`(?<![\\w$.])createStore\\s*${GENERIC}\\s*\\(`), what: 'creates a global zustand store', vanilla: true };
// createStore<T>()(() => ({ isOn: false })) or createStore(() => ({ isOn: false })): no calls, no nesting.
const PLAIN_VANILLA_STORE = new RegExp(`(?<![\\w$.])createStore\\s*${GENERIC}\\s*\\(\\s*(?:\\)\\s*\\(\\s*)?\\(\\s*\\)\\s*=>\\s*\\(\\s*\\{[^{}()]*\\}\\s*\\)\\s*\\)`);
const PLATFORM_LISTENER = /\.(addEventListener|addListener|addChangeListener)\s*\(/;

/**
 * An OS mirror: one module-level vanilla store whose initial state is a plain object literal, in a file
 * that subscribes to a platform event, the way accessibility-as-code's src/ui/a11y/system-a11y-store.ts
 * mirrors the screen reader and reduce-motion switches. The OS state is global already, so the store
 * may be too, and it may live beside the code it serves.
 */
function isOsMirror(source) {
  const { code } = scanSource(source);
  return ZUSTAND_VANILLA_IMPORT.test(source) && PLAIN_VANILLA_STORE.test(code) && PLATFORM_LISTENER.test(code);
}

// A line that ends with one of these continues on the next line: an arrow, a binary operator, a comma,
// a dot, an open generic. A closing ">" ends a type (Promise<void>), and "!" is a non-null assertion.
const CONTINUES_AFTER = /(?:=>|[=+\-*/%&|^<?:,.])$/;
// A line that starts with one of these continues the line before (ASI does not end the statement).
const CONTINUES_BEFORE = /^(?:[.?=+\-*/%&|^<>,:`([]|(?:as|satisfies|instanceof|in|else|catch|finally)\b)/;

/**
 * The top-level statements of masked code (comments and string contents blanked), with their start
 * index. A statement ends at a semicolon outside brackets, or, in code written without semicolons
 * (Prettier "semi": false, standard style), at a newline outside brackets where the next line starts a
 * new statement: the same automatic semicolon insertion the parser applies, so every formatting style
 * splits the same way.
 */
function topLevelStatements(code) {
  const out = [];
  let depth = 0;
  let start = 0;
  const push = (end) => {
    if (code.slice(start, end).trim() !== '') out.push({ index: start, text: code.slice(start, end) });
    start = end;
  };
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    if (c === ';') {
      push(i + 1);
    } else if (c === '\n') {
      const before = code.slice(start, i).trimEnd();
      if (before.trim() === '') continue;
      const after = code.slice(i + 1).trimStart();
      if (after === '') continue;
      if (!CONTINUES_AFTER.test(before) && !CONTINUES_BEFORE.test(after)) push(i + 1);
    }
  }
  push(code.length);
  return out;
}

function checkImportTimeWork(root, arch, rel, report) {
  const info = arch.classify(rel);
  if (!info.isRuntime || arch.anyGlob(rel, arch.settings.importTimeExempt)) return;
  const source = readFileSync(join(root, rel), 'utf8');
  const { code, lineOf } = scanSource(source);
  const hazards = [...IMPORT_TIME_HAZARDS];
  if (ZUSTAND_HOOK_IMPORT.test(source)) hazards.push(ZUSTAND_HOOK_CREATE);
  if (ZUSTAND_VANILLA_IMPORT.test(source)) hazards.push(ZUSTAND_VANILLA_CREATE);
  const mirror = isOsMirror(source);
  for (const statement of topLevelStatements(code)) {
    const body = statement.text.trimStart();
    if (/^(import|export\s+(type|\{|\*)|type\s|interface\s|declare\s)/.test(body) || /^(export\s+)?(default\s+)?(async\s+)?function\b/.test(body)) continue;
    for (const hazard of hazards) {
      const match = hazard.pattern.exec(body);
      if (hazard.vanilla && mirror && PLAIN_VANILLA_STORE.test(body)) continue;
      if (match && !/=>|\bfunction\b/.test(body.slice(0, match.index))) {
        const at = statement.index + (statement.text.length - body.length) + match.index;
        report.problem({ file: rel, line: lineOf(at), rule: 'import-time-work', message: `module-level code ${hazard.what} (${match[0].trim()})`, fix: 'Do it inside a factory the composition root calls (createDeviceServices, the stores factory) and hand the result down through ServicesProvider; a reload re-runs every module, so module-level work runs twice.' });
      }
    }
  }
}

function checkCompositionRoot(root, arch, scope, files, report) {
  const adapters = files.filter((rel) => arch.isAdapter(rel) && arch.scopeOf(rel) === scope);
  // The data layer's device opener composes its own driver; it is not the root that creates the services.
  const roots = files.filter((rel) => arch.scopeOf(rel) === scope && arch.isCompositionRoot(rel) && !under(rel, scope.layout.dataDir) && !/services-context\.tsx?$/.test(rel) && !/create-test-[a-z0-9-]*\.tsx?$/.test(rel));
  if (adapters.length > 0 && roots.length === 0) {
    report.problem({ file: `${scope.layout.servicesDir}/create-device-services.ts`, rule: 'composition-root', message: `the app has adapters (${adapters[0]}) but no composition root creates them`, fix: 'Copy the skill\'s create-device-services.ts and services-context.tsx: one factory creates every adapter once, the root layout calls it once, and ServicesProvider hands the ports down.' });
  }
  const factory = files.find((rel) => arch.scopeOf(rel) === scope && arch.isDeviceServicesFactory(rel));
  if (factory) checkRootMount(root, arch, scope, factory, report);
}

const IMPORT_DECLARATION = /(^|[;\n])\s*(import|export)\b[^;'"`]*?\bfrom\s*(['"])[^'"\n]*\3/g;
const FACTORY_NAME = 'createDeviceServices';

/** Indexes where `name` is used in masked code, import and re-export declarations left out. */
function usesOf(code, name) {
  const body = code.replace(IMPORT_DECLARATION, (whole) => ' '.repeat(whole.length));
  return [...body.matchAll(new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g'))].map((match) => match.index);
}

/**
 * Is the use at `index` evaluated once, as React's lazy state initializer? useState(createDeviceServices),
 * useState(() => createDeviceServices()), or a helper whose name useState receives the same way.
 * useState(createDeviceServices()) and useRef(createDeviceServices()) run the factory on every render.
 */
function isLazyInitializer(scan, index, name) {
  const lazyIn = (call, at, length) => {
    if (!(at > call.open && at < call.close)) return false;
    const between = scan.code.slice(call.open + 1, at);
    const after = scan.code.slice(at + length).trimStart();
    return /=>|\bfunction\b/.test(between) || !after.startsWith('(');
  };
  const initializers = findCalls(scan.code, 'useState');
  if (initializers.some((call) => lazyIn(call, index, name.length))) return true;
  const helper = functionsOf(scan)
    .filter((fn) => fn.bodyStart !== -1 && fn.bodyStart < index && index < fn.bodyEnd && fn.name !== '(anonymous)')
    .sort((a, b) => b.bodyStart - a.bodyStart)[0];
  if (!helper || /^[A-Z]/.test(helper.name)) return false;
  return usesOf(scan.code, helper.name).some((at) => initializers.some((call) => lazyIn(call, at, helper.name.length)));
}

/** The innermost named function whose block body holds `index`, or null (module level, an expression body). */
function enclosingFunction(scan, index) {
  return functionsOf(scan)
    .filter((fn) => fn.bodyStart !== -1 && fn.bodyStart < index && index < fn.bodyEnd && fn.name !== '(anonymous)')
    .sort((a, b) => b.bodyStart - a.bodyStart)[0] ?? null;
}

/** Local names under which a file imports the exports of `targetRel`: Map<exported name | 'default', local>. */
function bindingsFrom(root, arch, fromRel, scan, targetRel) {
  const out = new Map();
  for (const match of scan.codeKeep.matchAll(/(?<![\w$.])import\s+(?!type\s)([^;'"`]*?)\s*from\s*(['"])([^'"\n]*)\2/g)) {
    const target = resolveImport(fromRel, match[3], { root, aliases: arch.aliasesFor(fromRel) });
    if (target.kind !== 'local' || target.path !== targetRel) continue;
    const clause = match[1];
    for (const part of /\{([^}]*)\}/.exec(clause)?.[1].split(',') ?? []) {
      const name = part.trim();
      if (name === '' || /^type\s/.test(name)) continue;
      const [imported, local] = name.split(/\s+as\s+/);
      out.set(imported.trim(), (local ?? imported).trim());
    }
    const def = /^\s*([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause.replace(/\{[^}]*\}/, ' '));
    if (def) out.set('default', def[1]);
  }
  return out;
}

/** Uses of `name` in a file that call or pass it, its own declaration and export lists left out. */
function referencesOf(code, name) {
  return usesOf(code, name).filter((at) => {
    const before = code.slice(Math.max(0, at - 200), at);
    return !/\b(function\s*\*?|const|let|var)\s*$/.test(before) && !/\bexport\s*\{[^}]*$/.test(before);
  });
}

/**
 * The root layout reaches createDeviceServices through a startup file it imports (src/startup/start-app.ts
 * recorded in compositionRoot): the factory runs once only if every path to it ends in a useState
 * initializer, inside that file (a component or hook that mounts it) or in the layout, which then passes
 * the helper lazily, useState(startApp), as it would a helper of its own.
 */
function checkHelperMount({ layoutFile, scan, helper, fix, root, arch }, report) {
  const bindings = bindingsFrom(root, arch, layoutFile, scan, helper.rel);
  const visited = new Set();
  const visit = (name, at) => {
    if (visited.has(name)) return;
    visited.add(name);
    // A component that calls the factory in its body builds fresh adapters on each of its renders.
    if (/^[A-Z]/.test(name)) {
      report.problem({ file: helper.rel, line: helper.scan.lineOf(at), rule: 'composition-root', message: `${name} calls ${FACTORY_NAME}() outside a useState initializer, so every render builds fresh adapters`, fix });
      return;
    }
    const isDefault = new RegExp(`\\bexport\\s+default\\s+(?:async\\s+)?(?:function\\s*\\*?\\s*)?${name}\\b`).test(helper.scan.code);
    const local = bindings.get(name) ?? (isDefault ? bindings.get('default') : undefined);
    if (local !== undefined) {
      for (const use of usesOf(scan.code, local)) {
        if (!isLazyInitializer(scan, use, local)) {
          report.problem({ file: layoutFile, line: scan.lineOf(use), rule: 'composition-root', message: `the root layout calls ${local}() outside a useState initializer, and it calls ${FACTORY_NAME}() (${helper.rel}), so every render builds fresh adapters`, fix: `Pass the startup helper to a lazy state initializer: const [app] = useState(${local}); (or useState(() => ${local}())). ${fix}` });
        }
      }
      return;
    }
    for (const use of referencesOf(helper.scan.code, name)) {
      if (isLazyInitializer(helper.scan, use, name)) continue;
      const caller = enclosingFunction(helper.scan, use);
      if (caller) visit(caller.name, use);
    }
  };
  for (const index of usesOf(helper.scan.code, FACTORY_NAME)) {
    // Mounted inside the startup file (a component or hook with useState(createDeviceServices)): fine.
    if (isLazyInitializer(helper.scan, index, FACTORY_NAME)) continue;
    // Module level: import-time-work reports it.
    const fn = enclosingFunction(helper.scan, index);
    if (fn) visit(fn.name, index);
  }
}

/**
 * Once create-device-services.ts exists, the root layout mounts it: it (or a startup file it imports)
 * calls createDeviceServices in a useState initializer, and renders <ServicesProvider>.
 */
function checkRootMount(root, arch, scope, factory, report) {
  const L = scope.layout;
  const layoutFile = ['tsx', 'ts', 'jsx', 'js'].map((ext) => `${L.routesDir}/_layout.${ext}`).find((rel) => existsSync(join(root, rel)));
  // No root layout: app-files reports it when the app uses Expo Router; React Navigation mounts elsewhere.
  if (!layoutFile) return;
  const scan = scanSource(readFileSync(join(root, layoutFile), 'utf8'));
  const imported = importsOf(scan)
    .map((entry) => resolveImport(layoutFile, entry.spec, { root, aliases: arch.aliasesFor(layoutFile) }))
    .filter((target) => target.kind === 'local' && target.exists && CODE_FILE.test(target.path) && target.path !== factory)
    .map((target) => ({ rel: target.path, scan: scanSource(readFileSync(join(root, target.path), 'utf8')) }));
  const fix = `Mount the composition root in ${layoutFile}: const [services] = useState(${FACTORY_NAME}); then wrap the navigator in <ServicesProvider services={services}> (the skill's examples/root-layout.tsx). A useState initializer runs once; a call in the component body builds fresh adapters on every render.`;
  const uses = usesOf(scan.code, FACTORY_NAME);
  if (uses.length > 0) {
    for (const index of uses) {
      if (!isLazyInitializer(scan, index, FACTORY_NAME)) {
        report.problem({ file: layoutFile, line: scan.lineOf(index), rule: 'composition-root', message: `the root layout calls ${FACTORY_NAME}() outside a useState initializer, so every render builds fresh adapters`, fix });
      }
    }
  } else {
    const helpers = imported.filter((file) => usesOf(file.scan.code, FACTORY_NAME).length > 0);
    if (helpers.length === 0) {
      report.problem({ file: layoutFile, line: 1, rule: 'composition-root', message: `the root layout never calls ${FACTORY_NAME}() (${factory} exists)`, fix });
    }
    for (const helper of helpers) checkHelperMount({ layoutFile, scan, helper, fix, root, arch }, report);
  }
  const rendersProvider = (file) => /<ServicesProvider\b/.test(file.scan.code);
  if (!rendersProvider({ scan }) && !imported.some(rendersProvider)) {
    report.problem({ file: layoutFile, line: 1, rule: 'composition-root', message: 'the root layout never renders <ServicesProvider>, so useServices() throws in every screen', fix });
  }
}

/** The entry's top-level statements as one-line text (strings kept), with or without semicolons. */
function statementsOf(text) {
  const { code, codeKeep } = scanSource(text);
  return topLevelStatements(code)
    .map(({ index, text: part }) => codeKeep.slice(index, index + part.length).replace(/;\s*$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function checkAppEntry(root, scope, report, { isWorkspace }) {
  const manifestFile = prefixed(scope.dir, 'package.json');
  const manifest = scope.manifest ?? {};
  const deps = { ...(manifest.dependencies ?? {}) };
  const hasRouter = deps['expo-router'] !== undefined;
  const main = manifest.main;
  if (main === undefined) {
    if (!isWorkspace) report.problem({ file: manifestFile, line: 1, rule: 'app-entry', message: 'no "main"', fix: hasRouter ? 'Set "main": "expo-router/entry" (or a thin index.ts that imports the polyfills, then expo-router/entry).' : 'Set "main" to the thin entry file (index.ts: imports, then registerRootComponent(App)).' });
    return;
  }
  if (main === 'expo-router/entry') {
    if (!hasRouter) report.problem({ file: manifestFile, line: 1, rule: 'app-entry', message: 'main is expo-router/entry but expo-router is not a dependency', fix: 'Install expo-router (npx expo install expo-router) or point main at the entry file.' });
    return;
  }
  const base = prefixed(scope.dir, main.replace(/^\.\//, ''));
  const entry = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find((candidate) => existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile());
  if (!entry) {
    report.problem({ file: manifestFile, line: 1, rule: 'app-entry', message: `main "${main}" points to no file`, fix: 'Point main at the entry file, or use expo-router/entry.' });
    return;
  }
  const parts = statementsOf(readFileSync(join(root, entry), 'utf8'));
  const extra = parts.filter((part) => !/^import\b/.test(part) && !/^registerRootComponent\(\w+\)$/.test(part));
  const registers = parts.filter((part) => /^registerRootComponent\(/.test(part));
  if (extra.length > 0 || registers.length > 1) {
    report.problem({ file: entry, line: 1, rule: 'app-entry', message: `the entry does more than import (${(extra[0] ?? registers[1]).slice(0, 60)})`, fix: 'Keep the entry thin: imports only (polyfills first), then expo-router/entry or one registerRootComponent(App); startup work belongs in the root layout and the composition root.' });
  } else if (hasRouter && !parts.some((part) => /^import ['"]expo-router\/entry['"]$/.test(part))) {
    report.problem({ file: entry, line: 1, rule: 'app-entry', message: 'the entry never loads expo-router/entry', fix: 'End the entry with import \'expo-router/entry\'; (or set "main": "expo-router/entry").' });
  }
}

const JEST_CONFIGS = ['jest.config.js', 'jest.config.ts', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json'];
const CATCH_ALL_MAPPER = /^\^?@\/\(\.\*\)\$?$/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The "@/..." keys of the app's Jest moduleNameMapper, in source order (Jest takes the first pattern
 * that matches): { file, entries: [{ key, target, line }], jestExpo }, or null when the app has no Jest
 * config. `jestExpo`: the config names a jest-expo preset, which adds the tsconfig.json paths.
 */
function jestAliasMappers(root, scope) {
  for (const name of JEST_CONFIGS) {
    const file = prefixed(scope.dir, name);
    if (!existsSync(join(root, file))) continue;
    const { codeKeep, lineOf } = scanSource(readFileSync(join(root, file), 'utf8'));
    const entries = [...codeKeep.matchAll(/(['"`])(\^?@\/[^'"`\n]*)\1\s*:\s*(['"`])([^'"`\n]*)\3/g)].map((m) => ({ key: m[2], target: m[4], line: lineOf(m.index) }));
    return { file, entries, jestExpo: /(['"`])jest-expo(\/[\w-]+)?\1/.test(codeKeep) };
  }
  const jest = scope.manifest?.jest;
  if (jest && typeof jest === 'object') {
    const mapper = jest.moduleNameMapper && typeof jest.moduleNameMapper === 'object' ? jest.moduleNameMapper : {};
    const entries = Object.entries(mapper).filter(([key]) => /^\^?@\//.test(key)).map(([key, target]) => ({ key, target: String(target), line: 1 }));
    return { file: prefixed(scope.dir, 'package.json'), entries, jestExpo: /^jest-expo(\/[\w-]+)?$/.test(String(jest.preset ?? '')) };
  }
  return null;
}

/** The keys of tsconfig.json compilerOptions.paths in declaration order (the file itself, as jest-expo reads it). */
function tsconfigPathKeys(root, file) {
  try {
    const text = readFileSync(join(root, file), 'utf8');
    const paths = parseJsonc(text)?.compilerOptions?.paths;
    if (!paths || typeof paths !== 'object') return null;
    return Object.keys(paths).map((key) => ({ key, line: text.slice(0, Math.max(0, text.indexOf(JSON.stringify(key)))).split('\n').length }));
  } catch {
    return null;
  }
}

/**
 * jest-expo 57 (src/preset/withTypescriptMapping.js) turns tsconfig.json paths into moduleNameMapper
 * entries in declaration order, and Jest puts the config's own keys first: with no "@/" mapping in the
 * config, a folder alias listed after "@/*" in tsconfig.json never wins in Jest.
 */
function checkDerivedJestAliases(root, scope, wanted, report) {
  const tsconfig = prefixed(scope.dir, 'tsconfig.json');
  const keys = tsconfigPathKeys(root, tsconfig);
  if (keys === null) return;
  const catchAll = keys.findIndex((entry) => entry.key === '@/*');
  if (catchAll === -1) return;
  for (const alias of wanted) {
    const index = keys.findIndex((entry) => entry.key === `${alias.prefix}*`);
    if (index === -1 || index < catchAll) continue;
    report.problem({ file: tsconfig, line: keys[index].line, rule: 'app-files', message: `paths lists "${alias.prefix}*" after "@/*", and the Jest config has no "@/" mapping of its own`, fix: `List "${alias.prefix}*" before "@/*" in tsconfig.json paths: jest-expo 57 builds moduleNameMapper from them in that order and Jest takes the first pattern that matches, so ${alias.prefix}... resolves into ${scope.layout.srcDir}/ and the test fails with "Could not locate module ... mapped as"; TypeScript and Metro pick the longest prefix, so the order is harmless there. (Or spell the mappings out in the Jest config, '^${alias.prefix}(.*)$' before '^@/(.*)$'.)` });
  }
}

/**
 * A folder alias next to "@/*" ("@/assets/*" -> assets/, "@/modules/*" -> modules/) must be mapped in
 * jest.config.js before the "@/" catch-all, or Jest maps @/assets/images/icon.png into src/ and the
 * test fails with "Could not locate module ... mapped as <rootDir>/src/$1" while tsc, Metro and the checkers pass.
 */
function checkJestAliases(root, scope, files, report) {
  const L = scope.layout;
  const appRel = (target) => target.replace(/\*$/, '').replace(scope.dir === '' ? /^/ : new RegExp(`^${escapeRegExp(scope.dir)}/`), '');
  const wanted = L.aliases
    .filter((alias) => /^@\/[^*]+\/\*$/.test(alias.pattern) && alias.targets.length > 0)
    .map((alias) => ({ prefix: alias.pattern.slice(0, -1), folder: appRel(alias.targets[0]) }));
  if (!wanted.some((alias) => alias.prefix === '@/assets/')) {
    const requiresAssets = files.some((rel) => under(rel, L.srcDir) && /(['"`])@\/assets\//.test(readFileSync(join(root, rel), 'utf8')));
    if (requiresAssets) wanted.push({ prefix: '@/assets/', folder: 'assets/' });
  }
  if (wanted.length === 0) return;
  const jest = jestAliasMappers(root, scope);
  if (!jest) return;
  const catchAll = jest.entries.findIndex((entry) => CATCH_ALL_MAPPER.test(entry.key));
  if (catchAll === -1) {
    // No "@/" catch-all of its own: the order comes from tsconfig.json paths (jest-expo), unless the
    // config maps the folder itself (any "@/" key is then ahead of the derived ones).
    const ownPrefixes = jest.entries.map((entry) => entry.key.replace(/^\^/, ''));
    const unmapped = wanted.filter((alias) => !ownPrefixes.some((key) => key.startsWith(alias.prefix)));
    if (jest.jestExpo) checkDerivedJestAliases(root, scope, unmapped, report);
    return;
  }
  const catchAllEntry = jest.entries[catchAll];
  for (const alias of wanted) {
    const keyPattern = new RegExp(`^\\^?${escapeRegExp(alias.prefix)}`);
    const index = jest.entries.findIndex((entry) => keyPattern.test(entry.key));
    const want = `'^${alias.prefix}(.*)$': '<rootDir>/${alias.folder}$1'`;
    const why = `Jest takes the first moduleNameMapper pattern that matches, so ${alias.prefix}... otherwise maps into src/ and the test fails with "Could not locate module ... mapped as <rootDir>/src/$1" while tsc, Metro and the checkers pass.`;
    if (index === -1) {
      report.problem({ file: jest.file, line: catchAllEntry.line, rule: 'app-files', message: `moduleNameMapper has no '^${alias.prefix}(.*)$' mapping before '${catchAllEntry.key}' (tsconfig.json maps ${alias.prefix}* to ${alias.folder}*)`, fix: `Add ${want} before '${catchAllEntry.key}'. ${why}` });
    } else if (index > catchAll) {
      report.problem({ file: jest.file, line: jest.entries[index].line, rule: 'app-files', message: `moduleNameMapper lists '${jest.entries[index].key}' after the catch-all '${catchAllEntry.key}'`, fix: `Move ${want} before '${catchAllEntry.key}'. ${why}` });
    } else if (!jest.entries[index].target.includes(alias.folder)) {
      report.problem({ file: jest.file, line: jest.entries[index].line, rule: 'app-files', message: `moduleNameMapper maps '${jest.entries[index].key}' to ${jest.entries[index].target}, not ${alias.folder}`, fix: `Map ${want}, the folder tsconfig.json names.` });
    }
  }
}

function checkAppFiles(root, arch, scope, files, report) {
  const L = scope.layout;
  const tsconfig = prefixed(scope.dir, 'tsconfig.json');
  const alias = L.aliases.find((entry) => entry.pattern === '@/*');
  // The alias target as tsconfig.json (in the app folder) writes it: "./src/*", or "./lib/*" after a move.
  const srcFromApp = scope.dir === '' ? L.srcDir : L.srcDir.slice(scope.dir.length + 1);
  const want = `"paths": { "@/*": ["./${srcFromApp}/*"] }`;
  if (!existsSync(join(root, tsconfig))) {
    report.problem({ file: tsconfig, rule: 'app-files', message: 'tsconfig.json is missing', fix: `Add tsconfig.json with ${want} (the Expo template default, for the src/ folder).` });
  } else if (!alias || !alias.targets.includes(`${L.srcDir}/*`)) {
    report.problem({ file: tsconfig, line: 1, rule: 'app-files', message: `no "@/*" alias to ${L.srcDir}/*`, fix: `Add ${want}: every import outside the own folder uses @/ (no ../), and the Jest config maps the same alias.` });
  }
  const assetAlias = L.aliases.find((entry) => entry.pattern === '@/assets/*');
  const assetsDir = prefixed(scope.dir, 'assets');
  if (assetAlias && !assetAlias.targets.includes(`${assetsDir}/*`)) {
    report.problem({ file: tsconfig, line: 1, rule: 'app-files', message: `"@/assets/*" maps to ${assetAlias.targets.join(', ')}, not ${assetsDir}/*`, fix: 'Map "@/assets/*": ["./assets/*"] (the Expo template default): images, fonts and sounds live in assets/<kind>/ at the app root.' });
  }
  const hasRouter = (scope.manifest?.dependencies ?? {})['expo-router'] !== undefined;
  if (hasRouter && !['tsx', 'ts', 'jsx', 'js'].some((ext) => existsSync(join(root, `${L.routesDir}/_layout.${ext}`)))) {
    report.problem({ file: `${L.routesDir}/_layout.tsx`, rule: 'app-files', message: 'the root layout is missing', fix: `Add ${L.routesDir}/_layout.tsx: the root layout mounts the composition root (ServicesProvider) and the navigator.` });
  }
  checkJestAliases(root, scope, files.filter((rel) => arch.scopeOf(rel) === scope), report);
}

function checkOneReact(root, manifest, apps, report, { required }) {
  const overrides = manifest.overrides ?? {};
  for (const name of ['react', 'react-native']) {
    const appVersion = apps.map((app) => app.manifest?.dependencies?.[name]).find((version) => version !== undefined);
    if (overrides[name] === undefined) {
      if (required) report.problem({ file: 'package.json', line: 1, rule: 'one-react', message: `overrides.${name} is undefined, the apps use ${JSON.stringify(appVersion)}`, fix: `Set "overrides": { "${name}": "${appVersion ?? "<the apps' version>"}" }: without it npm installs a second copy at the root and Jest resolves it.` });
    } else if (appVersion !== undefined && overrides[name] !== appVersion) {
      report.problem({ file: 'package.json', line: 1, rule: 'one-react', message: `overrides.${name} is ${JSON.stringify(overrides[name])}, the app uses ${JSON.stringify(appVersion)}`, fix: `Change the override to "${appVersion}" in the same commit as the dependency (an SDK upgrade moves both); npm ls ${name} must show one version.` });
    }
  }
}

/** The workspace globs of the root package.json (a list, or { "packages": [...] }). */
function workspaceGlobs(manifest) {
  const value = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
  return Array.isArray(value) ? value : [];
}

/**
 * The root workspaces: apps/* and packages/*, plus the folder of every Node backend the contract records
 * outside packages/ ("functions"). Read from package.json, never assumed; an entry the contract does not
 * explain is a problem once the contract exists.
 */
function checkWorkspaces(arch, manifest, report) {
  const declared = workspaceGlobs(manifest);
  const backends = (arch.contract.data?.packages ?? []).map((entry) => entry.dir).filter((dir) => typeof dir === 'string' && !dir.startsWith('packages/'));
  const want = ['apps/*', 'packages/*', ...backends.filter((dir) => !dir.startsWith('apps/'))];
  const missing = want.filter((glob) => !declared.includes(glob));
  const extra = arch.contract.data === null ? [] : declared.filter((glob) => !want.includes(glob));
  if (missing.length > 0 || extra.length > 0) {
    report.problem({ file: 'package.json', line: 1, rule: 'workspaces', message: `workspaces is ${JSON.stringify(manifest.workspaces)}`, fix: `Set "workspaces": ${JSON.stringify(want)}: apps under apps/, shared packages under packages/, and each Node backend the contract records (packages[].dir) by its folder.` });
  }
  if (arch.contract.data === null) {
    report.problem({ file: arch.contract.rel, rule: 'workspaces', message: 'a multi-package repo has no architecture contract', fix: 'Copy the skill\'s templates/contracts/architecture.json and record every package under packages/ in "packages" (pure, world), and a Node backend outside packages/ with its "dir" and "world": "node".' });
    return;
  }
  for (const scope of arch.packageScopes) {
    if (scope.declared) continue;
    const record = scope.isBackend ? `{ "name": "${scope.name}", "dir": "${scope.dir}", "world": "node" } (a workspace outside packages/ that is no Expo app is a Node backend)` : `{ "name": "${scope.name}" } (pure, world)`;
    report.problem({ file: `${scope.dir}/`, rule: 'workspaces', message: `unexpected package "${scope.name}"`, fix: `Record it in ${arch.contract.rel} "packages" as ${record} (a new package is an architecture decision: stop and ask), or move the code into an existing package.` });
  }
}

function checkManifests(root, arch, report) {
  for (const scope of arch.packageScopes) {
    // A backend the contract does not record yet: the workspaces rule reports it, its world decides the rest.
    if (scope.isBackend && !scope.declared) continue;
    const manifest = scope.manifest ?? {};
    const file = `${scope.dir}/package.json`;
    if (manifest.type !== 'module') report.problem({ file, line: 1, rule: 'manifest', message: 'no "type": "module"', fix: 'Add "type": "module" so Node type-strips the package without MODULE_TYPELESS_PACKAGE_JSON.' });
    // A Node backend is imported by nothing: its "main" is the deploy bundle (lib/index.js), and it needs no exports map.
    if (scope.isBackend) {
      if (scope.declared.exports !== undefined && !same(manifest.exports, scope.declared.exports)) report.problem({ file, line: 1, rule: 'manifest', message: `exports is ${JSON.stringify(manifest.exports)}`, fix: `Set "exports": ${JSON.stringify(scope.declared.exports)}, the map the contract records.` });
      continue;
    }
    const want = scope.declared?.exports ?? { './*': './src/*' };
    if (!same(manifest.exports, want)) report.problem({ file, line: 1, rule: 'manifest', message: `exports is ${JSON.stringify(manifest.exports)}`, fix: `Set "exports": ${JSON.stringify(want)}; packages are consumed as TypeScript source, no build step, no barrel.` });
    if (manifest.main !== undefined) report.problem({ file, line: 1, rule: 'manifest', message: `"main": "${manifest.main}" (a barrel entry)`, fix: 'Remove "main"; importers name the file (@org/<package>/<path>).' });
  }
  for (const scope of arch.appScopes) {
    const manifest = scope.manifest ?? {};
    const file = `${scope.dir}/package.json`;
    if (manifest.main === undefined) report.problem({ file, line: 1, rule: 'manifest', message: 'main is undefined', fix: 'Set "main": "expo-router/entry" (or the thin index.ts entry).' });
    if (manifest.type === 'module' && existsSync(join(root, scope.dir, 'metro.config.js'))) report.problem({ file, line: 1, rule: 'manifest', message: '"type": "module" next to a CommonJS metro.config.js', fix: 'Remove "type" from the app (metro.config.js is CommonJS), or rename it metro.config.cjs.' });
  }
}

function checkNativeDeps(arch, report) {
  // A Node backend's peers are no app's native modules.
  const peers = new Set(arch.packageScopes.filter((scope) => !scope.isBackend).flatMap((scope) => Object.keys(scope.manifest?.peerDependencies ?? {})));
  const versions = new Map();
  const workspaceNames = new Set([...arch.packageScopes, ...arch.appScopes].map((scope) => scope.manifest?.name).filter(Boolean));
  for (const app of arch.appScopes) {
    const deps = app.manifest?.dependencies ?? {};
    for (const peer of [...peers].sort()) {
      if (deps[peer] === undefined) report.problem({ file: `${app.dir}/package.json`, line: 1, rule: 'native-deps', message: `lacks the package peer dependency ${peer}`, fix: 'Install it in every app (npx expo install inside the app): autolinking and expo install --check see only the app\'s own dependencies.' });
    }
    for (const [name, version] of Object.entries(deps)) {
      if (workspaceNames.has(name)) continue;
      if (!versions.has(name)) versions.set(name, new Map());
      versions.get(name).set(app.dir, version);
    }
  }
  for (const [name, byApp] of versions) {
    if (new Set(byApp.values()).size > 1) report.problem({ file: 'package.json', line: 1, rule: 'native-deps', message: `${name} has different versions across apps: ${[...byApp].map(([dir, v]) => `${dir} ${v}`).join(', ')}`, fix: 'Pin one version in every app; all apps upgrade in lockstep.' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${root} has no package.json`, 'Run from the app repo root, or pass it as the argument.');
  const arch = loadArchitecture(root, { contract: options.contract, overrides: { srcDir: options['src-dir'], routesDir: options['routes-dir'] } });
  const report = createReporter({ name: 'check-layout', json: options.json });
  if (arch.contract.data === null && arch.layout.mode === 'single') report.note(`note: no ${arch.contract.rel}; the default folders and globs apply`);
  const manifest = readJson(join(root, 'package.json'));
  const isMulti = arch.layout.mode === 'monorepo';
  const dependsOnExpo = (scopeManifest) => Boolean(scopeManifest?.dependencies?.expo ?? scopeManifest?.devDependencies?.expo);
  if (!arch.appScopes.some((scope) => dependsOnExpo(scope.manifest))) {
    return report.notApplicable(isMulti ? 'no workspace app depends on expo' : 'expo is not a dependency in package.json');
  }
  const files = walkRepo(root, { include: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx'] }).filter((rel) => arch.isCodePath(rel));
  if (isMulti) {
    checkWorkspaces(arch, manifest, report);
    checkManifests(root, arch, report);
    checkNativeDeps(arch, report);
    checkScriptsFolder(root, arch.layout.scriptsDir, report);
  }
  checkOneReact(root, manifest, isMulti ? arch.appScopes : [{ manifest }], report, { required: isMulti });
  for (const scope of arch.appScopes) {
    checkFolders(root, arch, scope, report);
    checkPorts(root, scope.layout.servicesDir, report);
    checkCompositionRoot(root, arch, scope, files, report);
    checkAppEntry(root, scope, report, { isWorkspace: isMulti });
    checkAppFiles(root, arch, scope, files, report);
  }
  for (const scope of arch.packageScopes) checkPorts(root, `${scope.dir}/src/services`, report);
  for (const rel of files) {
    const info = arch.classify(rel);
    // Every file in the routes folder is a route to Expo Router (server files are skipped inside).
    if (info.scope.kind === 'app' && under(rel, info.scope.layout.routesDir) && /\.[cm]?[jt]sx?$/.test(rel)) checkRouteFile(root, rel, info.scope.layout.featuresDir ?? 'src/features', report);
    if (!/\.(ts|tsx|mts|cts)$/.test(rel)) continue;
    checkPlacement(root, arch, rel, report);
    checkImportTimeWork(root, arch, rel, report);
  }
  return report.finish({ checked: files.length + arch.appScopes.length + arch.packageScopes.length, unit: 'files and manifests' });
});

