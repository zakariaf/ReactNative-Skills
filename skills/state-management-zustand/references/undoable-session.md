# The undoable session: one editing session as pure data

An editing session the user can undo (a bulk edit of tasks, a multi-step editor, a drawing; a game run
in the games plugin) is an `UndoableSession`: the feature's own state plus what the session tracks
around it (the start, the undo history, the command log, the status). It is changed only by the pure
`undoableSessionReducer`, held in a per-session store, and written before anything is shown.
`scripts/check-reducers.mjs` runs the reducer against the rules below with a built-in counter.

## Contents

- The rules a feature supplies
- The session and its actions
- What each action does
- Design choices
- The per-session store: reduce, persist, publish
- When the session is written
- Saving and restoring
- Tests every feature adds
- Games
- Files

## The rules a feature supplies

```ts
type UndoPolicy = { kind: 'none' } | { kind: 'unlimited' } | { kind: 'limited'; max: number };

type SessionRules<TState, TCommand> = {
  apply: (state: TState, command: TCommand) => TState;   // the SAME state when the command does not apply
  isFinished: (state: TState) => boolean;                // commands stop once it is true
  undo: UndoPolicy;
};
```

`apply` and `isFinished` are pure (the feature's own reducer-style rules, with their own tests). A
command is plain data the feature defines: `{ kind: 'complete', taskId }`, `{ kind: 'move', from, to }`.

## The session and its actions

```ts
type SessionStatus = 'active' | 'paused' | 'finished';

type UndoableSession<TState, TCommand> = {
  start: TState;               // where the session began: the origin the log replays from
  state: TState;
  past: readonly TState[];     // the state before each command still in the log (memory only)
  log: readonly TCommand[];    // the applied commands since start, minus the undone ones
  status: SessionStatus;
  undoCount: number;
  activeMs: number;            // time arrives in add-active-time, never from a clock in here
  revision: number;            // changes on every applied command and undo: a view animates on it
};

type SessionAction<TCommand> =
  | { type: 'apply-command'; command: TCommand } | { type: 'undo' }
  | { type: 'pause' } | { type: 'resume' } | { type: 'add-active-time'; ms: number };
```

All fields are `readonly` in the real file (`undoable-session-types.ts`). `startSession(rules, start)`
makes the first session: empty history, `active` unless `start` is already finished.

## What each action does

| Action | When it changes the session | Result |
|---|---|---|
| `apply-command` | only while `active`, and only when `rules.apply` returns a new state | state from `apply`, `past` + the previous state, `log` + the command, `revision + 1`, status from `isFinished` |
| `undo` | while `active`, `past` is not empty, and the policy allows it (`none`: never; `unlimited`: always; `limited`: `undoCount < max`) | previous state back, `past` and `log` shortened by one, `undoCount + 1`, `revision + 1` |
| `pause` | only from `active` | `status: 'paused'` |
| `resume` | only from `paused` | `status: 'active'` |
| `add-active-time` | only while `active`, with `ms > 0` | `activeMs + ms` |

Every refused action returns the same session object, so the store skips the write and the render.

## Design choices

- **Undo keeps states, the disk keeps commands.** In memory, `past` holds whole states for instant
  undo; the written form holds `start`, the command `log` and the current `state` snapshot, and a restore
  rebuilds `past` by replaying the log. A long session stays small on disk.
- **The rules decide what applies.** A command `rules.apply` refuses (returns the same state) changes
  nothing and is not logged, so the log replays exactly.
- **A finished session stops.** Neither commands nor undo apply after the end; the feature records the
  result (one write through `updateAndPublish` when it touches several stores) before it shows it.
- **Active time accumulates only while active,** from deltas the caller measures and clamps (an
  `AppState` change, a frame clock), so a clock jump never adds hours.

## The per-session store: reduce, persist, publish

```ts
const [store] = useState(() =>
  createSessionStore({
    rules,
    initial: restored ?? startSession(rules, start),
    persist: (session) => sessions.save(toSavedSession(session, CODEC.version)),   // a repository method
  }),
);
// dispatch: next = undoableSessionReducer(rules, current, action); if (next === current) return ok;
//           if (sessionActionPersists(action)) { const saved = persist(next); if (!saved.ok) return saved; }
//           set({ session: next });
```

- One store per session, created by the feature in a `useState` initializer; never a module singleton,
  never in `createStores` (`check-stores` treats it as per-session because the same file declares
  `useUndoableSessionStore(store, selector)`, a hook that takes the store first; keep the two together).
- `persist` runs before `set`, so the new session is on disk before the view animates it (a kill during
  an animation loses nothing), and a failed write publishes nothing.
- Components read it with a selector: `useUndoableSessionStore(store, (state) => state.session.revision)`.

## When the session is written

| Moment | Write |
|---|---|
| `apply-command`, `undo`, `pause` | the changed session, before it is published |
| `resume`, `add-active-time` | none of their own: the time rides on the next write (pause writes it) |
| App to background (iOS `inactive`/`background`, Android `background`) | dispatch `pause`, which writes |
| The session finishes | the feature's result write (one transaction), then the saved session is deleted |

A real-time loop with save points (a game's wave end) writes only at those points; that policy belongs
to realtime-game-loop.

## Saving and restoring

```ts
toSavedSession(session, CODEC.version): SavedSession   // { version, start, state, log, undoCount, activeMs }

restoreSession(rules, CODEC, saved):
  | { kind: 'restored'; session; hasHistory }
  | { kind: 'dropped'; reason: 'state-invalid' | 'state-not-migratable' }
```

- The saved value comes from disk: the repository validates its outer shape (valibot) before
  `restoreSession`, and the codec's `parseState` and `parseCommand` validate the feature's own values.
- The snapshot is the truth. A state that does not parse (same version) or cannot be migrated (an older
  version, `migrateState` returns null) drops the session alone, never the rest of the app's data.
- With the same version, the log is parsed and replayed from `start` to rebuild `past`. If the replay
  does not reproduce the snapshot exactly (a determinism bug, or rules changed without a version bump),
  the snapshot is kept, the history is dropped (`hasHistory: false`, and `start` becomes the snapshot),
  and the feature logs it to the error log. The user keeps their work.
- A restored session that was not finished comes back `paused`: a relaunch shows the paused session and
  waits for the user, on iOS and Android alike, never something that moved on unseen.

## Tests every feature adds

- Property: after any sequence of applicable commands, undoing k of them (within the policy) gives the
  state k commands earlier.
- Property: replaying the saved log from `start` reproduces the snapshot (`restoreSession(...).hasHistory`
  is true).
- The kit's own tests (templates) use a counter: a command is recorded, a refused one ignored, undo stops
  at `max`, a paused session ignores commands and time, a finished one ignores commands and undo,
  restore comes back paused with history, the snapshot wins when the replay disagrees, unreadable and
  unmigratable sessions drop alone, and the store writes before it publishes.

## Games

A game run is an undoable session with more: a one-time continue after a loss, a hint counter, a won or
lost outcome with a score, and events for the board to animate. Those belong to game-session-host
(games plugin), which builds on this kit.

## Files

| App path | Role |
|---|---|
| `src/stores/session/undoable-session-types.ts` | the types above |
| `src/stores/session/undoable-session-reducer.ts` | `startSession`, `canUndo`, `undoableSessionReducer` |
| `src/stores/session/undoable-session-store.ts` | `createSessionStore`, `sessionActionPersists`, `useUndoableSessionStore` |
| `src/stores/session/saved-session.ts` | `toSavedSession`, `restoreSession`, `SessionCodec` |
| `test/stores/counter-session-rules.ts` | tiny rules and codec for the kit's tests |
