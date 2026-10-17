// src/services/game-host/board-host-model.ts
// The pure part of the board host: the tap-then-tap selection, kept out of the component so plain
// Jest proves it. The selection is UI state of one board host, never game state and never a move,
// so bots, solvers, par, undo and the counters never see it.
import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { GameIntent } from '@/core/game/game-input';

/** The selected target and the eventSeq it was made at: any new move (or the run's end) clears it. */
export type BoardSelection = { readonly target: CanvasTarget; readonly seq: number };

/** A tap as the canvas gesture layer sends it (canvas-gestures-and-hit-testing's CanvasIntent). */
export type TapIntent = {
  readonly kind: 'tap';
  readonly target: CanvasTarget;
  readonly selected: CanvasTarget | null;
};

/** The selected target shown at this eventSeq, or null. */
export function selectedAt(selection: BoardSelection | null, seq: number): CanvasTarget | null {
  return selection !== null && selection.seq === seq ? selection.target : null;
}

export function isSameTarget(a: CanvasTarget | null, b: CanvasTarget | null): boolean {
  return (
    a !== null && b !== null && a.regionId === b.regionId && a.col === b.col && a.row === b.row
  );
}

function isTap<TIntent extends GameIntent>(intent: TIntent): intent is TIntent & TapIntent {
  return intent.kind === 'tap' && 'target' in intent;
}

export type IntentRouteInput<TIntent extends GameIntent> = {
  readonly intent: TIntent;
  /** selectedAt(selection, seq): the selection the player sees right now. */
  readonly selected: CanvasTarget | null;
  readonly seq: number;
  /** game.input.selectRegions: the regions whose taps select instead of act. */
  readonly selectRegions: readonly string[];
};

export type IntentRoute<TIntent> = {
  /** The selection after this intent (null clears it). */
  readonly selection: BoardSelection | null;
  /** What goes to the run (intentToMove), or null: a tap in a select region only selects. */
  readonly intent: TIntent | null;
};

function keep(selected: CanvasTarget | null, seq: number): BoardSelection | null {
  return selected === null ? null : { target: selected, seq };
}

/**
 * A tap in a select region toggles the selection (the same target again clears it); any other tap
 * goes to intentToMove with `selected` filled in, and the selection stays until a move lands (a new
 * eventSeq); a drag ignores the selection and clears it; other intents pass through unchanged.
 */
export function routeIntent<TIntent extends GameIntent>({
  intent,
  selected,
  seq,
  selectRegions,
}: IntentRouteInput<TIntent>): IntentRoute<TIntent> {
  if (isTap(intent) && selectRegions.includes(intent.target.regionId)) {
    const isSame = isSameTarget(selected, intent.target);
    return { selection: isSame ? null : { target: intent.target, seq }, intent: null };
  }
  if (isTap(intent)) return { selection: keep(selected, seq), intent: { ...intent, selected } };
  if (intent.kind === 'drag-end') return { selection: null, intent };
  return { selection: keep(selected, seq), intent };
}
