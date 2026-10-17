#!/usr/bin/env node
// check-motion.mjs: proves the motion-and-animation rules over an Expo app: one moment catalog that
// declares every moving thing, code tied to it, reduce motion wired at the root and honoured where
// the root cannot reach, loops and celebrations through their hooks, interruptible UI-thread motion.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-motion.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import { createReporter, matchGlob, notYetCreated, parseArgs, requireDir, resolveLayout, run, toPosix, UsageError, walkRepo } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { catalogProblems, catalogTable, isPlaceholder, lineOfMoment, loadCatalog, loadMotionTokens } from './lib/motion-catalog.mjs';
import { analyseFile, callbackCrossings, codeProblems, optOutIndexes } from './lib/motion-code.mjs';
import { findJsxTags, isTestFile, maskCode, resolveImport } from './lib/source-scan.mjs';

const RULES = [
  ['moment-catalog', 'the catalog exists, loads with Node alone and every moment has a kind, a trigger and a well-formed timing'],
  ['moment-tokens', 'every duration, delay, stagger, easing and spring a moment names is a token of src/theme/motion.ts'],
  ['moment-reduced', 'every moment declares a reduced alternative its kind allows (functional: unchanged only), a <CelebrationBurst> celebration declares none, a fade moment uses the reduced fade'],
  ['moment-declared', 'every file that animates reads MOTION_MOMENTS.<declared id> or is listed in a moment\'s files'],
  ['moment-files', 'every listed file exists, animates, and spends the token its moment names'],
  ['moment-unused', 'every declared moment is animated somewhere'],
  ['celebration-budget', 'a celebration counts its pieces and ends within CELEBRATION_LIMITS (library ceilings 2000 ms, 40 pieces)'],
  ['celebration-through-hook', 'a celebration plays through useCelebration (once per event, skippable, reduced end state), never from an effect'],
  ['reduce-motion-root', 'the root layout mounts <MotionConfig> and starts watchSystemA11y (accessibility-as-code\'s files); the component that mounts it never reads the answer itself'],
  ['reduce-motion-opt-out', 'ReduceMotion.Never only in a functional moment\'s file or the motion primitives (the reduced fade)'],
  ['css-motion-reduced', 'a Reanimated CSS animation or transition (animationName, transitionProperty, transition, a bare transitionDuration) reads useReduceMotion()'],
  ['screen-transition-reduced', 'a native stack takes its animation from useScreenAnimation(); no fixed moving animation literal'],
  ['reanimated-only', 'no LayoutAnimation from react-native (no reduce-motion setting reaches it)'],
  ['loop-through-hook', 'no endless withRepeat or infinite CSS animation outside useMotionLoop'],
  ['commit-before-motion', 'no completion callback hands work back to JS, outside functional moments and the primitives'],
  ['no-input-lock', 'no disabled / pointerEvents / onPress gated on an animation flag'],
  ['no-reset-before-animate', 'no shared value snapped to a start value right before it animates'],
  ['gesture-velocity', 'a spring started in a Pan, Pinch or Rotation gesture\'s onEnd / onFinalize takes the gesture velocity'],
  ['no-timer-sequencing', 'no setTimeout / setInterval / requestAnimationFrame that starts or stops an animation'],
  ['no-js-per-frame', 'no scheduleOnRN / runOnJS (or a React setter in a gesture) inside a per-frame worklet'],
  ['worklets-api', 'no deprecated runOnJS / runOnUI / executeOnUIRuntimeSync'],
  ['compositor-props', 'useAnimatedStyle animates transform and opacity; a layout key needs "// motion-layout: <reason>"'],
];

