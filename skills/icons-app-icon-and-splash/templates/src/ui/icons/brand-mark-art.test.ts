// src/ui/icons/brand-mark-art.test.ts
import { PALETTE } from '@/theme/palette';

import { markOps, monoOps } from './brand-mark-art';

import type { BrandMark } from './brand-mark-art';

const MARK: BrandMark = {
  tile: 'primary',
  layers: [
    { d: 'M8 8h32v32H8z', fill: 'surface', stroke: 'text' },
    { d: 'M14 24h20', stroke: 'primary', width: 5 },
  ],
};

describe('markOps', () => {
  it('paints a filled shape before its butt-capped edge, in the scheme colours', () => {
    const [face, edge] = markOps(MARK, PALETTE.light);

    expect(face).toStrictEqual({
      key: '0-fill',
      d: 'M8 8h32v32H8z',
      style: 'fill',
      color: PALETTE.light.surface,
      width: 0,
      cap: 'butt',
      isCut: false,
    });
    expect(edge).toMatchObject({
      style: 'stroke',
      color: PALETTE.light.text,
      width: 2.6,
      cap: 'butt',
    });
  });

  it('gives a line without a fill round caps and its own width', () => {
    expect(markOps(MARK, PALETTE.dark).at(-1)).toMatchObject({
      style: 'stroke',
      color: PALETTE.dark.primary,
      width: 5,
      cap: 'round',
    });
  });

  it('keys every operation by its layer position and paint, so React keys are unique and stable', () => {
    expect(markOps(MARK, PALETTE.light).map((op) => op.key)).toStrictEqual([
      '0-fill',
      '0-stroke',
      '1-stroke',
    ]);
  });

  it('keeps a layer rotation on every operation of that layer', () => {
    const rotate = { deg: -10, cx: 24, cy: 24 };
    const tilted: BrandMark = { ...MARK, layers: [{ ...MARK.layers[0], d: 'M0 0h4v4z', rotate }] };

    expect(markOps(tilted, PALETTE.light).map((op) => op.rotate)).toStrictEqual([rotate, rotate]);
  });
});

describe('monoOps', () => {
  it('draws filled shapes white and cuts lines out of them (themed icons read alpha only)', () => {
    const ops = monoOps(MARK, '#FFFFFF');

    expect(ops.map((op) => [op.style, op.color, op.isCut])).toStrictEqual([
      ['fill', '#FFFFFF', false],
      ['stroke', '#FFFFFF', false],
      ['stroke', '#FFFFFF', true],
    ]);
  });
});
