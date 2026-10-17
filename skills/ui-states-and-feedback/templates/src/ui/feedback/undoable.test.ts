// src/ui/feedback/undoable.test.ts
import { err, ok } from '@/core/result';
import { flushMicrotasks } from '@test/flush-microtasks';

import { runUndoable } from './undoable';

import type { NoticeRequest } from './notice';
import type { UndoableChange, UndoSinks } from './undoable';
import type { Result } from '@/core/result';

type Failure = { readonly kind: 'storage-full' };
const FULL: Failure = { kind: 'storage-full' };
const NOTICE = { doneText: 'Task deleted', undoLabel: 'Undo', testID: 'tasks.deleted-notice' };

function sinks(): UndoSinks<Failure> & { readonly shown: NoticeRequest[] } {
  const shown: NoticeRequest[] = [];
  return {
    shown,
    notify: (request) => {
      shown.push(request);
    },
    onFailure: jest.fn(),
    recordError: jest.fn(),
  };
}

function change(
  applied: Result<unknown, Failure>,
  reverted: Result<unknown, Failure> = ok(undefined),
): UndoableChange<Failure> & { readonly revert: jest.Mock } {
  return {
    apply: () => Promise.resolve(applied),
    revert: jest.fn(() => Promise.resolve(reverted)),
  };
}

describe('runUndoable', () => {
  it('applies at once and offers Undo, which reverts exactly once', async () => {
    const out = sinks();
    const deletion = change(ok(undefined));
    await expect(runUndoable(deletion, NOTICE, out)).resolves.toStrictEqual(ok(undefined));
    expect(out.shown).toHaveLength(1);
    const [shown] = out.shown;
    expect(shown?.text).toBe('Task deleted');
    expect(shown?.action?.label).toBe('Undo');
    shown?.action?.onPress();
    shown?.action?.onPress();
    await flushMicrotasks();
    expect(deletion.revert).toHaveBeenCalledTimes(1);
    expect(out.onFailure).not.toHaveBeenCalled();
  });

  it('shows no notice when the change failed, only the failure', async () => {
    const out = sinks();
    await expect(runUndoable(change(err(FULL)), NOTICE, out)).resolves.toStrictEqual(err(FULL));
    expect(out.shown).toHaveLength(0);
    expect(out.onFailure).toHaveBeenCalledWith(FULL, 'apply');
  });

  it('reports a failed undo as a failure of the revert step', async () => {
    const out = sinks();
    await runUndoable(change(ok(undefined), err(FULL)), NOTICE, out);
    out.shown[0]?.action?.onPress();
    await flushMicrotasks();
    expect(out.onFailure).toHaveBeenCalledWith(FULL, 'revert');
  });

  it('records a revert that broke its never-reject contract', async () => {
    const out = sinks();
    const broken: UndoableChange<Failure> = {
      apply: () => Promise.resolve(ok(undefined)),
      revert: () => Promise.reject(new Error('disk gone')),
    };
    await runUndoable(broken, NOTICE, out);
    out.shown[0]?.action?.onPress();
    await flushMicrotasks();
    expect(out.recordError).toHaveBeenCalledWith(new Error('disk gone'));
  });
});
