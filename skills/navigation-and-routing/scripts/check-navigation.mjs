#!/usr/bin/env node
// check-navigation.mjs: checks an Expo app's navigation against its route contract
// (contracts/navigation.json): the route files (Expo Router) or the static config (React Navigation 7)
// hold exactly the contract's routes, flows switch by guards, typed routes, params parsed at the edge,
// screens with unsaved work block removal, modals present as modals, going back never stacks a second
// home, navigation stays out of shared layers, debug routes stay gated, and placeholders never ship.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-navigation.mjs [repo-root] [--release]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import {
  UsageError,
  createReporter,
  lineOf,
  maskComments,
  parseArgs,
  parseJsonc,
  resolveLayout,
  run,
  toPosix,
  walk,
  walkRepo,
} from './check-lib.mjs';
import { callObjectArgument, childObject, extractBlock, topLevelEntries } from './lib/object-literal.mjs';
import { findClosing, findImports, findJsxTags, isTestFile, jsxAttributes, literalOf, maskCode, resolveImport } from './lib/source-scan.mjs';

const RULES = [
  ['contract', 'contracts/navigation.json exists and is well formed; its router matches package.json'],
  ['route-table', 'the route files (Expo Router) or the static config screens (React Navigation) are exactly the contract routes'],
  ['home-route', 'the contract home names a route (React Navigation: the first screen of its group)'],
  ['root-layout', 'Expo Router: the root _layout default-exports a component that renders the navigator (directly or through imported components)'],
  ['not-found', 'Expo Router: the routes folder has a +not-found route'],
  ['one-navigator', 'one router: no hand-built container or React Navigation import in an Expo Router app; one createStaticNavigation and no expo-router import in a React Navigation app'],
  ['static-container', 'React Navigation: the container is createStaticNavigation(...), never <NavigationContainer>'],
  ['native-stack', 'the native stack, not the JavaScript stack (expo-router/js-stack, @react-navigation/stack), unless the contract sets jsStack'],
  ['typed-routes', 'Expo Router: experiments.typedRoutes is true; React Navigation: the types file registers StaticParamList<typeof rootStack>'],
  ['href-cast', 'Expo Router: app code never casts an href (as Href); it uses a typed path or an object href'],
  ['flow-by-guard', 'flows switch by guards: no <Redirect> or navigation from an effect in a layout (Expo Router), no reset() (React Navigation)'],
  ['protected-guard', 'Expo Router: every Stack.Protected group equals a contract entry (file, guard, screens)'],
  ['group-if', 'React Navigation: the static config groups equal the contract groups (name, if hook, screens, order)'],
  ['guarded-prevent-remove', 'every contract guarded route has a hook file that blocks removal with usePreventRemove'],
  ['guarded-gesture-off', 'a guarded route with "gesture": "off" sets gestureEnabled: false and fullScreenGestureEnabled: false'],
  ['modal-presentation', 'exactly the contract modals set a modal presentation'],
  ['params-parsed', 'Expo Router: every dynamic route has a valibot parser file; no useLocalSearchParams<...>() type argument in app code'],
  ['params-serialisable', 'React Navigation: the params file holds plain data (no functions, Date, Map, Set, Promise)'],
  ['go-back', 'never navigate or push to the home route; go back with dismissTo/popTo or back'],
  ['nav-in-screens', 'shared layers (ui, stores, services, data, api, core) never import a router; a root kit (<services>/**/*-root-kit.tsx, app-startup-and-bootstrap\'s slots) routes its notification taps below the navigator and may'],
  ['debug-gated', 'debug routes render through TEST_ONLY and sit behind a guard'],
  ['placeholder-route', 'exactly the contract placeholders render the placeholder screen'],
  ['placeholder-release', '--release: no route renders the placeholder screen'],
  ['motion-transition', 'React Navigation: the static stack is wrapped with .with() and cross-fades under reduce motion'],
];

const SPEC = {
  name: 'check-navigation',
  summary:
    "Checks an Expo app's navigation against contracts/navigation.json: Expo Router route files and layouts " +
    '(or a React Navigation 7 static config), guards, typed routes and params, back handling, modals, debug routes and placeholders.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The route contract (default: <contractsDir>/navigation.json, or rn-skills.config.json "navigationContract")' },
    'routes-dir': { type: 'string', value: 'dir', help: 'Expo Router routes folder (default: from resolveLayout, src/app)' },
    release: { type: 'boolean', help: 'Ship gate: fail while any route renders the placeholder screen' },
    json: { type: 'boolean', help: 'Also print the problems as JSON before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'repo-root defaults to the current folder. NOT APPLICABLE when package.json has neither expo-router nor',
    '@react-navigation/native. When multi-package: run it once per app with the app folder as repo-root.',
    '',
    'Rules:',
    ...RULES.map(([id, text]) => `  ${id.padEnd(24)} ${text}`),
  ].join('\n'),
};

