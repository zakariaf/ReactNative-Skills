// src/services/game-host/run-end-policy.ts
// What the Game screen does with a run that is ending or being left.
//
// Never strand a finished run. A lost run keeps its rescue open only while the player can still
// take it: for free (Premium, a free allowance), with a rewarded ad that is ready, or one that is
// still loading (the button shows busy). When the offer is hidden (ads off, offline, no consent,
// nothing that can come), nobody can rescue the run, so the Game screen's model sends
// { type: 'finish' } once per eventSeq: the run end is recorded and the result shows at once.
// The same holds when a shown offer becomes hidden, and when a pending loss is reopened.
//
// Back never drops a live, unrecorded run: in play it opens Pause, inside Pause it resumes, and on
// a loss whose rescue is on offer it declines the rescue (the loss is recorded and the result
// shows). Only Pause -> Home leaves a live run; Back leaves once the run is recorded.
import type { SessionCommand, SessionView } from '@/services/game-host/session-view';

/** What the monetization layer can offer for the rescue right now. */
export type RescueOffer = 'free' | 'ready' | 'loading' | 'hidden';

/** True for a lost run that waits for a rescue nobody can give: send 'finish' for it. */
export function isLossStranded(view: SessionView, offer: RescueOffer): boolean {
  return (
    view.status === 'lost' &&
    view.continueState === 'offered' &&
    view.summary === null &&
    offer === 'hidden'
  );
}

const PAUSE: SessionCommand = { type: 'pause' };
const RESUME: SessionCommand = { type: 'resume' };
const FINISH: SessionCommand = { type: 'finish' };

/**
 * What Back sends instead of leaving (usePreventRemove is on while this is not null): pause in
 * play, resume in Pause, finish a pending loss. null: nothing live is left behind, let Back go.
 */
export function backCommandOf(view: SessionView | null): SessionCommand | null {
  if (view?.summary !== null) return null;
  switch (view.status) {
    case 'playing':
      return PAUSE;
    case 'paused':
      return RESUME;
    case 'lost':
      return view.continueState === 'offered' ? FINISH : null;
    case 'won':
      return null;
  }
}
