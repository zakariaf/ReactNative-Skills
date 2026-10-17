// test/play-actions.ts — drives any pure state model from a list of "choice" integers, so a
// fast-check property explores action sequences without knowing the domain: at each step
// choice % legalActions.length picks the next action, and a state with no legal action ends the play.
//   fc.array(fc.nat(), { maxLength: 40 }) generates the choices; the log feeds the assertions.

/** The two functions a property needs from a reducer, a rules engine or a policy. */
export type ActionModel<TState, TAction> = {
  /** Every action that is legal in `state`; an empty list ends the play. */
  readonly listActions: (state: TState) => readonly TAction[];
  /** The next state (pure: same state and action, same result). */
  readonly apply: (state: TState, action: TAction) => TState;
};

export type PlayLog<TState, TAction> = {
  /** The start state, then one state per applied action. */
  readonly states: readonly TState[];
  readonly actions: readonly TAction[];
};

export function playActions<TState, TAction>(
  model: ActionModel<TState, TAction>,
  start: TState,
  choices: readonly number[],
): PlayLog<TState, TAction> {
  const states: TState[] = [start];
  const actions: TAction[] = [];
  let state = start;
  for (const choice of choices) {
    const legal = model.listActions(state);
    const action = legal[choice % Math.max(legal.length, 1)];
    if (action === undefined) {
      break;
    }
    state = model.apply(state, action);
    states.push(state);
    actions.push(action);
  }
  return { states, actions };
}
