// src/services/image-resizer/expo-image-manipulator-image-resizer-adapter.ts: ImageResizerPort over expo-image-manipulator's contextual API (devices only).
// device-only: covered by the media drill on a named iOS simulator and Android emulator (references/testing-and-checker.md); the API was read in expo-image-manipulator 57.0.20 types and native sources (type-checked against them on 2026-10-14), and fake-image-resizer.ts runs the contract in Jest.
// An example, not a template: install it with `npx expo install expo-image-manipulator` (~57.0.20), classify the SDK
// (examples/contracts/architecture.json), then copy this file to the path on line 1.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { fitWithin } from '@/core/media/image-fit';
import { attemptAsync } from '@/core/result';

import type { PixelSize } from '@/core/media/image-fit';
import type {
  DownscaleRequest,
  DownscaledImage,
  ImageResizerPort,
  ResizeFailure,
} from '@/services/image-resizer/image-resizer-port';

/** The size to render: from the picker when it reported one, else read from a first render. */
async function targetSize(request: DownscaleRequest): Promise<PixelSize> {
  const known = fitWithin(request.size, request.maxEdgePx);
  if (known !== null) return known;
  const probe = ImageManipulator.manipulate(request.uri);
  const original = await probe.renderAsync();
  const size = { width: original.width, height: original.height };
  original.release();
  probe.release();
  return fitWithin(size, request.maxEdgePx) ?? size;
}

async function downscale(request: DownscaleRequest): Promise<DownscaledImage> {
  const size = await targetSize(request);
  // One dimension only (the long edge): the manipulator computes the other from the decoded image, so
  // the aspect ratio holds even if the picker's reported size and the decoded orientation disagree
  // (EXIF rotation). Passing both would stretch the photo then; one edge at worst overshoots the limit.
  const edge = size.width >= size.height ? { width: size.width } : { height: size.height };
  const context = ImageManipulator.manipulate(request.uri).resize(edge);
  const image = await context.renderAsync();
  // One encode: JPEG at the app's quality. UIImage.jpegData (iOS) and Bitmap.compress (Android)
  // write pixels only, so the EXIF block (GPS position, device) is not carried over (read in the
  // native sources; check a shared file with exiftool in the drill).
  const saved = await image.saveAsync({ compress: request.quality, format: SaveFormat.JPEG });
  image.release();
  context.release();
  return { uri: saved.uri, size: { width: saved.width, height: saved.height } };
}

export function createExpoImageManipulatorImageResizerAdapter(): ImageResizerPort {
  return {
    downscale: (request) =>
      attemptAsync(
        () => downscale(request),
        (): ResizeFailure => ({ kind: 'resize-failed' }),
      ),
  };
}
