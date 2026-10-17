// scripts/quality/check-worklet-boundary.test.ts
import { checkFile, checkRepo } from './check-worklet-boundary.ts';

const FILES: Readonly<Record<string, string>> = {
  'src/canvas/timeline/a.ts':
    "'worklet';\nimport { b } from './b';\nimport type { C } from '@/canvas/c';\nimport { type D } from './d';\n",
  'src/canvas/timeline/b.ts': "'worklet';\nexport const b = 1;\n",
  'src/canvas/c.ts': 'export type C = number;\nexport const c = 2;\n',
  'src/canvas/timeline/d.ts': 'export type D = string;\n',
  'src/canvas/timeline/bad.ts': "'worklet';\nimport { c } from '@/canvas/c';\n",
  'src/canvas/timeline/plain.ts': 'export const plain = 3;\n',
  'src/canvas/timeline/sdk.ts': "'worklet';\nimport { Skia } from '@shopify/react-native-skia';\n",
  'src/games/lights-out/canvas/draw-lights-out.ts': 'export function drawLightsOut(): void {}\n',
  'src/games/lights-out/canvas/layout-lights-out.ts':
    "'worklet';\nexport function layoutLightsOut(): number {\n  return 0;\n}\n",
  'src/games/lights-out/rules/apply-move.ts': 'export const applyMove = 1;\n',
};
const read = (file: string): string | null => FILES[file] ?? null;

describe('worklet boundary', () => {
  it('allows value imports between UI-thread modules and type imports from anywhere', () => {
    expect(checkFile('src/canvas/timeline/a.ts', read)).toStrictEqual([]);
  });

  it('flags a UI-thread module importing a value from a JS-only module through the alias', () => {
    expect(checkFile('src/canvas/timeline/bad.ts', read)).toStrictEqual([
      {
        file: 'src/canvas/timeline/bad.ts',
        problem: 'value import from non-worklet module src/canvas/c.ts',
      },
    ]);
  });

  it('flags a required UI-thread module without the directive, and a package value import', () => {
    expect(checkFile('src/canvas/timeline/plain.ts', read)).toHaveLength(1);
    expect(checkFile('src/canvas/timeline/sdk.ts', read)).toHaveLength(1);
  });

  it('requires the directive in game-board draw and layout files, not in their rules', () => {
    expect(checkFile('src/games/lights-out/canvas/draw-lights-out.ts', read)).toStrictEqual([
      {
        file: 'src/games/lights-out/canvas/draw-lights-out.ts',
        problem: "missing file-level 'worklet'; directive",
      },
    ]);
    expect(checkFile('src/games/lights-out/canvas/layout-lights-out.ts', read)).toStrictEqual([]);
    expect(checkFile('src/games/lights-out/rules/apply-move.ts', read)).toStrictEqual([]);
  });

  it('finds no violations in this repository', () => {
    expect(checkRepo()).toStrictEqual([]);
  });
});
