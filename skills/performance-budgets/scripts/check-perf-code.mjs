#!/usr/bin/env node
// check-perf-code.mjs: checks an Expo app's code for the performance rules a machine can see: no
// Skia allocation in worklets, no React state per frame, frame callbacks that can stop, a recorder
// that owns no callback, draw-call budgets under the app's ceiling, canvases per screen and per list
// item, no runtime code generation, Hermes kept, locale data in one place, Jest timing from
// node:perf_hooks, and (when contracts/perf.json declares it) the on-device measurement layer.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-perf-code.mjs [repo-root] [--contract <file>]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { UsageError, createReporter, fail, lineOf, maskComments, matchGlob, notYetCreated, parseArgs, parseJsonc, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { loadBudgets } from './lib/budgets.mjs';
import { findCalls, findClosing, findImports, findJsxTags, isTestFile, jsxAttributes, maskCode } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-perf-code',
  summary: 'Checks the app source (srcDir and routes of the app and of each workspace, root index.*), tests, Expo config, eas.json, plugins and package.json for performance mistakes that are visible in code.',
  usage: '[repo-root] [--contract <file>]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The performance contract (default contracts/perf.json, or rn-skills.config.json "perfContract")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  skia-alloc-per-frame  Skia.Paint/Color/Font/PathBuilder/PictureRecorder/Surface/... made inside a \'worklet\' function',
    '                        (or a function of a \'worklet\' file) outside the canvas kit and surface folders; frame-hook',
    "                        callbacks and canvas folders are skia-canvas-rendering's (frame-alloc, draw-pure)",
    '  react-state-per-frame a React state setter (setX(...)) called inside a useFrameCallback callback (scheduleOnRN/runOnJS',
    "                        per frame is motion-and-animation's no-js-per-frame)",
    '  frame-callback-stop   a useFrameCallback without false as its second argument (it starts active), or a file that',
    '                        starts one and never calls handle.setActive(...) or a setActive destructured from it',
    '  recorder-callback     a frame recorder file (frame-recorder.ts, use-frame-recorder.ts) owns a frame callback',
    '  draw-call-budget      a draw test (draw*.test.ts, *-draw.test.ts) asserts a budget over perf.drawCallsPerFrameMax',
    '  canvas-per-item       a <Canvas>, <SurfaceHost> or <SurfaceCanvas> rendered per list item: inside .map(...),',
    '                        a renderItem={...} prop or the same-file function renderItem names',
    '  canvases-per-screen   more than perf.skiaCanvasesPerScreenMax <Canvas> in one .tsx outside the canvas folders',
    '                        (contracts/perf.json canvasBudgetExempt lists measured exceptions)',
    '  runtime-codegen       eval, new Function or a string passed to setTimeout/setInterval',
    '  hermes-engine         jsEngine other than hermes, RCT_HERMES_V1_ENABLED, useHermesV1: false, or',
    '                        @react-native-community/javascriptcore in package.json',
    '  intl-locale-data      FormatJS locale data imported anywhere but <i18nDir>/intl-polyfills.ts (whose exact list',
    '                        i18n-strings-and-catalogs checks against the app\'s languages)',
    '  perf-clock-in-tests   a test times with the global performance.now() (a 1 ms mock in the React Native preset)',
    '  perf-layer            contracts/perf.json declares the measurement layer and a file of it is missing, the JS entry',
    '                        file never calls markJsEntry() inside a function (or calls it at module scope), or a first',
    '                        screen never calls useColdStartMark()',
    '  debug-perf-wired      the test-only entry does not create the perf log (createKvPerfLogAdapter) or the debug',
    '                        menu\'s Performance actions (createPerfDebugActions)',
    '',
    'Canvas folders: <srcDir>/canvas, <featuresDir>/*/canvas and <srcDir>/games/*/canvas, or rn-skills.config.json',
    '"canvasKitDir" / "canvasSurfaceDirs". No contracts/perf.json, or one without "layer": the layer rules print a',
    'note and do not apply. SKIP: the test-only entry, until debug-menu-and-test-hooks creates it.',
    'Installed skills (folders holding a SKILL.md, .agents/, .claude/, skills/ ...) are never scanned.',
    'Example: node check-perf-code.mjs .',
  ].join('\n'),
};

