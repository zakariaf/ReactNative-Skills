#!/usr/bin/env node
// check-realtime-loop.mjs: checks the real-time and simulate-then-replay code of an Expo app against
// the rules of the realtime-game-loop skill: the loop kit and host, fixed step, worklets,
// determinism, tick time, no per-tick allocation, batched events, the lifecycle (never auto-resume),
// replay tests, the stick table, the RealtimeSpec round trip, timed and capped replays, and the
// real-time surface's draw budget and pixel goldens.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-realtime-loop.mjs [repo-root]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, walk, walkRepo } from './check-lib.mjs';
import { balancedParens, hasWorkletDirective, isTestFile, resolveImport, valueImports } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-realtime-loop',
  summary: 'Checks the fixed-step loop kit and host, every real-time sim (<gamesDir>/<id>/sim) with its surface, and every simulate-then-replay rules file (<gamesDir>/<id>/rules importing the fixed-step module).',
  usage: '[repo-root] [options]',
  options: {
    'games-dir': { type: 'string', value: 'dir', help: 'Games folder (default: rn-skills.config.json "gamesDir", else <srcDir>/games)' },
    'kit-dir': { type: 'string', value: 'dir', help: 'Real-time kit folder (default: "realtimeKitDir", else <coreDir>/realtime)' },
    'geom-dir': { type: 'string', value: 'dir', help: 'Geometry kit folder (default: "geomKitDir", else <coreDir>/geom)' },
    'host-dir': { type: 'string', value: 'dir', help: 'Real-time host folder (default: "realtimeHostDir", else <srcDir>/canvas/realtime)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  loop-file-missing        the kit exists with its tests (fixed-step, replay helpers, RealtimeSpec, geometry); with a',
    '                           sim also the host (runner, loop hook, recorder, PNG painter, canvas host and their tests)',
    "  loop-import-unresolved   every import of a kit, host, sim or draw file resolves; the line names the skill that creates it",
    '  step-constants           STEP_MS = 1000 / 120 and MAX_FRAME_MS = 250 in fixed-step.ts',
    '  loop-runner              run-loop-frame.ts plans steps, calls sim.modify(), sends the drained events in one',
    '                           scheduleOnRN outside every loop, catches errors',
    '  frame-callback-body      useFrameCallback((info) => { runLoopFrame(...); }, false): one runner call, starts inactive',
    '                           (the parameter may be typed or destructured)',
    "  worklet-directive        sims, real-time draw files and the UI-thread kit start with a file-level 'worklet'; directive",
    "  worklet-import           a 'worklet' module imports values only from other 'worklet' modules or react-native-worklets",
    '  determinism              only + - * / % bitwise, sqrt, imul, floor, round, abs, min, max, PI; no **, Math.random, Date,',
    '                           performance.now, Intl (sims, the kit, simulate-then-replay rules)',
    '  sim-ticks                sim code counts ticks: no timestamps, frame times or STEP_MS inside a sim',
    '  sim-isolated             a sim never talks to JS or the app (no scheduleOnRN/runOnJS, React, React Native, Expo,',
    '                           Skia, or imports from routes, features, stores, services, ui, canvas or hooks)',
    '  sim-no-alloc             step functions and the helpers they reach (same file or a sibling sim file) allocate nothing',
    '                           per tick (no new, Array.from, copying or callback array methods, literals assigned, returned',
    '                           or passed, closures, vec2/sweep calls); the RNG state tuple of a nextU32 wrapper is exempt',
    '  sim-module-state         a sim keeps every changing value in its typed arrays: no module-level let/var or mutable containers',
    '  sim-replay-test          every sim has a replay test and a frame-grouping test',
    '  stick-table              a sim STICK table equals (cos, sin) of (k-1)*22.5 degrees, in order, y down',
    '  realtime-spec            a real-time game exposes a RealtimeSpec outside sim/ and tests its snapshot round trip',
    '  loop-lifecycle           a file that runs useFixedStepLoop also calls useCanvasLifecycle',
    '  loop-no-auto-resume      that lifecycle call is gated on the pause state (an identifier containing paused/Paused)',
    '  replay-events-timed      simulate-then-replay rules emit timed events (atMs)',
    '  replay-capped            simulate-then-replay rules stop at a hard tick cap (maxTicks), so a volley always ends',
    '  arena-draw-budget        a real-time surface has a draw*.test.ts asserting a draw-call budget of at most 1000',
    '  arena-golden             a real-time surface has a *.golden.test.ts under the test folder rendering it through',
    '                           paintSimPng at 3 sizes and moments [0, 0.5, 1], with >= 9 baselines',
    '',
    'rn-skills.config.json keys: gamesDir, realtimeKitDir, geomKitDir, realtimeHostDir ({srcDir} and {coreDir} expand),',
    'plus the layout keys srcDir, coreDir and testDir. The options above override them.',
    '',
    'NOT APPLICABLE (exit 0) when the repo has no real-time code: no <gamesDir>/<id>/sim folder, no module importing the',
    'fixed-step module and no kit file. A folder without package.json is not an app root (exit 2).',
    '',
    'Example: node check-realtime-loop.mjs .',
  ].join('\n'),
};

const ALLOWED_MATH = new Set(['sqrt', 'imul', 'floor', 'round', 'abs', 'min', 'max', 'PI']);
/**
 * What allocates inside a per-tick function: new, Array.from, array methods that copy or take a
 * callback, object and array literals (assigned, returned, passed as an argument or spread) and
 * closures (=>). A heuristic over the text: references/checker.md lists what it cannot see.
 */
