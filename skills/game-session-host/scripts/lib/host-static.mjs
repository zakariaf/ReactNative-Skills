// host-static.mjs: the checks read from the source: the host's files and tests, casts, type-erased
// screens, intents only through the game, the composition (hosts created once, never at import
// time, provided, options from the config), the Game screen's wiring, and each game's binding,
// registration and gameFacing record. Not an entry point.

import { posix } from 'node:path';

import { maskComments, matchGlob, notYetCreated, parseJsonc } from '../check-lib.mjs';
import { appSources, constOf, exportNames, hostFiles, lineAt, sourcesUnder } from './host-layout.mjs';
import { importsOf, resolveSpecifier, scanSource } from './source-scan.mjs';

const fileFix = (rel) => `Copy templates/${rel} from this skill (with its test); the host is installed verbatim.`;

/** host-file-missing, host-export-missing, host-test-missing. */
export function checkHostFiles(host, report) {
  let checked = 0;
  for (const file of hostFiles(host)) {
    checked += 1;
    if (!host.exists(file.rel)) {
      report.problem({ file: file.rel, rule: 'host-file-missing', message: 'game host file is missing', fix: fileFix(file.rel) });
      continue;
    }
    const exported = exportNames(maskComments(host.read(file.rel)));
    for (const name of file.exports.filter((item) => !exported.has(item))) {
      report.problem({ file: file.rel, line: 1, rule: 'host-export-missing', message: `does not export ${name}`, fix: `Restore the file from templates/${file.rel}; the screens, the registry and the checker use ${name}.` });
    }
    const test = file.rel.replace(/\.(tsx?)$/, '.test.$1');
    const altTest = file.rel.replace(/\.tsx?$/, (ext) => (ext === '.ts' ? '.test.tsx' : '.test.ts'));
    if (file.isRuntime && !host.exists(test) && !host.exists(altTest)) {
      report.problem({ file: test, rule: 'host-test-missing', message: 'this host behaviour has no test beside it', fix: `Copy templates/${test}: the tests are the proof that runs are saved before they show.` });
    }
  }
  return checked;
}

const CAST = /\bas\s+unknown\s+as\b|\bas\s+any\b|<any>|\bas\s+(?:HostedGame|GameModule|SessionController)\b/;

/** unsafe-cast: no cast anywhere in the seam, the run store, the registry or a game's binding. */
export function checkCasts(host, ids, report) {
  const dirs = [host.hostDir, host.storeDir, host.resultsDir];
  const files = [...dirs.flatMap((dir) => sourcesUnder(host, dir)), ...[host.registry, ...ids.flatMap((id) => bindingFiles(host, id))].filter((rel) => host.exists(rel)).map((rel) => ({ rel, source: host.read(rel) }))];
  for (const { rel, source } of files) {
    const code = maskComments(source);
    const cast = CAST.exec(code);
    if (cast) report.problem({ file: rel, line: lineAt(code, cast.index), rule: 'unsafe-cast', message: `casts (${cast[0]}) in the game seam`, fix: 'createGameHost is the one generic seam: close over the typed module (one factory per game in the registry) instead of casting it to store or pass it.' });
  }
}

function bindingFiles(host, id) {
  return [`${host.gamesDir}/${id}/${id}-hosted.ts`, `${host.gamesDir}/${id}/${id}-hosted.tsx`];
}

/** Folders whose code must never see a game's own types: screens, routes, UI, stores, shared hooks. */
function erasedZones(host) {
  const { layout } = host;
  return [layout.routesDir, layout.featuresDir, layout.uiDir, layout.storesDir, host.hooksDir];
}

/** Seam files that carry a game's own types (the board factory and the hooks are erased). */
const TYPED_PARTS = ['hosted-game', 'session-controller', 'host-runs'];