const SKIA_ALLOC = /\bSkia\.(Paint|Color|Font|ParagraphBuilder|PictureRecorder|RuntimeEffect|Surface|Matrix|PathBuilder\.Make\w*|Path\.Make\w*|Image\.Make\w*|Shader\.Make\w*|ColorFilter\.Make\w*|ImageFilter\.Make\w*|MaskFilter\.Make\w*|PathEffect\.Make\w*|XYWHRect|RRectXY)\s*\(/g;
const SETTER = /(?<![\w$.])(set(?!Timeout\b|Interval\b|Immediate\b)[A-Z]\w*)\s*\(/g;
const CANVAS_TAGS = new Set(['Canvas', 'SurfaceHost', 'SurfaceCanvas']);
const CONFIG_FILES = /^(app\.json|app\.config\.(ts|js|mjs|cjs)|eas\.json|package\.json)$/;
const LOCALE_DATA = /^@formatjs\/intl-[\w-]+\/locale-data\/([\w-]+)(\.js)?$/;
const JSC_PACKAGE = '@react-native-community/javascriptcore';
const CONTRACT_KEYS = new Set(['$schema', 'layer', 'canvasBudgetExempt']);
const LAYER_KEYS = new Set(['jsEntryFile', 'firstScreenFiles', 'testOnlyEntry', 'nativeModuleDir']);
const DEBUG_OWNER = 'debug-menu-and-test-hooks';

/** The files of the measurement layer, repo-relative, from the layout (templates/ holds each one). */
function layerFiles(layout, nativeDir) {
  const core = ['frame-histogram', 'frame-report', 'perf-entry', 'write-times', 'cold-start'];
  const tested = ['frame-report', 'perf-entry', 'write-times', 'cold-start'];
  const perf = ['perf-port', 'expo-perf-adapter', 'fake-perf', 'cold-start-marks', 'frame-recorder', 'perf-debug-actions'];
  const perfTested = ['fake-perf', 'cold-start-marks', 'frame-recorder', 'perf-debug-actions'];
  return [
    ...core.map((name) => `${layout.coreDir}/perf/${name}.ts`),
    ...tested.map((name) => `${layout.coreDir}/perf/${name}.test.ts`),
    ...perf.map((name) => `${layout.servicesDir}/perf/${name}.ts`),
    ...perfTested.map((name) => `${layout.servicesDir}/perf/${name}.test.ts`),
    ...['perf-log-port', 'kv-perf-log-adapter', 'fake-perf-log', 'fake-perf-log.test'].map((name) => `${layout.servicesDir}/perf-log/${name}.ts`),
    `${layout.srcDir}/hooks/use-cold-start-mark.ts`,
    `${layout.srcDir}/hooks/use-cold-start-mark.test.ts`,
    `${layout.testDir}/perf/storage-write.perf.test.ts`,
    `${nativeDir}/expo-module.config.json`,
    `${nativeDir}/ios/ProcessStartModule.swift`,
    `${nativeDir}/ios/ProcessStart.podspec`,
    `${nativeDir}/android/build.gradle`,
    `${nativeDir}/android/src/main/java/expo/modules/processstart/ProcessStartModule.kt`,
  ];
}

function readContract(root, layout, given) {
  const rel = given ?? layout.config.perfContract ?? `${layout.contractsDir}/perf.json`;
  const path = resolve(root, rel);
  if (!existsSync(path)) {
    if (given) fail(`contract ${given} does not exist`, 'Copy templates/contracts/perf.json, or drop --contract.');
    return { rel, contract: null };
  }
  let contract;
  try {
    contract = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, 'Fix the JSON (templates/contracts/perf.schema.json describes it).');
  }
  const bad = (what) => {
    throw new UsageError(`${rel}: ${what}`, 'Fix the contract (templates/contracts/perf.schema.json describes every key).');
  };
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) bad('not a JSON object');
  for (const key of Object.keys(contract)) if (!CONTRACT_KEYS.has(key)) bad(`unknown key "${key}"`);
  const { layer, canvasBudgetExempt = [] } = contract;
  if (layer !== undefined) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) bad('"layer" is not an object');
    for (const key of Object.keys(layer)) if (!LAYER_KEYS.has(key)) bad(`unknown key "layer.${key}"`);
    if (typeof layer.jsEntryFile !== 'string') bad('"layer.jsEntryFile" is not a repo-relative file');
    if (!Array.isArray(layer.firstScreenFiles) || layer.firstScreenFiles.length === 0 || !layer.firstScreenFiles.every((file) => typeof file === 'string')) bad('"layer.firstScreenFiles" is not a non-empty list of files');
    for (const key of ['testOnlyEntry', 'nativeModuleDir']) if (layer[key] !== undefined && typeof layer[key] !== 'string') bad(`"layer.${key}" is not a string`);
  }
  if (!Array.isArray(canvasBudgetExempt) || !canvasBudgetExempt.every((entry) => typeof entry?.file === 'string' && typeof entry?.reason === 'string' && entry.reason.trim().length >= 10)) {
    bad('"canvasBudgetExempt" entries need { "file", "reason" } with a reason of at least 10 characters');
  }
  return { rel, contract };
}

