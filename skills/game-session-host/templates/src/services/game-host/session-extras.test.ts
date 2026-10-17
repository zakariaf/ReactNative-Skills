// src/services/game-host/session-extras.test.ts
import { createSessionExtras, showSaveFailure } from './session-extras';

describe('createSessionExtras', () => {
  it('patches quietly and notifies only on emit', () => {
    const box = createSessionExtras<number>();
    const listener = jest.fn();
    const stop = box.subscribe(listener);
    box.patch({ hint: { move: 2, atSeq: 1 } });

    expect(box.current().hint).toStrictEqual({ move: 2, atSeq: 1 });
    expect(listener).not.toHaveBeenCalled();

    showSaveFailure(box, { kind: 'storage-busy' });

    expect(box.current().saveFailure).toStrictEqual({ kind: 'storage-busy' });
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    box.emit();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