const SOURCE_GLOBS = ['*.ts', '*.tsx', '*.js', '*.jsx'];
const NAVIGATOR_TAG = /^(Stack|Tabs|Slot|Drawer|NativeTabs|JsStack|Navigator)$/;
const MODAL_PRESENTATION = /\bpresentation\s*:\s*['"](modal|formSheet|pageSheet|fullScreenModal|transparentModal|containedModal|containedTransparentModal)['"]/;
const SKIPPED_ROUTE_FILE = /^(\+html|\+native-intent|\+middleware)$/;
const CONTRACT_KEYS = new Set([
  '$schema', '$comment', 'router', 'home', 'routes', 'protected', 'groups', 'guarded', 'modals', 'paramParsers',
  'debugRoutes', 'placeholders', 'placeholderComponent', 'jsStack', 'navigatorFile', 'containerFile', 'typesFile', 'paramsFile',
]);
const RN_DEFAULTS = {
  navigatorFile: 'src/features/root-navigator/root-stack.tsx',
  containerFile: 'src/features/root-navigator/navigation-root.tsx',
  typesFile: 'src/features/root-navigator/react-navigation.d.ts',
  paramsFile: 'src/features/root-navigator/route-params.ts',
};
const CONTRACT_FIX = "Copy the skill's templates/contracts/navigation.json and list the app's routes (references/contract-and-checker.md).";

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (text) => text.replace(/\s+/g, '');

function makeContext(root, report) {
  const cache = new Map();
  return {
    root,
    report,
    checked: new Set(),
    /** { raw, comments (comments masked), masked (strings blanked too) } of a repo file, or null. */
    source(rel) {
      if (cache.has(rel)) return cache.get(rel);
      const abs = join(root, rel);
      let entry = null;
      if (isFile(abs)) {
        const raw = readFileSync(abs, 'utf8');
        entry = { raw, comments: maskComments(raw), masked: maskCode(raw) };
        this.checked.add(rel);
      }
      cache.set(rel, entry);
      return entry;
    },
    problem(file, line, rule, message, fix) {
      report.problem({ file, line, rule, message, fix });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------------

function readContract(ctx, rel) {
  const abs = join(ctx.root, rel);
  if (!isFile(abs)) {
    ctx.problem(rel, 1, 'contract', 'the route contract is missing: the checker cannot compare the routes with anything', CONTRACT_FIX);
    return null;
  }
  let data;
  try {
    data = parseJsonc(readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, 'Fix the JSON syntax (the schema is templates/contracts/navigation.schema.json).');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new UsageError(`${rel} must hold one JSON object`, 'Start from templates/contracts/navigation.json.');
  }
  const bad = (message) => ctx.problem(rel, 1, 'contract', message, 'Follow templates/contracts/navigation.schema.json.');
  const stringList = (key) => {
    const value = data[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
      bad(`"${key}" must be a list of non-empty strings`);
      return [];
    }
    const dup = value.find((item, index) => value.indexOf(item) !== index);
    if (dup !== undefined) bad(`"${key}" lists "${dup}" twice`);
    return value;
  };
  const objectList = (key, required) => {
    const value = data[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      bad(`"${key}" must be a list`);
      return [];
    }
    return value.filter((item, index) => {
      const ok = typeof item === 'object' && item !== null && !Array.isArray(item) && required.every((field) => item[field] !== undefined);
      if (!ok) bad(`"${key}"[${index}] needs ${required.map((field) => `"${field}"`).join(', ')}`);
      return ok;
    });
  };
  for (const key of Object.keys(data)) if (!CONTRACT_KEYS.has(key)) bad(`unknown key "${key}"`);
  if (data.router !== 'expo-router' && data.router !== 'react-navigation') {
    bad('"router" must be "expo-router" or "react-navigation"');
    return null;
  }
  if (typeof data.home !== 'string' || data.home === '') bad('"home" must name the first screen');
  if (!Array.isArray(data.routes)) bad('"routes" must list every route');
  const guarded = objectList('guarded', ['route', 'hook']);
  for (const entry of guarded) {
    if (entry.gesture !== undefined && entry.gesture !== 'off') bad(`"guarded" entry ${entry.route}: "gesture" is "off" or left out`);
  }
  const paramParsers = data.paramParsers ?? {};
  if (typeof paramParsers !== 'object' || paramParsers === null || Array.isArray(paramParsers)) bad('"paramParsers" must map route ids to parser files');
  const debugRoutes = Array.isArray(data.debugRoutes) ? data.debugRoutes : [];
  return {
    file: rel,
    router: data.router,
    home: typeof data.home === 'string' ? data.home : '',
    routes: stringList('routes'),
    protected: objectList('protected', ['file', 'guard', 'screens']),
    groups: objectList('groups', ['name', 'if', 'screens']),
    guarded,
    modals: stringList('modals'),
    paramParsers: typeof paramParsers === 'object' && paramParsers !== null && !Array.isArray(paramParsers) ? paramParsers : {},
    debugRoutes: debugRoutes.map((entry) => (typeof entry === 'string' ? { route: entry, file: null } : { route: entry?.route, file: entry?.file ?? null })),
    placeholders: stringList('placeholders'),
    placeholderComponent: typeof data.placeholderComponent === 'string' ? data.placeholderComponent : 'PlaceholderScreen',
    jsStack: data.jsStack === true,
    navigatorFile: data.navigatorFile ?? RN_DEFAULTS.navigatorFile,
    containerFile: data.containerFile ?? RN_DEFAULTS.containerFile,
    typesFile: data.typesFile ?? RN_DEFAULTS.typesFile,
    paramsFile: data.paramsFile ?? RN_DEFAULTS.paramsFile,
  };
}

// ---------------------------------------------------------------------------------------------
// Shared scans (both routers)
// ---------------------------------------------------------------------------------------------

function appSourceFiles(ctx, layout) {
  const src = layout.srcDir;
  return walkRepo(ctx.root, { include: SOURCE_GLOBS.map((glob) => `${src}/**/${glob}`) }).filter((rel) => !rel.endsWith('.d.ts'));
}

/** Value imports of a module from a router package (type-only imports are fine anywhere). */
function routerValueImports(source, pattern) {
  const out = [];
  for (const imp of findImports(source.raw, source.masked)) {
    if (!pattern.test(imp.from)) continue;
    if (/^import\s+type\b/.test(imp.text)) continue;
    const braces = /\{([^}]*)\}/.exec(imp.text);
    const outside = imp.text.replace(/\{[^}]*\}/, '').replace(/^import|from[\s\S]*$/g, '').replace(/[\s,]/g, '');
    if (braces && outside === '' && braces[1].split(',').map((name) => name.trim()).filter(Boolean).every((name) => name.startsWith('type '))) continue;
    out.push(imp);
  }
  return out;
}

/** A root kit module (src/services/<concern>/<concern>-root-kit.tsx), registered in createRootKits. */
const ROOT_KIT_FILE = /(^|\/)[a-z0-9-]+-root-kit\.tsx?$/;

function checkNavInScreens(ctx, layout, files) {
  const shared = [layout.uiDir, layout.storesDir, layout.servicesDir, layout.dataDir, layout.apiDir, layout.coreDir];
  for (const rel of files) {
    if (isTestFile(rel) || !shared.some((dir) => rel.startsWith(`${dir}/`))) continue;
    // A root kit's effects run beside the root Stack (startup step F6): routing a notification tap
    // there is navigation from outside, the root's job, as in app-stack.tsx; no other service file.
    if (ROOT_KIT_FILE.test(rel)) continue;
    const source = ctx.source(rel);
    for (const imp of routerValueImports(source, /^(expo-router(?!\/server)(\/.*)?|@react-navigation\/.*)$/)) {
      ctx.problem(rel, lineOf(source.raw, imp.index), 'nav-in-screens', `imports ${imp.from}: shared layers never navigate (only screens' model hooks do)`, 'Give the component an onPress (or the store an action result) and call the router in the feature\'s use-<feature>-model.ts.');
    }
  }
}

function checkGoBack(ctx, files, home, isExpoRouter) {
  if (home === '') return;
  const literal = escapeRegExp(home);
  const call = isExpoRouter
    ? new RegExp(`\\b(router|navigation)\\.(navigate|push)\\(\\s*(?:\\{\\s*pathname\\s*:\\s*)?(['"\`])${literal}\\3\\s*[,)}]`, 'g')
    : new RegExp(`\\b(navigate|push)\\(\\s*(['"])${literal}\\2\\s*[,)]`, 'g');
  for (const rel of files) {
    if (isTestFile(rel)) continue;
    const source = ctx.source(rel);
    for (const match of source.comments.matchAll(call)) {
      ctx.problem(rel, lineOf(source.raw, match.index), 'go-back', `${match[0].replace(/\s*[,)}]$/, match[0].includes('{') ? ' })' : ')')} stacks a second ${home} on top of the one already below`, isExpoRouter ? `Use router.dismissTo('${home}') (back to it, or replace when it is not in the stack) or router.back().` : `Use navigation.popTo('${home}') or navigation.goBack().`);
    }
    if (!isExpoRouter || !rel.endsWith('x')) continue;
    for (const tag of findJsxTags(source.raw, source.masked)) {
      if (tag.name !== 'Link') continue;
      const attrs = jsxAttributes(source.raw, tag, source.masked);
      if (literalOf(attrs.get('href')) !== home || attrs.has('dismissTo') || attrs.has('replace')) continue;
      ctx.problem(rel, lineOf(source.raw, tag.start), 'go-back', `<Link href="${home}"> pushes a second ${home}`, `Add dismissTo (<Link dismissTo href="${home}">) so it goes back to the screen below.`);
    }
  }
}

function checkNativeStack(ctx, files, contract) {
  if (contract?.jsStack) return;
  for (const rel of files) {
    const source = ctx.source(rel);
    for (const imp of findImports(source.raw, source.masked)) {
      if (imp.from !== 'expo-router/js-stack' && imp.from !== '@react-navigation/stack') continue;
      ctx.problem(rel, lineOf(source.raw, imp.index), 'native-stack', `imports ${imp.from}: the JavaScript stack draws transitions and gestures in JS, unlike the platform's own`, 'Use the native stack (Stack from expo-router, createNativeStackNavigator), or set "jsStack": true in the contract with the reason in $comment.');
    }
  }
}

/** usePreventRemove in the file, or in a local module it imports (one level: a wrapping hook). */
function callsPreventRemove(ctx, rel, depth = 0) {
  const source = ctx.source(rel);
  if (source === null) return false;
  if (/\busePreventRemove\s*\(/.test(source.masked)) return true;
  if (depth >= 1) return false;
  for (const imp of findImports(source.raw, source.masked)) {
    const target = resolveImport(rel, imp.from, { root: ctx.root });
    if (target.kind === 'local' && target.exists && callsPreventRemove(ctx, target.path, depth + 1)) return true;
  }
  return false;
}

function checkGuardedHooks(ctx, contract) {
  for (const entry of contract.guarded) {
    const source = ctx.source(entry.hook);
    if (source === null) {
      ctx.problem(entry.hook, 1, 'guarded-prevent-remove', `the hook file of guarded route ${entry.route} does not exist`, 'Point "hook" at the model hook that blocks removal (templates/src/features/task-editor/use-discard-guard.ts shows the hook it calls).');
      continue;
    }
    if (!callsPreventRemove(ctx, entry.hook)) {
      ctx.problem(entry.hook, 1, 'guarded-prevent-remove', `guarded route ${entry.route} never blocks removal: Back, the swipe or Android's back gesture throws its unsaved work away`, 'Call usePreventRemove(hasUnsavedChanges, ...) here (or a hook that does, such as useDiscardGuard) and ask before discarding.');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Expo Router
// ---------------------------------------------------------------------------------------------

const stripExt = (rel) => rel.replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\.(ios|android|native|web)$/, '');

function routeFiles(ctx, routesDir) {
  const routes = new Map();
  const layouts = new Map();
  for (const rel of walk(join(ctx.root, routesDir), { include: SOURCE_GLOBS, ignore: ['*.d.ts'] })) {
    const id = stripExt(rel);
    const base = posix.basename(id);
    const file = `${routesDir}/${rel}`;
    if (base === '_layout') {
      const dir = posix.dirname(id) === '.' ? '' : posix.dirname(id);
      if (!layouts.has(dir)) layouts.set(dir, file);
      continue;
    }
    if (SKIPPED_ROUTE_FILE.test(base) || base.endsWith('+api') || isTestFile(rel)) continue;
    if (!routes.has(id)) routes.set(id, file);
  }
  return { routes, layouts };
}

const hrefOf = (id) => `/${id.split('/').filter((segment) => !/^\(.*\)$/.test(segment) && segment !== 'index').join('/')}`;

/** The files that render a layout's navigator: the layout and the components it renders, followed through local imports. */
function navigatorFiles(ctx, layoutFile) {
  const seen = new Set();
  const queue = [{ rel: layoutFile, depth: 0 }];
  let rendersNavigator = false;
  while (queue.length > 0) {
    const { rel, depth } = queue.shift();
    if (seen.has(rel)) continue;
    const source = ctx.source(rel);
    if (source === null) continue;
    seen.add(rel);
    const tags = findJsxTags(source.raw, source.masked);
    if (tags.some((tag) => NAVIGATOR_TAG.test(tag.name.split('.')[0]))) rendersNavigator = true;
    if (depth >= 6) continue;
    const used = new Set(tags.map((tag) => tag.name.split('.')[0]));
    for (const imp of findImports(source.raw, source.masked)) {
      const names = (/\{([^}]*)\}/.exec(imp.text)?.[1] ?? '').split(',').map((name) => name.trim().split(/\s+as\s+/).pop()).filter(Boolean);
      const defaultName = /^import\s+([A-Za-z_$][\w$]*)/.exec(imp.text)?.[1];
      if (defaultName) names.push(defaultName);
      if (!names.some((name) => used.has(name))) continue;
      const target = resolveImport(rel, imp.from, { root: ctx.root });
      if (target.kind === 'local' && target.exists && /\.(tsx|jsx)$/.test(target.path)) queue.push({ rel: target.path, depth: depth + 1 });
    }
  }
  return { files: [...seen], rendersNavigator };
}

/** <X.Screen name="..."> and <X.Protected guard={...}> tags of the navigator files of every layout. */
function screenTags(ctx, files) {
  const screens = [];
  const groups = [];
  for (const rel of files) {
    const source = ctx.source(rel);
    const tags = findJsxTags(source.raw, source.masked);
    for (const tag of tags) {
      const [owner, member] = tag.name.split('.');
      if (member === 'Screen') {
        const attrs = jsxAttributes(source.raw, tag, source.masked);
        screens.push({ file: rel, line: lineOf(source.raw, tag.start), owner, name: literalOf(attrs.get('name')), options: attrs.get('options')?.value ?? '', start: tag.start });
      }
      if (member === 'Screen' || member === 'Protected') continue;
      if (member === undefined && NAVIGATOR_TAG.test(owner)) {
        const attrs = jsxAttributes(source.raw, tag, source.masked);
        screens.push({ file: rel, line: lineOf(source.raw, tag.start), owner, name: null, options: attrs.get('screenOptions')?.value ?? '', start: tag.start, isNavigator: true });
      }
    }
    // Protected groups: the screens written between the opening tag and its closing tag.
    const opens = tags.filter((tag) => tag.name.endsWith('.Protected'));
    for (const tag of opens) {
      const attrs = jsxAttributes(source.raw, tag, source.masked);
      let end = source.masked.length;
      if (!tag.selfClosing) {
        let depth = 0;
        const re = new RegExp(`<${escapeRegExp(tag.name)}\\b|</${escapeRegExp(tag.name)}\\s*>`, 'g');
        re.lastIndex = tag.start;
        for (let match = re.exec(source.masked); match; match = re.exec(source.masked)) {
          if (match[0].startsWith('</')) depth -= 1;
          else if (!opens.find((other) => other.start === match.index)?.selfClosing) depth += 1;
          if (depth === 0) {
            end = match.index;
            break;
          }
        }
      }
      const inside = screens.filter((screen) => screen.file === rel && screen.name !== null && !screen.isNavigator && screen.start > tag.start && screen.start < end);
      groups.push({ file: rel, line: lineOf(source.raw, tag.start), guard: attrs.get('guard')?.value ?? '', screens: inside.map((screen) => screen.name) });
    }
  }
  return { screens, groups };
}

/** Ancestor layout folders of a route, nearest first ('' is the root layout). */
function ancestorLayouts(id, layouts) {
  const parts = id.split('/');
  const out = [];
  for (let n = parts.length - 1; n >= 0; n -= 1) {
    const dir = parts.slice(0, n).join('/');
    if (layouts.has(dir)) out.push(dir);
  }
  return out;
}

/** The names a layout's Screen children may give this route: its path below the layout, or the nested navigator folder holding it. */
function candidateNames(id, dir, layouts) {
  const rest = dir === '' ? id : id.slice(dir.length + 1);
  const names = new Set([rest]);
  const first = rest.split('/')[0];
  const firstDir = dir === '' ? first : `${dir}/${first}`;
  if (rest.includes('/') && layouts.has(firstDir)) names.add(first);
  return names;
}

function optionTextsOf(id, er) {
  const out = [];
  const nearest = ancestorLayouts(id, er.layouts);
  for (const [index, dir] of nearest.entries()) {
    const names = candidateNames(id, dir, er.layouts);
    for (const screen of er.navigators.get(dir)?.screens ?? []) {
      if (screen.isNavigator ? index === 0 : names.has(screen.name)) out.push(screen);
    }
  }
  for (const screen of er.routeScreens.get(id) ?? []) out.push(screen);
  return out;
}

function checkExpoRouter(ctx, layout, contract, files, options) {
  const routesDir = layout.routesDir;
  const rootLayoutRel = ['tsx', 'ts', 'jsx', 'js'].map((ext) => `${routesDir}/_layout.${ext}`).find((rel) => isFile(join(ctx.root, rel)));
  if (!isDir(join(ctx.root, routesDir)) || rootLayoutRel === undefined) {
    ctx.problem(`${routesDir}/_layout.tsx`, 1, 'root-layout', 'the root layout is missing: Expo Router has no navigator to render the routes in', 'Create src/app/_layout.tsx that default-exports RootLayout and renders the root Stack (references/expo-router-in-practice.md, "The root layout and the startup order").');
  }
  const { routes, layouts } = isDir(join(ctx.root, routesDir)) ? routeFiles(ctx, routesDir) : { routes: new Map(), layouts: new Map() };
  const navigators = new Map();
  const allNavigatorFiles = new Set();
  for (const [dir, file] of layouts) {
    const nav = navigatorFiles(ctx, file);
    for (const rel of nav.files) allNavigatorFiles.add(rel);
    navigators.set(dir, { ...nav, file });
  }
  const tagsByFile = new Map();
  for (const [dir, nav] of navigators) {
    const tags = screenTags(ctx, nav.files);
    navigators.set(dir, { ...nav, screens: tags.screens, groups: tags.groups });
    for (const group of tags.groups) tagsByFile.set(`${group.file}:${group.line}`, group);
  }
  const routeScreens = new Map();
  for (const [id, file] of routes) routeScreens.set(id, screenTags(ctx, [file]).screens.filter((screen) => !screen.isNavigator));
  const er = { routes, layouts, navigators, routeScreens };

  // root-layout
  if (rootLayoutRel !== undefined) {
    const source = ctx.source(rootLayoutRel);
    if (!/\bexport\s+default\b/.test(source.masked)) {
      ctx.problem(rootLayoutRel, 1, 'root-layout', 'the root layout has no default export, so Expo Router renders nothing', 'export default function RootLayout() { ... }.');
    }
    if (!navigators.get('')?.rendersNavigator) {
      ctx.problem(rootLayoutRel, 1, 'root-layout', 'neither the root layout nor a component it renders draws a navigator (Stack, Tabs, Slot, Drawer, NativeTabs)', 'Render the root <Stack> in the layout, or in a component it renders (src/features/root-navigator/app-stack.tsx).');
    }
  }

  // not-found
  if (isDir(join(ctx.root, routesDir)) && !routes.has('+not-found')) {
    ctx.problem(`${routesDir}/+not-found.tsx`, 1, 'not-found', 'no +not-found route: an old or mistyped link opens the router\'s development "Unmatched route" page', "Copy templates/src/app/+not-found.tsx with its feature (src/features/not-found/) and add '+not-found' to the contract routes.");
  }

  // one-navigator
  for (const rel of files) {
    if (isTestFile(rel)) continue;
    const source = ctx.source(rel);
    for (const imp of findImports(source.raw, source.masked)) {
      if (!imp.from.startsWith('@react-navigation/')) continue;
      ctx.problem(rel, lineOf(source.raw, imp.index), 'one-navigator', `imports ${imp.from} in an Expo Router app: expo-router 57 carries its own React Navigation, so a second copy has its own contexts ("Couldn't find a navigation object")`, "Import from 'expo-router' (hooks, Stack, themes) or 'expo-router/react-navigation' (usePreventRemove, StackActions).");
    }
    const usesLayoutContext = /\bwithLayoutContext\s*\(/.test(source.masked);
    for (const match of source.masked.matchAll(/<NavigationContainer\b|\bcreateStaticNavigation\s*\(|\bcreate(NativeStack|Stack|BottomTab|Drawer|MaterialTopTab|NativeBottomTab)Navigator\s*\(/g)) {
      if (match[1] !== undefined && usesLayoutContext) continue;
      ctx.problem(rel, lineOf(source.raw, match.index), 'one-navigator', `${match[0].replace(/\s*\($/, '(')} builds a second navigation tree beside Expo Router's`, 'Add a route file (and a Stack.Screen in its layout) instead; a custom navigator goes through withLayoutContext().');
    }
  }

  checkNativeStack(ctx, files, contract);

  // typed-routes
  const configRel = ['app.config.ts', 'app.config.js', 'app.json'].find((rel) => isFile(join(ctx.root, rel)));
  if (configRel === undefined) {
    ctx.problem('app.config.ts', 1, 'typed-routes', 'no app config, so typed routes are off', 'Create app.config.ts with experiments: { typedRoutes: true } (app-variants-and-environment ships it).');
  } else {
    const text = ctx.source(configRel).comments;
    const isOn = configRel === 'app.json' ? /"typedRoutes"\s*:\s*true/.test(text) : /\btypedRoutes\s*:\s*true\b/.test(text);
    if (!isOn) ctx.problem(configRel, 1, 'typed-routes', 'experiments.typedRoutes is not true: a mistyped href compiles and opens the not-found page at run time', 'Set experiments: { typedRoutes: true }; CI generates the types with `npx expo customize tsconfig.json` before tsc.');
  }

  // href-cast, params-parsed (type argument), flow-by-guard
  for (const rel of files) {
    if (isTestFile(rel)) continue;
    const source = ctx.source(rel);
    for (const match of source.masked.matchAll(/\bas\s+Href\b/g)) {
      ctx.problem(rel, lineOf(source.raw, match.index), 'href-cast', '`as Href` turns typed routes off for this link: a renamed route still compiles', "Write a typed path (`/tasks/${taskId}`) or an object href ({ pathname: '/tasks/[taskId]', params: { taskId } }).");
    }
    for (const match of source.masked.matchAll(/\buse(Local|Global)SearchParams\s*</g)) {
      ctx.problem(rel, lineOf(source.raw, match.index), 'params-parsed', `use${match[1]}SearchParams<...>() is a cast, not a check: a deep link can hand the screen any text`, 'Call it without a type argument and parse the raw params with the route\'s valibot parser (templates/src/features/task-detail/task-detail-params.ts).');
    }
  }
  const layoutLike = new Set([...layouts.values(), ...allNavigatorFiles]);
  for (const rel of layoutLike) {
    const source = ctx.source(rel);
    for (const tag of findJsxTags(source.raw, source.masked)) {
      if (tag.name !== 'Redirect') continue;
      ctx.problem(rel, lineOf(source.raw, tag.start), 'flow-by-guard', 'a layout redirects to switch flows: the guarded screen renders for a frame and every render re-runs the redirect', 'Wrap the screens in <Stack.Protected guard={...}> and let the store value that feeds the guard move the person.');
    }
    for (const match of source.masked.matchAll(/\buse(Layout)?Effect\s*\(/g)) {
      const open = source.masked.indexOf('(', match.index);
      const close = findClosing(source.masked, open);
      const body = source.masked.slice(open, close === -1 ? undefined : close);
      const nav = /\b(router|navigation)\.(replace|push|navigate|reset|dismissTo)\s*\(/.exec(body);
      if (nav) ctx.problem(rel, lineOf(source.raw, open + nav.index), 'flow-by-guard', `a layout navigates from an effect (${nav[0].replace(/\s*\($/, '')}): it runs after the wrong screen has rendered and can fire before the navigator mounts`, 'Switch flows with <Stack.Protected guard={...}>; navigate only from event handlers.');
    }
  }

  if (contract === null) return;
  const contractRel = contract.file;

  // route-table
  const listed = new Set(contract.routes);
  for (const [id, file] of routes) {
    if (!listed.has(id)) ctx.problem(file, 1, 'route-table', `route ${id} is not in the contract`, `Add "${id}" to "routes" in ${contractRel} (a route change starts in the contract), or move the file out of ${routesDir}: Expo Router bundles every file there as a route.`);
  }
  for (const id of contract.routes) {
    if (!routes.has(id)) ctx.problem(contractRel, 1, 'route-table', `contract route ${id} has no route file`, `Create ${routesDir}/${id}.tsx (a thin route rendering a feature screen), or remove "${id}" from the contract.`);
  }

  // home-route
  if (contract.home !== '' && ![...routes.keys()].some((id) => hrefOf(id) === contract.home)) {
    ctx.problem(contractRel, 1, 'home-route', `home ${contract.home} matches no route file`, `Set "home" to the href of the first screen (an index route gives "/"), or create that route.`);
  }

  // protected-guard
  const codeGroups = [...tagsByFile.values()];
  for (const entry of contract.protected) {
    const match = codeGroups.find((group) => group.file === entry.file && norm(group.guard) === norm(String(entry.guard)));
    if (!match) {
      ctx.problem(entry.file, 1, 'protected-guard', `no <Stack.Protected guard={${entry.guard}}> in ${entry.file}: the contract says these screens are guarded (${entry.screens.join(', ')})`, 'Wrap the screens in <Stack.Protected guard={...}> in that file, with the guard expression written as in the contract.');
      continue;
    }
    const want = [...entry.screens].sort().join(', ');
    const have = [...match.screens].sort().join(', ');
    if (want !== have) ctx.problem(match.file, match.line, 'protected-guard', `the group guard={${entry.guard}} holds [${have}], the contract says [${want}]`, 'Make the Screen children of the group match the contract (a screen outside the group is reachable whatever the guard says).');
  }
  for (const group of codeGroups) {
    if (contract.protected.some((entry) => entry.file === group.file && norm(group.guard) === norm(String(entry.guard)))) continue;
    ctx.problem(group.file, group.line, 'protected-guard', `the protected group guard={${group.guard}} is not in the contract`, `Add { "file": "${group.file}", "guard": "${group.guard}", "screens": [...] } to "protected" in ${contractRel}.`);
  }

  // guarded routes
  checkGuardedHooks(ctx, contract);
  for (const entry of contract.guarded) {
    if (!routes.has(entry.route)) {
      ctx.problem(contractRel, 1, 'guarded-prevent-remove', `guarded route ${entry.route} is not a route file`, 'Use the route id (its path under the routes folder without the extension).');
      continue;
    }
    if (entry.gesture !== 'off') continue;
    const texts = optionTextsOf(entry.route, er).map((screen) => screen.options).join('\n');
    if (!/\bgestureEnabled\s*:\s*false\b/.test(texts) || !/\bfullScreenGestureEnabled\s*:\s*false\b/.test(texts)) {
      ctx.problem(routes.get(entry.route), 1, 'guarded-gesture-off', `guarded route ${entry.route} keeps the iOS back swipe although the contract turns it off`, `Set options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} on its <Stack.Screen name=...> (fullScreenGestureEnabled is on by default from iOS 26).`);
    }
  }

  // modal-presentation
  const modals = new Set(contract.modals);
  for (const id of routes.keys()) {
    const screens = optionTextsOf(id, er);
    const modal = screens.find((screen) => MODAL_PRESENTATION.test(screen.options));
    if (modals.has(id) && !modal) {
      ctx.problem(routes.get(id), 1, 'modal-presentation', `route ${id} is a contract modal but opens as a pushed card`, "Set options={{ presentation: 'modal' }} (or formSheet, ...) on its <Stack.Screen> in the layout.");
    }
    if (!modals.has(id) && modal) {
      ctx.problem(modal.file, modal.line, 'modal-presentation', `route ${id} presents as a modal but is not in the contract modals`, `Add "${id}" to "modals" in ${contractRel}, or drop the presentation.`);
    }
  }
  for (const id of contract.modals) {
    if (!routes.has(id)) ctx.problem(contractRel, 1, 'modal-presentation', `contract modal ${id} is not a route file`, 'Use the route id.');
  }

  // params-parsed (parsers)
  for (const id of routes.keys()) {
    if (!/\[/.test(id)) continue;
    const parser = contract.paramParsers[id];
    if (typeof parser !== 'string') {
      ctx.problem(routes.get(id), 1, 'params-parsed', `dynamic route ${id} has no params parser in the contract`, `Write src/features/<feature>/<feature>-params.ts (valibot schema + parse function returning a Result) and add "${id}": "<that file>" to "paramParsers".`);
      continue;
    }
    const source = ctx.source(parser);
    if (source === null) ctx.problem(contractRel, 1, 'params-parsed', `the params parser ${parser} of ${id} does not exist`, 'Create it or fix the path.');
    else if (!findImports(source.raw, source.masked).some((imp) => imp.from === 'valibot')) {
      ctx.problem(parser, 1, 'params-parsed', `the params parser of ${id} does not validate with valibot`, 'Parse with a valibot schema (v.safeParse) so the type and the runtime check are one.');
    }
  }
  for (const id of Object.keys(contract.paramParsers)) {
    if (!routes.has(id)) ctx.problem(contractRel, 1, 'params-parsed', `paramParsers names ${id}, which is not a route file`, 'Use the route id of the dynamic route.');
  }

  // debug-gated
  const allGroups = [...navigators.entries()].flatMap(([dir, nav]) => nav.groups.map((group) => ({ ...group, dir })));
  for (const entry of contract.debugRoutes) {
    const file = routes.get(entry.route);
    if (file === undefined) {
      ctx.problem(contractRel, 1, 'debug-gated', `debug route ${entry.route} is not a route file`, 'Use the route id.');
      continue;
    }
    if (!/\bTEST_ONLY\b/.test(ctx.source(file).masked)) {
      ctx.problem(file, 1, 'debug-gated', `debug route ${entry.route} does not render through TEST_ONLY, so production bundles carry the debug screen`, 'Render TEST_ONLY?.DebugScreen (null in production builds): the literal variant check inside TEST_ONLY lets Metro drop the code (debug-menu-and-test-hooks).');
    }
    const guarded = allGroups.some((group) => ancestorLayouts(entry.route, layouts).includes(group.dir) && group.screens.some((name) => candidateNames(entry.route, group.dir, layouts).has(name)));
    if (!guarded) ctx.problem(file, 1, 'debug-gated', `debug route ${entry.route} is reachable in production builds (a deep link opens it)`, 'List it in a <Stack.Protected guard={isTestBuild}> group (and in the contract "protected").');
  }

  // placeholders
  checkPlaceholders(ctx, contract, [...routes.entries()].filter(([, file]) => new RegExp(`\\b${escapeRegExp(contract.placeholderComponent)}\\b`).test(ctx.source(file).masked)).map(([id, file]) => ({ id, file, line: 1 })), options);
}

function checkPlaceholders(ctx, contract, using, options) {
  const listed = new Set(contract.placeholders);
  for (const entry of using) {
    if (options.release) {
      ctx.problem(entry.file, entry.line, 'placeholder-release', `route ${entry.id} still renders ${contract.placeholderComponent}: a placeholder never ships`, 'Build the screen and render it, then remove the route from "placeholders".');
    } else if (!listed.has(entry.id)) {
      ctx.problem(entry.file, entry.line, 'placeholder-route', `route ${entry.id} renders ${contract.placeholderComponent} but is not in the contract placeholders`, `Add "${entry.id}" to "placeholders" (the list --release must find empty), or render the real screen.`);
    }
  }
  for (const id of contract.placeholders) {
    if (options.release) {
      if (!using.some((entry) => entry.id === id)) ctx.problem(contract.file, 1, 'placeholder-release', `the contract still lists placeholder ${id}`, 'Empty "placeholders" before a release.');
    } else if (!using.some((entry) => entry.id === id)) {
      ctx.problem(contract.file, 1, 'placeholder-route', `contract placeholder ${id} renders its real screen`, `Remove "${id}" from "placeholders".`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// React Navigation 7 (static API)
// ---------------------------------------------------------------------------------------------

function staticScreens(inner) {
  return topLevelEntries(childObject(inner, 'screens') ?? '');
}

function checkReactNavigation(ctx, contract, files, options) {
  // one-navigator / static-container
  const containers = [];
  for (const rel of files) {
    if (isTestFile(rel)) continue;
    const source = ctx.source(rel);
    for (const imp of findImports(source.raw, source.masked)) {
      if (imp.from === 'expo-router' || imp.from.startsWith('expo-router/')) ctx.problem(rel, lineOf(source.raw, imp.index), 'one-navigator', `imports ${imp.from} in a React Navigation app: two routers fight over the same screens`, 'Use @react-navigation/native and the static config (or move the whole app to Expo Router).');
    }
    for (const match of source.masked.matchAll(/<NavigationContainer\b/g)) {
      ctx.problem(rel, lineOf(source.raw, match.index), 'static-container', '<NavigationContainer> with the static API: the typed linking and the static param list are lost', 'Render the component createStaticNavigation(rootStack) returns.');
    }
    for (const match of source.masked.matchAll(/\bcreateStaticNavigation\s*\(/g)) containers.push({ rel, line: lineOf(source.raw, match.index) });
  }
  if (containers.length === 0) ctx.problem(contract.containerFile, 1, 'static-container', 'no createStaticNavigation(...) anywhere: the static config is never rendered', `Create ${contract.containerFile} from examples/react-navigation/navigation-root.tsx.`);
  for (const extra of containers.filter((entry) => entry.rel !== contract.containerFile)) {
    ctx.problem(extra.rel, extra.line, 'one-navigator', `a navigation container outside ${contract.containerFile}: one app, one navigation tree`, 'Nest navigators inside the one static config (a screen whose screen is another static navigator) instead of a second container.');
  }
  checkNativeStack(ctx, files, contract);

  // route-table, home-route, group-if, guarded, modals, debug, placeholders
  const stack = ctx.source(contract.navigatorFile);
  const screens = new Map();
  let groups = [];
  if (stack === null) {
    ctx.problem(contract.navigatorFile, 1, 'route-table', 'the static navigator file is missing', `Create it from examples/react-navigation/root-stack.tsx, or set "navigatorFile" in ${contract.file}.`);
  } else {
    const call = callObjectArgument(stack.comments, 'createNativeStackNavigator') ?? callObjectArgument(stack.comments, 'createStackNavigator');
    if (call === null) {
      ctx.problem(contract.navigatorFile, 1, 'route-table', 'no createNativeStackNavigator({ ... }) static config', 'Declare the root stack with the static API (examples/react-navigation/root-stack.tsx).');
    } else {
      const at = (text) => lineOf(stack.raw, Math.max(0, stack.comments.indexOf(text, call.index)));
      for (const screen of staticScreens(call.inner)) screens.set(screen.key, { value: screen.value, group: null, line: at(`${screen.key}:`) });
      groups = topLevelEntries(childObject(call.inner, 'groups') ?? '').map((group) => {
        const inner = extractBlock(group.value, 0)?.inner ?? '';
        const hook = topLevelEntries(inner).find((entry) => entry.key === 'if')?.value ?? null;
        const names = staticScreens(inner).map((screen) => {
          screens.set(screen.key, { value: screen.value, group: group.key, line: at(`${screen.key}:`) });
          return screen.key;
        });
        return { name: group.key, hook, screens: names, line: at(`${group.key}:`) };
      });
      const listed = new Set(contract.routes);
      for (const [name, entry] of screens) {
        if (!listed.has(name)) ctx.problem(contract.navigatorFile, entry.line, 'route-table', `screen ${name} is not in the contract`, `Add "${name}" to "routes" in ${contract.file} first, or render it inside its screen (an overlay keeps the screen below mounted).`);
      }
      for (const name of contract.routes) {
        if (!screens.has(name)) ctx.problem(contract.navigatorFile, at('createNativeStackNavigator'), 'route-table', `contract route ${name} is missing from the static config`, `Register ${name} in its group, or remove it from the contract.`);
      }
      const home = screens.get(contract.home);
      const homeGroup = groups.find((group) => group.name === home?.group);
      if (!home) ctx.problem(contract.file, 1, 'home-route', `home ${contract.home} is not a screen of the static config`, 'Set "home" to the first screen the main flow opens.');
      else if (homeGroup && homeGroup.screens[0] !== contract.home) ctx.problem(contract.navigatorFile, homeGroup.line, 'home-route', `the first screen of group ${homeGroup.name} is ${homeGroup.screens[0]}, so the app opens there instead of ${contract.home}`, `Put ${contract.home} first in its group.`);
      // group-if
      const wanted = contract.groups.map((group) => group.name).join(', ');
      const have = groups.map((group) => group.name).join(', ');
      if (wanted !== have) ctx.problem(contract.navigatorFile, at('groups') || at('createNativeStackNavigator'), 'group-if', `groups are [${have}], the contract says [${wanted}] in this order`, 'Keep the contract groups in order: the first group whose if hook is true gives the initial screen.');
      for (const expected of contract.groups) {
        const group = groups.find((candidate) => candidate.name === expected.name);
        if (!group) continue;
        if (group.hook !== expected.if) ctx.problem(contract.navigatorFile, group.line, 'group-if', `group ${expected.name} needs if: ${expected.if} (found ${group.hook ?? 'none'})`, 'Groups switch by their if hooks (a store selector), never by navigate() or reset().');
        const want = [...expected.screens].join(', ');
        if (group.screens.join(', ') !== want) ctx.problem(contract.navigatorFile, group.line, 'group-if', `group ${expected.name} holds [${group.screens.join(', ')}], the contract says [${want}]`, 'Make the group\'s screens (and their order) match the contract.');
      }
      // guarded gesture, modals, debug, placeholders
      for (const entry of contract.guarded) {
        const screen = screens.get(entry.route);
        if (!screen) ctx.problem(contract.file, 1, 'guarded-prevent-remove', `guarded route ${entry.route} is not a screen of the static config`, 'Use the screen name.');
        else if (entry.gesture === 'off' && !(/\bgestureEnabled\s*:\s*false\b/.test(screen.value) && /\bfullScreenGestureEnabled\s*:\s*false\b/.test(screen.value))) {
          ctx.problem(contract.navigatorFile, screen.line, 'guarded-gesture-off', `guarded route ${entry.route} keeps the iOS back swipe although the contract turns it off`, 'Give it options: { gestureEnabled: false, fullScreenGestureEnabled: false }.');
        }
      }
      const modals = new Set(contract.modals);
      for (const [name, screen] of screens) {
        const isModal = MODAL_PRESENTATION.test(screen.value);
        if (modals.has(name) && !isModal) ctx.problem(contract.navigatorFile, screen.line, 'modal-presentation', `screen ${name} is a contract modal but opens as a pushed card`, "Give it options: { presentation: 'modal' }.");
        if (!modals.has(name) && isModal) ctx.problem(contract.navigatorFile, screen.line, 'modal-presentation', `screen ${name} presents as a modal but is not in the contract modals`, `Add "${name}" to "modals" in ${contract.file}.`);
      }
      for (const entry of contract.debugRoutes) {
        const screen = screens.get(entry.route);
        const group = groups.find((candidate) => candidate.name === screen?.group);
        if (!screen || !group || group.hook === null) ctx.problem(contract.navigatorFile, screen?.line ?? 1, 'debug-gated', `debug route ${entry.route} is not inside a group with an if hook, so production builds register it`, 'Put it in a Debug group whose if hook reads the test-build gate.');
        const file = entry.file ? ctx.source(entry.file) : null;
        if (!file || !/\bTEST_ONLY\b/.test(file.masked)) ctx.problem(entry.file ?? contract.file, 1, 'debug-gated', `debug route ${entry.route} does not render through TEST_ONLY`, 'Name its route component file in "debugRoutes" ({ "route", "file" }) and render TEST_ONLY?.DebugScreen there.');
      }
      const placeholder = new RegExp(`^${escapeRegExp(contract.placeholderComponent)}\\b|\\bscreen\\s*:\\s*${escapeRegExp(contract.placeholderComponent)}\\b`);
      checkPlaceholders(ctx, contract, [...screens.entries()].filter(([, screen]) => placeholder.test(screen.value.trim())).map(([id, screen]) => ({ id, file: contract.navigatorFile, line: screen.line })), options);
    }
  }
  checkGuardedHooks(ctx, contract);

  // typed-routes
  const types = ctx.source(contract.typesFile);
  if (types === null) ctx.problem(contract.typesFile, 1, 'typed-routes', 'the global RootParamList declaration is missing: navigate() accepts any route name', 'Copy examples/react-navigation/react-navigation.d.ts.');
  else if (!(/StaticParamList\s*<\s*typeof\s+\w+\s*>/.test(types.masked) && /interface\s+RootParamList\s+extends/.test(types.masked))) {
    ctx.problem(contract.typesFile, 1, 'typed-routes', 'RootParamList does not extend StaticParamList<typeof rootStack>', 'declare global { namespace ReactNavigation { interface RootParamList extends StaticParamList<typeof rootStack> {} } }.');
  }

  // params-serialisable
  const params = ctx.source(contract.paramsFile);
  if (params !== null) {
    const bad = /=>|\b(Date|Map|Set|Promise|WeakMap)\s*</.exec(params.masked) ?? /:\s*(Date|Map|Set|Function)\b/.exec(params.masked);
    if (bad) ctx.problem(contract.paramsFile, lineOf(params.raw, bad.index), 'params-serialisable', 'route params hold a function or a non-JSON object: state restore and deep links break and React Navigation warns', 'Pass ids and plain data; the screen reads everything else from its store.');
  }

  // motion-transition
  const container = ctx.source(contract.containerFile);
  const motion = `${container?.masked ?? ''}\n${stack?.masked ?? ''}`;
  const motionRaw = `${container?.raw ?? ''}\n${stack?.raw ?? ''}`;
  if (!/\.with\s*\(/.test(motion) || !(/\buseScreenAnimation\s*\(/.test(motion) || (/\buseReduceMotion\s*\(/.test(motion) && /['"]fade['"]/.test(motionRaw)))) {
    ctx.problem(contract.containerFile, 1, 'motion-transition', 'pushes never switch to a cross-fade when motion is reduced', 'Wrap the static stack: rootStack.with(({ Navigator }) => <Navigator screenOptions={{ animation: useScreenAnimation() }} />) (examples/react-navigation/navigation-root.tsx).');
  }

  // flow-by-guard
  for (const rel of files) {
    if (isTestFile(rel)) continue;
    const source = ctx.source(rel);
    for (const match of source.masked.matchAll(/\b(navigation\.reset|CommonActions\.reset)\s*\(/g)) {
      ctx.problem(rel, lineOf(source.raw, match.index), 'flow-by-guard', `${match[1]}() rebuilds the stack by hand to switch flows`, 'Dispatch the store action that flips the group\'s if hook; the navigator lands on the first screen of the group that renders.');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------------------------

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const layout = resolveLayout(positionals[0] ?? '.', { routesDir: options['routes-dir'] });
  const root = layout.root;
  const pkgPath = join(root, 'package.json');
  if (!isFile(pkgPath)) throw new UsageError(`nothing to check: ${toPosix(pkgPath)} not found`, 'Run it from the app repo root (or pass the root as the first argument).');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    throw new UsageError(`package.json is not valid JSON: ${error.message}`, 'Fix package.json.');
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const hasExpoRouter = deps['expo-router'] !== undefined;
  const hasReactNavigation = deps['@react-navigation/native'] !== undefined;
  const report = createReporter({ name: 'check-navigation', json: options.json });
  if (!hasExpoRouter && !hasReactNavigation) {
    // A ship gate never prints NOT APPLICABLE: with --release, an app without a router is bad input.
    if (options.release) throw new UsageError('nothing to gate: neither expo-router nor @react-navigation/native is in package.json', 'Run --release from the app repo root (the folder whose package.json lists the router).');
    return report.notApplicable('neither expo-router nor @react-navigation/native is in package.json');
  }
  const ctx = makeContext(root, report);
  const contractRel = toPosix(options.contract ?? layout.config.navigationContract ?? posix.join(layout.contractsDir, 'navigation.json'));
  const contract = readContract(ctx, contractRel);
  let router = contract?.router ?? (hasExpoRouter ? 'expo-router' : 'react-navigation');
  if (contract && router === 'expo-router' && !hasExpoRouter) {
    ctx.problem(contractRel, 1, 'contract', 'the contract says expo-router but package.json does not depend on it', 'Set "router" to the router the app uses.');
    router = 'react-navigation';
  } else if (contract && router === 'react-navigation' && !hasReactNavigation) {
    ctx.problem(contractRel, 1, 'contract', 'the contract says react-navigation but package.json does not depend on @react-navigation/native', 'Set "router" to the router the app uses.');
    router = 'expo-router';
  }
  const files = appSourceFiles(ctx, layout);
  for (const rel of files) ctx.source(rel);
  const isExpoRouter = router === 'expo-router';
  if (isExpoRouter) checkExpoRouter(ctx, layout, contract, files, options);
  else if (contract !== null) checkReactNavigation(ctx, contract, files, options);
  checkNavInScreens(ctx, layout, files);
  checkGoBack(ctx, files, contract?.home ?? (isExpoRouter ? '/' : ''), isExpoRouter);
  return report.finish({ checked: ctx.checked.size, unit: 'files' });
});
