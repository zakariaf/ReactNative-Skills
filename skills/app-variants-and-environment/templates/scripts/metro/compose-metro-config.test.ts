// scripts/metro/compose-metro-config.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composeMetroConfig, METRO_KITS_FILE, readMetroKits } from './compose-metro-config.ts';

import type { MetroKit } from './compose-metro-config.ts';
import type { MetroConfig } from 'expo/metro-config';

/** A stand-in config: only the fields a case reads (Metro's full config has dozens). */
const configOf = (fields: Partial<MetroConfig>): MetroConfig => fields as MetroConfig;
const expoDefault = (projectRoot: string): MetroConfig =>
  configOf({ projectRoot, resetCache: false });

describe('composeMetroConfig', () => {
  it("is Expo's default config without kits", () => {
    expect(composeMetroConfig('/app', expoDefault, [])).toStrictEqual({
      projectRoot: '/app',
      resetCache: false,
    });
  });

  it("builds on one kit's base config, then runs every transform in list order", () => {
    const order: string[] = [];
    const kits: readonly MetroKit[] = [
      {
        name: 'first',
        transform: (config) => {
          order.push('first');
          return { ...config, watchFolders: ['first'] };
        },
      },
      {
        name: 'crash-reporting',
        baseConfig: (projectRoot) => configOf({ projectRoot, resetCache: true }),
      },
      {
        name: 'second',
        transform: (config) => {
          order.push('second');
          return { ...config, maxWorkers: 2 };
        },
      },
    ];
    expect(composeMetroConfig('/app', expoDefault, kits)).toStrictEqual({
      projectRoot: '/app',
      resetCache: true,
      watchFolders: ['first'],
      maxWorkers: 2,
    });
    expect(order).toStrictEqual(['first', 'second']);
  });

  it('refuses two kits that each replace the base config', () => {
    const base = (projectRoot: string): MetroConfig => configOf({ projectRoot });
    expect(() =>
      composeMetroConfig('/app', expoDefault, [
        { name: 'a', baseConfig: base },
        { name: 'b', baseConfig: base },
      ]),
    ).toThrow('Metro kits a, b each replace the base config');
  });
});

describe('readMetroKits', () => {
  let projectRoot = '';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'metro-kits-'));
    writeFileSync(join(projectRoot, 'package.json'), '{}');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('finds no kits when the app has no metro-kits file', () => {
    expect(readMetroKits(projectRoot)).toStrictEqual([]);
  });

  it('refuses a metro-kits file without a METRO_KITS list', () => {
    mkdirSync(join(projectRoot, 'scripts', 'metro'), { recursive: true });
    writeFileSync(join(projectRoot, METRO_KITS_FILE), 'module.exports = { kits: [] };\n');
    expect(() => readMetroKits(projectRoot)).toThrow('must export METRO_KITS');
  });
});
