// test/goldens/harness-badge.golden.test.ts
// PIXEL GOLDEN (Jest 'golden' project, CanvasKit): proves the golden project draws with the real
// Skia through the canvas kit's offscreen renderer (paintSurfacePng: the same draw() and layout()
// shape a device surface runs) and compares against a committed PNG. Create or change the baseline
// only with `npx jest <this file> --selectProjects golden -u`, after opening the PNG, with a
// Gate-Change trailer.
import { Skia } from '@shopify/react-native-skia';

import { EMPTY_LAYOUT } from '@/canvas/canvas-layout';
import { makeCanvasColors, makeDrawKit } from '@/canvas/draw-kit';
import { paintSurfacePng } from '@/canvas/paint-surface-png';

import { toMatchPixelGolden } from './skia-golden';

import type { CanvasLayout } from '@/canvas/canvas-layout';
import type { DrawFrame, LayoutInput } from '@/canvas/canvas-types';
import type { PaletteSet } from '@/canvas/draw-kit';
import type { SkCanvas } from '@shopify/react-native-skia';

expect.extend({ toMatchImageSnapshot: toMatchPixelGolden });

type BadgeToken = 'badge';

const SIZE = 64;
const PALETTES: PaletteSet<BadgeToken> = {
  light: { badge: '#208AEF' },
  dark: { badge: '#208AEF' },
};

function layoutBadge({ width, height, isMirrored }: LayoutInput<null>): CanvasLayout {
  return { ...EMPTY_LAYOUT, width, height, isMirrored };
}

function drawBadge(canvas: SkCanvas, frame: DrawFrame<null, BadgeToken>): void {
  const { fill } = frame.kit;
  fill.setColor(frame.colors.color.badge);
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(8, 8, 48, 48), 12, 12), fill);
}

function paintBadge(): Uint8Array {
  return paintSurfacePng(Skia, {
    draw: drawBadge,
    layout: layoutBadge,
    view: null,
    tracks: [],
    elapsedMs: 0,
    colors: makeCanvasColors(Skia, PALETTES, 'light'),
    kit: makeDrawKit(Skia, { paths: {}, numberTypeface: null, numberSize: 0 }),
    width: SIZE,
    height: SIZE,
    isMirrored: false,
  });
}

describe('harness badge golden', () => {
  it('draws the rounded badge', () => {
    expect(Buffer.from(paintBadge())).toMatchImageSnapshot({
      customSnapshotIdentifier: 'harness-badge',
    });
  });
});
