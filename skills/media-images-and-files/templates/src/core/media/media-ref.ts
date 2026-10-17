// src/core/media/media-ref.ts
// The one way the app names a stored media file: a MediaRef is a plain file name inside the app's
// media folder ('k7m2q9-photo.jpg'), never a file:// URI or an absolute path. Records, stores and
// backups hold MediaRefs; the media store resolves one to a URI at the moment it is shown, because
// the absolute path of the app's folders is not stable (iOS gives a new container path after an
// update or a restore, Android after a restore to another device). A new file always gets a new
// name, so an image cache keyed by URI can never show stale pixels. Pure TypeScript.
import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

/** A stored media file's name, made only by createMediaRef or parseMediaRef. */
export type MediaRef = string & { readonly __brand: 'MediaRef' };

/** The formats the app stores. Images are re-encoded to JPEG before they are stored. */
export const MEDIA_EXTENSIONS = ['jpg', 'png', 'webp', 'gif'] as const;

export type MediaExtension = (typeof MEDIA_EXTENSIONS)[number];

export type MediaRefFailure =
  | { readonly kind: 'invalid-id'; readonly id: string }
  | { readonly kind: 'invalid-ref'; readonly text: string }
  | { readonly kind: 'unsupported-type'; readonly mimeType: string | null };

/** Lowercase letters, digits and inner hyphens: safe in every file system and URL. */
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

const REF_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)\.(jpg|png|webp|gif)$/;

const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, MediaExtension>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The file name for a new stored file. `id` is new for every file: never reuse one. */
export function createMediaRef(
  id: string,
  extension: MediaExtension,
): Result<MediaRef, MediaRefFailure> {
  if (!ID_PATTERN.test(id)) return err({ kind: 'invalid-id', id });
  return ok(`${id}.${extension}` as MediaRef);
}

/** Reads a stored name back (a database row, a backup, a list of the media folder). */
export function parseMediaRef(text: string): Result<MediaRef, MediaRefFailure> {
  return REF_PATTERN.test(text) ? ok(text as MediaRef) : err({ kind: 'invalid-ref', text });
}

/** The extension of a MediaRef ('jpg'). */
export function extensionOf(ref: MediaRef): MediaExtension {
  const match = REF_PATTERN.exec(ref);
  // A MediaRef always matches: only createMediaRef and parseMediaRef make one.
  return (match?.[2] ?? 'jpg') as MediaExtension;
}

/**
 * The stored extension for a MIME type the platform reported. HEIC and other formats are not
 * stored as they are: the resizer re-encodes them to JPEG first.
 */
export function extensionForMimeType(
  mimeType: string | null,
): Result<MediaExtension, MediaRefFailure> {
  const extension = mimeType === null ? undefined : EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()];
  return extension === undefined ? err({ kind: 'unsupported-type', mimeType }) : ok(extension);
}

/** The MIME type to hand to a share sheet or an upload for a stored file. */
export function mimeTypeOf(ref: MediaRef): string {
  const extension = extensionOf(ref);
  return extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
}

/** iOS Uniform Type Identifiers of the stored formats (UTType.jpeg, .png, .webP, .gif). */
const UTI_BY_EXTENSION: Readonly<Record<MediaExtension, string>> = {
  jpg: 'public.jpeg',
  png: 'public.png',
  webp: 'org.webmproject.webp',
  gif: 'com.compuserve.gif',
};

/** The iOS type identifier to hand to a share sheet for a stored file (next to mimeTypeOf). */
export function utiOf(ref: MediaRef): string {
  return UTI_BY_EXTENSION[extensionOf(ref)];
}
