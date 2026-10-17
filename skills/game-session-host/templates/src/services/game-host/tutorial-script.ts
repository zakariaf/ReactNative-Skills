// src/services/game-host/tutorial-script.ts
// A tutorial run's script as the host uses it: which move each step accepts and the coached step
// screens show (plain data, no game types). Moves are JSON-like data, so they compare by value.
import type { TutorialStep } from '@/services/game-host/hosted-game';
import type { TutorialCoach } from '@/services/game-host/session-view';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Structural equality of two plain-data moves (the rules build moves as JSON-like data). */
export function isSameMove(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => isSameMove(item, right[i]));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => isSameMove(left[key], right[key]))
    );
  }
  return Object.is(left, right);
}

/**
 * Step `moveCount` accepts only its expected move ('any-move': every legal move); after the last
 * step the run plays freely. Undo steps back one move, so the script steps back with it.
 */
export function isTutorialMoveAccepted<TMove>(
  steps: readonly TutorialStep<TMove>[],
  move: TMove,
  moveCount: number,
): boolean {
  const step = steps[moveCount];
  if (step === undefined || step.expect.kind === 'any-move') return true;
  return isSameMove(move, step.expect.move);
}

/** The coached step the run waits for, or null after the script (or for a run without one). */
export function tutorialCoachOf<TMove>(
  steps: readonly TutorialStep<TMove>[] | null,
  moveCount: number,
): TutorialCoach | null {
  const step = steps?.[moveCount];
  if (steps === null || step === undefined) return null;
  return { messageId: step.messageId, index: moveCount, count: steps.length };
}
