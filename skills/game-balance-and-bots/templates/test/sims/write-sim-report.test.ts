// test/sims/write-sim-report.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fingerprintFiles, rulesFingerprint, writeSimReport } from './write-sim-report';

import type { SimReport } from '@/core/game-balance/balance-bands';

const GAME = 'toy-game';

/** A tiny repo: the game's rules and bot, its sim, and a src/core with used and unused files. */
const FILES: Readonly<Record<string, string>> = {
  [`src/games/${GAME}/rules/create.ts`]:
    "import { seedRng } from '@/core/rng/sfc32';\nexport const create = seedRng;\n",
  [`src/games/${GAME}/rules/create.test.ts`]: "import { create } from './create';\n",
  [`src/games/${GAME}/geom/grid.ts`]: 'export const SIDE = 4;\n',
  [`src/games/${GAME}/testing/${GAME}-bot.ts`]:
    "import type { BotPolicy } from '@/core/game/testing/play-bot';\nexport type Bot = BotPolicy;\n",
  [`src/games/${GAME}/canvas/draw-board.ts`]: 'export const draw = 1;\n',
  [`test/sims/${GAME}/balance.sim.test.ts`]:
    "import { traceBot } from '@/core/game-balance/trace-bot';\nvoid traceBot;\n",
  [`test/sims/${GAME}/balance-bands.json`]: '{}\n',
  'src/core/rng/sfc32.ts': 'export const seedRng = 1;\n',
  'src/core/rng/sfc32.test.ts': "import { seedRng } from './sfc32';\n",
  'src/core/game/testing/play-bot.ts': 'export type BotPolicy = number;\n',
  'src/core/game-balance/trace-bot.ts':
    "import { seedRng } from '../rng/sfc32';\nimport { gap } from './missing';\nexport const traceBot = seedRng;\n",
  'src/core/game-balance/index.ts': 'export const unused = 0;\n',
  'src/core/dates/date-key.ts': 'export const dateKey = 1;\n',
};

describe('rulesFingerprint', () => {
  // Each test gets its own repo folder: coverage runs tests in random order.
  let root = '';

  const put = (rel: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sim-fingerprint-'));
    for (const [rel, text] of Object.entries(FILES)) put(rel, text);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('covers the game logic folders, the sim and only the src/core files they import', () => {
    expect(fingerprintFiles(GAME, root)).toStrictEqual([
      'src/core/game-balance/trace-bot.ts',
      'src/core/game/testing/play-bot.ts',
      'src/core/rng/sfc32.ts',
      `src/games/${GAME}/geom/grid.ts`,
      `src/games/${GAME}/rules/create.ts`,
      `src/games/${GAME}/testing/${GAME}-bot.ts`,
      `test/sims/${GAME}/balance.sim.test.ts`,
    ]);
  });

  it('stays the same when an unrelated src/core or screen file changes', () => {
    const before = rulesFingerprint(GAME, root);
    put('src/core/dates/date-key.ts', 'export const dateKey = 2;\n');
    put(`src/games/${GAME}/canvas/draw-board.ts`, 'export const draw = 2;\n');
    put('src/core/canvas/particles.ts', 'export const particles = 3;\n');

    expect(rulesFingerprint(GAME, root)).toBe(before);
  });

  it('changes when a src/core file the sim reaches only through another core file changes', () => {
    const before = rulesFingerprint(GAME, root);
    put('src/core/rng/sfc32.ts', 'export const seedRng = 2;\n');

    expect(rulesFingerprint(GAME, root)).not.toBe(before);
  });

  it('stays the same when the level packs are generated after the sims', () => {
    put(`src/games/${GAME}/levels/${GAME}-level-plan.ts`, 'export const rows = 4;\n');
    const before = rulesFingerprint(GAME, root);
    put(`src/games/${GAME}/levels/pack-1.json`, '{ "levels": [] }\n');
    put(`src/games/${GAME}/levels/pack-2.json`, '{ "levels": [] }\n');

    expect(rulesFingerprint(GAME, root)).toBe(before);
    expect(fingerprintFiles(GAME, root)).toContain(
      `src/games/${GAME}/levels/${GAME}-level-plan.ts`,
    );
  });

  it('changes when a rules or level-plan file changes after the packs were generated', () => {
    put(`src/games/${GAME}/levels/pack-1.json`, '{ "levels": [] }\n');
    const before = rulesFingerprint(GAME, root);
    put(`src/games/${GAME}/levels/${GAME}-level-plan.ts`, 'export const rows = 5;\n');
    const afterPlan = rulesFingerprint(GAME, root);
    put(`src/games/${GAME}/rules/create.ts`, 'export const create = 2;\n');

    expect(afterPlan).not.toBe(before);
    expect(rulesFingerprint(GAME, root)).not.toBe(afterPlan);
  });

  it('changes with the rules and the sim, but not with unit tests or the bands', () => {
    const before = rulesFingerprint(GAME, root);
    put(`src/games/${GAME}/rules/create.test.ts`, '// another test\n');
    put(`test/sims/${GAME}/balance-bands.json`, '{ "status": "approved" }\n');
    expect(rulesFingerprint(GAME, root)).toBe(before);

    put(`test/sims/${GAME}/balance.sim.test.ts`, '// seeds 1-200\n');
    expect(rulesFingerprint(GAME, root)).not.toBe(before);
  });

  it('writes the report as two-space JSON with a trailing newline', () => {
    const report = {
      gameId: GAME,
      rulesFingerprint: 'abc',
      seedsPerCell: 100,
      maxMoves: 50,
      cells: [],
    };
    const written = writeSimReport(report satisfies SimReport, root);

    expect(written).toBe(path.join(root, 'reports', 'sim', `${GAME}.json`));
    expect(readFileSync(written, 'utf8')).toBe(`${JSON.stringify(report, null, 2)}\n`);
  });
});
