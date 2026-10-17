// src/data/media/media-sweeper.test.ts
import { parseMediaRef } from '@/core/media/media-ref';
import { err } from '@/core/result';
import { createFakeMediaStore } from '@/services/media-store/fake-media-store';

import { sweepMedia } from './media-sweeper';

import type { MediaRef } from '@/core/media/media-ref';

function refOf(text: string): MediaRef {
  const parsed = parseMediaRef(text);
  if (!parsed.ok) throw new Error(`test setup: ${text} is not a MediaRef`);
  return parsed.value;
}

describe('sweepMedia', () => {
  it('deletes orphans, keeps referenced and session files, and reports missing ones', () => {
    const store = createFakeMediaStore();
    for (const name of ['kept.jpg', 'orphan.jpg', 'new.jpg']) store.plant(refOf(name));
    store.plantPartial(refOf('crashed.jpg'));

    const report = sweepMedia({
      store,
      referenced: new Set([refOf('kept.jpg'), refOf('gone.jpg')]),
      sessionRefs: new Set([refOf('new.jpg')]),
      protectedRefs: new Set(),
    });

    expect(report).toStrictEqual({
      ok: true,
      value: { removed: ['orphan.jpg'], failed: [], missing: ['gone.jpg'], partialsRemoved: 1 },
    });
    expect([...store.stored().keys()].sort()).toStrictEqual(['kept.jpg', 'new.jpg']);
    expect(store.partials().size).toBe(0);
  });

  it("keeps the files only the restore's safety copy references, so undoing the restore finds them", () => {
    const store = createFakeMediaStore();
    for (const name of ['live.jpg', 'before-restore.jpg', 'orphan.jpg']) store.plant(refOf(name));

    const report = sweepMedia({
      store,
      referenced: new Set([refOf('live.jpg')]),
      sessionRefs: new Set(),
      protectedRefs: new Set([refOf('before-restore.jpg')]),
    });

    expect(report.ok && report.value.removed).toStrictEqual(['orphan.jpg']);
    expect([...store.stored().keys()].sort()).toStrictEqual(['before-restore.jpg', 'live.jpg']);
  });

  it('keeps an orphan whose delete failed for the next sweep', () => {
    const store = createFakeMediaStore();
    store.plant(refOf('stuck.jpg'));
    const failing = { ...store, remove: () => err({ kind: 'delete-failed' as const }) };
    expect(
      sweepMedia({
        store: failing,
        referenced: new Set(),
        sessionRefs: new Set(),
        protectedRefs: new Set(),
      }),
    ).toStrictEqual({
      ok: true,
      value: { removed: [], failed: ['stuck.jpg'], missing: [], partialsRemoved: 0 },
    });
  });

  it('fails as a value when the folder cannot be listed, deleting nothing', () => {
    const store = createFakeMediaStore();
    store.plant(refOf('a.jpg'));
    const unlistable = { ...store, list: () => err({ kind: 'list-failed' as const }) };
    expect(
      sweepMedia({
        store: unlistable,
        referenced: new Set(),
        sessionRefs: new Set(),
        protectedRefs: new Set(),
      }),
    ).toStrictEqual({
      ok: false,
      error: { kind: 'list-failed' },
    });
    expect(store.stored().size).toBe(1);
  });
});
