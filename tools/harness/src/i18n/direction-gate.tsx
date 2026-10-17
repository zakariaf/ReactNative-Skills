// src/i18n/direction-gate.tsx
// The first element the root layout renders. It compares the layout direction of this JS run with
// the direction of the language the app will show, once, and then:
//   keep     renders the app (children) under DirectionProvider with the layout direction;
//   restart  renders only DirectionRestart, which flips the direction once it is mounted;
//   give-up  renders the app in the current layout and reports why (the flip did not take, the
//            restart failed, or the guard could not be read).
// The app's startup work (database open, stores, providers) lives in the children, so none of it
// runs in a JS run that is about to be replaced.
import { useEffect, useRef, useState } from 'react';

import { readLayoutDirection } from './direction';
import { DirectionProvider } from './direction-context';
import { planDirection } from './direction-plan';
import { DirectionRestart } from './direction-restart';
import { directionOf } from './languages';

import type { DirectionPlan } from './direction-plan';
import type { Direction, Language } from './languages';
import type {
  DirectionGuardFailure,
  DirectionGuardPort,
} from '@/services/direction-guard/direction-guard-port';
import type { ReactNode } from 'react';

export type DirectionGiveUp = {
  readonly layout: Direction;
  readonly wanted: Direction;
  /**
   * flip-did-not-take: the last reload was for this direction; restart-failed: the record could not
   * be written or the reload rejected (when only beforeReload rejected, the reload was still asked
   * for, so this run may be replaced moments later); guard-unreadable: the guard could not be read,
   * so a restart could not be stopped from looping.
   */
  readonly reason: 'flip-did-not-take' | 'restart-failed' | 'guard-unreadable';
};

export type DirectionGateProps = {
  /** The language the app will show: the saved choice, else the device's, else the source. */
  readonly language: Language;
  readonly guard: DirectionGuardPort;
  /** Called once per give-up; record it in the error log. */
  readonly onGiveUp: (giveUp: DirectionGiveUp) => void;
  /**
   * Called when the record could not be cleared after the decision; record it in the error log. A
   * record left behind can turn a later launch's first flip into a flip-did-not-take give-up.
   */
  readonly onGuardFailure: (failure: DirectionGuardFailure) => void;
  /** Drawn for the moment before the reload (default: an empty screen). */
  readonly restartScreen?: ReactNode;
  /**
   * Passed to restartForDirection: runs after the flip, right before the reload. An app with audio
   * passes () => services.audio.dispose() (audio-and-haptics-feedback's dispose-before-reload).
   */
  readonly beforeReload?: (() => Promise<void>) | undefined;
  readonly children: ReactNode;
};

type Decision = { readonly plan: DirectionPlan; readonly reason: DirectionGiveUp['reason'] };

export function DirectionGate(props: DirectionGateProps): ReactNode {
  const { language, guard, onGiveUp, onGuardFailure, children } = props;
  const layout = readLayoutDirection();
  const wanted = directionOf(language);
  // One guard read per JS run, in the initializer: the plan and the give-up reason both use it.
  const [decision, setDecision] = useState<Decision>(() => {
    const pendingRestart = guard.readPending();
    return {
      plan: planDirection({ language, layout, pendingRestart }),
      reason: pendingRestart === 'unreadable' ? 'guard-unreadable' : 'flip-did-not-take',
    };
  });
  const { plan, reason } = decision;
  const settledPlan = useRef<DirectionPlan | null>(null);
  useEffect(() => {
    // Clear the record and report a give-up once per decision, never on every render.
    if (plan === 'restart' || settledPlan.current === plan) return;
    settledPlan.current = plan;
    const cleared = guard.writePending(null);
    if (!cleared.ok) onGuardFailure(cleared.error);
    if (plan === 'give-up') onGiveUp({ layout, wanted, reason });
  }, [plan, guard, onGiveUp, onGuardFailure, layout, wanted, reason]);
  if (plan === 'restart') {
    const handleFailed = (): void => {
      setDecision({ plan: 'give-up', reason: 'restart-failed' });
    };
    return (
      <DirectionRestart
        language={language}
        guard={guard}
        onFailed={handleFailed}
        screen={props.restartScreen}
        beforeReload={props.beforeReload}
      />
    );
  }
  return <DirectionProvider direction={layout}>{children}</DirectionProvider>;
}
