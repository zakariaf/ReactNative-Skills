// src/data/media/media-importer.test.ts
import { MEDIA_LIMITS } from '@/core/media/image-fit';
import { err, ok } from '@/core/result';
import { createFakeImageResizer } from '@/services/image-resizer/fake-image-resizer';
import {
  createFakeMediaPicker,
  pickedImageFixture,
} from '@/services/media-picker/fake-media-picker';
import { createFakeMediaStore } from '@/services/media-store/fake-media-store';

import { createMediaImporter } from './media-importer';
import { sweepMedia } from './media-sweeper';

import type { MediaRef } from '@/core/media/media-ref';
import type { PickedImage } from '@/services/media-picker/media-picker-port';

function setup(): {
  readonly picker: ReturnType<typeof createFakeMediaPicker>;
  readonly resizer: ReturnType<typeof createFakeImageResizer>;
  readonly store: ReturnType<typeof createFakeMediaStore>;
  readonly importer: ReturnType<typeof createMediaImporter>;
  readonly give: (images: readonly PickedImage[]) => readonly PickedImage[];
} {
  const picker = createFakeMediaPicker();
  const resizer = createFakeImageResizer();
  const store = createFakeMediaStore();
  resizer.onOutput((uri) => {
    store.giveTemporary(uri);
  });
  let next = 0;
  const importer = createMediaImporter({
    picker,
    resizer,
    store,
    nextMediaId: () => {
      next += 1;
      return `m${String(next)}`;
    },
  });
  const give = (images: readonly PickedImage[]): readonly PickedImage[] => {
    for (const image of images) store.giveTemporary(image.uri);
    return images;
  };
  return { picker, resizer, store, importer, give };
}