const SPEC = {
  name: 'check-motion',
  summary: 'Checks the motion-and-animation rules: the moment catalog, code tied to it, reduce motion at the root and where the root cannot reach, loops and celebrations through their hooks, interruptible UI-thread motion.',
  usage: '[repo-root] [options]',
  options: {
    catalog: { type: 'string', value: 'file', help: 'The moment catalog, app-relative (default: rn-skills.config.json "motionCatalog", else <uiDir>/motion/motion-moments.ts)' },
    'root-layout': { type: 'string', value: 'file', help: 'The file that mounts the app\'s providers, app-relative (default: "motionRootLayout", else <routesDir>/_layout.tsx; App.tsx with React Navigation)' },
    exclude: { type: 'string', multiple: true, value: 'glob', help: 'Leave matching repo-relative files out of the code scan (added to "motionExclude")' },
    table: { type: 'boolean', help: 'Also print the catalog as a Markdown table (moment, kind, trigger, timing in ms, reduced, where it lives)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    ...RULES.map(([id, text]) => `  ${id.padEnd(26)}${text}`),
    '',
    'Scans .ts/.tsx files under the source and routes folders, minus tests, the domain folders (core, data,',
    'api, stores, services, i18n, config), src/canvas (skia-canvas-rendering owns canvas timelines) and',
    'src/ui/a11y (accessibility-as-code). The motion primitives folder (<uiDir>/motion) is exempt from',
    'moment-declared, loop-through-hook, no-reset-before-animate, reduce-motion-opt-out and commit-before-motion.',
    'Installed skills (.agents/, .claude/, skills/, any folder holding a SKILL.md) are never scanned.',
    'rn-skills.config.json keys: the layout keys, "motionCatalog", "motionRootLayout", "motionExclude" (globs).',
    'When multi-package: every app workspace (app.config.* / app.json, a routes folder, or expo-router / expo in',
    'dependencies) that depends on react-native-reanimated is checked with its own layout and catalog; "files"',
    'entries are relative to that app folder. A shared package that depends on react-native-reanimated without',
    'being an app runs the per-file rules, and its animating files must be listed in some app\'s catalog.',
    'NOT APPLICABLE when no package.json of the repo depends on react-native-reanimated.',
    '',
    'Example: node check-motion.mjs .            (from the app repo root)',
    '',
    'Exit codes: 0 pass, 1 problems found, 2 bad input or environment.',
    'The last line is always "RESULT: PASS" or "RESULT: FAIL (<n> problems)".',
  ].join('\n'),
};

const DEFAULT_EXCLUDES = ['{srcDir}/canvas/**', '{uiDir}/a11y/**'];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${path} is not valid JSON: ${error.message}`, 'Repair the file.');
  }
}

const dependsOnReanimated = (manifest) => ['dependencies', 'devDependencies'].some((key) => manifest?.[key]?.['react-native-reanimated'] !== undefined);
const APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];

/** A workspace is an app when it has an app config or a routes folder, or depends (not devDepends) on expo-router or expo. */
function isAppWorkspace(root, workspace, manifest) {
  if (APP_CONFIGS.some((name) => existsSync(join(root, workspace.dir, name)))) return true;
  if (existsSync(join(root, workspace.layout.routesDir))) return true;
  return ['expo-router', 'expo'].some((name) => manifest?.dependencies?.[name] !== undefined);
}

/**
 * The workspaces to check: { apps: [{ dir, layout }] (dir '' for a single app), libraries }. A package
 * that depends on react-native-reanimated without being an app (a shared UI package) is a library: its
 * code rules run, and its animating files must be listed in an app's catalog. With no app among the
 * workspaces, every reanimated workspace is checked as an app.
 */
function appsOf(root, layout) {
  const rootManifest = readJson(join(root, 'package.json'));
  const single = dependsOnReanimated(rootManifest) ? [{ dir: '', layout }] : [];
  if (layout.workspaces.length === 0) return { apps: single, libraries: [] };
  const animating = layout.workspaces
    .map((workspace) => ({ workspace, manifest: readJson(join(root, workspace.dir, 'package.json')) }))
    .filter(({ manifest }) => dependsOnReanimated(manifest));
  const apps = animating.filter(({ workspace, manifest }) => isAppWorkspace(root, workspace, manifest)).map(({ workspace }) => ({ dir: workspace.dir, layout: workspace.layout }));
  const others = animating.filter(({ workspace, manifest }) => !isAppWorkspace(root, workspace, manifest)).map(({ workspace }) => ({ dir: workspace.dir, layout: workspace.layout }));
  if (apps.length === 0) return others.length > 0 ? { apps: others, libraries: [] } : { apps: single, libraries: [] };
  return { apps, libraries: others };
}

const inDir = (rel, dir) => dir !== '' && (rel === dir || rel.startsWith(`${dir}/`));
const appPath = (app, rel) => toPosix(posix.normalize(app.dir === '' ? rel : posix.join(app.dir, rel)));

function scanFiles(root, app, excludes) {
  const { layout } = app;
  const scanDirs = [layout.srcDir, layout.routesDir].filter((dir, index, all) => all.indexOf(dir) === index && !all.some((other) => other !== dir && inDir(dir, other)));
  const domain = [layout.coreDir, layout.dataDir, layout.apiDir, layout.storesDir, layout.servicesDir, layout.i18nDir, layout.configDir];
  const fill = (glob) => glob.replaceAll('{srcDir}', layout.srcDir).replaceAll('{uiDir}', layout.uiDir);
  const globs = excludes.map(fill);
  return walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] })
    .filter((rel) => scanDirs.some((dir) => inDir(rel, dir)))
    .filter((rel) => !isTestFile(rel) && !isTestFile(rel.slice(app.dir.length).replace(/^\//, '')))
    .filter((rel) => !domain.some((dir) => inDir(rel, dir)))
    .filter((rel) => !globs.some((glob) => matchGlob(rel, glob)));
}

function settingsOf(layout, options, app) {
  const config = layout.config ?? {};
  const motionDir = `${app.layout.uiDir}/motion`;
  return {
    motionDir,
    catalog: appPath(app, options.catalog ?? config.motionCatalog ?? posix.relative(app.dir || '.', `${motionDir}/motion-moments.ts`)),
    rootLayout: appPath(app, options['root-layout'] ?? config.motionRootLayout ?? posix.relative(app.dir || '.', `${app.layout.routesDir}/_layout.tsx`)),
    tokens: `${app.layout.themeDir}/motion.ts`,
  };
}

/** reduce-motion-root: the root layout (or a file it imports, 3 levels deep) mounts MotionConfig and starts the store. */
function rootWiringProblems(root, app, settings, report) {
  const motionConfig = `${app.layout.uiDir}/a11y/motion-config.tsx`;
  const missing = notYetCreated(root, { file: motionConfig, owner: 'accessibility-as-code' });
  if (missing) return report.skip({ file: motionConfig, rule: 'reduce-motion-root', message: missing });
  const rootMissing = notYetCreated(root, { file: settings.rootLayout, owner: 'expo-project-bootstrap' });
  if (rootMissing) return report.skip({ file: settings.rootLayout, rule: 'reduce-motion-root', message: rootMissing });
  const seen = new Set();
  let queue = [settings.rootLayout];
  let mounts = false;
  let watches = false;
  for (let depth = 0; depth <= 3 && queue.length > 0; depth += 1) {
    const next = [];
    for (const rel of queue) {
      if (seen.has(rel) || inDir(rel, `${app.layout.uiDir}/a11y`)) continue;
      seen.add(rel);
      const source = readFileSync(join(root, rel), 'utf8');
      const masked = maskCode(source);
      if (findJsxTags(source, masked).some((tag) => tag.name === 'MotionConfig')) mounts = true;
      if (/(?<!function\s+)(?<![\w$.])watchSystemA11y\s*\(/.test(masked)) watches = true;
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const resolved = resolveImport(rel, match[1], { root, aliases: app.layout.aliases });
        if (resolved.kind === 'local' && resolved.exists && /\.(ts|tsx)$/.test(resolved.path) && !resolved.path.includes('node_modules')) next.push(resolved.path);
      }
    }
    queue = next;
  }
  const fix = 'In the root layout: useEffect(() => watchSystemA11y(reportError), []) and wrap the app in <MotionConfig preference={reduceMotionPreference}> ("system" until the app has a setting), as examples/root-layout.tsx shows.';
  if (!mounts) report.problem({ file: settings.rootLayout, line: 1, rule: 'reduce-motion-root', message: 'the root layout never mounts <MotionConfig>, so the in-app setting and live switch changes reach no Reanimated animation', fix });
  if (!watches) report.problem({ file: settings.rootLayout, line: 1, rule: 'reduce-motion-root', message: 'the root layout never starts watchSystemA11y(), so useReduceMotion() never sees the phone\'s switch', fix });
  return undefined;
}

function referencesOf(files, moments) {
  const byId = new Map(Object.keys(moments).map((id) => [id, []]));
  for (const file of files) for (const ref of file.refs) byId.get(ref.id)?.push(file.rel);
  return byId;
}

function listedFiles(moments, app) {
  const byFile = new Map();
  for (const [id, moment] of Object.entries(moments)) {
    for (const entry of Array.isArray(moment.files) ? moment.files : []) {
      if (typeof entry !== 'string' || isPlaceholder(entry)) continue;
      const rel = appPath(app, entry);
      byFile.set(rel, [...(byFile.get(rel) ?? []), id]);
    }
  }
  return byFile;
}

function spendsToken(file, id, moment) {
  const { timing } = moment;
  if (file.refs.some((ref) => ref.id === id)) return true;
  if (timing?.navigator !== undefined) return file.stackIndex !== -1;
  if (timing?.spring !== undefined) return new RegExp(`\\bSPRINGS\\s*\\.\\s*${timing.spring}\\b`).test(file.masked);
  if (timing?.duration !== undefined) return new RegExp(`\\bMOTION_MS\\s*\\.\\s*${timing.duration}\\b`).test(file.masked);
  return true;
}

function filesEntryProblems(ctx, id, moment) {
  const { root, app, byRel, catalogLine, report } = ctx;
  for (const entry of Array.isArray(moment.files) ? moment.files : []) {
    if (typeof entry !== 'string') continue;
    const line = catalogLine(id);
    const at = (message, fix) => report.problem({ file: ctx.settings.catalog, line, rule: 'moment-files', message, fix });
    if (isPlaceholder(entry)) {
      at(`${id}.files still holds the template placeholder ${entry}`, 'Replace it with the app-relative path of the file that animates the moment (the file that renders the root <Stack> for screenPush).');
      continue;
    }
    const rel = appPath(app, entry);
    if (!existsSync(join(root, rel))) {
      at(`${id}.files names ${entry}, which does not exist`, 'List the file that animates the moment, or drop the entry.');
      continue;
    }
    const file = byRel.get(rel) ?? analyseFile(rel, readFileSync(join(root, rel), 'utf8'));
    if (!file.animates) at(`${id}.files names ${entry}, which animates nothing`, 'List the file that animates the moment, or drop the entry.');
    else if (!spendsToken(file, id, moment)) at(`${id}.files names ${entry}, which never spends the moment's token`, 'Make the file use the token the moment names (MOTION_MS.<duration> / SPRINGS.<spring>), or correct the moment\'s timing.');
    if (moment.kind === 'celebration' && !/(?<![\w$.])useCelebration\s*\(/.test(file.masked)) {
      report.problem({ file: rel, line: 1, rule: 'celebration-through-hook', message: `animates the celebration ${id} without useCelebration`, fix: 'Play it with useCelebration(MOTION_MOMENTS.<id>): once per event, skip(), reduced end state.' });
    }
  }
}

