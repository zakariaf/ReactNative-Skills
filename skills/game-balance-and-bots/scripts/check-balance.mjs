#!/usr/bin/env node
// check-balance.mjs: checks the bot and balance setup of an Expo app with games and judges each game's
// latest sim report (<simReportsDir>/<game-id>.json) against its balance contract
// (<simsDir>/<game-id>/balance-bands.json). Run after `npm run test:sim`:
//   node ${CLAUDE_SKILL_DIR}/scripts/check-balance.mjs [repo-root] [--game <id>] [--release]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, requireDir, run, walkRepo } from './check-lib.mjs';
import {
  GAME_LOGIC_FOLDERS,
  MIN_SEEDS,
  balanceLayout,
  bandsProblems,
  cellOf,
  discoverGames,
  harnessFiles,
  isInside,
  localBase,
  reportShapeProblems,
  rulesFingerprint,
} from './lib/balance.mjs';

const SPEC = {
  name: 'check-balance',
  summary: "Checks the bot harness, every game's sims, bots, bands and tuning file, and judges each sim report against its bands.",
  usage: '[repo-root] [options]',
  options: {
    game: { type: 'string', multiple: true, value: 'id', help: 'Check only this game (a folder of the games folder)' },
    release: { type: 'boolean', help: 'Release run: prints unapproved bands as a HUMAN CHECK (not blocking) line' },
    'games-dir': { type: 'string', value: 'dir', help: 'Games folder (default: rn-skills.config.json gamesDir, else <srcDir>/games)' },
    'core-dir': { type: 'string', value: 'dir', help: 'Pure core folder holding game-balance/ and game/ (default: the layout coreDir, src/core)' },
    'sims-dir': { type: 'string', value: 'dir', help: 'Sims folder (default: simsDir, else <testDir>/sims)' },
    'reports-dir': { type: 'string', value: 'dir', help: 'Sim reports folder (default: simReportsDir, else reports/sim)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Setup rules:',
    '  sim-config           jest.sim.config.js (node environment, *.sim.test.ts), the test:sim script, sims kept out of npm test',
    '  harness-missing      the balance harness (<coreDir>/game-balance/*, each with its test) and the report writer',
    '                       (<simsDir>/write-sim-report.ts with its test) exist; play-bot.ts is SKIPPED until game-rules-engine adds its kit',
    '  harness-outdated     the report writer fingerprints the sim\'s import closure (exports fingerprintFiles)',
    '  sim-missing          every game (a folder of the games folder with rules/ or sim/) has <simsDir>/<id>/*.sim.test.ts',
    '  sim-location         a *.sim.test.ts that uses Node APIs lives under the sims folder, never in app source',
    '  sim-determinism      sims and bot hooks use no Math.random, Date, performance.now, retries, skips or focus',
    '  sim-seeds            each sim plays seeds 1..seedsPerCell (seed: index + 1 over Array.from({ length: BANDS.seedsPerCell }))',
    '  sim-harness          each sim plays through the balance harness, writes the report and asserts bandProblems',
    '  bot-missing          <gamesDir>/<id>/testing/ exports an event tagger (EventTag[]) and a BotPolicy or, real-time, a SimBotGame and a CommandPolicy',
    '  fingerprint-scope    game code in rules/, levels/, sim/, geom/ and testing/ imports only from those folders and the core',
    '                       (anything else could change the bots\' numbers without making the report stale)',
    '  bands-missing        <simsDir>/<id>/balance-bands.json exists',
    '  bands-invalid        the bands file is complete and consistent (metrics, rules, >= 100 seeds, a grid of level',
    '                       difficulties 0..99; an endless mode has its own "endless" block at difficulty 100)',
    '  bands-unapproved     (--release) a HUMAN CHECK (not blocking) line, never a problem: the bands stay "proposed"',
    '                       until a person has play-tested the game; the play-test never blocks',
    '  tuning-missing       <gamesDir>/<id>/rules/<id>-tuning.ts (real-time: sim/<id>-tuning.ts) holds the balance knobs',
    '  tuning-undocumented  every knob in the tuning file has a comment saying what it controls (a key documented on a',
    '                       knobs type counts; rows of the difficulty table are values, not knobs)',
    'Report rules (<simReportsDir>/<id>.json, written by npm run test:sim):',
    '  report-missing       the report exists',
    '  report-invalid       the report has the expected shape, is for this game and matches the bands\' seeds and move cap',
    '  report-stale         the report was made from the current code (fingerprint: the game\'s logic folders, the sim and the core',
    '                       files they import; the generated levels/pack-*.json do not count)',
    '  report-cell-missing  every grid cell (policy x difficulty) and the endless cell are in the report',
    '  cap-hit              no run hit maxMoves (no stuck or endless games)',
    '  band-violated        every band holds',
    '  curve                the difficulty curve moves in its direction by at least minStep per level',
    '  skill-gap            each smarter policy beats the previous one by at least minStep',
    '  first-payoff         the kill test: the first payoff comes within withinMoves in minShare of runs',
    '  twist                the twist happens at least minPerRun times per run',
    '  endless-won          the endless cell (difficulty 100) has no won run; its bands hold, and it is never a step of the curve',
    '',
    'An app with no game prints NOT APPLICABLE. rn-skills.config.json keys: gamesDir, simsDir, simReportsDir (and the layout keys',
    'srcDir, coreDir, testDir). Example: npm run test:sim && node check-balance.mjs .',
  ].join('\n'),
};

const NONDETERMINISM = [
  [/\bMath\.random\s*\(/, 'Math.random()'],
  [/\bDate\.now\s*\(/, 'Date.now()'],
  [/\bnew\s+Date\s*\(/, 'new Date()'],
  [/\bperformance\.now\s*\(/, 'performance.now()'],
  [/\bjest\.retryTimes\s*\(/, 'jest.retryTimes()'],
  [/\b(it|test|describe)\.(skip|only)\s*\(|\b(xit|xdescribe|fit|fdescribe)\s*\(/, 'a skipped or focused test'],
];
const KNOB_LINE = /^\s*(readonly\s+)?[A-Za-z_$][\w$]*\??\s*:\s*(number|-?[\d_]+(\.\d+)?)\s*[,;]?\s*$/;
const SPECIFIER = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const VALUE_IMPORT = /^[ \t]*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm;

function readRel(root, rel) {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

function listDir(root, rel, predicate) {
  const abs = join(root, rel);
  return existsSync(abs) ? readdirSync(abs, { withFileTypes: true }).filter(predicate).map((entry) => entry.name).sort() : [];
}

/** Every .ts/.tsx file below a folder (recursive), repo-relative. */
function sourcesUnder(root, folder) {
  const abs = join(root, folder);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .map((entry) => `${folder}/${entry.split('\\').join('/')}`)
    .filter((rel) => /\.tsx?$/.test(rel))
    .sort();
}

/** 1-based line of the first match of `needle` (a string) in `text`, or 1. */
function lineAt(text, needle) {
  const index = text.indexOf(needle);
  return index === -1 ? 1 : lineOf(text, index);
}

function checkSimConfig(root, report) {
  const config = readRel(root, 'jest.sim.config.js');
  if (config === null) report.problem({ file: 'jest.sim.config.js', line: 0, rule: 'sim-config', message: 'no jest.sim.config.js at the repo root', fix: 'Copy templates/jest.sim.config.js: bot sims run in plain Node, never in npm test or pre-commit.' });
  else if (!/testEnvironment\s*:\s*['"]node['"]/.test(config) || !config.includes('*.sim.test.ts')) report.problem({ file: 'jest.sim.config.js', line: 1, rule: 'sim-config', message: 'the sim config is not a plain-Node config matching *.sim.test.ts', fix: 'Use templates/jest.sim.config.js (testEnvironment node, testMatch for *.sim.test.ts, the @/ and @test/ moduleNameMapper).' });
  const pkgText = readRel(root, 'package.json');
  let scripts = {};
  try {
    scripts = JSON.parse(pkgText ?? '{}').scripts ?? {};
  } catch {
    scripts = {};
  }
  if (!/jest\.sim\.config\.js/.test(scripts['test:sim'] ?? '')) report.problem({ file: 'package.json', line: pkgText === null ? 0 : lineAt(pkgText, '"scripts"'), rule: 'sim-config', message: 'no "test:sim" script running jest.sim.config.js', fix: 'Add "test:sim": "jest --ci --config jest.sim.config.js" to the root package.json scripts.' });
  const unit = readRel(root, 'jest.config.js');
  if (unit !== null && !/sim[\\.]{1,3}test/.test(maskComments(unit))) report.problem({ file: 'jest.config.js', line: 1, rule: 'sim-config', message: 'npm test does not ignore *.sim.test.ts', fix: "Add '\\\\.sim\\\\.test\\\\.' to the unit project's testPathIgnorePatterns: sims take seconds to minutes." });
}

function checkHarness(balance, report) {
  const { root } = balance;
  for (const rel of harnessFiles(balance)) {
    if (!existsSync(join(root, rel))) report.problem({ file: rel, line: 0, rule: 'harness-missing', message: 'bot harness file is missing', fix: `Copy it from this skill's templates/ (${rel}), verbatim.` });
  }
  // play-bot.ts is game-rules-engine's: before its kit exists the line is a SKIP; once the kit folder
  // exists (rules and testing specs come from that skill), a missing play-bot.ts is a real gap.
  const kitDir = posix.dirname(posix.dirname(balance.playBot));
  if (!existsSync(join(root, balance.playBot)) && existsSync(join(root, kitDir))) {
    report.problem({ file: balance.playBot, line: 0, rule: 'harness-missing', message: `the game kit (${kitDir}) exists but its play-bot.ts is missing (traceBot plays every turn-based game through it)`, fix: 'Copy src/core/game/testing/play-bot.ts and its test from game-rules-engine\'s kit (this skill\'s templates carry the synced copy), verbatim.' });
  } else {
    const reason = notYetCreated(root, { file: balance.playBot, owner: 'game-rules-engine' });
    if (reason) report.skip({ file: balance.playBot, rule: 'harness-missing', message: reason });
  }
  // A writer from before the import-closure fingerprint hashes whole folders, so its reports never match this check.
  const writer = readRel(root, balance.writer);
  if (writer !== null && !/^export function fingerprintFiles\(/m.test(maskComments(writer))) report.problem({ file: balance.writer, line: 1, rule: 'harness-outdated', message: 'the report writer is an older copy: it does not fingerprint the core files the sim imports (no fingerprintFiles export)', fix: 'Copy templates/test/sims/write-sim-report.ts and its test again (verbatim), then rerun npm run test:sim.' });
}

/** A *.sim.test.ts in app source that imports node:* (only the root test folder has Node types). */
function strayNodeSims(balance, report) {
  for (const rel of walkRepo(balance.root, { include: ['*.sim.test.ts'] })) {
    if (!balance.srcDirs.some((dir) => isInside(rel, dir))) continue;
    const source = readFileSync(join(balance.root, rel), 'utf8');
    const at = maskComments(source).search(/from\s+['"]node:|require\(\s*['"]node:/);
    if (at !== -1) report.problem({ file: rel, line: lineOf(source, at), rule: 'sim-location', message: 'a sim that uses Node APIs lives in app source', fix: `Move it to ${balance.simsDir}/<game-id>/ (app code has no Node types and may not import node:*).` });
  }
}

function checkDeterminism(report, rel, source) {
  const code = maskComments(source);
  for (const [pattern, what] of NONDETERMINISM) {
    const match = pattern.exec(code);
    if (match) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'sim-determinism', message: `uses ${what}`, fix: 'Bots and sims take randomness only from seeds (sfc32) and never skip, focus or retry: a rerun must give identical numbers.' });
  }
}

/** Seeds 1..seedsPerCell, the same every run: a sim that picks other seeds can shop for numbers. */
function checkSeeds(report, rel, code) {
  const seed = /\bseed\s*:\s*([^,\n}]+)/.exec(code);
  const isOneBased = seed !== null && /^[A-Za-z_$][\w$]*\s*\+\s*1$/.test(seed[1].trim());
  const usesSeedsPerCell = /\blength\s*:\s*[\w$.]*\bseedsPerCell\b/.test(code);
  if (!isOneBased || !usesSeedsPerCell) report.problem({ file: rel, line: seed === null ? 1 : lineOf(code, seed.index), rule: 'sim-seeds', message: seed === null ? 'plays no seeds from the bands file' : `plays seed ${seed[1].trim()}, not 1..seedsPerCell`, fix: 'Play Array.from({ length: BANDS.seedsPerCell }, (_, index) => ... seed: index + 1 ...): the same seeds every run, never chosen to fit a band.' });
}

function checkSims(balance, game, report) {
  const { root } = balance;
  const dir = `${balance.simsDir}/${game}`;
  const sims = listDir(root, dir, (entry) => entry.isFile() && entry.name.endsWith('.sim.test.ts'));
  if (sims.length === 0) {
    report.problem({ file: `${dir}/balance.sim.test.ts`, line: 0, rule: 'sim-missing', message: `${game} has no bot simulation`, fix: 'Copy templates/test/sims/__GAME_ID__/balance.sim.test.ts and replace the placeholders.' });
    return;
  }
  for (const name of sims) {
    const rel = `${dir}/${name}`;
    const source = readFileSync(join(root, rel), 'utf8');
    checkDeterminism(report, rel, source);
    const code = maskComments(source);
    checkSeeds(report, rel, code);
    const usesHarness = [...code.matchAll(SPECIFIER)].some((match) => isInside(localBase(rel, match[1], balance.aliases) ?? '', balance.harnessDir));
    const needs = [
      [usesHarness, `does not play through the balance harness (${balance.harnessDir}: traceBot or runSimBot)`],
      [/\bwriteSimReport\s*\(/.test(code), `does not write ${balance.reportsDir}/<id>.json (writeSimReport)`],
      [/\bbandProblems\s*\(/.test(code), 'does not assert bandProblems(report, bands)'],
    ];
    for (const [isMet, message] of needs) {
      if (!isMet) report.problem({ file: rel, line: 1, rule: 'sim-harness', message, fix: 'Start from templates/test/sims/__GAME_ID__/balance.sim.test.ts.' });
    }
  }
}

/**
 * bot-missing: the balance hooks, not just any bot. game-rules-engine's testing spec always declares
 * a starter BotPolicy, so a policy alone proves nothing: the game's testing/ must also export an
 * event tagger (a function returning EventTag[]) and, real-time, a SimBotGame next to its
 * CommandPolicy. A text check over the testing folder (references/checker.md lists its limits).
 */
function checkBot(balance, game, report) {
  const dir = `${balance.gamesDir}/${game}/testing`;
  const isRealtime = existsSync(join(balance.root, `${balance.gamesDir}/${game}/sim`));
  const seen = { tagger: false, botPolicy: false, commandPolicy: false, simGame: false };
  for (const rel of sourcesUnder(balance.root, dir).filter((path) => !/\.test\.tsx?$/.test(path))) {
    const source = readFileSync(join(balance.root, rel), 'utf8');
    checkDeterminism(report, rel, source);
    const code = maskComments(source);
    if (/\)\s*:\s*(?:readonly\s+)?EventTag\s*\[\s*\]/.test(code)) seen.tagger = true;
    if (/\bBotPolicy\b/.test(code)) seen.botPolicy = true;
    if (/\bCommandPolicy\b/.test(code)) seen.commandPolicy = true;
    if (/\bSimBotGame\b/.test(code)) seen.simGame = true;
  }
  const missing = [
    ...(seen.tagger ? [] : ['an event tagger (tag<Game>Event returning EventTag[])']),
    ...(isRealtime
      ? [...(seen.simGame ? [] : ['the SimBotGame hooks']), ...(seen.commandPolicy ? [] : ['a CommandPolicy'])]
      : seen.botPolicy ? [] : ['a BotPolicy (the reasonable player)']),
  ];
  if (missing.length > 0) report.problem({ file: `${dir}/${game}-bot.ts`, line: 0, rule: 'bot-missing', message: `${game} has no balance bot hooks: ${missing.join(', ')} (a starter bot in the testing spec is not enough)`, fix: 'Write testing/<id>-bot.ts with evaluate, scoreOf, tag and the reasonable player (templates/src/games/__GAME_ID__/testing/; real-time: the SimBotGame hooks and a CommandPolicy, references/bots-and-sims.md).' });
}

const knobKey = (line) => line.trim().replace(/^readonly\s+/, '').split(/[?:]/)[0].trim();

/** Indexes of the lines inside `[ ... ] as const satisfies readonly <Type>[]` tables (the difficulty rows). */
function difficultyTableLines(lines) {
  const inside = new Set();
  let start = -1;
  lines.forEach((line, index) => {
    if (/=\s*\[\s*$/.test(line)) start = index;
    else if (start !== -1 && /^\s*\]\s*as\s+const\s+satisfies\s+readonly\s+[A-Za-z_$][\w$]*\s*\[\]/.test(line)) {
      for (let at = start + 1; at < index; at += 1) inside.add(at);
      start = -1;
    }
  });
  return inside;
}

/** Keys that carry a doc comment on a `type X = { ... }` declared in the tuning file (DifficultyKnobs). */
function documentedTypeKeys(lines) {
  const keys = new Set();
  let depth = 0;
  lines.forEach((line, index) => {
    if (/^\s*(export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*\{\s*$/.test(line)) depth = 1;
    else if (depth > 0) {
      if (/^\s*\}/.test(line)) depth = 0;
      else if (/^\s*(readonly\s+)?[A-Za-z_$][\w$]*\??\s*:/.test(line)) {
        const above = (lines.slice(0, index).reverse().find((text) => text.trim() !== '') ?? '').trim();
        if (above.endsWith('*/') || above.startsWith('//')) keys.add(knobKey(line));
      }
    }
  });
  return keys;
}

function checkTuning(balance, game, report) {
  const candidates = ['rules', 'sim'].map((folder) => `${balance.gamesDir}/${game}/${folder}/${game}-tuning.ts`);
  const rel = candidates.find((path) => existsSync(join(balance.root, path))) ?? candidates[0];
  const source = readRel(balance.root, rel);
  if (source === null) {
    report.problem({ file: rel, line: 0, rule: 'tuning-missing', message: `${game} has no tuning file`, fix: "Start from game-rules-engine's template tuning file and move every balance number of the rules into it (references/tuning-playbook.md)." });
    return;
  }
  const lines = source.split('\n');
  const tableLines = difficultyTableLines(lines);
  const typed = documentedTypeKeys(lines);
  let isInSatisfies = false;
  lines.forEach((line, index) => {
    // A `satisfies { ... }` block restates the shape; the knobs are documented where they are set.
    if (/\bsatisfies\s*\{\s*$/.test(line)) isInSatisfies = true;
    else if (isInSatisfies && /^\s*\}/.test(line)) isInSatisfies = false;
    // Rows of a difficulty table are values (Prettier may wrap a row over several lines).
    if (isInSatisfies || tableLines.has(index) || !KNOB_LINE.test(line)) return;
    if (typed.has(knobKey(line))) return;
    const above = (lines.slice(0, index).reverse().find((text) => text.trim() !== '') ?? '').trim();
    if (!(above.endsWith('*/') || above.startsWith('//') || above.startsWith('*'))) report.problem({ file: rel, line: index + 1, rule: 'tuning-undocumented', message: `knob "${line.trim()}" has no comment`, fix: 'Put a /** ... */ line above it, or document the key on the knobs type: what it controls and which direction is harder.' });
  });
}

/** Value imports (type-only imports are erased) of every non-test source in the game's logic folders. */
function checkFingerprintScope(balance, game, report) {
  const allowed = [...GAME_LOGIC_FOLDERS.map((folder) => `${balance.gamesDir}/${game}/${folder}`), balance.coreDir];
  for (const folder of GAME_LOGIC_FOLDERS) {
    for (const rel of sourcesUnder(balance.root, `${balance.gamesDir}/${game}/${folder}`)) {
      if (/\.test\.tsx?$/.test(rel)) continue;
      const code = maskComments(readFileSync(join(balance.root, rel), 'utf8'));
      for (const match of code.matchAll(VALUE_IMPORT)) {
        const target = localBase(rel, match[1], balance.aliases);
        if (target === null || allowed.some((prefix) => isInside(target, prefix))) continue;
        report.problem({ file: rel, line: lineOf(code, match.index), rule: 'fingerprint-scope', message: `imports ${match[1]}, which the sim report's fingerprint does not cover`, fix: `Keep everything that decides a bot result in rules/, levels/, sim/, geom/ or testing/ (move a word list or table there) or in ${balance.coreDir}; game logic never imports screens, services or stores.` });
      }
    }
  }
}

/** Four decimals, like the report: 0.6 - 0.7 is -0.09999999999999998 in floating point, not -0.1. */
const round4 = (value) => Math.round(value * 10000) / 10000;

function readJson(root, rel) {
  const text = readRel(root, rel);
  if (text === null) return { text: null, value: null };
  try {
    return { text, value: JSON.parse(text) };
  } catch (error) {
    return { text, value: null, error: error.message };
  }
}

function checkBandsFile(balance, game, report, options) {
  const rel = `${balance.simsDir}/${game}/balance-bands.json`;
  const { text, value, error } = readJson(balance.root, rel);
  if (text === null) {
    report.problem({ file: rel, line: 0, rule: 'bands-missing', message: `${game} has no balance contract`, fix: 'Copy templates/test/sims/__GAME_ID__/balance-bands.json and set the bands from the first sim run.' });
    return null;
  }
  const problems = error ? [`not valid JSON: ${error}`] : bandsProblems(value);
  for (const problem of problems) report.problem({ file: rel, line: 1, rule: 'bands-invalid', message: problem, fix: 'Fix the bands file (fields and metrics in references/balance-contract.md).' });
  if (problems.length > 0) return null;
  if (value.gameId !== game) report.problem({ file: rel, line: lineAt(text, '"gameId"'), rule: 'bands-invalid', message: `gameId is "${value.gameId}", expected "${game}"`, fix: 'Use the game folder name.' });
  // The play-test is a human check and never blocks a release; a release run prints it for the
  // report's "Human checks (not blocking)" list.
  if (options.release && value.status !== 'approved') {
    console.log(`HUMAN CHECK (not blocking) ${rel}:${lineAt(text, '"status"')} [bands-unapproved] the bands are still "proposed": list "Play-test ${game} on an iPhone and an Android phone" under Human checks (not blocking); when a person agrees, set "status": "approved" and "approvedOn": "YYYY-MM-DD". Nothing waits for it.`);
  }
  return { rel, text, bands: value };
}

function judge(report, where, bands, sim) {
  const { rel: bandsRel, text } = where;
  const at = (needle) => ({ file: bandsRel, line: lineAt(text, needle) });
  const metric = (policy, difficulty, key) => cellOf(sim, policy, difficulty)?.[key] ?? NaN;
  for (const band of bands.bands) {
    const value = metric(band.policy, band.difficulty, band.metric);
    if (!(value >= band.min && value <= band.max)) report.problem({ ...at(band.why), rule: 'band-violated', message: `${band.policy} d${band.difficulty} ${band.metric} = ${value} is outside ${band.min}..${band.max} (${band.why})`, fix: 'Change a knob in the tuning file (never the band, unless the game\'s intent changed and the reviewer agrees), rerun npm run test:sim, repeat.' });
  }
  const curve = bands.curve;
  const levels = [...bands.grid[curve.policy]].sort((a, b) => a - b);
  for (let i = 1; i < levels.length; i += 1) {
    const step = round4(metric(curve.policy, levels[i], curve.metric) - metric(curve.policy, levels[i - 1], curve.metric));
    const isOk = curve.direction === 'down' ? step <= -curve.minStep : step >= curve.minStep;
    if (!isOk) report.problem({ ...at('"curve"'), rule: 'curve', message: `${curve.policy} ${curve.metric} moves ${Number.isNaN(step) ? 'NaN' : step.toFixed(4)} from d${levels[i - 1]} to d${levels[i]}, expected ${curve.direction} by at least ${curve.minStep}`, fix: 'Spread the difficulty table so each level is clearly harder than the one before.' });
  }
  const gap = bands.skillGap;
  const sign = gap.better === 'higher' ? 1 : -1;
  for (let i = 1; i < gap.order.length; i += 1) {
    const gain = round4(sign * (metric(gap.order[i], gap.difficulty, gap.metric) - metric(gap.order[i - 1], gap.difficulty, gap.metric)));
    if (!(gain >= gap.minStep)) report.problem({ ...at('"skillGap"'), rule: 'skill-gap', message: `${gap.order[i]} does not beat ${gap.order[i - 1]} by ${gap.minStep} ${gap.metric} at d${gap.difficulty}`, fix: 'Skill must matter: if random plays as well as the reasonable player, the choices are fake; change the rules or knobs, not the bots.' });
  }
  const fun = bands.firstPayoff;
  const share = cellOf(sim, fun.policy, fun.difficulty)?.firstPayoffShare?.[fun.withinMoves - 1] ?? 0;
  if (!(share >= fun.minShare)) report.problem({ ...at('"firstPayoff"'), rule: 'first-payoff', message: `only ${share} of ${fun.policy} d${fun.difficulty} runs reach the first payoff within ${fun.withinMoves} moves (need ${fun.minShare})`, fix: 'The fun-within-seconds kill test: build the opening so the first payoff comes at once (references/fun-and-kill-test.md), or report that the idea fails it.' });
  if (bands.twist !== null) {
    const perRun = metric(bands.twist.policy, bands.twist.difficulty, 'twistPerRun');
    if (!(perRun >= bands.twist.minPerRun)) report.problem({ ...at('"twist"'), rule: 'twist', message: `the twist happens ${perRun} times per ${bands.twist.policy} d${bands.twist.difficulty} run (need ${bands.twist.minPerRun})`, fix: 'The twist barely matters: strengthen it in the rules so it is the natural best move, not in the band.' });
  }
  judgeEndless(report, where, bands, sim);
}

/** The endless cell (never part of the curve): never won, and inside its own bands. */
function judgeEndless(report, where, bands, sim) {
  const endless = bands.endless ?? null;
  if (endless === null) return;
  const at = (needle) => ({ file: where.rel, line: lineAt(where.text, needle) });
  const label = `endless ${endless.policy} d${endless.difficulty}`;
  const cell = cellOf(sim, endless.policy, endless.difficulty);
  if (cell === undefined) {
    report.problem({ ...at('"endless"'), rule: 'report-cell-missing', message: `no ${label} cell in the report`, fix: 'Play the endless cell in the sim after the grid (templates/test/sims/__GAME_ID__/balance.sim.test.ts), then rerun npm run test:sim.' });
    return;
  }
  if (cell.capHits > 0) report.problem({ ...at('"endless"'), rule: 'cap-hit', message: `${cell.capHits} ${label} runs hit maxMoves ${sim.maxMoves}`, fix: 'An endless run must still end: pressure has to rise (health, spawns, a turn budget) until the run is lost.' });
  if (cell.wins > 0) report.problem({ ...at('"endless"'), rule: 'endless-won', message: `${cell.wins} ${label} runs were won; an endless run only ever ends lost`, fix: 'Give the tuning an endless row with no goal and make outcome never return won at ENDLESS_DIFFICULTY (100).' });
  for (const band of endless.bands) {
    const value = cell[band.metric];
    if (!(value >= band.min && value <= band.max)) report.problem({ ...at(band.why), rule: 'band-violated', message: `${label} ${band.metric} = ${value} is outside ${band.min}..${band.max} (${band.why})`, fix: 'Change a knob of the endless row in the tuning file (never the band, unless the reviewer agrees), rerun npm run test:sim, repeat.' });
  }
}

function checkReport(balance, game, contract, report) {
  const rel = `${balance.reportsDir}/${game}.json`;
  const { text, value, error } = readJson(balance.root, rel);
  if (text === null) {
    report.problem({ file: rel, line: 0, rule: 'report-missing', message: `no sim report for ${game}`, fix: `Run npm run test:sim (it writes ${balance.reportsDir}/<id>.json), then rerun this check.` });
    return;
  }
  const shape = error ? [`not valid JSON: ${error}`] : reportShapeProblems(value);
  for (const problem of shape) report.problem({ file: rel, line: 1, rule: 'report-invalid', message: problem, fix: 'Regenerate it with npm run test:sim; never edit a report by hand.' });
  if (shape.length > 0) return;
  if (value.gameId !== game) report.problem({ file: rel, line: lineAt(text, '"gameId"'), rule: 'report-invalid', message: `the report is for "${value.gameId}", not ${game}`, fix: 'The sim must write the report of its own game id: fix GAME_ID in the sim file and rerun npm run test:sim.' });
  if (value.rulesFingerprint !== rulesFingerprint(balance, game)) report.problem({ file: rel, line: lineAt(text, '"rulesFingerprint"'), rule: 'report-stale', message: 'the report was made from other rules, bots or harness than the current code', fix: `Rerun npm run test:sim after every change to the game's rules, levels (not the generated pack-*.json), sim, geom or testing folders, the ${balance.coreDir} files they import, or the sim file.` });
  if (contract === null) return;
  const { bands } = contract;
  if (value.seedsPerCell < Math.max(bands.seedsPerCell, MIN_SEEDS) || value.maxMoves !== bands.maxMoves) report.problem({ file: rel, line: lineAt(text, '"seedsPerCell"'), rule: 'report-invalid', message: `report ran ${value.seedsPerCell} seeds with maxMoves ${value.maxMoves}; the bands ask for ${bands.seedsPerCell} and ${bands.maxMoves}`, fix: 'Rerun npm run test:sim with the current bands file.' });
  for (const [policy, levels] of Object.entries(bands.grid)) {
    for (const difficulty of levels) {
      const cell = cellOf(value, policy, difficulty);
      if (cell === undefined) report.problem({ file: rel, line: 1, rule: 'report-cell-missing', message: `no ${policy} d${difficulty} cell`, fix: 'Rerun npm run test:sim; the sim plays every grid cell of the bands file.' });
      else if (cell.capHits > 0) report.problem({ file: rel, line: lineAt(text, `"policy": "${policy}",\n      "difficulty": ${difficulty}`), rule: 'cap-hit', message: `${cell.capHits} ${policy} d${difficulty} runs hit maxMoves ${value.maxMoves}`, fix: 'A game must always end: find the stuck state (replay the seed) and fix the rules.' });
    }
  }
  judge(report, contract, bands, value);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const balance = balanceLayout(root, options);
  const found = discoverGames(balance);
  const report = createReporter({ name: 'check-balance', json: options.json });
  if (options.game.length === 0 && found.length === 0) return report.notApplicable(`the app has no game (no ${balance.gamesDir}/<game-id>/ folder with rules/ or sim/)`);
  const unknown = options.game.filter((game) => !found.includes(game));
  if (unknown.length > 0) fail(`nothing to check: no ${balance.gamesDir}/${unknown[0]}/rules or sim folder in ${root}`, `Pass an existing game id (${found.join(', ') || 'none found'}).`);
  const games = options.game.length === 0 ? found : found.filter((game) => options.game.includes(game));
  checkSimConfig(root, report);
  checkHarness(balance, report);
  strayNodeSims(balance, report);
  for (const game of games) {
    checkSims(balance, game, report);
    checkBot(balance, game, report);
    checkTuning(balance, game, report);
    checkFingerprintScope(balance, game, report);
    const contract = checkBandsFile(balance, game, report, options);
    checkReport(balance, game, contract, report);
  }
  return report.finish({ checked: harnessFiles(balance).length + games.length, unit: 'harness files and games' });
});
