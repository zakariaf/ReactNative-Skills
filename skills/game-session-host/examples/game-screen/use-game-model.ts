// src/features/game/use-game-model.ts
// The Game screen's model hook: the only code of the screen that reads the host, navigation and the
// monetization layer. It opens the run, pauses it when the app or the screen goes away or a
// full-screen ad covers it, turns Back into Pause, pays for a perk before sending it, and finishes
// a loss nobody can rescue.
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useEffectEvent, useRef } from 'react';

import { useRescueOffer } from '@/features/game/use-rescue-offer';
import { usePauseOnBackground } from '@/hooks/use-pause-on-background';
import { backCommandOf, isLossStranded } from '@/services/game-host/run-end-policy';
import { useGameSession } from '@/services/game-host/use-game-session';
import { useServices } from '@/services/services-context';

import type { RunRef } from '@/core/game-results/run-ref';
import type { PerkOffer } from '@/features/game/use-rescue-offer';
import type { FullscreenAdGate } from '@/services/ads/fullscreen-ad';
import type { BoardHostProps } from '@/services/game-host/game-host';
import type { SessionOpen } from '@/services/game-host/open-session';
import type { SessionCommand, SessionView } from '@/services/game-host/session-view';
import type { ComponentType, RefObject } from 'react';

export type GameModel = {
  readonly view: SessionView | null;
  readonly BoardHost: ComponentType<BoardHostProps> | null;
  /** Offer the hint (and take its price) only when the solver has one for this position. */
  readonly isHintOffered: boolean;
  readonly onUndo: () => void;
  readonly onHint: () => void;
  readonly onContinue: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onPlayAgain: (ref: RunRef) => void;
  readonly onHome: () => void;
};

type Send = (command: SessionCommand) => void;

/**
 * A full-screen ad (admob-ads-and-consent's runFullscreenAd suspends the app's one gate) pauses the
 * run. iOS keeps AppState 'active' under a Google full-screen ad, so only the gate tells; Android
 * shows the ad as its own activity, so AppState may also report 'background' (not verified on a
 * device). Either way the run is paused, and after the ad the player sees Pause on both platforms.
 */
function usePauseOnFullscreenAd(gate: FullscreenAdGate, pause: () => void): void {
  const onGateChange = useEffectEvent(() => {
    if (gate.isShowing()) pause();
  });
  useEffect(
    () =>
      gate.subscribe(() => {
        onGateChange();
      }),
    [gate],
  );
}

/**
 * Pause on background, blur or a full-screen ad; Back (header, iOS swipe, Android button and
 * predictive back) pauses in play, resumes in Pause and finishes a pending loss, never leaving a
 * live, unrecorded run behind. Only Pause -> Home leaves one: it sets `leaving` before it navigates,
 * because `leave` changes no status and the guard is still on until React re-renders, so the guard
 * lets that one removal through instead of turning it into `resume`.
 */
function usePauseGuards(view: SessionView | null, send: Send, leaving: RefObject<boolean>): void {
  const { fullscreenAd } = useServices();
  const navigation = useNavigation();
  const pause = (): void => {
    send({ type: 'pause' });
  };
  usePauseOnBackground(view?.status ?? null, pause);
  usePauseOnFullscreenAd(fullscreenAd, pause);
  const back = backCommandOf(view);
  usePreventRemove(back !== null, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
      return;
    }
    if (back !== null) send(back);
  });
}

/** Never strand a finished run: once per eventSeq, a loss nobody can rescue is finished. */
function useFinishStranded(view: SessionView | null, offer: PerkOffer['offer'], send: Send): void {
  const finishStranded = useEffectEvent(() => {
    if (view !== null && isLossStranded(view, offer)) send({ type: 'finish' });
  });
  useEffect(() => {
    finishStranded();
  }, [view?.eventSeq, offer]);
}

export function useGameModel(gameId: string, open: SessionOpen): GameModel {
  const router = useRouter();
  const leaving = useRef(false);
  const { view, BoardHost, send, startRun } = useGameSession(gameId, open);
  // The monetization layer (admob-ads-and-consent, in-app-purchases): offer is 'free', 'ready',
  // 'loading' or 'hidden'; pay(then) runs `then` only once the perk is paid for (an ad watched to
  // the end, the daily allowance spent, Premium owned). An app without paid perks returns 'free'.
  const rescue = useRescueOffer(gameId, 'continue');
  const hint = useRescueOffer(gameId, 'hint');
  usePauseGuards(view, send, leaving);
  useFinishStranded(view, rescue.offer, send);
  return {
    view,
    BoardHost,
    isHintOffered: view?.isHintAvailable === true && hint.offer !== 'hidden',
    onUndo: () => {
      send({ type: 'undo' });
    },
    onHint: () => {
      // The hint's ad paused the run: the hint is held for this position and shows on Resume.
      hint.pay(() => {
        send({ type: 'hint' });
      });
    },
    onContinue: () => {
      // A rescued run restarts from Pause on both platforms: the player gets their bearings after
      // the ad, and a real-time loop never restarts under their thumb.
      rescue.pay(() => {
        send({ type: 'continue' });
        send({ type: 'pause' });
      });
    },
    onPause: () => {
      send({ type: 'pause' });
    },
    onResume: () => {
      send({ type: 'resume' });
    },
    onPlayAgain: startRun,
    onHome: () => {
      // leave writes the live run (it reopens only from Home's Continue) or records a pending
      // loss; the flag tells the Back guard that this removal is the one way out.
      leaving.current = true;
      send({ type: 'leave' });
      router.dismissTo('/');
    },
  };
}
