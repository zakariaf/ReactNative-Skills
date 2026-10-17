// src/services/file-picker/file-picker-port.ts: letting the user pick one file to import, copied where the app can read it.
import type { Result } from '@/core/result';

export type PickedFile = {
  /** A file:// URI in the app's cache: the picker copied the file there, so it can be read. */
  readonly uri: string;
  /** The name the user saw; shown in the confirmation, never trusted to decide the format. */
  readonly name: string;
  readonly sizeBytes: number | null;
  /** What the provider claims; never trusted either: the envelope decides. */
  readonly mimeType: string | null;
};

export type PickFailure = { readonly kind: 'pick-failed' };

/**
 * Adapter: expo-document-picker-file-picker-adapter.ts. Fake: fake-file-picker.ts. Called only from
 * a user's press. A cancelled pick is ok(null), not a failure: the user changed their mind.
 */
export type FilePickerPort = {
  readonly pickFile: () => Promise<Result<PickedFile | null, PickFailure>>;
};
