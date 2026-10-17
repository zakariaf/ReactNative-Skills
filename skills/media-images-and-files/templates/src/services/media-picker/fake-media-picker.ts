// src/services/media-picker/fake-media-picker.ts: a MediaPickerPort that answers with what the test queued, for tests.
import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  MediaPickFailure,
  MediaPickerPort,
  PickedImage,
} from '@/services/media-picker/media-picker-port';

export type FakeMediaPicker = MediaPickerPort & {
  /** The next pickImages answers this (images, an empty list for a cancel, or a failure). */
  readonly queuePick: (answer: Result<readonly PickedImage[], MediaPickFailure>) => void;
  /** The next capturePhoto answers this (null for a cancel). */
  readonly queueCapture: (answer: Result<PickedImage | null, MediaPickFailure>) => void;
  /** What recoverPendingPick answers once (Android's lost pick). */
  readonly leavePendingPick: (images: readonly PickedImage[]) => void;
  /** Whether the camera permission is granted; capturePhoto answers permission-needed without it. */
  readonly setCameraAllowed: (isAllowed: boolean) => void;
  /** Whether the device has a camera; capturePhoto answers camera-unavailable without one (first). */
  readonly setCameraPresent: (isPresent: boolean) => void;
  /** Every pickImages limit, oldest first. */
  readonly pickLimits: readonly number[];
};

/** A cache file the way the picker leaves one; `name` keeps tests readable. */
export function pickedImageFixture(
  name: string,
  overrides: Partial<PickedImage> = {},
): PickedImage {
  return {
    uri: `file:///cache/ImagePicker/${name}`,
    size: { width: 4032, height: 3024 },
    mimeType: 'image/jpeg',
    sizeBytes: 3_500_000,
    ...overrides,
  };
}

/** With nothing queued a pick or a capture is cancelled. The camera starts present and allowed. */
export function createFakeMediaPicker(): FakeMediaPicker {
  const picks: Result<readonly PickedImage[], MediaPickFailure>[] = [];
  const captures: Result<PickedImage | null, MediaPickFailure>[] = [];
  const pickLimits: number[] = [];
  let pending: readonly PickedImage[] = [];
  let isCameraAllowed = true;
  let isCameraPresent = true;
  return {
    pickLimits,
    queuePick: (answer) => {
      picks.push(answer);
    },
    queueCapture: (answer) => {
      captures.push(answer);
    },
    leavePendingPick: (images) => {
      pending = images;
    },
    setCameraAllowed: (isAllowed) => {
      isCameraAllowed = isAllowed;
    },
    setCameraPresent: (isPresent) => {
      isCameraPresent = isPresent;
    },
    pickImages: ({ limit }) => {
      pickLimits.push(limit);
      return Promise.resolve(picks.shift() ?? ok([]));
    },
    capturePhoto: () => {
      if (!isCameraPresent) return Promise.resolve(err({ kind: 'camera-unavailable' }));
      if (!isCameraAllowed) return Promise.resolve(err({ kind: 'permission-needed' }));
      return Promise.resolve(captures.shift() ?? ok(null));
    },
    recoverPendingPick: () => {
      const images = pending;
      pending = [];
      return Promise.resolve(ok(images));
    },
  };
}