function crossRuleProblems(ctx, files) {
  const { moments, report, settings } = ctx;
  const listed = listedFiles(moments, ctx.app);
  const kindsOf = (file) => [...new Set([...file.refs.map((ref) => moments[ref.id]?.kind), ...(listed.get(file.rel) ?? []).map((id) => moments[id]?.kind)])];
  for (const file of files) {
    const isPrimitive = inDir(file.rel, settings.motionDir);
    const add = (index, rule, message, fix) => report.problem({ file: file.rel, line: file.line(index), rule, message, fix });
    for (const ref of file.refs) {
      if (!Object.hasOwn(moments, ref.id)) add(ref.index, 'moment-declared', `reads MOTION_MOMENTS.${ref.id}, which the catalog does not declare`, `Declare ${ref.id} in ${settings.catalog}, or read a declared moment.`);
      else if (!isPrimitive && moments[ref.id].kind === 'celebration' && !/(?<![\w$.])useCelebration\s*\(/.test(file.masked)) add(ref.index, 'celebration-through-hook', `reads the celebration ${ref.id} without useCelebration`, 'Play it with useCelebration(MOTION_MOMENTS.<id>) and draw it with <CelebrationBurst> or the app\'s own end-state view.');
    }
    if (isPrimitive) continue;
    if (file.animates && file.refs.length === 0 && !listed.has(file.rel)) {
      if (file.sites.length === 0 && file.stackIndex !== -1) {
        // Only a native stack moves here: the platform times it, so it cannot take timingOf(...).
        const navigatorId = Object.keys(moments).find((id) => moments[id]?.timing?.navigator !== undefined) ?? 'screenPush';
        add(file.stackIndex, 'moment-declared', 'renders a native <Stack> that no navigator moment lists', `List this file in the files of the navigator moment (${navigatorId}) in ${settings.catalog}; a stack cannot take its timing through timingOf(...).`);
      } else {
        add(file.sites[0]?.index ?? file.stackIndex, 'moment-declared', 'animates without naming a moment', `Declare the moment in ${settings.catalog} and take its timing with timingOf(MOTION_MOMENTS.<id>) / springOf(...), or list this file in the moment's files when it cannot import the catalog.`);
      }
    }
    const isFunctional = kindsOf(file).includes('functional');
    if (!isFunctional) {
      for (const index of optOutIndexes(file)) add(index, 'reduce-motion-opt-out', 'opts out of reduce motion with ReduceMotion.Never outside a functional moment', 'Only a functional timer (hold to confirm) keeps playing under reduce motion; a reduced fade uses REDUCED_FADE / reducedEntering() from moment-config.ts. Declare the moment functional if it really is one.');
      for (const crossing of callbackCrossings(file)) add(crossing.index, 'commit-before-motion', `a ${crossing.callee} completion callback hands work back to JS`, 'Commit the state in the handler first and let the animation follow; a callback gets finished=false when the animation is interrupted, so the work never happens. Exiting views use exiting={...}; only functional timers commit on completion.');
    }
    burstReducedProblems(ctx, file, listed.get(file.rel) ?? [], add);
  }
  fadeReducedProblems(ctx, files, listed);
}

/** moment-reduced: <CelebrationBurst> draws nothing under reduced motion, so its celebration declares 'none'. */
function burstReducedProblems(ctx, file, listedIds, add) {
  const burst = findJsxTags(file.source, file.masked).find((tag) => tag.name === 'CelebrationBurst');
  if (!burst) return;
  const ids = [...new Set([...file.refs.map((ref) => ref.id), ...listedIds])];
  for (const id of ids) {
    const moment = ctx.moments[id];
    if (moment?.kind !== 'celebration' || moment.reduced === 'none') continue;
    add(burst.start, 'moment-reduced', `renders <CelebrationBurst> for ${id}, declared reduced "${moment.reduced}", but the burst draws nothing while motion is reduced`, `Declare ${id} reduced: 'none' (the committed result is already on screen), or draw the "${moment.reduced}" end state with the app's own view instead of <CelebrationBurst>.`);
  }
}

const REDUCED_FADE_API = /(?<![\w$.])(REDUCED_FADE|reducedEntering|reducedExiting)\b/;

/** moment-reduced: a moment declared 'fade' whose code never uses the reduced fade collapses to instant under the root config. */
function fadeReducedProblems(ctx, files, listed) {
  const { moments, settings, report, catalogLine } = ctx;
  for (const [id, moment] of Object.entries(moments)) {
    if (moment?.reduced !== 'fade' || moment.timing?.navigator !== undefined) continue;
    if ([...listed.values()].some((ids) => ids.includes(id))) continue; // primitives listed in files time themselves
    const users = files.filter((file) => !inDir(file.rel, settings.motionDir) && file.refs.some((ref) => ref.id === id));
    if (users.length === 0 || users.some((file) => REDUCED_FADE_API.test(file.masked))) continue;
    report.problem({ file: settings.catalog, line: catalogLine(id), rule: 'moment-reduced', message: `${id} declares reduced "fade", but ${users[0].rel} never uses REDUCED_FADE, reducedEntering() or reducedExiting(), so the root config finishes it instantly`, fix: `Swap to the reduced fade when isReducedMotion is true (withTiming(target, REDUCED_FADE), entering={isReducedMotion ? reducedEntering() : ...}), or declare ${id} reduced: 'instant'.` });
  }
}

async function checkApp({ root, app, layout, options, report, shared }) {
  const settings = settingsOf(layout, options, app);
  requireDir(join(root, app.layout.srcDir), `source folder ${app.layout.srcDir}`);
  const configured = Array.isArray(layout.config?.motionExclude) ? layout.config.motionExclude : [];
  const excludes = [...DEFAULT_EXCLUDES, ...configured, ...options.exclude];
  const rels = scanFiles(root, app, excludes);
  const files = rels.map((rel) => analyseFile(rel, readFileSync(join(root, rel), 'utf8')));
  const byRel = new Map(files.map((file) => [file.rel, file]));
  for (const file of files) codeProblems(file, { isPrimitive: inDir(file.rel, settings.motionDir) }, (entry) => report.problem(entry));
  rootWiringProblems(root, app, settings, report);
  const animating = files.filter((file) => file.animates && !inDir(file.rel, settings.motionDir));
  if (!existsSync(join(root, settings.catalog))) {
    if (animating.length > 0) report.problem({ file: settings.catalog, line: 1, rule: 'moment-catalog', message: `the moment catalog is missing while ${animating.length} file(s) animate (first: ${animating[0].rel})`, fix: 'Copy templates/src/ui/motion/ from this skill and declare each moment the app animates.' });
    else report.note(`check-motion: no file animates yet and ${settings.catalog} does not exist`);
    return files.length;
  }
  const tokensMissing = notYetCreated(root, { file: settings.tokens, owner: 'design-system-structure' });
  if (tokensMissing) {
    report.skip({ file: settings.tokens, rule: 'moment-tokens', message: tokensMissing });
    return files.length;
  }
  const appModules = enableAppImports(join(root, app.dir), { aliases: app.dir === '' ? app.layout.aliases : undefined });
  const local = (rel) => (app.dir === '' ? rel : rel.slice(app.dir.length + 1));
  const tokens = await loadMotionTokens(appModules, local(settings.tokens));
  const catalog = await loadCatalog(appModules, local(settings.catalog));
  const loadError = catalog.error ?? tokens.error;
  if (loadError) {
    report.problem({ file: catalog.error ? settings.catalog : settings.tokens, line: 1, rule: 'moment-catalog', message: loadError, fix: 'Keep the catalog plain data whose only imports are type-only ones from @/theme/motion.' });
    return files.length;
  }
  const catalogSource = readFileSync(join(root, settings.catalog), 'utf8');
  const catalogLine = (id) => (id === null ? 1 : lineOfMoment(catalogSource, id));
  for (const problem of catalogProblems({ moments: catalog.moments, limits: catalog.limits, tokens: tokens.tokens })) {
    report.problem({ file: settings.catalog, line: catalogLine(problem.id), rule: problem.rule, message: problem.message, fix: problem.fix });
  }
  const ctx = { root, app, settings, moments: catalog.moments, report, byRel, catalogLine };
  for (const rel of listedFiles(catalog.moments, app).keys()) shared.listed.add(rel);
  shared.catalogs += 1;
  crossRuleProblems(ctx, files);
  const references = referencesOf(files, catalog.moments);
  for (const [id, moment] of Object.entries(catalog.moments)) {
    if (moment === null || typeof moment !== 'object') continue;
    filesEntryProblems(ctx, id, moment);
    const listedExisting = (Array.isArray(moment.files) ? moment.files : []).some((entry) => typeof entry === 'string' && !isPlaceholder(entry) && existsSync(join(root, appPath(app, entry))));
    if (references.get(id).length === 0 && !listedExisting) report.problem({ file: settings.catalog, line: catalogLine(id), rule: 'moment-unused', message: `${id} is declared but nothing animates it`, fix: 'Animate it (timingOf(MOTION_MOMENTS.<id>) in the file that moves), list the file in its files, or delete the moment.' });
  }
  if (options.table) for (const line of catalogTable(catalog.moments, tokens.tokens)) report.note(line);
  return files.length;
}

/**
 * When multi-package: a shared package that animates (not an app) runs the per-file rules, and each
 * of its animating files must be listed in a moment's files in some app's catalog.
 */
function checkLibrary({ root, library, layout, options, report, shared, appCount }) {
  const configured = Array.isArray(layout.config?.motionExclude) ? layout.config.motionExclude : [];
  if (!existsSync(join(root, library.layout.srcDir))) return 0;
  const rels = scanFiles(root, library, [...DEFAULT_EXCLUDES, ...configured, ...options.exclude]);
  const motionDir = `${library.layout.uiDir}/motion`;
  for (const rel of rels) {
    const file = analyseFile(rel, readFileSync(join(root, rel), 'utf8'));
    const isPrimitive = inDir(rel, motionDir);
    codeProblems(file, { isPrimitive }, (entry) => report.problem(entry));
    if (isPrimitive || !file.animates || shared.listed.has(rel)) continue;
    if (shared.catalogs < appCount) continue; // an app catalog did not load; its own problem says why
    const index = file.sites[0]?.index ?? file.stackIndex;
    report.problem({ file: rel, line: file.line(index), rule: 'moment-declared', message: `animates, but ${library.dir} is a shared package and no app's moment catalog lists this file`, fix: `List it in the files of the moment it animates, in the catalog of the app that renders it (a path relative to that app's folder, which climbs out of it to ${rel}).` });
  }
  return rels.length;
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  if (!existsSync(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run it from the app repo root, or pass the root: node check-motion.mjs <repo-root>.');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'check-motion', json: options.json });
  const { apps, libraries } = appsOf(root, layout);
  if (apps.length === 0) return report.notApplicable('react-native-reanimated is not in package.json');
  const shared = { listed: new Set(), catalogs: 0 };
  let checked = 0;
  for (const app of apps) checked += await checkApp({ root, app, layout, options, report, shared });
  for (const library of libraries) checked += checkLibrary({ root, library, layout, options, report, shared, appCount: apps.length });
  return report.finish({ checked, unit: 'files' });
}

await run(main);
