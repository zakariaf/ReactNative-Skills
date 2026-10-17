// src/core/media/media-ref.test.ts
import {
  createMediaRef,
  extensionForMimeType,
  extensionOf,
  mimeTypeOf,
  parseMediaRef,
  utiOf,
} from './media-ref';

import type { MediaRef } from './media-ref';

function refOf(text: string): MediaRef {
  const parsed = parseMediaRef(text);
  if (!parsed.ok) throw new Error(`test setup: ${text} is not a MediaRef`);
  return parsed.value;
}

describe('createMediaRef', () => {
  it('names a file from a new id and a stored extension', () => {
    expect(createMediaRef('k7m2q9', 'jpg')).toStrictEqual({ ok: true, value: 'k7m2q9.jpg' });
  });

  it.each(['', 'Upper', '../escape', 'a/b', 'trailing-', '-leading', 'a b', 'x'.repeat(81)])(
    'refuses the id %j, which would not be a plain lowercase name',
    (id) => {
      expect(createMediaRef(id, 'jpg')).toStrictEqual({
        ok: false,
        error: { kind: 'invalid-id', id },
      });
    },
  );
});

describe('parseMediaRef', () => {
  it('accepts a stored name and refuses a URI, a path or another extension', () => {
    expect(parseMediaRef('task-12-a1.png')).toStrictEqual({ ok: true, value: 'task-12-a1.png' });
    for (const text of ['file:///var/mobile/a.jpg', 'media/a.jpg', 'a.heic', 'a.JPG', 'a.jpg ']) {
      expect(parseMediaRef(text)).toStrictEqual({
        ok: false,
        error: { kind: 'invalid-ref', text },
      });
    }
  });
});

describe('extensions and MIME types', () => {
  it('maps the reported MIME type to the stored extension, case-insensitively', () => {
    expect(extensionForMimeType('image/JPEG')).toStrictEqual({ ok: true, value: 'jpg' });
    expect(extensionForMimeType('image/webp')).toStrictEqual({ ok: true, value: 'webp' });
  });

  it('refuses HEIC and an unknown type: those are re-encoded before they are stored', () => {
    expect(extensionForMimeType('image/heic')).toStrictEqual({
      ok: false,
      error: { kind: 'unsupported-type', mimeType: 'image/heic' },
    });
    expect(extensionForMimeType(null)).toStrictEqual({
      ok: false,
      error: { kind: 'unsupported-type', mimeType: null },
    });
  });

  it('gives the extension and MIME type of a stored file', () => {
    expect(extensionOf(refOf('a.gif'))).toBe('gif');
    expect(mimeTypeOf(refOf('a.jpg'))).toBe('image/jpeg');
    expect(mimeTypeOf(refOf('a.png'))).toBe('image/png');
  });

  it('gives the iOS type identifier of each stored format, for the share sheet', () => {
    expect(['a.jpg', 'a.png', 'a.webp', 'a.gif'].map((name) => utiOf(refOf(name)))).toStrictEqual([
      'public.jpeg',
      'public.png',
      'org.webmproject.webp',
      'com.compuserve.gif',
    ]);
  });
});
