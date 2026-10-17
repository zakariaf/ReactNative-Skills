// src/stores/session/saved-session.test.ts
import fc from 'fast-check';

import { restoreSession, toSavedSession } from '@/stores/session/saved-session';
import { startSession, undoableSessionReducer } from '@/stores/session/undoable-session-reducer';
import { COUNTER_CODEC, counterRules } from '@test/stores/counter-session-rules';

import type { SavedSession } from '@/stores/session/saved-session';
import type { UndoableSession } from '@/stores/session/undoable-session-types';
import type { Counter } from '@test/stores/counter-session-rules';

const RULES = counterRules({ kind: 'unlimited' });

function played(steps: readonly number[]): UndoableSession<Counter, number> {
  return steps.reduce(
    (session, command) =>
      undoableSessionReducer(RULES, session, { type: 'apply-command', command }),
    startSession(RULES, { n: 0 }),
  );
}

function restored(saved: SavedSession): UndoableSession<Counter, number> {
  const result = restoreSession(RULES, COUNTER_CODEC, saved);
  if (result.kind !== 'restored')
    throw new Error(`expected a restored session, got ${result.reason}`);
  return result.session;
}

describe('saved session', () => {
  it('leaves past out of what it writes', () => {
    expect(Object.keys(toSavedSession(played([1, 2]), 2))).not.toContain('past');
  });

  it('restores paused, with the undo history rebuilt by replay', () => {
    const session = restored(toSavedSession(played([1, 2]), 2));
    expect(session.status).toBe('paused');
    expect(session.state).toStrictEqual({ n: 3 });
    expect(session.past).toStrictEqual([{ n: 0 }, { n: 1 }]);
    expect(session.log).toStrictEqual([1, 2]);
  });

  it('keeps the snapshot and drops only the history when the replay disagrees', () => {
    const saved = { ...toSavedSession(played([1, 2]), 2), state: { n: 7 } };
    const result = restoreSession(RULES, COUNTER_CODEC, saved);
    expect(result.kind === 'restored' && result.hasHistory).toBe(false);
    const session = restored(saved);
    expect(session.state).toStrictEqual({ n: 7 });
    expect(session.start).toStrictEqual({ n: 7 });
    expect(session.past).toStrictEqual([]);
    expect(session.log).toStrictEqual([]);
  });

  it('drops an unreadable session alone, and migrates an older one without history', () => {
    const saved = toSavedSession(played([1]), 2);
    expect(restoreSession(RULES, COUNTER_CODEC, { ...saved, state: 'n' })).toStrictEqual({
      kind: 'dropped',
      reason: 'state-invalid',
    });
    expect(restoreSession(RULES, COUNTER_CODEC, { ...saved, version: 1, state: {} })).toStrictEqual(
      {
        kind: 'dropped',
        reason: 'state-not-migratable',
      },
    );
    const migrated = restored({ ...saved, version: 1, state: 4 });
    expect(migrated.state).toStrictEqual({ n: 4 });
    expect(migrated.log).toStrictEqual([]);
  });

  it('restores a finished session as finished', () => {
    expect(restored(toSavedSession(played([9, 1]), 2)).status).toBe('finished');
  });

  it('reproduces the snapshot when the saved log is replayed', () => {
    const steps = fc.array(fc.constantFrom(-2, -1, 1, 2), { maxLength: 4 });
    fc.assert(
      fc.property(steps, (commands) => {
        const result = restoreSession(RULES, COUNTER_CODEC, toSavedSession(played(commands), 2));
        expect(result.kind === 'restored' && result.hasHistory).toBe(true);
      }),
    );
  });
});
