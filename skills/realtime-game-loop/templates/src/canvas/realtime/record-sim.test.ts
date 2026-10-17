// src/canvas/realtime/record-sim.test.ts
import { recordSim } from './record-sim';

import type { CanvasColors, DrawKit } from '@/canvas/canvas-types';
import type { SkCanvas, SkPicture, SkPictureRecorder } from '@shopify/react-native-skia';

type Sim = { readonly body: Float32Array };

const PICTURE = { kind: 'picture' } as unknown as SkPicture;

/** A recorder whose canvas counts drawCircle calls; Skia's native module is not needed. */
function fakeRecorder(): { recorder: SkPictureRecorder; circles: () => number } {
  let circles = 0;
  const canvas = {
    drawCircle: () => {
      circles += 1;
    },
  } as unknown as SkCanvas;
  const recorder = {
    beginRecording: () => canvas,
    finishRecordingAsPicture: () => PICTURE,
  } as unknown as SkPictureRecorder;
  return { recorder, circles: () => circles };
}

const FRAME = {
  width: 390,
  height: 560,
  colors: { set: 'dark', color: {} } as CanvasColors<string>,
  kit: {} as DrawKit,
};

describe('recordSim', () => {
  it('draws the live sim into a picture', () => {
    const { recorder, circles } = fakeRecorder();
    const sim: Sim = { body: new Float32Array([1, 2, 3, 4]) };
    const picture = recordSim(recorder, {
      ...FRAME,
      sim,
      draw: (canvas, frame) => {
        for (let i = 0; i < frame.sim.body.length; i += 2)
          canvas.drawCircle(0, 0, 1, frame.kit.fill);
      },
      onError: () => undefined,
    });
    expect(picture).toBe(PICTURE);
    expect(circles()).toBe(2);
  });

  it('reports a draw exception and still returns a picture', () => {
    const { recorder } = fakeRecorder();
    const onError = jest.fn();
    const picture = recordSim(recorder, {
      ...FRAME,
      sim: { body: new Float32Array(0) },
      draw: () => {
        throw new RangeError('bad entity');
      },
      onError,
    });
    expect(picture).toBe(PICTURE);
    expect(onError).toHaveBeenCalledWith('RangeError: bad entity');
  });
});
