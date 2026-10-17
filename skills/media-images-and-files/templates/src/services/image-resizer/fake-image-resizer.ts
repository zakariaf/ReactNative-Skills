// src/services/image-resizer/fake-image-resizer.ts: an ImageResizerPort that computes the adapter's output size and records each request, for tests.
import { fitWithin } from '@/core/media/image-fit';
import { err, ok } from '@/core/result';

import type {
  DownscaleRequest,
  ImageResizerPort,
} from '@/services/image-resizer/image-resizer-port';

export type FakeImageResizer = ImageResizerPort & {
  readonly requests: readonly DownscaleRequest[];
  /** The next downscale fails, once. */
  readonly failNext: () => void;
  /** Called with each output URI, so a fake media store can treat it as an existing temporary. */
  readonly onOutput: (listener: (uri: string) => void) => void;
};

/** Outputs are numbered cache files, the way the manipulator names its own. */
export function createFakeImageResizer(): FakeImageResizer {
  const requests: DownscaleRequest[] = [];
  const listeners: ((uri: string) => void)[] = [];
  let shouldFail = false;
  return {
    requests,
    failNext: () => {
      shouldFail = true;
    },
    onOutput: (listener) => {
      listeners.push(listener);
    },
    downscale: (request) => {
      requests.push(request);
      if (shouldFail) {
        shouldFail = false;
        return Promise.resolve(err({ kind: 'resize-failed' }));
      }
      const size = fitWithin(request.size, request.maxEdgePx) ?? {
        width: request.maxEdgePx,
        height: request.maxEdgePx,
      };
      const uri = `file:///cache/ImageManipulator/${String(requests.length)}.jpg`;
      for (const listener of listeners) listener(uri);
      return Promise.resolve(ok({ uri, size }));
    },
  };
}
