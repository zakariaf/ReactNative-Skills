// src/core/push/foreground-presentation.test.ts
import { foregroundPresentation } from './foreground-presentation';

const LOUD = { banner: true, list: true, sound: true, badge: true };
const QUIET = { banner: false, list: true, sound: false, badge: true };

describe('foregroundPresentation', () => {
  it('lets the app own local notifications interrupt', () => {
    expect(foregroundPresentation({ isRemote: false, message: null })).toStrictEqual(LOUD);
  });

  it.each([
    [{ kind: 'task-assigned', taskId: 't1' } as const],
    [{ kind: 'list-shared', listId: 'l1' } as const],
  ])('interrupts for work handed to the person (%j)', (message) => {
    expect(foregroundPresentation({ isRemote: true, message })).toStrictEqual(LOUD);
  });

  it('keeps a broadcast quiet', () => {
    expect(
      foregroundPresentation({ isRemote: true, message: { kind: 'announcement' } }),
    ).toStrictEqual(QUIET);
  });

  it('keeps data this build does not understand quiet, but never drops it', () => {
    const shown = foregroundPresentation({ isRemote: true, message: null });
    expect(shown).toStrictEqual(QUIET);
    expect(shown.list).toBe(true);
  });
});
