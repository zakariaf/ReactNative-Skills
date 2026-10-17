// src/core/game/testing/contract-intents.ts
// The input half of engineContractProblems: panMode and selectRegions are valid, every move
// intentToMove makes is listed (taps with a selection included), a tap inside a select region only
// selects, and no intent is accepted that the surface's pan mode never sends. Generic over the
// intent type: it reads only `kind`, and a tap's `target.regionId`.
import { jsonOf } from './json-shape';

import type { GameInput, GameIntent, PanMode } from '@/core/game/game-input';

/** One explored position: the state and the moves listMoves offers there. */
export type IntentStep<TState, TMove> = {
  readonly state: TState;
  readonly moves: readonly TMove[];
};

/** A tap's target as far as the contract needs it: the region the finger hit. */
type RegionTarget = { readonly regionId: string };

/** The pan mode the surface must be in to send each pan intent; taps and long presses always work. */
const MODE_FOR_INTENT: Readonly<Record<string, PanMode>> = {
  swipe: 'swipe',
  'drag-end': 'drag',
  aim: 'aim',
};
const PAN_MODES: readonly unknown[] = ['none', 'swipe', 'drag', 'aim'];

function isRegionTarget(value: unknown): value is RegionTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'regionId') === 'string'
  );
}

/** The target of a tap intent, or null for any other intent. */
function tapTarget(intent: GameIntent): RegionTarget | null {
  if (intent.kind !== 'tap') return null;
  const target: unknown = Reflect.get(intent, 'target');
  return isRegionTarget(target) ? target : null;
}

/** A panMode outside the four, or none at all (a JavaScript caller, a missing member). */
function panModeProblem(panMode: unknown): string | null {
  return PAN_MODES.includes(panMode)
    ? null
    : `panMode '${String(panMode)}' is not 'none', 'swipe', 'drag' or 'aim'`;
}

/** The select regions as a list; anything else (a JavaScript caller) is reported and ignored. */
function regionsOf(selectRegions: unknown): readonly string[] {
  return Array.isArray(selectRegions) && selectRegions.every((id) => typeof id === 'string')
    ? selectRegions
    : [];
}

function selectRegionsProblem(selectRegions: unknown): string | null {
  return regionsOf(selectRegions) === selectRegions
    ? null
    : `selectRegions ${String(selectRegions)} is not a list of region ids ([] when every tap acts)`;
}

function isSelectTap(intent: GameIntent, regions: readonly string[]): boolean {
  const target = tapTarget(intent);
  return target !== null && regions.includes(target.regionId);
}

/** Every tap outside the select regions again, once per tapped target inside them as selection. */
function withSelections<TIntent extends GameIntent>(
  intents: readonly TIntent[],
  regions: readonly string[],
): TIntent[] {
  const selectable = intents.flatMap((intent) => {
    const target = tapTarget(intent);
    return target !== null && regions.includes(target.regionId) ? [target] : [];
  });
  return intents.flatMap((intent) =>
    tapTarget(intent) !== null && !isSelectTap(intent, regions)
      ? selectable.map((selected): TIntent => ({ ...intent, selected }))
      : [],
  );
}

function isListed<TMove>(moves: readonly TMove[], move: TMove): boolean {
  const wanted = jsonOf(move);
  return moves.some((candidate) => jsonOf(candidate) === wanted);
}

function intentProblem<TState, TMove, TIntent extends GameIntent>(
  input: GameInput<TState, TMove, TIntent>,
  step: IntentStep<TState, TMove>,
  intent: TIntent,
): string | null {
  const move = input.intentToMove(step.state, intent);
  if (move === null) return null;
  if (isSelectTap(intent, regionsOf(input.selectRegions))) {
    return `intentToMove(${jsonOf(intent)}) returned ${jsonOf(move)}, but a tap in a select region only selects (return null)`;
  }
  const needed = MODE_FOR_INTENT[intent.kind];
  if (needed !== undefined && needed !== input.panMode) {
    return `intentToMove accepts a ${intent.kind} intent, but with panMode '${input.panMode}' the surface never sends one (panMode '${needed}')`;
  }
  return isListed(step.moves, move)
    ? null
    : `intentToMove(${jsonOf(intent)}) returned ${jsonOf(move)}, which listMoves does not list`;
}

/** A panMode outside the four or selectRegions that is not a list of ids, or []. */
export function inputMemberProblems<TState, TMove, TIntent extends GameIntent>(
  input: GameInput<TState, TMove, TIntent>,
): readonly string[] {
  const problems = [panModeProblem(input.panMode), selectRegionsProblem(input.selectRegions)];
  return problems.filter((problem): problem is string => problem !== null);
}

/**
 * Every problem of the moves intentToMove makes from `intents` in one position. Taps outside the
 * select regions are also tried with each tapped target inside them as the selection.
 */
export function contractIntentProblems<TState, TMove, TIntent extends GameIntent>(
  input: GameInput<TState, TMove, TIntent>,
  step: IntentStep<TState, TMove>,
  intents: readonly TIntent[],
): readonly string[] {
  const all = [...intents, ...withSelections(intents, regionsOf(input.selectRegions))];
  return all.flatMap((intent) => intentProblem(input, step, intent) ?? []);
}
