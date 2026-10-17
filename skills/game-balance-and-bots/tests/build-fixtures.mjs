#!/usr/bin/env node
// build-fixtures.mjs: writes the overlay cases of tests/fixtures/check-balance/ (mutation.json,
// EXPECT.txt, ARGS.txt). The base is tests/bases/app plus this skill's templates (filled as the game
// "lights-out") plus both worked examples (pig: turn-based with an endless run; arena-chase:
// real-time) with their real sim reports, so the templates and the examples must pass the checker.
// Every bad-* case plants ONE bug; EXPECT.txt names the rule and, where it matters, the exact
// file:line, computed here on the assembled tree. A case that changes fingerprinted code is
// re-stamped (as a fresh npm run test:sim would), except the stale-report cases.
// Run after changing a template, an example or the checker:
//   node tests/build-fixtures.mjs && node scripts/selftest.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMutation, assembleSuiteCases, makeTempDir, readSuiteSpec, removeTempDir } from '../scripts/check-lib.mjs';
import { balanceLayout, rulesFingerprint } from '../scripts/lib/balance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..');
const SUITE = join(HERE, 'fixtures', 'check-balance');
const GAMES = ['arena-chase', 'lights-out', 'pig'];
const LO = 'lights-out';
const SIM = `test/sims/${LO}/balance.sim.test.ts`;
const BANDS = `test/sims/${LO}/balance-bands.json`;
const REPORT = `reports/sim/${LO}.json`;
const TUNING = `src/games/${LO}/rules/${LO}-tuning.ts`;
const BOT = `src/games/${LO}/testing/${LO}-bot.ts`;
const PIG_BANDS = 'test/sims/pig/balance-bands.json';
const PIG_REPORT = 'reports/sim/pig.json';
const PIG_TUNING = 'src/games/pig/rules/pig-tuning.ts';
const RT_BANDS = 'test/sims/arena-chase/balance-bands.json';
const RT_REPORT = 'reports/sim/arena-chase.json';
const RT_TUNING = 'src/games/arena-chase/sim/arena-chase-tuning.ts';
const WRITER = 'test/sims/write-sim-report.ts';
const LEVEL_PLAN = `src/games/${LO}/levels/${LO}-level-plan.ts`;

const BASE = [
  '@tests/bases/app',
  {
    templates: true,
    firstLinePath: true,
    fill: { __GAME_ID__: LO, __GAME_PASCAL__: 'LightsOut', __GAME_CAMEL__: 'lightsOut', __GAME_CONST__: 'LIGHTS_OUT' },
  },
  { from: '@skill/examples/pig' },
  { from: '@skill/examples/arena-chase' },
];

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

/** 1-based line of `marker` in a file of the assembled case. */
function lineOf(dir, rel, marker) {
  const text = read(dir, rel);
  const index = text.indexOf(marker);
  if (index === -1) throw new Error(`fixture builder: marker ${JSON.stringify(marker)} not found in ${rel}`);
  return text.slice(0, index).split('\n').length;
}

const replace = (file, find, withText, extra = {}) => ({ replace: { file, find, with: withText, ...extra } });
const json = (file, path, value) => ({ json: { file, path, value } });
const write = (file, content) => ({ write: { file, content } });
const del = (path) => ({ delete: path });

/** The report of `game` restamped with the fingerprint of the tree in `dir` (what npm run test:sim would write). */
function restampOps(dir, games = GAMES) {
  const balance = balanceLayout(dir);
  return games
    .filter((game) => existsSync(join(dir, `${balance.reportsDir}/${game}.json`)))
    .flatMap((game) => {
      const rel = `${balance.reportsDir}/${game}.json`;
      const current = JSON.parse(read(dir, rel)).rulesFingerprint;
      const fresh = rulesFingerprint(balance, game);
      return current === fresh ? [] : [json(rel, ['rulesFingerprint'], fresh)];
    });
}

/** Files under `folders` whose text holds `needle`, repo-relative and sorted. */
function filesHolding(dir, folders, needle) {
  return folders
    .flatMap((folder) => readdirSync(join(dir, folder), { recursive: true, encoding: 'utf8' }).map((rel) => `${folder}/${rel.split('\\').join('/')}`))
    .filter((rel) => statSync(join(dir, rel)).isFile() && read(dir, rel).includes(needle))
    .sort();
}