/** screens-type-erased: no game folder, no typed seam part, no HostedGame/GameModule name outside the seam. */
export function checkTypeErasure(host, report) {
  const zones = erasedZones(host);
  const files = appSources(host).filter(({ rel }) => zones.some((zone) => rel.startsWith(`${zone}/`)));
  for (const { rel, source } of files) {
    for (const entry of importsOf(scanSource(source))) {
      const target = resolveSpecifier(rel, entry.spec, { root: host.root });
      if (target === null) continue;
      const inGame = target.startsWith(`${host.gamesDir}/`) && target.slice(host.gamesDir.length + 1).includes('/');
      const typed = target.startsWith(`${host.hostDir}/`) && TYPED_PARTS.some((part) => posix.basename(target).startsWith(part));
      if (inGame || typed || target === `${host.kitDir}/game-module.ts`) {
        report.problem({ file: rel, line: entry.line, rule: 'screens-type-erased', message: `imports ${entry.spec}, a typed part of a game`, fix: 'Screens, routes, UI and stores see only the erased GameHost and SessionHandle (useGameHost, useGameSession); only the registry names a game.' });
      }
    }
    const code = maskComments(source);
    const named = /\b(?:HostedGame|GameModule|SessionController)\b/.exec(code);
    if (named) report.problem({ file: rel, line: lineAt(code, named.index), rule: 'screens-type-erased', message: `names ${named[0]} outside the game seam`, fix: 'Only the seam (createGameHost) and the registry touch the typed game; screens use GameHost and SessionView.' });
  }
}

