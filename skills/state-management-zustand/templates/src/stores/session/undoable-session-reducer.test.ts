// src/stores/session/undoable-session-reducer.test.ts
import fc from 'fast-check';

import {
  canUndo,
  startSession,
  undoableSessionReducer,
} from '@/stores/session/undoable-session-reducer';
import { counterRules } from '@test/stores/counter-session-rules';

import type { SessionRules, UndoableSession } from '@/stores/session/undoable-session-types';
import type { Counter } from '@test/stores/counter-session-rules';

type CounterSession = UndoableSession<Counter, number>;

function play(rules: SessionRules<Counter, number>, steps: readonly number[]): CounterSession {
  return steps.reduce(
    (session, command) =>
      undoableSessionReducer(rules, session, { type: 'apply-command', command }),
    startSession(rules, { n: 2 }),
  );
}

describe('undoableSessionReducer', () => {
  it('records a command, the state before it and a new revision', () => {
    const session = play(counterRules(), [3]);
    expect(session.state).toStrictEqual({ n: 5 });
    expect(session.past).toStrictEqual([{ n: 2 }]);
    expect(session.log).toStrictEqual([3]);
    expect(session.revision).toBe(1);
  });

  it('ignores a command the rules refuse', () => {
    const session = play(counterRules(), [1]);
    expect(
      undoableSessionReducer(counterRules(), session, { type: 'apply-command', command: 0 }),
    ).toBe(session);
  });

  it('undoes within the policy and refuses beyond it', () => {
    const rules = counterRules({ kind: 'limited', max: 1 });
    const once = undoableSessionReducer(rules, play(rules, [3, 1]), { type: 'undo' });
    expect(once.state).toStrictEqual({ n: 5 });
    expect(once.log).toStrictEqual([3]);
    expect(undoableSessionReducer(rules, once, { type: 'undo' })).toBe(once);
    const none = counterRules({ kind: 'none' });
    const played = play(none, [1]);
    expect(canUndo(none, played)).toBe(false);
    expect(undoableSessionReducer(none, played, { type: 'undo' })).toBe(played);
  });

  it('ignores commands and time while paused, and resumes only from paused', () => {
    const rules = counterRules();
    const paused = undoableSessionReducer(rules, startSession(rules, { n: 2 }), { type: 'pause' });
    expect(paused.status).toBe('paused');
    expect(undoableSessionReducer(rules, paused, { type: 'apply-command', command: 1 })).toBe(
      paused,
    );
    expect(undoableSessionReducer(rules, paused, { type: 'add-active-time', ms: 500 })).toBe(
      paused,
    );
    expect(undoableSessionReducer(rules, paused, { type: 'pause' })).toBe(paused);
    const active = undoableSessionReducer(rules, paused, { type: 'resume' });
    expect(active.status).toBe('active');
    expect(undoableSessionReducer(rules, active, { type: 'resume' })).toBe(active);
    expect(
      undoableSessionReducer(rules, active, { type: 'add-active-time', ms: 40 }).activeMs,
    ).toBe(40);
  });

  it('stops at the end: a finished session ignores commands and undo', () => {
    const rules = counterRules({ kind: 'unlimited' });
    const finished = play(rules, [8]);
    expect(finished.status).toBe('finished');
    expect(undoableSessionReducer(rules, finished, { type: 'apply-command', command: 1 })).toBe(
      finished,
    );
    expect(undoableSessionReducer(rules, finished, { type: 'undo' })).toBe(finished);
  });

  it('gives the state k commands earlier after k undos', () => {
    const rules = counterRules({ kind: 'unlimited' });
    // At most 7 steps of +1 from n = 2 never reach 10, so the session stays active.
    const steps = fc.array(fc.constantFrom(-3, -2, -1, 1), { maxLength: 7 });
    fc.assert(
      fc.property(steps, fc.nat(7), (commands, back) => {
        const session = play(rules, commands);
        const k = Math.min(back, session.log.length);
        let rewound = session;
        for (let index = 0; index < k; index += 1) {
          rewound = undoableSessionReducer(rules, rewound, { type: 'undo' });
        }
        const earlier = play(rules, session.log.slice(0, session.log.length - k));
        expect(rewound.state).toStrictEqual(earlier.state);
      }),
    );
  });
});
