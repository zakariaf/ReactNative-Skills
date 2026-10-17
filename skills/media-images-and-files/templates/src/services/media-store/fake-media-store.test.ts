// src/services/media-store/fake-media-store.test.ts
import { parseMediaRef } from '@/core/media/media-ref';

import { createFakeMediaStore } from './fake-media-store';

import type { MediaRef } from '@/core/media/media-ref';

function refOf(text: string): MediaRef {
  const parsed = parseMediaRef(text);
  if (!parsed.ok) throw new Error(`test setup: ${text} is not a MediaRef`);
  return parsed.value;
}

const TEMP = 'file:///cache/ImageManipulator/1.jpg';

describe('createFakeMediaStore', () => {
  it('imports a temporary under a new name and resolves it to a URI only when asked', async () => {
    const store = createFakeMediaStore();
    store.giveTemporary(TEMP);
    await expect(store.importFile({ sourceUri: TEMP, ref: refOf('a.jpg') })).resolves.toStrictEqual(
      {
        ok: true,
        value: 'a.jpg',
      },
    );
    expect(store.exists(refOf('a.jpg'))).toBe(true);
    expect(store.uriOf(refOf('a.jpg'))).toBe('file:///documents/media/a.jpg');
    expect(store.list()).toStrictEqual({ ok: true, value: ['a.jpg'] });
  });

  it('refuses to overwrite a name, and refuses a temporary the system purged', async () => {
    const store = createFakeMediaStore();
    store.giveTemporary(TEMP);
    await store.importFile({ sourceUri: TEMP, ref: refOf('a.jpg') });
    await expect(store.importFile({ sourceUri: TEMP, ref: refOf('a.jpg') })).resolves.toStrictEqual(
      {
        ok: false,
        error: { kind: 'name-taken', ref: 'a.jpg' },
      },
    );
    await expect(
      store.importFile({ sourceUri: 'file:///cache/gone.jpg', ref: refOf('b.jpg') }),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'source-missing' } });
  });

  it('fails once as a value when told to, storing nothing', async () => {
    const store = createFakeMediaStore();
    store.giveTemporary(TEMP);
    store.failNextImport({ kind: 'no-space', neededBytes: 10, availableBytes: 1 });
    expect((await store.importFile({ sourceUri: TEMP, ref: refOf('a.jpg') })).ok).toBe(false);
    expect(store.stored().size).toBe(0);
  });

  it('removes idempotently and discards only cache temporaries', () => {
    const store = createFakeMediaStore();
    store.plant(refOf('old.jpg'));
    expect(store.remove(refOf('old.jpg'))).toStrictEqual({ ok: true, value: undefined });
    expect(store.remove(refOf('old.jpg'))).toStrictEqual({ ok: true, value: undefined });
    store.giveTemporary(TEMP);
    store.giveTemporary('file:///documents/media/kept.jpg');
    store.discardTemporary(TEMP);
    store.discardTemporary('file:///documents/media/kept.jpg');
    expect([...store.temporaries()]).toStrictEqual(['file:///documents/media/kept.jpg']);
  });

  it('removes the partial copies a crash left, which list() never shows', () => {
    const store = createFakeMediaStore();
    store.plant(refOf('kept.jpg'));
    store.plantPartial(refOf('half.jpg'));
    expect(store.list()).toStrictEqual({ ok: true, value: ['kept.jpg'] });
    expect(store.removeStalePartials()).toStrictEqual({ ok: true, value: 1 });
    expect(store.partials().size).toBe(0);
    expect(store.removeStalePartials()).toStrictEqual({ ok: true, value: 0 });
  });
});