/** The app layouts to scan: the root app, or every workspace of a monorepo. */
function appLayouts(layout) {
  return layout.workspaces.length > 0 ? layout.workspaces.map((ws) => ({ ...ws.layout, dir: ws.dir })) : [{ ...layout, dir: '' }];
}

function canvasGlobs(layout, apps) {
  const configured = [layout.config.canvasKitDir, layout.config.canvasSurfaceDirs].flat().filter((dir) => typeof dir === 'string');
  const defaults = apps.flatMap((app) => [`${app.srcDir}/canvas`, `${app.featuresDir}/*/canvas`, `${app.srcDir}/games/*/canvas`]);
  return [...configured, ...defaults].map((dir) => `${dir.replace(/\/+$/, '')}/**`);
}

function classify(root, layout) {
  const apps = appLayouts(layout);
  const runtimeRoots = apps.flatMap((app) => [app.srcDir, app.routesDir]);
  const entries = apps.map((app) => (app.dir ? `${app.dir}/index` : 'index'));
  const all = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs', '*.json'], ignore: ['**/*.d.ts'] });
  const isUnder = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);
  const code = all.filter((rel) => /\.(ts|tsx)$/.test(rel));
  const runtime = code.filter((rel) => !isTestFile(rel) && (runtimeRoots.some((dir) => isUnder(rel, dir)) || entries.some((entry) => rel.replace(/\.(ts|tsx)$/, '') === entry)));
  const tests = code.filter((rel) => isTestFile(rel));
  const appDirs = apps.map((app) => app.dir);
  const configs = all.filter((rel) => {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    return (appDirs.includes(dir) && CONFIG_FILES.test(basename(rel))) || /(^|\/)plugins\/.+\.(ts|js|mjs|cjs)$/.test(rel);
  });
  return { apps, runtime, tests, configs, canvas: canvasGlobs(layout, apps) };
}

/** Bodies of 'worklet' functions: the directive opens the body it sits in; a 'worklet' file makes every function one. */
function workletBodies(source, masked) {
  const ranges = [];
  const directive = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]worklet['"];?/.exec(source);
  if (directive) {
    for (const match of masked.matchAll(/=>\s*\{|\bfunction\b[^{;]*\{/g)) {
      const open = match.index + match[0].length - 1;
      const close = findClosing(masked, open);
      if (close !== -1) ranges.push({ open, close });
    }
    return ranges;
  }
  for (const match of source.matchAll(/(['"])worklet\1\s*;?/g)) {
    let depth = 0;
    for (let i = match.index; i >= 0; i -= 1) {
      if (masked[i] === '}') depth += 1;
      else if (masked[i] === '{') {
        if (depth === 0) {
          const close = findClosing(masked, i);
          if (close !== -1) ranges.push({ open: i, close });
          break;
        }
        depth -= 1;
      }
    }
  }
  return ranges;
}

/** The body range of a same-file function `name` (a declaration, or a const arrow), or { open: -1 }. */
function functionBody(masked, name) {
  const declared = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(masked);
  if (declared) {
    const params = findClosing(masked, declared.index + declared[0].length - 1);
    const open = params === -1 ? -1 : masked.indexOf('{', params);
    return { open, close: open === -1 ? -1 : findClosing(masked, open) };
  }
  const bound = new RegExp(`\\b(?:const|let)\\s+${name}\\b[^=]*=`).exec(masked);
  const arrow = bound ? masked.indexOf('=>', bound.index) : -1;
  if (arrow === -1) return { open: -1, close: -1 };
  const start = arrow + 2 + (/^\s*/.exec(masked.slice(arrow + 2))?.[0].length ?? 0);
  if (masked[start] === '{') return { open: start, close: findClosing(masked, start) };
  const end = masked.indexOf(';', start);
  return { open: arrow, close: end === -1 ? masked.length : end };
}

/** Index ranges that render once per list item: .map(...) calls, renderItem={...} props and the functions they name. */
function perItemRanges(source, masked) {
  const ranges = [...masked.matchAll(/\.map\s*\(/g)].map((match) => {
    const open = match.index + match[0].length - 1;
    return { open, close: findClosing(masked, open) };
  });
  for (const tag of findJsxTags(source, masked)) {
    const attr = jsxAttributes(source, tag, masked).get('renderItem');
    if (attr?.kind !== 'expr') continue;
    const open = masked.indexOf('{', attr.index);
    ranges.push({ open, close: findClosing(masked, open) });
    if (/^[A-Za-z_$][\w$]*$/.test(attr.value)) ranges.push(functionBody(masked, attr.value));
  }
  return ranges.filter((range) => range.open !== -1 && range.close !== -1);
}

/** The top-level arguments of the call whose parentheses sit at open..close in masked code. */
function callArguments(masked, open, close) {
  const args = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push(masked.slice(from, i).trim());
      from = i + 1;
    }
  }
  const last = masked.slice(from, close).trim();
  if (last !== '') args.push(last);
  return args;
}

/**
 * Rule 7 as far as one file shows it: every useFrameCallback starts inactive (a second argument that
 * is not missing and not `true`), and the file stops it somewhere: handle.setActive(...), or a
 * setActive destructured from the hook's result (`const { setActive } = useFrameCallback(cb, false)`,
 * also renamed) and called bare. A handle passed to another file that stops it (a driver) still needs
 * a .setActive( call there; see references/performance-rules.md for what the checker cannot see.
 */
const STOP_FIX = 'Start it inactive (useFrameCallback(cb, false)), keep the handle and call setActive(false) when the animation ends, on background, on blur and while a full-screen interruption (modal, ad, video) covers it.';
function checkFrameCallbackStop(masked, problem) {
  const calls = findCalls(masked, 'useFrameCallback');
  for (const call of calls) {
    const autostart = callArguments(masked, call.open, call.close)[1];
    if (autostart === undefined || autostart === 'true') problem(call.start, 'frame-callback-stop', 'useFrameCallback starts active (its second argument, autostart, is missing or true), so it renders frames before anything moves', STOP_FIX);
  }
  const names = new Set();
  for (const match of masked.matchAll(/\{([^{}]*)\}\s*=\s*useFrameCallback\s*\(/g)) {
    const field = /(?:^|,)\s*setActive\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:,|$)/.exec(match[1]);
    if (field) names.add(field[1] ?? 'setActive');
  }
  const stopsByHandle = /\.setActive\s*\(/.test(masked);
  const stopsByName = [...names].some((name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`).test(masked));
  if (calls.length > 0 && !stopsByHandle && !stopsByName) problem(calls[0].start, 'frame-callback-stop', 'useFrameCallback is started but never stopped', STOP_FIX);
}

function checkRuntimeFile(ctx, rel, source) {
  const { report, budgets, inCanvas, exempt } = ctx;
  const masked = maskCode(source);
  const problem = (index, rule, message, fix) => report.problem({ file: rel, line: lineOf(source, index), rule, message, fix });
  const isCanvasCode = inCanvas(rel);
  if (!isCanvasCode) {
    for (const range of workletBodies(source, masked)) {
      for (const match of masked.slice(range.open, range.close + 1).matchAll(SKIA_ALLOC)) {
        problem(range.open + match.index, 'skia-alloc-per-frame', `Skia.${match[1]}() is created inside a worklet, so every frame that runs it allocates a native object`, 'Create paints, colours, paths, fonts and recorders once (module scope, a useState initializer, or the canvas kit\'s draw kit) and pass them in.');
      }
    }
    for (const call of findCalls(masked, 'useFrameCallback')) {
      // The inline callback, or a same-file function named as the first argument (`useFrameCallback(onFrame, false)`).
      const ranges = [{ open: call.open, close: call.close }];
      const first = callArguments(masked, call.open, call.close)[0];
      if (first !== undefined && /^[A-Za-z_$][\w$]*$/.test(first)) ranges.push(functionBody(masked, first));
      for (const range of ranges.filter((item) => item.open !== -1 && item.close !== -1)) {
        for (const match of masked.slice(range.open, range.close + 1).matchAll(SETTER)) {
          problem(range.open + match.index, 'react-state-per-frame', `${match[1]}() sets React state from a frame callback`, 'Keep per-frame data in shared values and Skia pictures; React renders only on events (cross to JS once, when a threshold is crossed or the animation ends).');
        }
      }
    }
  }
  const isRecorder = /(^|-)frame-recorder\.tsx?$/.test(basename(rel));
  const frameCall = masked.search(/(?<![\w$.])useFrameCallback\s*\(/);
  if (frameCall !== -1 && isRecorder) {
    problem(frameCall, 'recorder-callback', 'the frame recorder owns a frame callback', 'Call sampleFrame(recorder, info.timeSincePreviousFrame) from the frame callback that already runs (useSurfacePlayer({ onFrameTime }), a loop runner); an extra display link keeps idle screens rendering and changes what it measures.');
  } else if (frameCall !== -1) {
    checkFrameCallbackStop(masked, problem);
  }
  for (const match of masked.matchAll(/(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(|(?<![\w$.])set(?:Timeout|Interval)\s*\(\s*['"`]/g)) {
    problem(match.index, 'runtime-codegen', `${match[0].replace(/\s*\(.*$/s, '').trim()} generates code at runtime`, 'Hermes runs precompiled bytecode: pass a function, never a string, and never eval (a library that compiles validators with new Function needs its non-JIT mode).');
  }
  if (rel.endsWith('.tsx')) {
    const canvases = findJsxTags(source, masked).filter((tag) => CANVAS_TAGS.has(tag.name));
    const ranges = perItemRanges(source, masked);
    for (const tag of canvases) {
      if (ranges.some((range) => tag.start > range.open && tag.start < range.close)) problem(tag.start, 'canvas-per-item', `a Skia <${tag.name}> is rendered once per list item`, 'Draw repeated icons with the Icon primitive (one rasterized glyph, tinted), or every item on one canvas; each canvas costs memory and a first-frame delay (about 0.18 MB and 2.8 ms each, measured on iOS).');
    }
    const plain = canvases.filter((tag) => tag.name === 'Canvas');
    if (!isCanvasCode && !exempt.has(rel) && plain.length > budgets.skiaCanvasesPerScreenMax) {
      problem(plain[budgets.skiaCanvasesPerScreenMax].start, 'canvases-per-screen', `${plain.length} Skia canvases in one screen file (budget ${budgets.skiaCanvasesPerScreenMax})`, 'Keep Skia canvases for multi-colour or animated art, draw a group on one canvas, and use the Icon primitive for single-colour glyphs; a measured exception goes into contracts/perf.json canvasBudgetExempt with its reason.');
    }
  }
}

function checkLocaleData(ctx, rel, source) {
  if (ctx.polyfillFiles.has(rel)) return;
  for (const imp of findImports(source)) {
    const data = LOCALE_DATA.exec(imp.from);
    if (data) ctx.report.problem({ file: rel, line: lineOf(source, imp.index), rule: 'intl-locale-data', message: `locale data "${data[1]}" is imported outside the polyfill module`, fix: `Import locale data only in ${[...ctx.polyfillFiles][0]}, one file per language the app ships (i18n-strings-and-catalogs checks that list); every extra locale is start-up weight.` });
  }
}

function checkConfig(ctx, rel, source) {
  const problem = (index, message, fix) => ctx.report.problem({ file: rel, line: lineOf(source, index), rule: 'hermes-engine', message, fix });
  const code = rel.endsWith('.json') ? source : maskComments(source);
  for (const match of code.matchAll(/["']?jsEngine["']?\s*:\s*["'](\w+)["']/g)) {
    if (match[1] !== 'hermes') problem(match.index, `jsEngine is "${match[1]}"`, 'Remove jsEngine: Hermes is the default engine and runs precompiled bytecode.');
  }
  const hermesV1 = /\bRCT_HERMES_V1_ENABLED\b/.exec(code);
  if (hermesV1) problem(hermesV1.index, 'RCT_HERMES_V1_ENABLED is set', 'Remove it: Hermes V1 is the default engine since React Native 0.84, and 0 switches back to the legacy engine.');
  const v1Off = /["']?useHermesV1["']?\s*:\s*false\b/.exec(code);
  if (v1Off) problem(v1Off.index, 'useHermesV1 is false (the legacy Hermes engine)', 'Remove the expo-build-properties override: Hermes V1 starts faster and uses less memory.');
  if (basename(rel) === 'package.json') {
    const at = source.indexOf(`"${JSC_PACKAGE}"`);
    if (at !== -1) problem(at, `${JSC_PACKAGE} is installed (the JavaScriptCore engine)`, 'Uninstall it and keep Hermes: release builds then ship precompiled bytecode.');
  }
}

function checkTest(ctx, rel, source) {
  const masked = maskCode(source);
  const at = masked.search(/(?<![\w$.])performance\.now\s*\(/);
  if (at === -1 || findImports(source, masked).some((imp) => imp.from === 'node:perf_hooks' || imp.from === 'perf_hooks')) return;
  ctx.report.problem({ file: rel, line: lineOf(source, at), rule: 'perf-clock-in-tests', message: 'the test times with the global performance.now(), which the React Native Jest preset replaces with a 1 ms Date.now mock', fix: "Import { performance } from 'node:perf_hooks' (such tests live in the root test/ folder, the one with Node types)." });
}

function read(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** True when the call at `index` sits inside a function body (brace depth above zero outside JSX/objects is close enough). */
function isInsideFunction(masked, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') depth -= 1;
  }
  return depth > 0;
}

function checkLayer(ctx, layer) {
  const { root, layout, report } = ctx;
  const nativeDir = layer.nativeModuleDir ?? 'modules/process-start';
  for (const rel of layerFiles(layout, nativeDir).filter((file) => !existsSync(join(root, file)))) {
    report.problem({ file: rel, line: 1, rule: 'perf-layer', message: 'a file of the declared measurement layer is missing', fix: `Copy templates/${rel.startsWith(nativeDir) ? `modules/process-start${rel.slice(nativeDir.length)}` : rel} from this skill (the native module needs a native rebuild: npx expo prebuild --clean, or an EAS build).` });
  }
  const entry = read(root, layer.jsEntryFile);
  const entryMasked = entry === null ? '' : maskCode(entry);
  const mark = entryMasked.search(/(?<![\w$.])markJsEntry\s*\(/);
  if (entry === null) report.problem({ file: layer.jsEntryFile, line: 1, rule: 'perf-layer', message: 'the JS entry file the contract names does not exist', fix: 'Point layer.jsEntryFile at the root layout (src/app/_layout.tsx) or create it (app-startup-and-bootstrap).' });
  else if (mark === -1) report.problem({ file: layer.jsEntryFile, line: 1, rule: 'perf-layer', message: 'never calls markJsEntry(), so a cold start has no JS entry mark', fix: 'Call markJsEntry(services.perf.epochMs()) once in the startup decision of the root layout, right after the composition root is created.' });
  else if (!isInsideFunction(entryMasked, mark)) report.problem({ file: layer.jsEntryFile, line: lineOf(entry, mark), rule: 'perf-layer', message: 'calls markJsEntry() at module scope', fix: 'Call it inside the startup function (the root layout\'s first-render initializer): nothing runs at import time, and a reload marks again through the same path.' });
  for (const rel of layer.firstScreenFiles) {
    const source = read(root, rel);
    if (source === null) report.problem({ file: rel, line: 1, rule: 'perf-layer', message: 'the first-screen file the contract names does not exist', fix: 'Point layer.firstScreenFiles at the model hook of the first screen a launch shows.' });
    else if (maskCode(source).search(/(?<![\w$.])useColdStartMark\s*\(/) === -1) report.problem({ file: rel, line: 1, rule: 'perf-layer', message: 'the first screen never marks the cold start (a report has no cold-start entry)', fix: 'Call useColdStartMark({ perf: services.perf, perfLog: TEST_ONLY?.perf.perfLog ?? null, label: \'<screen>\', isReady }) in the model hook, with isReady true once the real data is on screen (query.isSuccess for a query; a spinner is not the first screen).' });
  }
  const testOnly = layer.testOnlyEntry ?? `${layout.srcDir}/test-only-entry.ts`;
  const reason = notYetCreated(root, { file: testOnly, owner: DEBUG_OWNER });
  if (reason) {
    report.skip({ file: testOnly, rule: 'debug-perf-wired', message: reason });
    return;
  }
  const code = maskCode(read(root, testOnly));
  if (!/(?<![\w$.])createKvPerfLogAdapter\s*\(/.test(code)) report.problem({ file: testOnly, line: 1, rule: 'debug-perf-wired', message: 'the test-only entry creates no perf log, so test builds record nothing', fix: 'Create the log there: perfLog: createKvPerfLogAdapter() (test builds only; debug-menu-and-test-hooks owns the entry).' });
  if (!/(?<![\w$.])createPerfDebugActions\s*\(/.test(code)) report.problem({ file: testOnly, line: 1, rule: 'debug-perf-wired', message: 'the test-only entry builds no Performance actions, so the debug menu cannot record frames, run the storage benchmark or share the report', fix: 'Build them there: createPerfDebugActions({ perfLog, perf, openBenchmark }) and hand them to the debug menu.' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const layout = resolveLayout(root);
  const files = classify(root, layout);
  if (files.runtime.length === 0 && files.tests.length === 0) fail(`nothing to check: no app source under ${files.apps.map((app) => app.srcDir).join(', ')} and no tests`, 'Run from the app repo root (or set srcDir in rn-skills.config.json).');
  const { contract, rel: contractRel } = readContract(root, layout, options.contract);
  const { budgets } = loadBudgets(root);
  const report = createReporter({ name: 'check-perf-code', json: options.json });
  const exempt = new Set((contract?.canvasBudgetExempt ?? []).map((entry) => entry.file));
  const polyfillFiles = new Set(files.apps.map((app) => `${app.i18nDir}/intl-polyfills.ts`));
  const ctx = { root, layout, report, budgets, exempt, polyfillFiles, inCanvas: (rel) => files.canvas.some((glob) => matchGlob(rel, glob)) };
  for (const rel of files.runtime) {
    const source = read(root, rel);
    checkRuntimeFile(ctx, rel, source);
    checkLocaleData(ctx, rel, source);
  }
  for (const rel of files.tests) {
    const source = read(root, rel);
    checkTest(ctx, rel, source);
    if (/(^|\/)(draw[^/]*|[^/]*-draw)\.test\.tsx?$/.test(rel)) checkDrawBudget(ctx, rel, source);
  }
  for (const rel of files.configs) checkConfig(ctx, rel, read(root, rel));
  if (contract?.layer) checkLayer(ctx, contract.layer);
  else report.note(`perf-layer: ${contract ? `${contractRel} declares no "layer"` : `no ${contractRel}`}, so no on-device measurement layer is checked (copy templates/contracts/perf.json to declare it)`);
  return report.finish({ checked: files.runtime.length + files.tests.length + files.configs.length, unit: 'files' });
});

function checkDrawBudget(ctx, rel, source) {
  const masked = maskCode(source);
  for (const match of source.matchAll(/toBeLessThanOrEqual\(\s*([\d_]+)\s*,?\s*\)|\b[A-Z_]*BUDGET[A-Z_]*\s*=\s*([\d_]+)/g)) {
    if (masked.slice(match.index, match.index + 4) !== source.slice(match.index, match.index + 4)) continue;
    const value = Number((match[1] ?? match[2]).replace(/_/g, ''));
    if (value > ctx.budgets.drawCallsPerFrameMax) ctx.report.problem({ file: rel, line: lineOf(source, match.index), rule: 'draw-call-budget', message: `the draw-call budget ${value} is over the app's ceiling ${ctx.budgets.drawCallsPerFrameMax} (quality-gates.json perf.drawCallsPerFrameMax)`, fix: 'Bring the busiest frame under the ceiling (an atlas for many sprites, a cached picture for the static layer); raising the ceiling needs a device report with hitch rate within budget at the new count.' });
  }
}
