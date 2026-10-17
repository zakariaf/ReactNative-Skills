// src/stores/session/undoable-session-store.test.ts
import { err, ok } from '@/core/result';
import { toSavedSession } from '@/stores/session/saved-session';
import { startSession } from '@/stores/session/undoable-session-reducer';
import { createSessionStore, sessionActionPersists } from '@/stores/session/undoable-session-store';
import { counterRules } from '@test/stores/counter-session-rules';

import type { Result } from '@/core/result';
import type { SavedSession } from '@/stores/session/saved-session';
import type { UndoableSession } from '@/stores/session/undoable-session-types';
import type { Counter } from '@test/stores/counter-session-rules';

type WriteFailure = { readonly kind: 'storage-full' };

/** An in-memory "disk" that keeps every written session, or refuses the next write. */
function createDisk(): {
  readonly written: SavedSession[];
  failNext: boolean;
  readonly persist: (session: UndoableSession<Counter, number>) => Result<void, WriteFailure>;
} {
  const disk = {
    written: [] as SavedSession[],
    failNext: false,
    persist: (session: UndoableSession<Counter, number>): Result<void, WriteFailure> => {
      if (disk.failNext) {
        disk.failNext = false;
        return err({ kind: 'storage-full' });
      }
      disk.written.push(toSavedSession(session, 2));
      return ok(undefined);
    },
  };
  return disk;
}

function setup(): {
  readonly disk: ReturnType<typeof createDisk>;
  readonly store: ReturnType<typeof createSessionStore<Counter, number, WriteFailure>>;
} {
  const rules = counterRules();
  const disk = createDisk();
  const store = createSessionStore({
    rules,
    initial: startSession(rules, { n: 2 }),
    persist: disk.persist,
  });
  return { disk, store };
}

describe('session store', () => {
  it('writes a changed session before it publishes it', () => {
    const { disk, store } = setup();
    const seenOnDisk: unknown[] = [];
    store.subscribe(() => {
      seenOnDisk.push(disk.written.at(-1)?.state);
    });
    expect(store.getState().dispatch({ type: 'apply-command', command: 3 })).toStrictEqual(
      ok(undefined),
    );
    expect(seenOnDisk).toStrictEqual([{ n: 5 }]);
  });

  it('writes nothing for a refused action', () => {
    const { disk, store } = setup();
    expect(store.getState().dispatch({ type: 'undo' })).toStrictEqual(ok(undefined));
    expect(store.getState().dispatch({ type: 'apply-command', command: 0 })).toStrictEqual(
      ok(undefined),
    );
    expect(disk.written).toHaveLength(0);
  });

  it('publishes nothing when the write fails', () => {
    const { disk, store } = setup();
    const listener = jest.fn();
    store.subscribe(listener);
    disk.failNext = true;
    expect(store.getState().dispatch({ type: 'apply-command', command: 1 })).toStrictEqual(
      err({ kind: 'storage-full' }),
    );
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState().session.state).toStrictEqual({ n: 2 });
  });

  it('publishes resume and active time without a write of their own', () => {
    const { disk, store } = setup();
    expect(store.getState().dispatch({ type: 'pause' }).ok).toBe(true);
    expect(store.getState().dispatch({ type: 'resume' }).ok).toBe(true);
    expect(store.getState().dispatch({ type: 'add-active-time', ms: 250 }).ok).toBe(true);
    expect(disk.written).toHaveLength(1);
    expect(store.getState().session.activeMs).toBe(250);
    expect(sessionActionPersists({ type: 'undo' })).toBe(true);
  });
});