const ALLOCATION = /\bnew\s+\w+|\bArray\.from\s*\(|\.(map|filter|slice|subarray|concat|push|unshift|splice|forEach|reduce|find|findIndex|some|every|flatMap)\s*\(|=\s*\[|=\s*\{|\(\s*\{|\breturn\s*[[{]|[,(]\s*\[|=>|\[\s*\.\.\./g;
/** In a helper that wraps nextU32 (the documented exception), the RNG state tuple built from the sim's words. */
const RNG_TUPLE = /=\s*\[[^\]\n]*\brng\b/;
/** Module-level mutable state in a sim file: a let/var, or a lower-case const holding a container (tables are UPPER_CASE). */
const MODULE_STATE = /^(?:export\s+)?(?:(?:let|var)\s+(\w+)|const\s+([a-z]\w*)\s*(?::[^=\n]+)?=\s*(?:\[|\{|new\s+\w+))/gm;
const MAX_DRAW_CALLS = 1000;
/** useFrameCallback((info) => { runLoopFrame(…); }, false); the parameter may be typed or destructured. */
const FRAME_CALLBACK = /^\s*\(\s*(?:\w+(?:\s*:\s*\w+)?|\{[^{}()]*\}(?:\s*:\s*\w+)?)\s*\)\s*=>\s*\{\s*runLoopFrame\s*\([^;{}]*\)\s*;?\s*\}\s*,\s*false\s*$/;
const FROM = /(?:^|[\s;])(?:import|export)\b[^'";]*?\bfrom\s+['"]([^'"]+)['"]|^[ \t]*import\s+['"]([^'"]+)['"]/gm;
const UI_PACKAGES = /^(react|react-native|expo|expo-[\w-]+|@expo\/[\w-]+|@shopify\/[\w-]+|react-native-[\w-]+)(\/|$)/;

const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
const isDir = (root, rel) => existsSync(join(root, rel)) && statSync(join(root, rel)).isDirectory();
const tree = (root, rel, include) => (isDir(root, rel) ? walk(join(root, rel), { include }).map((f) => `${rel}/${f}`) : []);
const sourceFile = (rel) => /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts') && !isTestFile(rel);
const titlesOf = (text) => [...maskComments(text).matchAll(/\b(?:it|test)(?:\.each\([\s\S]*?\))?\(\s*(['"`])((?:(?!\1).)+)\1/g)].map((m) => m[2]);

/** A config value or the default, with {srcDir}/{coreDir}/{testDir} expanded, as a clean repo-relative folder. */
function folder(layout, option, key, fallback) {
  const raw = option ?? layout.config?.[key] ?? fallback;
  if (typeof raw !== 'string' || raw.trim() === '') fail(`${key} must be a folder path`, `Set "${key}" in rn-skills.config.json to a repo-relative folder.`);
  const value = raw.replaceAll('{srcDir}', layout.srcDir).replaceAll('{coreDir}', layout.coreDir).replaceAll('{testDir}', layout.testDir);
  const clean = posix.normalize(value.split('\\').join('/')).replace(/\/+$/, '');
  if (clean.startsWith('/') || clean.split('/').includes('..')) fail(`${key} must stay inside the repo, got ${raw}`, 'Use a repo-relative folder such as src/games.');
  return clean;
}

function paths(layout, options) {
  const kit = folder(layout, options['kit-dir'], 'realtimeKitDir', '{coreDir}/realtime');
  const geom = folder(layout, options['geom-dir'], 'geomKitDir', '{coreDir}/geom');
  const host = folder(layout, options['host-dir'], 'realtimeHostDir', '{srcDir}/canvas/realtime');
  const games = folder(layout, options['games-dir'], 'gamesDir', '{srcDir}/games');
  return {
    kit,
    geom,
    host,
    games,
    fixedStep: `${kit}/fixed-step.ts`,
    runner: `${host}/run-loop-frame.ts`,
    KIT: [
      `${kit}/fixed-step.ts`, `${kit}/fixed-step.test.ts`, `${kit}/replay-commands.ts`, `${kit}/replay-commands.test.ts`, `${kit}/realtime-spec.ts`,
      `${geom}/vec2.ts`, `${geom}/vec2.test.ts`, `${geom}/sweep.ts`, `${geom}/sweep.test.ts`, `${geom}/spatial-hash.ts`, `${geom}/spatial-hash.test.ts`,
    ],
    HOST: [`${host}/run-loop-frame.ts`, `${host}/run-loop-frame.test.ts`, `${host}/use-fixed-step-loop.ts`, `${host}/record-sim.ts`, `${host}/paint-sim-png.ts`, `${host}/realtime-canvas-host.tsx`, `${host}/realtime-canvas-host.test.tsx`],
    UI_THREAD: [`${kit}/fixed-step.ts`, `${geom}/vec2.ts`, `${geom}/sweep.ts`, `${geom}/spatial-hash.ts`, `${host}/run-loop-frame.ts`, `${host}/record-sim.ts`],
  };
}

/** Which skill creates a missing import target (the line tells the agent what to load). */
function ownerOf(target, layout, p) {
  const under = (dir) => target === dir || target.startsWith(`${dir}/`);
  if (under(p.kit) || under(p.geom) || under(p.host)) return 'realtime-game-loop (copy it from templates/)';
  if (under(`${layout.coreDir}/rng`)) return 'seeded-determinism-and-golden-vectors';
  if (under(`${layout.coreDir}/game`)) return 'game-rules-engine';
  if (under(`${layout.srcDir}/canvas`)) return 'skia-canvas-rendering';
  if (under(`${layout.srcDir}/hooks`)) return 'react-components-and-hooks';
  if (under(p.games)) return 'the game itself (game-rules-engine or this skill)';
  return 'the app';
}

function checkImportsResolve(ctx, rel, source) {
  const { root, layout, p, report } = ctx;
  const code = maskComments(source);
  for (const match of code.matchAll(FROM)) {
    const spec = match[1] ?? match[2];
    const resolved = resolveImport(rel, spec, { root, aliases: layout.aliases });
    if (resolved.kind !== 'local' || resolved.exists) continue;
    report.problem({ file: rel, line: lineOf(code, match.index + match[0].indexOf(spec)), rule: 'loop-import-unresolved', message: `imports ${spec}, which resolves to no file (${resolved.path})`, fix: `Create ${resolved.path} first: ${ownerOf(resolved.path, layout, p)} creates it.` });
  }
}

function checkWorklet(ctx, rel, source) {
  const { root, layout, report } = ctx;
  if (!hasWorkletDirective(source)) {
    report.problem({ file: rel, line: 1, rule: 'worklet-directive', message: "UI-thread module has no file-level 'worklet'; directive (it would throw on the UI thread at runtime)", fix: "Put 'worklet'; as the first statement, right after the // path comment." });
    return;
  }
  for (const { spec, index } of valueImports(maskComments(source))) {
    const resolved = resolveImport(rel, spec, { root, aliases: layout.aliases });
    if (resolved.kind === 'external') {
      if (spec !== 'react-native-worklets') report.problem({ file: rel, line: lineOf(source, index), rule: 'worklet-import', message: `'worklet' module imports a value from the package ${spec}`, fix: 'Use `import type` for types; keep third-party runtime code off the UI thread (only react-native-worklets is allowed).' });
      continue;
    }
    const target = resolved.exists ? read(root, resolved.path) : null;
    if (target !== null && !hasWorkletDirective(target)) report.problem({ file: rel, line: lineOf(source, index), rule: 'worklet-import', message: `'worklet' module imports a value from ${resolved.path}, which is not a 'worklet' module`, fix: "Add 'worklet'; to that module if it is pure, or move the helper into a 'worklet' module." });
  }
}

function checkDeterminism(report, rel, code) {
  for (const match of code.matchAll(/\bMath\.(\w+)/g)) {
    if (!ALLOWED_MATH.has(match[1])) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'determinism', message: `uses Math.${match[1]}, which Hermes and V8 may compute differently (or is random)`, fix: 'Use only + - * / %, bitwise, Math.sqrt/imul/floor/round/abs/min/max/PI; take directions from committed tables and randomness from sfc32.' });
  }
  const banned = [
    [/\*\*=?/g, 'uses ** (Math.pow)', 'Multiply explicitly.'],
    [/\bDate\b|\bperformance\.now\b/g, 'reads a clock', 'Count ticks; time never enters simulation.'],
    [/\bIntl\./g, 'uses Intl (locale-dependent)', 'Keep formatting out of simulation code.'],
  ];
  for (const [re, message, fix] of banned) {
    for (const match of code.matchAll(re)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'determinism', message, fix });
  }
}

function checkSimIsolation(ctx, rel, source, code) {
  const { root, layout, report } = ctx;
  for (const match of code.matchAll(/\b(scheduleOnRN|scheduleOnUI|runOnJS|runOnUI)\s*\(/g)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'sim-isolated', message: `sim calls ${match[1]} itself`, fix: 'Push [kind, value, tick] events into the sim; runLoopFrame drains them once per frame and sends them to JS.' });
  const appLayers = ['app', 'features', 'stores', 'services', 'ui', 'canvas', 'hooks'].map((name) => `${layout.srcDir}/${name}/`);
  for (const { spec, index } of valueImports(code)) {
    const resolved = resolveImport(rel, spec, { root, aliases: layout.aliases });
    // react-native-worklets is in UI_PACKAGES too: a sim needs no scheduling API.
    const isUi = resolved.kind === 'external' ? UI_PACKAGES.test(spec) : appLayers.some((dir) => (resolved.path ?? '').startsWith(dir));
    if (isUi) report.problem({ file: rel, line: lineOf(source, index), rule: 'sim-isolated', message: `sim imports ${spec}`, fix: 'Keep the sim pure: typed arrays, the core kit (rng, geometry) and its own constants only; the host and the screen talk to JS and the app.' });
  }
}

function checkSim(ctx, rel, source, simDir) {
  const { report } = ctx;
  const code = maskComments(source);
  checkWorklet(ctx, rel, source);
  checkImportsResolve(ctx, rel, source);
  checkDeterminism(report, rel, code);
  for (const match of code.matchAll(/\b(timestamp|timeSincePreviousFrame|timeSinceFirstFrame|STEP_MS|dtMs|deltaMs|elapsedMs)\b/g)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'sim-ticks', message: `sim code uses ${match[1]}; gameplay counts ticks, never milliseconds`, fix: 'Express speeds per tick and timers in ticks (ints[TICK]); the loop turns frame time into ticks.' });
  checkSimIsolation(ctx, rel, source, code);
  checkTickAllocations(ctx, rel, simDir);
  checkStickTable(report, rel, code);
  for (const match of code.matchAll(MODULE_STATE)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'sim-module-state', message: `sim keeps state outside the sim object (${match[1] ?? match[2]} at module level): the UI thread works on its own captured copy, and saves and replays never see it`, fix: 'Keep every changing value in the typed arrays created by create…Sim (a header slot in ints, or a buffer); module-level values are UPPER_CASE constants only.' });
  for (const { name, index } of writtenConstContainers(code)) report.problem({ file: rel, line: lineOf(code, index), rule: 'sim-module-state', message: `sim writes to the module-level ${name} (an UPPER_CASE name does not make a container constant): the UI thread works on its own captured copy, and saves and replays never see it`, fix: 'Keep every changing value in the typed arrays created by create…Sim (a header slot in ints, or a buffer); a module-level table is read-only.' });
}

/** An UPPER_CASE module-level container (`[`, `{`, `new X`) is a constant table only while nothing writes to it. */
const UPPER_CONTAINER = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=\n]+)?=\s*(?:\[|\{|new\s+\w+)/gm;

function writtenConstContainers(code) {
  const found = [];
  for (const match of code.matchAll(UPPER_CONTAINER)) {
    const name = match[1];
    const write = new RegExp(`(?<![\\w$.])${name}(?:\\s*\\[[^\\]]*\\]\\s*(?:[-+*/%&|^]?=(?!=)|\\+\\+|--)|\\.(?:set|fill|push|pop|shift|unshift|splice|copyWithin|sort|reverse)\\s*\\()|(?:\\+\\+|--)${name}\\s*\\[`);
    if (write.test(code)) found.push({ name, index: match.index });
  }
  return found;
}

/** Every top-level function of a file (declarations and `const f = (…) => {…}`): name → { bodyStart, body }. */
function functionsOf(code) {
  const out = new Map();
  const declarations = /(?:^|\n)\s*(?:export\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  const arrows = /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:<[^>]*>)?\s*\(/g;
  for (const [re, isArrow] of [[declarations, false], [arrows, true]]) {
    for (const match of code.matchAll(re)) {
      const open = match.index + match[0].length - 1;
      const params = balancedParens(code, open);
      if (params === null) continue;
      const afterParams = open + params.length + 2;
      const arrow = isArrow ? /^\s*(?::[^=]*?)?=>\s*\{/.exec(code.slice(afterParams)) : null;
      if (isArrow && arrow === null) continue; // not an arrow function with a block body
      const bodyStart = isArrow ? afterParams + arrow[0].length - 1 : bodyBraceAfter(code, afterParams);
      if (bodyStart === -1) continue;
      out.set(match[1], { bodyStart, body: braceBody(code, bodyStart) });
    }
  }
  return out;
}

/** Index of a function's body brace after its parameters, skipping a return type (an object type literal included). */
function bodyBraceAfter(code, from) {
  const closers = { '{': '}', '(': ')', '<': '>', '[': ']' };
  const skipGroup = (open) => {
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === code[open]) depth += 1;
      else if (code[i] === closers[code[open]]) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return code.length;
  };
  let expectType = false;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (/\s/.test(ch)) continue;
    if (ch === ';') return -1; // an overload signature: no body
    if (ch === '{' && !expectType) return i;
    if (ch === ':' || ch === '|' || ch === '&') expectType = true;
    else if (ch === '=' && code[i + 1] === '>') {
      expectType = true;
      i += 1;
    } else if (ch in closers) {
      i = skipGroup(i);
      expectType = false;
    } else expectType = false;
  }
  return -1;
}

function braceBody(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return code.slice(open + 1);
}

/** Names a sim imports as values from the geometry kit's vec2/sweep modules, which return a new object on every call. */
function allocatingImports(ctx, rel, code) {
  const { root, layout, p } = ctx;
  const names = new Set();
  for (const match of code.matchAll(/^[ \t]*import\s+\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/gm)) {
    const target = resolveImport(rel, match[2], { root, aliases: layout.aliases }).path ?? '';
    if (!/\/(vec2|sweep)(\.ts)?$/.test(target) || !target.startsWith(`${p.geom}/`)) continue;
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && !part.trim().startsWith('type ') && !/^[A-Z]/.test(name)) names.add(name);
    }
  }
  return names;
}

/** Local names a file imports as values from another file of the same sim folder: local name → { file, name }. */
function siblingImports(ctx, rel, code, simDir) {
  const { root, layout } = ctx;
  const out = new Map();
  for (const match of code.matchAll(/^[ \t]*import\s+\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/gm)) {
    const resolved = resolveImport(rel, match[2], { root, aliases: layout.aliases });
    if (!resolved.exists || !resolved.path.startsWith(`${simDir}/`) || resolved.path === rel) continue;
    for (const part of match[1].split(',')) {
      const trimmed = part.trim();
      if (trimmed === '' || trimmed.startsWith('type ')) continue;
      const [name, local = name] = trimmed.split(/\s+as\s+/);
      out.set(local, { file: resolved.path, name });
    }
  }
  return out;
}

/** One sim file as the tick walk needs it, read once per run. */
function simUnit(ctx, rel, simDir) {
  ctx.simUnits ??= new Map();
  if (!ctx.simUnits.has(rel)) {
    const code = maskComments(read(ctx.root, rel) ?? '');
    ctx.simUnits.set(rel, { code, functions: functionsOf(code), kitAllocators: allocatingImports(ctx, rel, code), siblings: siblingImports(ctx, rel, code, simDir) });
  }
  return ctx.simUnits.get(rel);
}

/** The allocations in a function body; in a helper that wraps nextU32, its RNG state tuple is the documented exception. */
function allocationsIn(body) {
  const isRngWrapper = /\bnextU32\s*\(/.test(body);
  return [...body.matchAll(ALLOCATION)].filter((match) => {
    if (!isRngWrapper) return true;
    const line = body.slice(body.lastIndexOf('\n', match.index) + 1, body.indexOf('\n', match.index) === -1 ? body.length : body.indexOf('\n', match.index));
    return !RNG_TUPLE.test(line);
  });
}

/**
 * The exported step…() functions and every helper they reach (in the same file or imported from a
 * sibling file of the sim folder) run once per tick, up to 30 times a frame on the UI thread, so none
 * of them may allocate. The one exception is the RNG state tuple of a helper that wraps nextU32 (the
 * sim's RNG draw, documented as fine for occasional spawns); the rest of that helper is still checked.
 */
function checkTickAllocations(ctx, rel, simDir) {
  const { report } = ctx;
  ctx.tickSeen ??= new Set();
  const start = simUnit(ctx, rel, simDir);
  const queue = [...start.functions.keys()].filter((name) => /^step/.test(name) && new RegExp(`export\\s+function\\s+${name}\\b`).test(start.code)).map((name) => ({ file: rel, name }));
  const enqueue = (item) => {
    const key = `${item.file}#${item.name}`;
    if (ctx.tickSeen.has(key)) return;
    ctx.tickSeen.add(key);
    queue.push(item);
  };
  for (const item of queue.splice(0)) enqueue(item);
  while (queue.length > 0) {
    const { file, name } = queue.shift();
    const unit = simUnit(ctx, file, simDir);
    const fn = unit.functions.get(name);
    if (fn === undefined) continue;
    const { bodyStart, body } = fn;
    const [alloc] = allocationsIn(body);
    if (alloc) report.problem({ file, line: lineOf(unit.code, bodyStart + 1 + alloc.index), rule: 'sim-no-alloc', message: `${name} runs every tick and allocates or grows an array (${alloc[0].trim().replace(/\s*\($/, '')})`, fix: 'Allocate buffers once in create…Sim and write into them in place (events go into the ints queue, scratch values into a typed array); the loop may run 30 ticks in one frame.' });
    for (const call of body.matchAll(/\b(\w+)\s*\(/g)) {
      if (!unit.kitAllocators.has(call[1])) continue;
      report.problem({ file, line: lineOf(unit.code, bodyStart + 1 + call.index), rule: 'sim-no-alloc', message: `${name} runs every tick and calls ${call[1]}() from the vec2/sweep kit, which returns a new object on every call`, fix: 'In a UI-thread sim write the maths with scalars on the typed arrays (dx * dx + dy * dy < r * r, v - 2(v.n)n per component); vec2 and sweep are for simulate-then-replay rules on the JS thread.' });
      break;
    }
    for (const call of body.matchAll(/\b(\w+)\s*\(/g)) {
      if (unit.functions.has(call[1])) enqueue({ file, name: call[1] });
      else if (unit.siblings.has(call[1])) enqueue(unit.siblings.get(call[1]));
    }
  }
}

function checkStickTable(report, rel, code) {
  const match = /\bconst\s+STICK\w*\s*=\s*\[([^\]]*)\]/.exec(code);
  if (!match) return;
  const values = match[1].split(',').map((v) => v.trim()).filter(Boolean).map(Number);
  const expected = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]).flat();
  const isSame = values.length === 32 && values.every((v, i) => Math.abs(v - expected[i]) <= 1e-4);
  if (!isSame) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'stick-table', message: 'the STICK table is not the 16 unit vectors (cos, sin) of (k-1) x 22.5 degrees in order (y down)', fix: "Copy the table from the template sim; the stick gesture (canvas-gestures-and-hit-testing's STICK_DIRECTIONS) uses the same order: 1 right, 5 down, 9 left, 13 up." });
}

function checkSimTests(ctx, simDir) {
  const { root, report } = ctx;
  const titles = tree(root, simDir, ['*.test.ts']).flatMap((rel) => titlesOf(read(root, rel) ?? ''));
  if (!titles.some((t) => /replay/i.test(t))) report.problem({ file: simDir, rule: 'sim-replay-test', message: 'no test replays a recorded (tick, command) log and compares the world', fix: 'Copy the template <game-id>-sim.test.ts: play with a bot, replay the command log, compare fingerprints.' });
  if (!titles.some((t) => /group|frames|60 vs 120/i.test(t))) report.problem({ file: simDir, rule: 'sim-replay-test', message: 'no test proves the world is the same however ticks are grouped into frames', fix: 'Step one tick at a time and in 1-3 tick frames with the same bot; the fingerprints must be equal.' });
}

/** The game exposes its sim to the host as a RealtimeSpec, and proves the snapshot round trip. */
function checkRealtimeSpec(ctx, id) {
  const { root, p, report } = ctx;
  const gameDir = `${p.games}/${id}`;
  const files = tree(root, gameDir, ['*.ts', '*.tsx']).filter((rel) => !rel.startsWith(`${gameDir}/sim/`));
  const specFiles = files.filter((rel) => !isTestFile(rel) && /\bRealtimeSpec\s*</.test(maskComments(read(root, rel) ?? '')));
  if (specFiles.length === 0) {
    report.problem({ file: `${gameDir}/${id}-realtime.ts`, rule: 'realtime-spec', message: 'the real-time game exposes no RealtimeSpec (createSim, step, drainEvents, snapshot, savePoints, isSavePoint)', fix: 'Copy templates/src/games/__GAME_ID__/__GAME_ID__-realtime.ts (+ test) and join it to the game module as `realtime`.' });
    return;
  }
  const titles = files.filter((rel) => /\.test\.tsx?$/.test(rel)).flatMap((rel) => titlesOf(read(root, rel) ?? ''));
  if (!titles.some((t) => /round.?trip/i.test(t))) report.problem({ file: specFiles[0], line: 1, rule: 'realtime-spec', message: 'no test proves the snapshot round trip (snapshot(createSim(snapshot(sim))) equals snapshot(sim))', fix: 'Copy the template <game-id>-realtime.test.ts: step a run, snapshot it, rebuild it and compare; a restored run must continue exactly.' });
}

/** A real-time surface is a canvas surface too: a draw-call budget test and pixel goldens at 3 sizes x 3 moments. */
function checkArenaSurface(ctx, id, goldens) {
  const { root, layout, report } = ctx;
  const dir = `${ctx.p.games}/${id}/canvas`;
  const drawTests = tree(root, dir, ['draw*.test.ts']);
  const texts = drawTests.map((rel) => maskComments(read(root, rel) ?? ''));
  const budgets = texts.flatMap((text, i) => [...text.matchAll(/DRAW_CALL_BUDGET\s*=\s*(\d+)|toBeLessThanOrEqual\(\s*(\d+)\s*\)/g)].map((m) => ({ value: Number(m[1] ?? m[2]), file: drawTests[i], line: lineOf(text, m.index) })));
  // Asserted, not just declared: toBeLessThanOrEqual(<number> | <…BUDGET…>); toBeLessThanOrEqual(width) proves nothing.
  if (!texts.some((text) => /toBeLessThanOrEqual\(\s*(\d+|[A-Z][A-Z0-9_]*BUDGET[A-Z0-9_]*)\s*\)/.test(text))) report.problem({ file: `${dir}/draw-arena.test.ts`, rule: 'arena-draw-budget', message: 'the real-time surface has no draw test asserting a draw-call budget', fix: "Copy templates/src/games/__GAME_ID__/canvas/draw-arena.test.ts: count canvas calls with every entity slot in play and assert <= the game's budget." });
  for (const budget of budgets.filter((b) => b.value > MAX_DRAW_CALLS)) report.problem({ file: budget.file, line: budget.line, rule: 'arena-draw-budget', message: `draw-call budget ${budget.value} is above the app-wide cap of ${MAX_DRAW_CALLS}`, fix: 'Draw hundreds of identical sprites as one atlas call; raising a budget needs an on-device frame report.' });
  const expected = `${layout.testDir}/goldens/canvas/${id}-arena.golden.test.ts`;
  const mine = goldens.filter((g) => g.code.includes(`games/${id}/canvas/`));
  if (mine.length === 0) {
    report.problem({ file: expected, rule: 'arena-golden', message: `the real-time surface of ${id} has no pixel golden`, fix: "Copy templates/test/goldens/canvas/__GAME_ID__-arena.golden.test.ts, fill it in, run 'npx jest <file> --selectProjects golden -u', and open every PNG." });
    return;
  }
  for (const { rel, code } of mine) {
    const sizes = new Set([...code.matchAll(/\bwidth\s*:\s*(\d+)/g)].map((m) => m[1])).size;
    if (!/\bpaintSimPng\s*\(/.test(code) || !/\btoMatchImageSnapshot\s*\(/.test(code)) report.problem({ file: rel, line: 1, rule: 'arena-golden', message: 'the golden does not render through paintSimPng and toMatchImageSnapshot', fix: "Render with paintSimPng(Skia, { draw, sim, … }) (the device's draw) and assert toMatchImageSnapshot with the skia-golden matcher." });
    if (sizes < 3 || !/\[\s*0\s*,\s*0\.5\s*,\s*1\s*\]/.test(code)) report.problem({ file: rel, line: 1, rule: 'arena-golden', message: `the golden renders ${sizes} canvas size(s) or not the moments [0, 0.5, 1] of a scripted run`, fix: 'Render 390x560, 1024x700 and 320x400 at MOMENTS = [0, 0.5, 1] of RUN_TICKS.' });
    const snapshots = `${dirname(rel)}/__image_snapshots__`;
    const pngs = isDir(root, snapshots) ? readdirSync(join(root, snapshots)).filter((name) => name.startsWith(`${id}-`) && name.endsWith('.png')) : [];
    if (pngs.length < 9) report.problem({ file: `${snapshots}/${id}-*.png`, rule: 'arena-golden', message: `${pngs.length} baseline PNG(s) for ${id}; 9 (3 sizes x 3 moments) are required`, fix: `Run npx jest ${rel} --selectProjects golden -u, open every PNG, and commit them on purpose (golden-and-snapshot-tests).` });
  }
}

/** Index ranges of loop bodies: for/while/do blocks or single statements, and callbacks of forEach/map/reduce/…. */
function loopRanges(code) {
  const ranges = [];
  for (const match of code.matchAll(/\b(?:for|while)\s*\(|\.(?:forEach|map|flatMap|reduce|filter|some|every)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const inner = balancedParens(code, open);
    if (inner === null) continue;
    const close = open + inner.length + 1;
    if (match[0].startsWith('.')) {
      ranges.push([open, close]);
      continue;
    }
    const next = /\S/.exec(code.slice(close + 1));
    if (next === null) continue;
    const at = close + 1 + next.index;
    if (code[at] === '{') ranges.push([at, at + braceBody(code, at).length + 1]);
    else ranges.push([at, code.indexOf(';', at) === -1 ? code.length : code.indexOf(';', at)]);
  }
  for (const match of code.matchAll(/\bdo\s*\{/g)) {
    const at = match.index + match[0].length - 1;
    ranges.push([at, at + braceBody(code, at).length + 1]);
  }
  return ranges;
}

/**
 * One batch per frame: exactly one scheduleOnRN(wiring.onEvents, x) call, x is the array assigned from
 * wiring.drainEvents(…), and the call sits inside no loop (a for over events, even split across lines).
 */
function isOneBatchPerFrame(code) {
  const calls = [...code.matchAll(/\bscheduleOnRN\s*\(\s*wiring\.onEvents\s*,\s*([^)]*)\)/g)];
  if (calls.length !== 1) return false;
  const [call] = calls;
  const arg = call[1].trim();
  if (!/^\w+$/.test(arg) || !new RegExp(`\\b(?:const|let)\\s+${arg}\\b[^=;]*=\\s*wiring\\.drainEvents\\s*\\(`).test(code)) return false;
  return !loopRanges(code).some(([from, to]) => call.index > from && call.index < to);
}

function checkKit(ctx) {
  const { root, p, report } = ctx;
  const fixed = read(root, p.fixedStep);
  if (fixed !== null) {
    const code = maskComments(fixed);
    if (!/STEP_MS\s*=\s*1000\s*\/\s*120\b/.test(code)) report.problem({ file: p.fixedStep, line: 1, rule: 'step-constants', message: 'STEP_MS is not 1000 / 120', fix: 'Keep export const STEP_MS = 1000 / 120; ticks, not frames, define gameplay speed.' });
    if (!/MAX_FRAME_MS\s*=\s*250\b/.test(code)) report.problem({ file: p.fixedStep, line: 1, rule: 'step-constants', message: 'MAX_FRAME_MS is not 250', fix: 'Keep export const MAX_FRAME_MS = 250 (the catch-up clamp after a stall).' });
  }
  const runner = read(root, p.runner);
  if (runner !== null) {
    const code = maskComments(runner);
    const isBatched = isOneBatchPerFrame(code);
    for (const [isMet, what] of [[/\bplanSteps\s*\(/.test(code), 'plan steps with planSteps()'], [/\.modify\s*\(\s*\)/.test(code), 'call sim.modify() after mutating in place'], [/\bcatch\s*\(/.test(code), 'catch errors'], [isBatched, 'send events to JS once per frame (one scheduleOnRN with the drained array)']]) {
      if (!isMet) report.problem({ file: p.runner, line: 1, rule: 'loop-runner', message: `the loop runner does not ${what}`, fix: "Restore run-loop-frame.ts from this skill's template." });
    }
  }
  for (const rel of p.UI_THREAD) {
    const source = read(root, rel);
    if (source === null) continue;
    checkWorklet(ctx, rel, source);
    if (!rel.startsWith(`${p.host}/`)) checkDeterminism(report, rel, maskComments(source));
  }
  for (const rel of [...p.KIT, ...p.HOST].filter(sourceFile)) {
    const source = read(root, rel);
    if (source !== null) checkImportsResolve(ctx, rel, source);
  }
}

function checkComponents(ctx, files) {
  const { root, report } = ctx;
  for (const rel of files) {
    const code = maskComments(read(root, rel) ?? '');
    for (const match of code.matchAll(/\buseFrameCallback\s*\(/g)) {
      const args = balancedParens(code, match.index + match[0].length - 1) ?? '';
      if (/runLoopFrame/.test(args) && !FRAME_CALLBACK.test(args)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'frame-callback-body', message: 'the loop frame callback is not a single runLoopFrame call that starts inactive', fix: 'Write useFrameCallback((info) => { runLoopFrame(wiring, info.timeSincePreviousFrame); }, false).' });
    }
    const loopAt = code.search(/\buseFixedStepLoop\s*\(/);
    if (loopAt === -1 || /export\s+function\s+useFixedStepLoop\b/.test(code)) continue;
    const lifecycle = /\buseCanvasLifecycle\s*\(/.exec(code);
    if (lifecycle === null) {
      report.problem({ file: rel, line: lineOf(code, loopAt), rule: 'loop-lifecycle', message: 'runs the fixed-step loop without useCanvasLifecycle (it would keep simulating in the background, unfocused or covered)', fix: 'Call useCanvasLifecycle: onPause stops the loop, takes a save point and shows the pause UI; onResume starts it.' });
      continue;
    }
    const args = balancedParens(code, lifecycle.index + lifecycle[0].length - 1) ?? '';
    if (!isPauseGated(args)) report.problem({ file: rel, line: lineOf(code, lifecycle.index), rule: 'loop-no-auto-resume', message: 'the lifecycle that runs the loop is not gated on isPaused, so the loop restarts by itself when the app returns', fix: 'Pass isInterrupted: props.isInterrupted || props.isPaused || props.isEnded; onAutoPause shows the pause UI and only the player resumes.' });
  }
}

/** A pause flag that is read, never its setter (setIsPaused, setWasPaused are writes). */
const PAUSE_READ = /(?<![\w$])(?!set[A-Z])[A-Za-z_$][\w$]*[Pp]aused[\w$]*(?![\w$])/;

/**
 * loop-no-auto-resume: the lifecycle's isInterrupted value reads a pause flag, or (a hand-written
 * host without isInterrupted) its onResume does. A text heuristic: references/checker.md lists what
 * it cannot see.
 */
function isPauseGated(args) {
  const interrupted = /\bisInterrupted\s*:\s*([^,\n]*)/.exec(args);
  if (interrupted !== null) return PAUSE_READ.test(interrupted[1]);
  const resume = /\bonResume\s*:\s*/.exec(args);
  if (resume === null) return false;
  const body = args.slice(resume.index + resume[0].length);
  const open = body.search(/[({]/);
  const inner = open === -1 ? body : (body[open] === '(' ? balancedParens(body, open) : balancedBraces(body, open)) ?? body;
  return PAUSE_READ.test(inner);
}

/** The text inside the braces that open at `index`, or null when they never close. */
function balancedBraces(text, index) {
  let depth = 0;
  for (let at = index; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1;
    else if (text[at] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(index + 1, at);
    }
  }
  return null;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${root} has no package.json`, 'Run from the app repo root (or pass it as the argument); in a monorepo pass each app folder.');
  const layout = resolveLayout(root);
  const p = paths(layout, options);
  const report = createReporter({ name: 'check-realtime-loop', json: options.json });
  const ctx = { root, layout, p, report };
  const gameIds = isDir(root, p.games) ? readdirSync(join(root, p.games)).filter((id) => isDir(root, `${p.games}/${id}`)).sort() : [];
  const simGames = gameIds.filter((id) => isDir(root, `${p.games}/${id}/sim`));
  // A missing kit resolves to the unprobed path (no extension): the import still marks the file.
  const isFixedStep = (path) => path === p.fixedStep || path === p.fixedStep.replace(/\.ts$/, '');
  const importsFixedStep = (rel) => valueImports(maskComments(read(root, rel) ?? '')).some(({ spec }) => isFixedStep(resolveImport(rel, spec, { root, aliases: layout.aliases }).path));
  const replayFiles = gameIds.flatMap((id) => tree(root, `${p.games}/${id}/rules`, ['*.ts'])).filter((rel) => !isTestFile(rel) && importsFixedStep(rel));
  // Only this skill's own folders prove real-time code: an app may keep its own src/core/geom/vec2.ts
  // (a drawing app, a turn-based game), and that alone never makes the check apply.
  const hasKit = [...p.KIT, ...p.HOST].filter((rel) => !rel.startsWith(`${p.geom}/`)).some((rel) => existsSync(join(root, rel)));
  if (simGames.length === 0 && replayFiles.length === 0 && !hasKit) {
    return report.notApplicable(`no real-time code: no ${p.games}/<id>/sim folder, no module importing ${p.fixedStep}, and no loop kit in ${p.kit} or ${p.host}`);
  }
  const required = simGames.length > 0 ? [...p.KIT, ...p.HOST] : p.KIT;
  for (const rel of required) if (!existsSync(join(root, rel))) report.problem({ file: rel, rule: 'loop-file-missing', message: 'loop kit file is missing', fix: "Copy it from this skill's templates (the file whose first line names this path) and run its tests." });
  checkKit(ctx);
  const goldens = simGames.length === 0 ? [] : walkRepo(root, { include: ['*.golden.test.ts', '*.golden.test.tsx'] }).filter((rel) => rel.startsWith(`${layout.testDir}/`)).map((rel) => ({ rel, code: maskComments(read(root, rel) ?? '') }));
  let checked = 0;
  for (const id of simGames) {
    const simDir = `${p.games}/${id}/sim`;
    for (const rel of tree(root, simDir, ['*.ts']).filter(sourceFile)) {
      checkSim(ctx, rel, read(root, rel), simDir);
      checked += 1;
    }
    checkSimTests(ctx, simDir);
    checkRealtimeSpec(ctx, id);
    checkArenaSurface(ctx, id, goldens);
    // The real-time picture calls the game's draw on the UI thread (recordSim inside useDerivedValue).
    for (const rel of tree(root, `${p.games}/${id}/canvas`, ['*.ts']).filter((f) => /\/draw[^/]*\.ts$/.test(f) && sourceFile(f))) {
      const source = read(root, rel);
      checkWorklet(ctx, rel, source);
      checkImportsResolve(ctx, rel, source);
      checked += 1;
    }
  }
  for (const rel of replayFiles) {
    const code = maskComments(read(root, rel));
    checkDeterminism(report, rel, code);
    if (!/\batMs\b/.test(code)) report.problem({ file: rel, line: 1, rule: 'replay-events-timed', message: 'simulate-then-replay code emits no timed events (atMs)', fix: 'Emit { kind, …, atMs: tickToMs(tick) } at every change of motion so the timeline can replay it.' });
    if (!/\bmax_?ticks\b/i.test(code)) report.problem({ file: rel, line: 1, rule: 'replay-capped', message: 'simulate-then-replay code has no hard tick cap (maxTicks)', fix: 'Loop while bodies move AND tick <= maxTicks, and end every body at the cap, so a volley always ends and a bot never hangs.' });
    checked += 1;
  }
  // Every source file of the repo (single app or workspaces); installed skills and build output are pruned.
  const components = walkRepo(root, { include: ['*.ts', '*.tsx'] }).filter(sourceFile);
  checkComponents(ctx, components);
  return report.finish({ checked: checked + required.length, unit: 'loop files' });
});
