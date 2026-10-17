// src/canvas/record-picture.test.ts
import { EMPTY_HIGHLIGHT, IDLE_POINTER } from './canvas-types';
import { recordPicture } from './record-picture';
import { makeScene } from './scene';

import type { CanvasLayout } from './canvas-layout';
import type { CanvasColors, DrawFrame, DrawKit } from './canvas-types';
import type { RecordInput } from './record-picture';
import type { Track } from './timeline/track';
import type { SkCanvas, SkPicture, SkPictureRecorder } from '@shopify/react-native-skia';

type View = { readonly label: string };
type Frame = DrawFrame<View, 'ink'>;

const LAYOUT: CanvasLayout = { width: 200, height: 100, isMirrored: false, regions: [] };
const CANVAS = { name: 'canvas' } as unknown as SkCanvas;
const PICTURE = { name: 'picture' } as unknown as SkPicture;
const POP: Track = {
  channel: 'pop',
  entityId: 1,
  startMs: 0,
  durationMs: 100,
  easing: 'linear',
  from: [0],
  to: [1],
};

/** A recorder that hands out CANVAS, remembers the bounds and returns PICTURE. */
function fakeRecorder(): { recorder: SkPictureRecorder; bounds: unknown[] } {
  const bounds: unknown[] = [];
  const recorder = {
    beginRecording: (rect: unknown) => {
      bounds.push(rect);
      return CANVAS;
    },
    finishRecordingAsPicture: () => PICTURE,
  } as unknown as SkPictureRecorder;
  return { recorder, bounds };
}

function input(draw: (canvas: SkCanvas, frame: Frame) => void): RecordInput<View, 'ink'> {
  const scene = { ...makeScene(3, { label: 'final' }, [POP]), startAt: 1000 };
  return {
    scene,
    now: 1050,
    layout: LAYOUT,
    pointer: { ...IDLE_POINTER, isDown: true },
    highlight: { selected: { regionId: 'tray', col: 1, row: 0 }, hinted: [] },
    colors: {} as CanvasColors<'ink'>,
    kit: {} as DrawKit,
    draw,
    onError: jest.fn(),
  };
}

describe('recordPicture', () => {
  it('records one frame of the final view at the scene time, with pointer and highlight', () => {
    const frames: Frame[] = [];
    const { recorder, bounds } = fakeRecorder();
    const picture = recordPicture(
      recorder,
      input((canvas, frame) => {
        expect(canvas).toBe(CANVAS);
        frames.push(frame);
      }),
    );
    expect(picture).toBe(PICTURE);
    expect(bounds).toStrictEqual([{ x: 0, y: 0, width: 200, height: 100 }]);
    const [frame] = frames;
    expect(frame?.view).toStrictEqual({ label: 'final' });
    expect(frame?.fx.elapsedMs).toBe(50);
    expect(frame?.fx.entries['pop:1']?.values).toStrictEqual([0.5]);
    expect(frame?.fx.pointer.isDown).toBe(true);
    expect(frame?.highlight.selected).toStrictEqual({ regionId: 'tray', col: 1, row: 0 });
    expect(frame?.layout).toBe(LAYOUT);
  });

  it('reports a draw() error and still returns a picture (the app never crashes)', () => {
    const failing = input(() => {
      throw new Error('bad token');
    });
    const picture = recordPicture(fakeRecorder().recorder, {
      ...failing,
      highlight: EMPTY_HIGHLIGHT,
    });
    expect(picture).toBe(PICTURE);
    expect(failing.onError).toHaveBeenCalledWith('Error: bad token');
  });
});
