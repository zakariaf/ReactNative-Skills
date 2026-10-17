// src/services/game-host/session-extras.ts
// What a run's controller holds beside its store: the recorded summary, the shown hint and a failed
// write. Patched inside the persist step before the store publishes (one render sees both); emit()
// notifies only for a change no publish carries (a failed write publishes nothing).
import type { GameRunsFailure } from '@/data/game-runs/game-runs-repository';
import type { SessionExtras } from '@/services/game-host/session-view-of';

export type ExtrasBox<TMove> = {
  readonly current: () => SessionExtras<TMove>;
  readonly patch: (patch: Partial<SessionExtras<TMove>>) => void;
  readonly emit: () => void;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createSessionExtras<TMove>(): ExtrasBox<TMove> {
  let current: SessionExtras<TMove> = { summary: null, hint: null, saveFailure: null };
  const listeners = new Set<() => void>();
  return {
    current: () => current,
    patch: (patch) => {
      current = { ...current, ...patch };
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A write failed: nothing was published, so show the failure (the screen offers a retry). */
export function showSaveFailure<TMove>(box: ExtrasBox<TMove>, failure: GameRunsFailure): void {
  box.patch({ saveFailure: failure });
  box.emit();
}
