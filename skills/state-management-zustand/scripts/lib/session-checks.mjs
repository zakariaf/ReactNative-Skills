// session-checks.mjs: the rules every undoable session reducer keeps, run with a built-in counter
// (the reducer is generic over its rules, so a tiny rules object exercises all of it).
// Each check throws (node:assert) when the reducer breaks its rule.

import { deepStrictEqual, strictEqual } from 'node:assert/strict';

import { deepFreeze } from './app-modules.mjs';

/** A command adds its step to n; a step of 0 is refused; n of 10 or more finishes the session. */
export const counterRules = (undo) => ({
  apply: (state, step) => (step === 0 ? state : { n: state.n + step }),
  isFinished: (state) => state.n >= 10,
  undo,
});

const LIMITED = counterRules({ kind: 'limited', max: 1 });
const play = (mod, rules, commands, session = mod.startSession(rules, { n: 2 })) =>
  commands.reduce((current, command) => mod.undoableSessionReducer(rules, current, { type: 'apply-command', command }), session);

export const SESSION_CHECKS = [
  {
    rule: 'session-command',
    name: 'apply-command records the state, the state before it, the log and a new revision; a refused command changes nothing',
    fix: 'apply-command (while active): state from rules.apply, past + the previous state, log + the command, revision + 1; when rules.apply returns the same state, return the same session.',
    run: (mod) => {
      const next = play(mod, LIMITED, [3]);
      deepStrictEqual(next.state, { n: 5 });
      deepStrictEqual(next.past, [{ n: 2 }]);
      deepStrictEqual(next.log, [3]);
      strictEqual(next.revision, 1);
      strictEqual(next.status, 'active');
      strictEqual(mod.undoableSessionReducer(LIMITED, next, { type: 'apply-command', command: 0 }), next, 'a refused command');
    },
  },
  {
    rule: 'session-undo',
    name: 'undo steps back exactly one command, within the undo policy',
    fix: "undo: refuse (same object) when the policy is 'none', when 'limited' is used up, or when past is empty; otherwise the previous state, past and log shortened by one, undoCount + 1.",
    run: (mod) => {
      const played = play(mod, LIMITED, [3, 1]);
      const once = mod.undoableSessionReducer(LIMITED, played, { type: 'undo' });
      deepStrictEqual(once.state, { n: 5 });
      deepStrictEqual(once.log, [3]);
      strictEqual(once.undoCount, 1);
      strictEqual(mod.undoableSessionReducer(LIMITED, once, { type: 'undo' }), once, 'a second undo beyond max 1');
      const none = counterRules({ kind: 'none' });
      const noUndo = play(mod, none, [1]);
      strictEqual(mod.undoableSessionReducer(none, noUndo, { type: 'undo' }), noUndo, "undo with policy 'none'");
    },
  },
  {
    rule: 'session-paused',
    name: 'a paused session ignores commands and time, and resume returns it to active',
    fix: 'apply-command and add-active-time return the same session unless status is active; pause only from active, resume only from paused.',
    run: (mod) => {
      const paused = mod.undoableSessionReducer(LIMITED, mod.startSession(LIMITED, { n: 2 }), { type: 'pause' });
      strictEqual(paused.status, 'paused');
      strictEqual(mod.undoableSessionReducer(LIMITED, paused, { type: 'apply-command', command: 1 }), paused, 'a command while paused');
      strictEqual(mod.undoableSessionReducer(LIMITED, paused, { type: 'add-active-time', ms: 500 }), paused, 'time while paused');
      strictEqual(mod.undoableSessionReducer(LIMITED, paused, { type: 'resume' }).status, 'active');
    },
  },
  {
    rule: 'session-finished',
    name: 'a finished session ignores commands and undo',
    fix: "status becomes 'finished' when rules.isFinished(state); apply-command and undo return the same session unless status is active.",
    run: (mod) => {
      const unlimited = counterRules({ kind: 'unlimited' });
      const finished = play(mod, unlimited, [9]);
      strictEqual(finished.status, 'finished');
      strictEqual(mod.undoableSessionReducer(unlimited, finished, { type: 'apply-command', command: 1 }), finished, 'a command after the end');
      strictEqual(mod.undoableSessionReducer(unlimited, finished, { type: 'undo' }), finished, 'undo after the end');
    },
  },
  {
    rule: 'reducer-mutates',
    name: 'the input session is never changed',
    fix: 'Build a new session object for every change (spread, never push or assign).',
    run: (mod) => {
      const played = play(mod, LIMITED, [3]);
      const copy = structuredClone(played);
      deepFreeze(played);
      for (const action of [{ type: 'apply-command', command: 1 }, { type: 'undo' }, { type: 'pause' }, { type: 'add-active-time', ms: 5 }]) {
        mod.undoableSessionReducer(LIMITED, played, action);
      }
      deepStrictEqual(played, copy);
    },
  },
];
