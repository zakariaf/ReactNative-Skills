// src/ui/feedback/undoable.ts
// Undo over confirm: a reversible change happens at once, and a notice offers to put it back. No
// question first, because the person meant it nearly every time, and Undo protects the rare slip
// better than a dialog people learn to tap through. The change is already written when the notice
// shows (a soft delete, a move), so a notice that times out, is replaced or dies with the app
// loses nothing; purging soft-deleted rows later is the data layer's job.
import type { NoticeRequest } from './notice';
import type { Result } from '@/core/result';

export type UndoableChange<TFailure> = {
  /** Makes the change now. Returns a Result and never rejects. */
  readonly apply: () => Promise<Result<unknown, TFailure>>;
  /** Puts it back exactly as it was (restores the soft-deleted row). Never rejects. */
  readonly revert: () => Promise<Result<unknown, TFailure>>;
};

/** The notice shown after the change, all translated. */
export type UndoNotice = {
  /** "Task deleted". */
  readonly doneText: string;
  /** "Undo". */
  readonly undoLabel: string;
  /** '<screen>.<what>-notice'. */
  readonly testID: string;
};

export type UndoStep = 'apply' | 'revert';

export type UndoSinks<TFailure> = {
  /** useFeedback().notify. */
  readonly notify: (request: NoticeRequest) => void;
  /** A failed step: shown inline or in a banner where the change was asked for, never with Undo. */
  readonly onFailure: (failure: TFailure, step: UndoStep) => void;
  /** A step that rejected despite its contract: the error log, never the screen. */
  readonly recordError: (error: unknown) => void;
};

/**
 * Applies `change`; when it worked, shows the notice with Undo, which reverts once. A failed apply
 * shows no notice (nothing happened, so there is nothing to undo). Resolves with the apply result.
 */
export async function runUndoable<TFailure>(
  change: UndoableChange<TFailure>,
  notice: UndoNotice,
  sinks: UndoSinks<TFailure>,
): Promise<Result<unknown, TFailure>> {
  const applied = await change.apply();
  if (!applied.ok) {
    sinks.onFailure(applied.error, 'apply');
    return applied;
  }
  let isReverted = false;
  const undo = (): void => {
    if (isReverted) return;
    isReverted = true;
    change.revert().then((reverted) => {
      if (!reverted.ok) sinks.onFailure(reverted.error, 'revert');
    }, sinks.recordError);
  };
  sinks.notify({
    text: notice.doneText,
    testID: notice.testID,
    action: { label: notice.undoLabel, onPress: undo },
  });
  return applied;
}
