// scripts/levels/app-imports.test.ts
import { appImportBase, candidatePaths } from './app-imports.ts';

const SRC = '/repo/src';

describe('appImportBase', () => {
  it('maps the @/ alias into src/', () => {
    expect(appImportBase('@/core/game/levels', null, SRC)).toBe('/repo/src/core/game/levels');
  });

  it('resolves a relative import against the importing app file', () => {
    const parent = '/repo/src/games/lights-out/levels/lights-out-levels.ts';
    expect(appImportBase('./pack-1.json', parent, SRC)).toBe(
      '/repo/src/games/lights-out/levels/pack-1.json',
    );
    expect(appImportBase('../rules/create', parent, SRC)).toBe(
      '/repo/src/games/lights-out/rules/create',
    );
  });

  it('leaves packages and imports from outside src/ to Node', () => {
    expect(appImportBase('prettier', null, SRC)).toBeNull();
    expect(appImportBase('./app-imports.ts', '/repo/scripts/levels/generate.ts', SRC)).toBeNull();
  });
});

describe('candidatePaths', () => {
  it('tries the written path, then each extension, then an index file', () => {
    expect(candidatePaths('/repo/src/a')).toStrictEqual([
      '/repo/src/a',
      '/repo/src/a.ts',
      '/repo/src/a.tsx',
      '/repo/src/a.js',
      '/repo/src/a.json',
      '/repo/src/a/index.ts',
      '/repo/src/a/index.tsx',
      '/repo/src/a/index.js',
      '/repo/src/a/index.json',
    ]);
  });
});
