// src/ui/feedback/confirm.test.ts
import { createConfirmGate } from './confirm';

import type { ConfirmRequest } from './confirm';

const CLEAR_DONE: ConfirmRequest = {
  title: 'Delete 3 done tasks?',
  body: 'They are removed for good.',
  confirmLabel: 'Delete tasks',
  cancelLabel: 'Cancel',
  tone: 'destructive',
  testID: 'tasks.clear-done-dialog',
};

describe('createConfirmGate', () => {
  it('holds the open question and resolves it with the answer', async () => {
    const gate = createConfirmGate();
    const answer = gate.ask(CLEAR_DONE);
    expect(gate.current()).toBe(CLEAR_DONE);
    gate.answer('confirmed');
    await expect(answer).resolves.toBe('confirmed');
    expect(gate.current()).toBeNull();
  });

  it('answers an open question dismissed when a newer one replaces it', async () => {
    const gate = createConfirmGate();
    const first = gate.ask(CLEAR_DONE);
    const second = gate.ask({ ...CLEAR_DONE, title: 'Delete this list?' });
    await expect(first).resolves.toBe('dismissed');
    gate.answer('cancelled');
    await expect(second).resolves.toBe('cancelled');
  });

  it('tells its listeners about each change and ignores answers with nothing open', async () => {
    const gate = createConfirmGate();
    const listener = jest.fn();
    const unsubscribe = gate.subscribe(listener);
    gate.answer('confirmed');
    expect(listener).not.toHaveBeenCalled();
    const first = gate.ask(CLEAR_DONE);
    gate.answer('dismissed');
    await expect(first).resolves.toBe('dismissed');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    const second = gate.ask(CLEAR_DONE);
    gate.answer('cancelled');
    await expect(second).resolves.toBe('cancelled');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
