// test/stores/counter-session-rules.ts: tiny session rules and codec for the session kit's tests.
import type { SessionCodec } from '@/stores/session/saved-session';
import type { SessionRules, UndoPolicy } from '@/stores/session/undoable-session-types';

/** The counter's whole state. */
export type Counter = { readonly n: number };

const isCounter = (json: unknown): json is Counter =>
  typeof json === 'object' &&
  json !== null &&
  'n' in json &&
  typeof json.n === 'number' &&
  Number.isInteger(json.n);

/** A command adds its step to n; a step of 0 is refused; n of 10 or more finishes the session. */
export function counterRules(
  undo: UndoPolicy = { kind: 'limited', max: 1 },
): SessionRules<Counter, number> {
  return {
    apply: (state, step) => (step === 0 ? state : { n: state.n + step }),
    isFinished: (state) => state.n >= 10,
    undo,
  };
}

/** Version 2 saves { n }; version 1 saved the bare number. */
export const COUNTER_CODEC: SessionCodec<Counter, number> = {
  version: 2,
  parseState: (json) => (isCounter(json) ? { n: json.n } : null),
  parseCommand: (json) => (typeof json === 'number' && Number.isInteger(json) ? json : null),
  migrateState: (json, fromVersion) =>
    fromVersion === 1 && typeof json === 'number' ? { n: json } : null,
};
