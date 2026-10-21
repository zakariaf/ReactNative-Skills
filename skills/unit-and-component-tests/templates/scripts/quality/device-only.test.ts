// scripts/quality/device-only.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { deviceOnlyCoveragePatterns, deviceOnlyFiles, hasDeviceOnlyMarker } from './device-only.ts';

const MARKED =
  '// src/services/audio/audio-adapter.ts\n// device-only: covered by the simulator smoke test\nexport {};\n';

describe('hasDeviceOnlyMarker', () => {
  it('accepts a marker that names the covering check', () => {
    expect(hasDeviceOnlyMarker(MARKED)).toBe(true);
  });

  it('rejects a marker without a reason', () => {
    expect(hasDeviceOnlyMarker('// device-only: yes\nexport {};\n')).toBe(false);
  });

  it('rejects a marker below the first six lines', () => {
    expect(hasDeviceOnlyMarker(`${'\n'.repeat(6)}${MARKED}`)).toBe(false);
  });

  it('rejects a file without the marker', () => {
    expect(hasDeviceOnlyMarker('export const x = 1;\n')).toBe(false);
  });
});

describe('deviceOnlyFiles', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'device-only-'));
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  beforeAll(() => {
    write('src/services/audio/audio-adapter.ts', MARKED);
    write('src/app/root-providers.tsx', MARKED);
    write('src/services/audio/plain.ts', 'export const plain = 1;\n');
    write('src/services/audio/audio-adapter.test.ts', MARKED);
    write('src/features/board/draw-board.ts', MARKED);
    // Installed agent skills and their templates are not app code (the path is built from parts:
    // the skill library's own checks read a literal skills-folder path as a reference to a skill).
    write(['.agents', 'skills', 'demo', 'templates', 'src', 'x.ts'].join('/'), MARKED);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists only marked source files under src', () => {
    expect(deviceOnlyFiles(root)).toStrictEqual([
      'src/app/root-providers.tsx',
      'src/features/board/draw-board.ts',
      'src/services/audio/audio-adapter.ts',
    ]);
  });

  it('turns each file into one exact coverage ignore pattern', () => {
    const patterns = deviceOnlyCoveragePatterns(root);
    expect(patterns[0]).toBe('<rootDir>/src/app/root-providers\\.tsx$');
    const [, drawBoard = ''] = patterns;
    // The temp root is escaped before it goes in: this tests the pattern's shape, and a temp folder
    // may hold a regex metacharacter ('+'). Jest substitutes <rootDir> unescaped, so keep repo paths
    // free of them.
    const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(drawBoard.replace('<rootDir>', () => escapedRoot));
    expect(matcher.test(`${root}/src/features/board/draw-board.ts`)).toBe(true);
    expect(matcher.test(`${root}/src/features/board/draw-boardXts`)).toBe(false);
  });
});

describe('deviceOnlyFiles when multi-package', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'device-only-workspaces-'));
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  beforeAll(() => {
    write(
      'package.json',
      JSON.stringify({
        workspaces: ['apps/*', 'packages/*', 'functions', '!packages/legacy'],
      }),
    );
    write('apps/mobile/src/services/audio/audio-adapter.ts', MARKED);
    write('packages/shared/src/clock/system-clock.ts', MARKED);
    write('functions/src/deploy-entry.ts', MARKED);
    write('apps/mobile/src/core/plain.ts', 'export const plain = 1;\n');
    // Outside every workspace's src/: config plugins, a folder no glob declares, a negated workspace.
    write('apps/mobile/plugins/with-flag.ts', MARKED);
    write('tools/src/report.ts', MARKED);
    write('packages/legacy/src/old.ts', MARKED);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists the marked files under the src/ of every declared workspace', () => {
    expect(deviceOnlyFiles(root)).toStrictEqual([
      'apps/mobile/src/services/audio/audio-adapter.ts',
      'functions/src/deploy-entry.ts',
      'packages/shared/src/clock/system-clock.ts',
    ]);
  });

  it('reads the workspaces of the { "packages": [...] } form too', () => {
    write('package.json', JSON.stringify({ workspaces: { packages: ['functions'] } }));
    expect(deviceOnlyFiles(root)).toStrictEqual(['functions/src/deploy-entry.ts']);
  });
});