/** Cell index of a report, for json paths. */
function cellIndex(dir, rel, policy, difficulty) {
  const index = JSON.parse(read(dir, rel)).cells.findIndex((cell) => cell.policy === policy && cell.difficulty === difficulty);
  if (index === -1) throw new Error(`fixture builder: no ${policy} d${difficulty} cell in ${rel}`);
  return index;
}

const KNOB_ROWS = /^ {2}\{ target: (\d+), maxTurns: (\d+) \},$/gm;

/**
 * Each case: `ops(dir)` (the planted bug, on the restamped base), optional `post(dir)` (applied after
 * the restamp, like files a later step writes without rerunning the sims), `restamp` (default true),
 * `args` (ARGS.txt words) and `expect(dir)` (the EXPECT.txt lines, read from the assembled case).
 */
const CASES = {
  'bad-no-sim-config': { ops: () => [del('jest.sim.config.js')], expect: () => ['[sim-config]', 'jest.sim.config.js', 'no jest.sim.config.js'] },
  'bad-sim-config-not-node': {
    ops: () => [replace('jest.sim.config.js', "testEnvironment: 'node'", "testEnvironment: 'jsdom'")],
    expect: () => ['[sim-config]', 'jest.sim.config.js:1', 'not a plain-Node config'],
  },
  'bad-no-sim-script': {
    ops: () => [json('package.json', ['scripts', 'test:sim'], 'jest --ci')],
    expect: (dir) => ['[sim-config]', `package.json:${lineOf(dir, 'package.json', '"scripts"')}`, 'no "test:sim" script'],
  },
  'bad-sims-in-npm-test': {
    ops: () => [replace('jest.config.js', ", '\\\\.sim\\\\.test\\\\.'", '')],
    expect: () => ['[sim-config]', 'jest.config.js:1', 'npm test does not ignore'],
  },
  'bad-writer-outdated': {
    ops: () => [replace(WRITER, 'export function fingerprintFiles(', 'function fingerprintFiles(')],
    expect: () => ['[harness-outdated]', `${WRITER}:1`, 'no fingerprintFiles export'],
  },
  'bad-harness-missing': { ops: () => [del('src/core/game-balance/trace-bot.ts')], expect: () => ['[harness-missing]', 'src/core/game-balance/trace-bot.ts'] },
  'bad-harness-test-missing': { ops: () => [del('test/sims/write-sim-report.test.ts')], expect: () => ['[harness-missing]', 'test/sims/write-sim-report.test.ts'] },
  'pass-before-the-kit': {
    ops: () => [del('src/core/game')],
    expect: () => ['SKIP src/core/game/testing/play-bot.ts [harness-missing] not yet created (game-rules-engine creates it)'],
  },
  'bad-kit-without-play-bot': {
    ops: () => [del('src/core/game/testing/play-bot.ts')],
    expect: () => ['[harness-missing]', 'src/core/game/testing/play-bot.ts', 'the game kit (src/core/game) exists but its play-bot.ts is missing'],
  },
  'bad-sim-missing': { ops: () => [del(SIM)], expect: () => ['[sim-missing]', `${LO} has no bot simulation`] },
  'bad-sim-in-app': {
    ops: () => [write(`src/games/${LO}/rules/quick.sim.test.ts`, `// src/games/${LO}/rules/quick.sim.test.ts\nimport { writeFileSync } from 'node:fs';\n\ndescribe('quick', () => {\n  it('writes', () => {\n    writeFileSync('x', 'y');\n  });\n});\n`)],
    expect: () => ['[sim-location]', `src/games/${LO}/rules/quick.sim.test.ts:2`],
  },
  'bad-sim-random': {
    ops: () => [replace(SIM, "const GAME_ID = 'lights-out';\n", "const GAME_ID = 'lights-out';\nconst JITTER = Math.random();\nvoid JITTER;\n")],
    expect: (dir) => ['[sim-determinism]', `${SIM}:${lineOf(dir, SIM, 'Math.random')}`, 'Math.random()'],
  },
  'bad-sim-skip': {
    ops: () => [replace(SIM, "  it('stays inside every band", "  it.skip('stays inside every band")],
    expect: (dir) => ['[sim-determinism]', `${SIM}:${lineOf(dir, SIM, 'it.skip(')}`, 'skipped or focused'],
  },
  'bad-bot-clock': {
    ops: () => [replace(BOT, "return result.kind === 'won' ? result.score : 0;", "return result.kind === 'won' ? result.score + (Date.now() % 2) : 0;")],
    expect: (dir) => ['[sim-determinism]', `${BOT}:${lineOf(dir, BOT, 'Date.now()')}`, 'Date.now()'],
  },
  'bad-bot-in-other-file-random': {
    ops: () => [write(`src/games/${LO}/testing/${LO}-openings.ts`, `// src/games/${LO}/testing/${LO}-openings.ts\n/** Picks a scripted opening for the bot. */\nexport function pickOpening(count: number): number {\n  return Math.floor(Math.random() * count);\n}\n`)],
    expect: () => ['[sim-determinism]', `src/games/${LO}/testing/${LO}-openings.ts:4`, 'Math.random()'],
  },
  'bad-sim-seeds-shifted': {
    ops: () => [replace(SIM, '      seed: index + 1,', '      seed: index + 101,')],
    expect: (dir) => ['[sim-seeds]', `${SIM}:${lineOf(dir, SIM, 'seed: index + 101')}`, 'plays seed index + 101, not 1..seedsPerCell'],
  },
  'bad-sim-no-report': {
    ops: () => [replace(SIM, '    writeSimReport(report);\n', '')],
    expect: () => ['[sim-harness]', `${SIM}:1`, 'does not write reports/sim/<id>.json'],
  },
  'bad-sim-no-bands': {
    ops: () => [replace(SIM, 'expect(bandProblems(report, BANDS)).toStrictEqual([]);', 'expect(report.cells.length).toBeGreaterThan(0);')],
    expect: () => ['[sim-harness]', 'does not assert bandProblems'],
  },
  'bad-sim-own-harness': {
    ops: () => [replace(SIM, "'@/core/game-balance/", "'./local-", { all: true })],
    expect: () => ['[sim-harness]', `${SIM}:1`, 'does not play through the balance harness (src/core/game-balance'],
  },
  'bad-bot-missing': { ops: () => [del(BOT)], expect: () => ['[bot-missing]', BOT] },
  'bad-bot-hooks-missing': {
    // game-rules-engine's testing spec keeps its starter BotPolicy; the balance hooks file is gone.
    ops: () => [
      del(BOT),
      del(`src/games/${LO}/testing/${LO}-bot.test.ts`),
      write(`src/games/${LO}/testing/${LO}-testing.ts`, `// src/games/${LO}/testing/${LO}-testing.ts\nimport type { BotPolicy } from '@/core/game/testing/play-bot';\nimport type { LightsOutMove, LightsOutState } from '@/games/${LO}/rules/${LO}-types';\n\n/** The starter bot: the first offered move. */\nexport const greedyBot: BotPolicy<LightsOutState, LightsOutMove> = (_state, moves, rng) => {\n  const move = moves[0];\n  if (move === undefined) throw new Error('no moves');\n  return { move, rng };\n};\n`),
    ],
    expect: () => ['[bot-missing]', BOT, 'an event tagger (tag<Game>Event returning EventTag[])'],
  },
  'bad-bands-missing': { ops: () => [del(BANDS)], expect: () => ['[bands-missing]', BANDS] },
  'bad-bands-bad-metric': { ops: () => [json(BANDS, ['bands', 0, 'metric'], 'fun')], expect: () => ['[bands-invalid]', 'bands[0].metric is missing or invalid'] },
  'bad-bands-unknown-policy': {
    ops: () => [json(BANDS, ['curve', 'policy'], 'expert')],
    expect: () => ['[bands-invalid]', 'curve names policy expert, which the grid does not run'],
  },
  'bad-bands-few-seeds': { ops: () => [json(BANDS, ['seedsPerCell'], 20)], expect: () => ['[bands-invalid]', 'bands file.seedsPerCell is missing or invalid'] },
  'bad-bands-other-game': {
    ops: () => [json(BANDS, ['gameId'], 'pig')],
    expect: (dir) => ['[bands-invalid]', `${BANDS}:${lineOf(dir, BANDS, '"gameId"')}`, 'gameId is "pig", expected "lights-out"'],
  },
  'bad-tuning-missing': { ops: () => [del(TUNING)], expect: () => ['[tuning-missing]', TUNING] },
  'bad-tuning-undocumented': {
    ops: () => [replace(TUNING, '  /** Moves the player gets per scramble press (more = kinder). */\n', '')],
    expect: (dir) => ['[tuning-undocumented]', `${TUNING}:${lineOf(dir, TUNING, 'movesPerPress: 3')}`, 'knob "movesPerPress: 3," has no comment'],
  },
  'pass-wrapped-table': {
    ops: (dir) => [write(PIG_TUNING, wrapRows(read(dir, PIG_TUNING)))],
    expect: () => ['check-balance: 17 harness files and games checked, 0 problems'],
  },
  'bad-wrapped-tuning-undocumented': {
    ops: (dir) => [write(PIG_TUNING, wrapRows(read(dir, PIG_TUNING)).replace('  /** Busts in a row that end the run (fewer = harsher on pushing your luck). */\n', ''))],
    expect: (dir) => ['[tuning-undocumented]', `${PIG_TUNING}:${lineOf(dir, PIG_TUNING, 'maxBusts: 5,')}`, 'knob "maxBusts: 5," has no comment'],
  },
  'bad-fingerprint-scope': {
    ops: () => [
      write(`src/games/${LO}/words/bonus-table.ts`, `// src/games/${LO}/words/bonus-table.ts\nexport const BONUS = [1, 2, 3] as const;\n`),
      write(`src/games/${LO}/rules/bonus.ts`, `// src/games/${LO}/rules/bonus.ts\nimport { BONUS } from '@/games/${LO}/words/bonus-table';\n\nexport const firstBonus = (): number => BONUS[0];\n`),
    ],
    expect: () => ['[fingerprint-scope]', `src/games/${LO}/rules/bonus.ts:2`, `imports @/games/${LO}/words/bonus-table`],
  },
  'bad-fingerprint-scope-relative': {
    ops: () => [write(`src/games/${LO}/testing/${LO}-view-bot.ts`, `// src/games/${LO}/testing/${LO}-view-bot.ts\nimport type { Cells } from '../canvas/cells';\nimport { cellCount } from '../canvas/cells';\n\nexport const count = (cells: Cells): number => cellCount(cells);\n`)],
    expect: () => ['[fingerprint-scope]', `src/games/${LO}/testing/${LO}-view-bot.ts:3`, 'imports ../canvas/cells'],
  },
  'bad-fingerprint-scope-service': {
    ops: () => [write(`src/games/${LO}/rules/today.ts`, `// src/games/${LO}/rules/today.ts\nimport { systemClock } from '@/services/clock/system-clock-adapter';\n\nexport const today = (): number => systemClock.now();\n`)],
    expect: () => ['[fingerprint-scope]', `src/games/${LO}/rules/today.ts:2`, 'imports @/services/clock/system-clock-adapter'],
  },
  'bad-realtime-game-unchecked': {
    ops: () => [write('src/games/dodge-lite/sim/dodge-lite-sim.ts', "// src/games/dodge-lite/sim/dodge-lite-sim.ts\n'worklet';\n\nexport function stepDodgeLite(sim: { tick: number }): void {\n  sim.tick += 1;\n}\n")],
    expect: () => ['[sim-missing]', 'dodge-lite has no bot simulation', '[bot-missing]', 'src/games/dodge-lite/testing/dodge-lite-bot.ts', '[tuning-missing]', 'src/games/dodge-lite/rules/dodge-lite-tuning.ts', '[bands-missing]', '[report-missing]'],
  },
  'bad-realtime-report-stale': {
    ops: () => [replace(RT_TUNING, 'chaserSpeed: 150,', 'chaserSpeed: 160,')],
    restamp: false,
    expect: (dir) => ['[report-stale]', `${RT_REPORT}:${lineOf(dir, RT_REPORT, '"rulesFingerprint"')}`],
  },
  'bad-realtime-slow-payoff': {
    ops: (dir) => [json(RT_REPORT, ['cells', cellIndex(dir, RT_REPORT, 'dodge', 0), 'firstPayoffShare', 0], 0.5)],
    expect: (dir) => ['[first-payoff]', `${RT_BANDS}:${lineOf(dir, RT_BANDS, '"firstPayoff"')}`, 'only 0.5 of dodge d0 runs reach the first payoff within 1 moves'],
  },
  'bad-realtime-tuning-undocumented': {
    ops: () => [replace(RT_TUNING, '  /** A pulse throws every chaser this close back to the edge (larger is easier). */\n', '')],
    expect: (dir) => ['[tuning-undocumented]', `${RT_TUNING}:${lineOf(dir, RT_TUNING, 'pulseRadius: 260')}`],
  },
  'bad-report-other-game': {
    ops: () => [json(REPORT, ['gameId'], 'pig')],
    expect: (dir) => ['[report-invalid]', `${REPORT}:${lineOf(dir, REPORT, '"gameId"')}`, 'the report is for "pig"'],
  },
  'bad-report-missing': { ops: () => [del(REPORT)], expect: () => ['[report-missing]', REPORT] },
  'bad-report-stale': {
    ops: () => [replace(TUNING, '  movesPerPress: 3,', '  movesPerPress: 4,')],
    restamp: false,
    expect: (dir) => ['[report-stale]', `${REPORT}:${lineOf(dir, REPORT, '"rulesFingerprint"')}`],
  },
  'bad-report-invalid': { ops: () => [{ json: { file: REPORT, path: ['cells', 0, 'winRate'], delete: true } }], expect: () => ['[report-invalid]', 'cells[0].winRate is missing or invalid'] },
  'bad-report-cell-missing': {
    ops: (dir) => [{ json: { file: REPORT, path: ['cells', cellIndex(dir, REPORT, 'lookahead', 34)], delete: true } }],
    expect: () => ['[report-cell-missing]', 'no lookahead d34 cell'],
  },
  'bad-report-few-seeds': { ops: () => [json(REPORT, ['seedsPerCell'], 50)], expect: (dir) => ['[report-invalid]', `${REPORT}:${lineOf(dir, REPORT, '"seedsPerCell"')}`, 'report ran 50 seeds'] },
  'bad-cap-hit': {
    ops: (dir) => [json(REPORT, ['cells', cellIndex(dir, REPORT, 'greedy', 34), 'capHits'], 3)],
    expect: (dir) => ['[cap-hit]', `${REPORT}:${lineOf(dir, REPORT, '"policy": "greedy",\n      "difficulty": 34')}`, '3 greedy d34 runs hit maxMoves'],
  },
  'bad-band-violated': {
    ops: (dir) => [json(REPORT, ['cells', cellIndex(dir, REPORT, 'greedy', 0), 'winRate'], 0.8)],
    expect: (dir) => ['[band-violated]', `${BANDS}:${lineOf(dir, BANDS, 'The first row (3x3 boards) is the warm-up')}`, 'greedy d0 winRate = 0.8 is outside 0.9..1'],
  },
  'bad-curve-flat': {
    ops: (dir) => [json(REPORT, ['cells', cellIndex(dir, REPORT, 'greedy', 67), 'winRate'], 0.5)],
    expect: (dir) => ['[curve]', `${BANDS}:${lineOf(dir, BANDS, '"curve"')}`, 'from d34 to d67'],
  },
  'bad-skill-gap': {
    ops: (dir) => [json(REPORT, ['cells', cellIndex(dir, REPORT, 'random', 34), 'winRate'], 0.57)],
    expect: (dir) => ['[skill-gap]', `${BANDS}:${lineOf(dir, BANDS, '"skillGap"')}`, 'greedy does not beat random by 0.15 winRate at d34'],
  },
  'bad-lookahead-weak': {
    ops: (dir) => [json(REPORT, ['cells', cellIndex(dir, REPORT, 'lookahead', 34), 'winRate'], 0.62)],
    expect: (dir) => ['[skill-gap]', `${BANDS}:${lineOf(dir, BANDS, '"skillGap"')}`, 'lookahead does not beat greedy by 0.15 winRate at d34'],
  },
  'bad-slow-payoff': {
    ops: (dir) => [json(REPORT, ['cells', cellIndex(dir, REPORT, 'greedy', 0), 'firstPayoffShare', 2], 0.4)],
    expect: (dir) => ['[first-payoff]', `${BANDS}:${lineOf(dir, BANDS, '"firstPayoff"')}`, 'only 0.4 of greedy d0 runs reach the first payoff within 3 moves'],
  },
  'bad-weak-twist': {
    ops: (dir) => [json(REPORT, ['cells', cellIndex(dir, REPORT, 'greedy', 34), 'twistPerRun'], 0.25)],
    expect: (dir) => ['[twist]', `${BANDS}:${lineOf(dir, BANDS, '"twist"')}`, 'the twist happens 0.25 times'],
  },
  'bad-endless-in-grid': {
    ops: () => [json(PIG_BANDS, ['grid', 'holdAt20', 4], 100)],
    expect: () => ['[bands-invalid]', 'grid.holdAt20 must list level difficulties 0..99 (the endless run has its own block)'],
  },
  'bad-endless-bad-block': {
    ops: () => [json(PIG_BANDS, ['endless', 'difficulty'], 75), json(PIG_BANDS, ['endless', 'bands', 0, 'metric'], 'winRate')],
    expect: () => ['[bands-invalid]', 'endless.difficulty must be 100 (ENDLESS_DIFFICULTY)', 'endless.bands[0].metric is missing or invalid'],
  },
  'bad-endless-won': {
    ops: (dir) => {
      const index = cellIndex(dir, PIG_REPORT, 'holdAt20', 100);
      return [json(PIG_REPORT, ['cells', index, 'wins'], 4), json(PIG_REPORT, ['cells', index, 'winRate'], 0.04)];
    },
    expect: (dir) => ['[endless-won]', `${PIG_BANDS}:${lineOf(dir, PIG_BANDS, '"endless"')}`, '4 endless holdAt20 d100 runs were won'],
  },
  'bad-endless-band-violated': {
    ops: (dir) => [json(PIG_REPORT, ['cells', cellIndex(dir, PIG_REPORT, 'holdAt20', 100), 'medianMoves'], 9)],
    expect: (dir) => ['[band-violated]', `${PIG_BANDS}:${lineOf(dir, PIG_BANDS, 'An endless run outlasts a level')}`, 'endless holdAt20 d100 medianMoves = 9 is outside 45..100'],
  },
  'bad-endless-cell-missing': {
    ops: (dir) => [{ json: { file: PIG_REPORT, path: ['cells', cellIndex(dir, PIG_REPORT, 'holdAt20', 100)], delete: true } }],
    expect: () => ['[report-cell-missing]', 'no endless holdAt20 d100 cell in the report'],
  },
  'bad-endless-cap-hit': {
    ops: (dir) => [json(PIG_REPORT, ['cells', cellIndex(dir, PIG_REPORT, 'holdAt20', 100), 'capHits'], 2)],
    expect: (dir) => ['[cap-hit]', `${PIG_BANDS}:${lineOf(dir, PIG_BANDS, '"endless"')}`, '2 endless holdAt20 d100 runs hit maxMoves 400'],
  },
  'pass-release-proposed': {
    ops: () => [],
    args: ['{dir}', '--release'],
    expect: (dir) => ['HUMAN CHECK (not blocking)', `${BANDS}:${lineOf(dir, BANDS, '"status"')} [bands-unapproved]`, 'Play-test lights-out on an iPhone and an Android phone', 'Nothing waits for it.', 'RESULT: PASS'],
  },
  'bad-release-approved-without-date': {
    ops: () => [json(BANDS, ['status'], 'approved')],
    args: ['{dir}', '--release'],
    expect: () => ['[bands-invalid]', 'approved bands need approvedOn as YYYY-MM-DD'],
  },
  'pass-core-growth': {
    ops: () => [],
    post: () => [
      write('src/core/canvas/particles.ts', '// src/core/canvas/particles.ts\nexport const PARTICLES = 12;\n'),
      write('src/core/game/levels.ts', '// src/core/game/levels.ts\nexport type LevelId = number;\n'),
    ],
    expect: () => ['check-balance: 17 harness files and games checked, 0 problems'],
  },
  'bad-core-import-changed': {
    ops: (dir) => [write('src/core/game-balance/sim-stats.ts', `${read(dir, 'src/core/game-balance/sim-stats.ts')}// A comment is enough: the sims import this file.\n`)],
    restamp: false,
    expect: (dir) => ['[report-stale]', `${REPORT}:${lineOf(dir, REPORT, '"rulesFingerprint"')}`, 'the src/core files they import'],
  },
  'pass-packs-after-sims': {
    ops: () => [write(LEVEL_PLAN, `// ${LEVEL_PLAN}\n/** The level table's rows (a fixture stand-in for the real plan). */\nexport const LEVEL_PLAN = { rows: 4 } as const;\n`)],
    post: () => PACKS,
    expect: () => ['check-balance: 17 harness files and games checked, 0 problems'],
  },
  'bad-rules-changed-after-report': {
    ops: () => [write(LEVEL_PLAN, `// ${LEVEL_PLAN}\nexport const LEVEL_PLAN = { rows: 4 } as const;\n`)],
    post: () => [...PACKS, replace(TUNING, '  movesPerPress: 3,', '  movesPerPress: 4,')],
    expect: (dir) => ['[report-stale]', `${REPORT}:${lineOf(dir, REPORT, '"rulesFingerprint"')}`, 'not the generated pack-*.json'],
  },
  'bad-level-plan-changed-after-report': {
    ops: () => [write(LEVEL_PLAN, `// ${LEVEL_PLAN}\nexport const LEVEL_PLAN = { rows: 4 } as const;\n`)],
    post: () => [...PACKS, replace(LEVEL_PLAN, 'rows: 4', 'rows: 5')],
    expect: (dir) => ['[report-stale]', `${REPORT}:${lineOf(dir, REPORT, '"rulesFingerprint"')}`],
  },
  'pass-installed-skills': {
    ops: () => [
      write('.agents/skills/other-skill/src/games/planted/rules/create.ts', 'export const r = Math.random();\n'),
      write('skills/other-skill/test/sims/planted/balance.sim.test.ts', "import { writeFileSync } from 'node:fs';\nit.skip('x', () => writeFileSync('a', 'b'));\n"),
      write('src/tools/bundled-skill/SKILL.md', '---\nname: bundled-skill\ndescription: A vendored skill folder.\n---\n'),
      write('src/tools/bundled-skill/quick.sim.test.ts', "import { readFileSync } from 'node:fs';\nvoid readFileSync;\n"),
      write('src/games/vendored/SKILL.md', '---\nname: vendored\ndescription: A vendored skill folder.\n---\n'),
      write('src/games/vendored/rules/create.ts', 'export const s = Math.random();\n'),
    ],
    expect: () => ['check-balance: 17 harness files and games checked, 0 problems'],
  },
  'pass-no-game': { ops: () => [del('src/games')], expect: () => ['NOT APPLICABLE: the app has no game (no src/games/<game-id>/ folder with rules/ or sim/)'] },
  'pass-games-dir': {
    ops: (dir) => [
      { rename: { from: 'src/games', to: 'src/play' } },
      write('rn-skills.config.json', '{ "gamesDir": "src/play" }\n'),
      // The imports move with the folder (the app's alias, @/play/...).
      ...filesHolding(dir, ['src/games', 'test/sims'], "'@/games/").map((rel) =>
        replace(rel.replace(/^src\/games\//, 'src/play/'), "'@/games/", "'@/play/", { all: true }),
      ),
    ],
    expect: () => ['check-balance: 17 harness files and games checked, 0 problems'],
  },
  'pass-one-game': { ops: () => [], args: ['{dir}', '--game', 'pig'], expect: () => ['check-balance: 15 harness files and games checked, 0 problems'] },
  'error-missing-root': { ops: () => [], args: ['{dir}/no-such-app'], expect: () => ['ERROR [bad-input]', 'nothing to check'] },
  'error-unknown-game': { ops: () => [], args: ['{dir}', '--game', 'chess'], expect: () => ['ERROR [bad-input]', 'no src/games/chess/rules or sim folder'] },
  'error-games-dir-outside': { ops: () => [], args: ['{dir}', '--games-dir', '../games'], expect: () => ['ERROR [bad-input]', '--games-dir must be a repo-relative folder'] },
};

const PACKS = [
  write(`src/games/${LO}/levels/pack-1.json`, '{\n  "pack": 1,\n  "levels": [{ "seed": 101, "difficulty": 0, "par": 3 }]\n}\n'),
  write(`src/games/${LO}/levels/pack-2.json`, '{\n  "pack": 2,\n  "levels": [{ "seed": 202, "difficulty": 45, "par": 6 }]\n}\n'),
];

/** Pig's tuning rows as Prettier writes them once a row outgrows the line: one knob per line, no comments. */
function wrapRows(text) {
  const wrapped = text.replace(KNOB_ROWS, (_, target, turns) => `  {\n    target: ${target},\n    maxTurns: ${turns},\n  },`);
  if (wrapped === text) throw new Error('fixture builder: the pig tuning rows no longer have the expected shape');
  return wrapped;
}

function writeCaseFiles(dir, { ops, expect, args }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (ops.length > 0) writeFileSync(join(dir, 'mutation.json'), `${JSON.stringify(ops, null, 2)}\n`);
  writeFileSync(join(dir, 'EXPECT.txt'), `${expect.join('\n')}\n`);
  if (args) writeFileSync(join(dir, 'ARGS.txt'), `${args.join(' ')}\n`);
}

if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) {
  console.log('Usage: node tests/build-fixtures.mjs\nRewrites tests/fixtures/check-balance/ (SUITE.json, good/ and every case) from the templates,\nthe two worked examples and the CASES table in this file. Takes no options; --help only prints this.\nThen run: node scripts/selftest.mjs');
  process.exit(0);
}
if (process.argv.length > 2) {
  console.error(`build-fixtures: unknown argument ${process.argv[2]} (it takes none; --help prints usage)`);
  process.exit(2);
}

const tmp = makeTempDir('balance-fixtures-');
try {
  rmSync(SUITE, { recursive: true, force: true });
  mkdirSync(join(SUITE, 'good'), { recursive: true });
  writeFileSync(join(SUITE, 'good', 'EXPECT.txt'), 'check-balance: 17 harness files and games checked, 0 problems\nRESULT: PASS\n');
  // 1. Assemble the base once, then restamp the three real reports for the fixture tree.
  writeFileSync(join(SUITE, 'SUITE.json'), `${JSON.stringify({ base: BASE }, null, 2)}\n`);
  assembleSuiteCases({ suiteDir: SUITE, skillDir: SKILL, into: join(tmp, 'raw'), spec: readSuiteSpec(SUITE), only: (name) => name === 'good' });
  const raw = join(tmp, 'raw', 'good');
  const suiteOps = restampOps(raw);
  writeFileSync(join(SUITE, 'SUITE.json'), `${JSON.stringify({ base: BASE, ops: suiteOps }, null, 2)}\n`);
  const base = join(tmp, 'base');
  cpSync(raw, base, { recursive: true });
  applyMutation(base, suiteOps, 'SUITE.json ops');
  // 2. Each case: the planted ops, a restamp, the post ops; EXPECT lines read from the result.
  for (const [name, spec] of Object.entries(CASES)) {
    const dir = join(tmp, 'cases', name);
    cpSync(base, dir, { recursive: true });
    const ops = spec.ops(dir);
    applyMutation(dir, ops, name);
    const stamp = spec.restamp === false ? [] : restampOps(dir);
    applyMutation(dir, stamp, `${name} restamp`);
    const post = spec.post ? spec.post(dir) : [];
    applyMutation(dir, post, `${name} post`);
    writeCaseFiles(join(SUITE, name), { ops: [...ops, ...stamp, ...post], expect: spec.expect(dir), args: spec.args });
  }
  console.log(`built tests/fixtures/check-balance: good + ${Object.keys(CASES).length} cases (${Object.keys(CASES).filter((name) => name.startsWith('bad-')).length} bad)`);
} finally {
  removeTempDir(tmp);
}