/** intent-legality: moves are made only by the game's intentToMove, inside the controller. */
export function checkIntentLegality(host, report) {
  const zones = erasedZones(host);
  const outside = appSources(host).filter(({ rel }) => zones.some((zone) => rel.startsWith(`${zone}/`)) && !rel.startsWith(`${host.storeDir}/`));
  for (const { rel, source } of outside) {
    const code = maskComments(source);
    const hit = /\.applyMove\s*\(|\bapplyMove\s*\(|type\s*:\s*'apply-move'|\.sendIntent\s*\(/.exec(code);
    if (hit) report.problem({ file: rel, line: lineAt(code, hit.index), rule: 'intent-legality', message: `makes a move itself (${hit[0].trim()})`, fix: 'Screens send commands (undo, hint, continue, pause, finish, leave); the board host sends intents and only the game\'s intentToMove turns one into a move.' });
  }
  const controller = `${host.hostDir}/session-controller.ts`;
  const code = maskComments(host.read(controller));
  if (code !== '' && !/deps\.intentToMove\s*\(/.test(code)) {
    report.problem({ file: controller, line: 1, rule: 'intent-legality', message: 'the controller turns intents into moves without the game\'s intentToMove', fix: 'Restore sendIntent from the template: const move = deps.intentToMove(state, intent); if (move !== null) dispatch apply-move.' });
  }
}

/**
 * True when a call at `index` runs at import time: outside every function body (brace depth 0)
 * and not the body of an arrow function (`(deps) => createGameHost(...)` runs only when called).
 * A declaration (`function createGameHosts(`) is not a call.
 */
function isModuleLevel(masked, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') depth -= 1;
  }
  const before = masked.slice(Math.max(0, index - 40), index);
  return depth === 0 && !/(=>|\bfunction)\s*$/.test(before);
}

/** A lazy initializer: the call is the body of `useState(() =>` or `useRef(` / `??=` (runs once). */
const ONCE_BEFORE = /(?:\buseState\s*(?:<[^>]*>)?\s*\(\s*\(\s*\)\s*=>\s*|\.current\s*\?\?=\s*)$/;

/**
 * host-in-render: in a component or hook file (.tsx, or use-*.ts), a host created outside a
 * useState initializer runs on every render (re-validating saved runs, replacing the hosts). A
 * heuristic over the text before the call: wrapping it in a helper the body calls is not seen.
 */
function isRenderCall(rel, masked, index) {
  const isReactFile = rel.endsWith('.tsx') || /(?:^|\/)use-[^/]*\.ts$/.test(rel);
  return isReactFile && !isModuleLevel(masked, index) && !ONCE_BEFORE.test(masked.slice(Math.max(0, index - 80), index));
}

/** host-not-created, host-at-import, host-in-render, host-not-provided, continue-from-config. */
export function checkComposition(host, hasGames, report) {
  const files = appSources(host).filter(({ rel }) => !rel.startsWith(`${host.hostDir}/`));
  const creators = files.filter(({ masked }) => /(?<![\w$.])createGameHost\s*\(/.test(masked));
  if (hasGames && creators.length === 0) {
    report.problem({ file: host.registry, rule: 'host-not-created', message: 'no app code calls createGameHost(game, deps)', fix: 'Write src/games/game-registry.ts (examples/app-wiring/game-registry.ts): one factory per game calling createGameHost, and createGameHosts(deps) for the composition root.' });
  }
  for (const { rel, masked } of files) {
    for (const match of masked.matchAll(/(?<![\w$.])createGameHosts?\s*\(/g)) {
      if (isModuleLevel(masked, match.index)) report.problem({ file: rel, line: lineAt(masked, match.index), rule: 'host-at-import', message: `${match[0].replace(/\s*\($/, '')} runs at import time`, fix: 'Create the hosts once in the composition root (a useState initializer after the data layer opened); a host reads and validates saved runs, which must never happen at import.' });
      else if (isRenderCall(rel, masked, match.index)) report.problem({ file: rel, line: lineAt(masked, match.index), rule: 'host-in-render', message: `${match[0].replace(/\s*\($/, '')} runs on every render`, fix: 'Create the hosts in a useState initializer: const [hosts] = useState(() => createGameHosts({ ... })). A plain call in the body re-validates saved runs and replaces the hosts each render (the React Compiler may memoize it, but that is not a guarantee).' });
    }
  }
  if (hasGames && !files.some(({ masked }) => /<GameHostsProvider\b/.test(masked))) {
    report.problem({ file: `${host.layout.featuresDir}/root-navigator`, rule: 'host-not-provided', message: 'no app code renders <GameHostsProvider hosts={...}>', fix: 'Mount it once inside the navigation theme (examples/app-wiring/games-root.tsx) so every screen finds the hosts.' });
  }
  for (const { rel, source } of files.filter((file) => file.rel !== host.config)) {
    const code = maskComments(source);
    const literal = /\bisContinueAllowed\s*:\s*(?:true|false)\b/.exec(code);
    if (literal) report.problem({ file: rel, line: lineAt(code, literal.index), rule: 'continue-from-config', message: 'the rescue switch is a literal here', fix: `Read it from ${host.config} (GAME_HOST_CONFIG[id]): the checker compares that file with the game's rules.` });
  }
}

const SCREEN_NEEDS = [
  { pattern: /(?<![\w$.])usePauseOnBackground\s*\(/, message: 'does not pause the run when the app or the screen goes away (usePauseOnBackground)' },
  { pattern: /(?<![\w$.])usePreventRemove\s*\(/, message: 'lets Back (header, iOS swipe, Android back) remove a live run (usePreventRemove)' },
  { pattern: /(?<![\w$.])backCommandOf\s*\(/, message: 'guards Back without backCommandOf (Back in Pause or on a pending loss would leave the run behind)' },
  { pattern: /<BoardHost\b/, message: 'does not render the host\'s BoardHost' },
  { pattern: /(?<![\w$.])isLossStranded\s*\(/, message: 'never finishes a loss nobody can rescue (isLossStranded)' },
  { pattern: /type\s*:\s*'finish'/, message: 'never sends { type: \'finish\' } (a stranded loss would never show its result)' },
];

/**
 * The first argument of usePreventRemove when it neither calls backCommandOf nor names a variable
 * assigned from it (`usePreventRemove(view?.status === 'playing', ...)`), else null. A text
 * heuristic: a condition computed in another hook is not followed (references/host-architecture.md).
 */
function guardNotFromPolicy(code) {
  const call = /(?<![\w$.])usePreventRemove\s*\(\s*([^,]+),/.exec(code);
  if (call === null) return null;
  const condition = call[1].trim();
  if (/(?<![\w$.])backCommandOf\s*\(/.test(condition)) return null;
  const names = [...code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*backCommandOf\s*\(/g)].map((match) => match[1]);
  return names.some((name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(condition)) ? null : condition;
}

/** game-screen-wiring: the feature that opens a run pauses it, renders the board and never strands a loss. */
export function checkGameScreen(host, hasGames, report) {
  const files = appSources(host).filter(({ rel }) => rel.startsWith(`${host.layout.featuresDir}/`));
  const openers = files.filter(({ masked }) => /(?<![\w$.])useGameSession\s*\(/.test(masked));
  if (openers.length === 0) {
    const file = `${host.layout.featuresDir}/game`;
    const reason = hasGames ? notYetCreated(host.root, { file, owner: 'the Game screen step of game-session-host' }) : null;
    if (reason) report.skip({ file, rule: 'game-screen-wiring', message: reason });
    return 0;
  }
  for (const folder of new Set(openers.map(({ rel }) => posix.dirname(rel)))) {
    const code = files.filter(({ rel }) => posix.dirname(rel) === folder || rel.startsWith(`${folder}/components/`)).map(({ source }) => maskComments(source)).join('\n');
    for (const need of SCREEN_NEEDS.filter((item) => !item.pattern.test(code))) {
      report.problem({ file: folder, rule: 'game-screen-wiring', message: `the Game screen ${need.message}`, fix: 'Follow examples/game-screen/: the model hook opens the run with useGameSession, calls usePauseOnBackground, guards Back with usePreventRemove(backCommandOf(view) !== null, ...), finishes a stranded loss once per eventSeq, and the screen renders <BoardHost testID=... />.' });
    }
    const guard = guardNotFromPolicy(code);
    if (guard !== null) report.problem({ file: folder, rule: 'game-screen-wiring', message: `the Game screen guards Back on \`${guard}\`, not on backCommandOf (Back in Pause or on a pending loss would leave the run behind)`, fix: 'Make the guard\'s condition the policy: const back = backCommandOf(view); usePreventRemove(back !== null, ...).' });
  }
  return openers.length;
}

/** hosted-binding, game-registered, game-facing-recorded: one game's assembly into the app. */
export function checkGameBinding(host, id, report) {
  const rel = bindingFiles(host, id).find((file) => host.exists(file));
  const constName = `${constOf(id)}_HOSTED`;
  if (rel === undefined) {
    report.problem({ file: bindingFiles(host, id)[0], rule: 'hosted-binding', message: 'the game has no hosted binding', fix: `Write it from examples/app-wiring/lights-out-hosted.ts: export const ${constName}: HostedGame<...> = { ...${constOf(id)}_GAME, Surface: <the game's board> }.` });
  } else {
    const code = maskComments(host.read(rel));
    const member = (name) => `${name}\\s*:\\s*[A-Za-z_$][\\w$]*`;
    const shape = new RegExp(`export\\s+const\\s+${constName}\\s*:\\s*HostedGame\\s*<[\\s\\S]*?>\\s*=\\s*\\{\\s*\\.\\.\\.${constOf(id)}_GAME\\s*,\\s*${member('Surface')}\\s*(?:,\\s*${member('tutorial')}\\s*)?,?\\s*\\}`);
    if (!shape.test(code)) report.problem({ file: rel, line: 1, rule: 'hosted-binding', message: `is not the assembly ${constName}: HostedGame<...> = { ...${constOf(id)}_GAME, Surface[, tutorial] }`, fix: 'Keep the binding assembly only: the game module spread plus its Surface component (and its tutorial constant, if any), typed HostedGame (no logic, no casts, no extra members).' });
    checkGameFacing(host, rel, report);
  }
  const registry = maskComments(host.read(host.registry));
  if (!new RegExp(`/${id}/${id}-hosted['"]`).test(host.read(host.registry)) || !new RegExp(`createGameHost\\s*\\(\\s*${constName}\\b`).test(registry)) {
    report.problem({ file: host.registry, rule: 'game-registered', message: `the registry does not host ${id} (import ${constName} and call createGameHost(${constName}, ...))`, fix: 'Add one factory per game: (deps) => createGameHost(<CONST>_HOSTED, { ...deps, options: GAME_HOST_CONFIG[\'<id>\'] }).' });
  }
}

function checkGameFacing(host, bindingRel, report) {
  const seam = `${host.hostDir}/hosted-game.ts`;
  const imports = importsOf(scanSource(host.read(bindingRel))).map((entry) => resolveSpecifier(bindingRel, entry.spec, { root: host.root }));
  if (!imports.includes(seam)) return;
  const reason = notYetCreated(host.root, { file: host.contract, owner: 'architecture-and-boundaries' });
  if (reason) {
    report.skip({ file: host.contract, rule: 'game-facing-recorded', message: reason });
    return;
  }
  let globs = [];
  try {
    const contract = parseJsonc(host.read(host.contract));
    globs = Array.isArray(contract?.gameFacing) ? contract.gameFacing : [];
  } catch {
    globs = [];
  }
  if (!globs.some((glob) => typeof glob === 'string' && matchGlob(seam, glob))) {
    report.problem({ file: host.contract, line: 1, rule: 'game-facing-recorded', message: `gameFacing does not list ${seam}, the seam games import`, fix: `Add "${seam}" to "gameFacing" in ${host.contract} (architecture-and-boundaries' game-facing rule), so a game may import only the seam.` });
  }
}