describe('createMediaImporter', () => {
  it('downscales each pick once, stores it under a new name and discards both temporaries', async () => {
    const { picker, resizer, store, importer, give } = setup();
    picker.queuePick(
      ok(
        give([
          pickedImageFixture('a.heic', { mimeType: 'image/heic' }),
          pickedImageFixture('b.jpg'),
        ]),
      ),
    );

    await expect(importer.importFromLibrary(5)).resolves.toStrictEqual({
      ok: true,
      value: ['m1.jpg', 'm2.jpg'],
    });

    expect(picker.pickLimits).toStrictEqual([5]);
    expect(resizer.requests.map((request) => [request.maxEdgePx, request.quality])).toStrictEqual([
      [MEDIA_LIMITS.storedMaxEdgePx, MEDIA_LIMITS.jpegQuality],
      [MEDIA_LIMITS.storedMaxEdgePx, MEDIA_LIMITS.jpegQuality],
    ]);
    expect([...store.stored()]).toStrictEqual([
      ['m1.jpg', 'file:///cache/ImageManipulator/1.jpg'],
      ['m2.jpg', 'file:///cache/ImageManipulator/2.jpg'],
    ]);
    expect(store.temporaries().size).toBe(0);
    expect([...importer.sessionRefs()]).toStrictEqual(['m1.jpg', 'm2.jpg']);
  });

  it('treats a cancelled pick as an empty list and a cancelled capture as null', async () => {
    const { importer, store } = setup();
    await expect(importer.importFromLibrary(1)).resolves.toStrictEqual({ ok: true, value: [] });
    await expect(importer.importFromCamera()).resolves.toStrictEqual({ ok: true, value: null });
    expect(store.stored().size).toBe(0);
  });

  it('is all or nothing: a failed resize removes the batch already stored and discards the rest', async () => {
    const { picker, resizer, store, importer, give } = setup();
    const images = give([
      pickedImageFixture('a.jpg'),
      pickedImageFixture('b.jpg'),
      pickedImageFixture('c.jpg'),
    ]);
    picker.queuePick(ok(images));
    let calls = 0;
    resizer.onOutput(() => {
      calls += 1;
      if (calls === 1) resizer.failNext();
    });

    await expect(importer.importFromLibrary(3)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'resize-failed' },
    });
    expect(store.stored().size).toBe(0);
    expect(store.temporaries().size).toBe(0);
    expect(importer.sessionRefs().size).toBe(0);
  });

  it('protects a stored file while the batch resizes its next image, so a sweep spares it', async () => {
    const { picker, resizer, store, importer, give } = setup();
    picker.queuePick(ok(give([pickedImageFixture('a.jpg'), pickedImageFixture('b.jpg')])));
    const sweeps: (readonly string[])[] = [];
    let calls = 0;
    resizer.onOutput(() => {
      calls += 1;
      if (calls !== 2) return;
      // The startup sweep (or one after a restore) runs while image 2 is being resized.
      const swept = sweepMedia({
        store,
        referenced: new Set(),
        sessionRefs: importer.sessionRefs(),
        protectedRefs: new Set(),
      });
      sweeps.push(swept.ok ? swept.value.removed : ['list-failed']);
    });

    await expect(importer.importFromLibrary(2)).resolves.toStrictEqual({
      ok: true,
      value: ['m1.jpg', 'm2.jpg'],
    });
    expect(sweeps).toStrictEqual([[]]);
    expect([...store.stored().keys()]).toStrictEqual(['m1.jpg', 'm2.jpg']);
  });

  it('passes a store failure through, with nothing stored', async () => {
    const { picker, store, importer, give } = setup();
    picker.queuePick(ok(give([pickedImageFixture('a.jpg')])));
    store.failNextImport({ kind: 'no-space', neededBytes: 9, availableBytes: 1 });
    await expect(importer.importFromLibrary(1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'no-space', neededBytes: 9, availableBytes: 1 },
    });
    expect(store.stored().size).toBe(0);
  });

  it('passes the camera permission and picker failures through as values', async () => {
    const { picker, importer } = setup();
    picker.setCameraAllowed(false);
    await expect(importer.importFromCamera()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'permission-needed' },
    });
    picker.queuePick(err({ kind: 'pick-failed' }));
    await expect(importer.importFromLibrary(1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'pick-failed' },
    });
  });

  it('stores a captured photo and the pick Android lost while the activity was gone', async () => {
    const { picker, importer, give } = setup();
    picker.queueCapture(ok(give([pickedImageFixture('camera.jpg')])[0] ?? null));
    await expect(importer.importFromCamera()).resolves.toStrictEqual({ ok: true, value: 'm1.jpg' });
    picker.leavePendingPick(give([pickedImageFixture('lost.jpg')]));
    await expect(importer.importPendingPick()).resolves.toStrictEqual({
      ok: true,
      value: ['m2.jpg'],
    });
  });

  it('refuses an id that is not a plain lowercase name, discarding the temporary', async () => {
    const picker = createFakeMediaPicker();
    const store = createFakeMediaStore();
    const importer = createMediaImporter({
      picker,
      resizer: createFakeImageResizer(),
      store,
      nextMediaId: () => 'Not Plain',
    });
    store.giveTemporary(pickedImageFixture('a.jpg').uri);
    picker.queuePick(ok([pickedImageFixture('a.jpg')]));
    await expect(importer.importFromLibrary(1)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-id', id: 'Not Plain' },
    });
    expect(store.temporaries().size).toBe(0);
  });

  it('spares a ref saved to a table the sweep already read', async () => {
    const { picker, store, importer, give } = setup();
    // Two tables that hold MediaRefs; the sweep unions them with an await per table.
    const taskPhotos: MediaRef[] = [];
    const notePhotos: MediaRef[] = [];
    const readTable = async (table: readonly MediaRef[]): Promise<readonly MediaRef[]> => {
      await Promise.resolve();
      return [...table];
    };
    picker.queuePick(ok(give([pickedImageFixture('a.jpg')])));

    const referenced = new Set(await readTable(taskPhotos));
    // Between the two reads the task-photos job imports a photo and saves it to the first table.
    const imported = await importer.importFromLibrary(1);
    if (imported.ok) taskPhotos.push(...imported.value);
    for (const ref of await readTable(notePhotos)) referenced.add(ref);
    const swept = sweepMedia({
      store,
      referenced,
      sessionRefs: importer.sessionRefs(),
      protectedRefs: new Set(),
    });

    expect(taskPhotos).toStrictEqual(['m1.jpg']);
    expect(referenced.size).toBe(0);
    expect(swept.ok ? swept.value.removed : ['list-failed']).toStrictEqual([]);
    expect([...store.stored().keys()]).toStrictEqual(['m1.jpg']);
  });
});
