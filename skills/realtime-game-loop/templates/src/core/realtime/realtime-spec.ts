// src/core/realtime/realtime-spec.ts
// The real-time half of a game: what the fixed-step loop needs from a sim, and what the host needs to
// create, save and restore one. A real-time game's module is
//   GameModule<...> & { readonly realtime: RealtimeSpec<State, Sim, SavePoint> }
// (game-rules-engine's kit keeps GameModule and SavePoint; a turn-based game has no realtime member).

/** What the loop calls on the UI thread. Both functions are worklets that mutate `sim` in place. */
export type FixedStepSim<TSim> = {
  /** Advances exactly one tick with the current input command. */
  readonly step: (sim: TSim, command: number) => void;
  /** Copies out and clears this frame's events (hits, wave end, run end) as flat [kind, value, tick] triples. */
  readonly drainEvents: (sim: TSim) => readonly number[];
};

/** A real-time game's sim, as the host and the save path see it. */
export type RealtimeSpec<TState, TSim, TPoint extends string = string> = FixedStepSim<TSim> & {
  /** JS: a typed-array sim from a fresh or saved JSON state. */
  readonly createSim: (state: TState) => TSim;
  /** JS: the JSON state of a sim copy, taken only at save points. */
  readonly snapshot: (sim: TSim) => TState;
  /** When a run is written (wave end, pause, background); never per frame. */
  readonly savePoints: readonly TPoint[];
  /** JS: whether a drained batch holds a save-point event (a wave end). */
  readonly isSavePoint: (events: readonly number[]) => boolean;
};
