// src/services/ads/consent-moment-flow.ts
// When the consent moment runs, as plain data for AdsProvider. The first time an ad is about to
// load (an ad screen is open: a screen that shows a banner) the flow runs prepareAds once per
// session; where Google's form is required, its intro step shows the app's consent primer over that
// screen until the user continues, and only then the form, ATT, initialize and preload run. Apple's
// tracking prompt (ATT) follows the form, before initialize; like the primer, it shows only over an
// ad screen. Never during onboarding, offline, for Premium or with ads off (the gate), and never over
// a focused task: the primer and the ATT prompt wait while no ad screen is open. The snapshot's
// canRequestAds turns true only once prepareAds has finished (ATT answered, SDK initialised):
// banner slots read it, so no banner requests an ad while Apple's prompt is up.
import { prepareAds, refreshConsentAtLaunch } from './ad-gate';

import type { AdGateDeps, AdGateInput, PrepareAdsDeps } from './ad-gate';
import type { ConsentInfo, ConsentPort } from '@/services/consent/consent-port';

/** What AdsProvider draws and hands down. */
export type ConsentMomentSnapshot = {
  readonly isIntroShown: boolean;
  /**
   * Whether ads may be requested (null: never asked); banners re-render when it changes. It starts
   * as the saved answer, turns false as soon as consent allows no ads, and turns true only after
   * prepareAds finished this session (consent, the ATT answer and initialize, in that order).
   */
  readonly canRequestAds: boolean | null;
};

/** The ports, the saved answer and the error log. */
export type ConsentMomentFlowDeps = AdGateDeps & {
  /** False when the app shows no primer: Google's form then opens at once where it is required. */
  readonly hasPrimer: boolean;
  /** The saved answer of the last session (null: never asked). */
  readonly savedCanRequestAds: boolean | null;
  /** The error log: consent failures are recorded, never shown. */
  readonly onError: (error: unknown) => void;
};

/** The flow AdsProvider runs (an external store for useSyncExternalStore). */
export type ConsentMomentFlow = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ConsentMomentSnapshot;
  /** The gate's facts, whenever one changes: a closed gate that opens retries the moment. */
  readonly updateInput: (input: AdGateInput) => void;
  /** An ad screen opened: prepare ads once; call the returned function when it closes. */
  readonly requestAdMoment: () => () => void;
  /** Refreshes the consent info once per launch (skipped while the moment runs anyway). */
  readonly refreshAtLaunch: () => void;
  /** Continue on the primer: Google's form opens next. */
  readonly continueToForm: () => void;
};

type Phase = 'idle' | 'preparing' | 'done';

/** The flow's one mutable record, changed only by the functions of createConsentMomentFlow. */
type FlowState = {
  phase: Phase;
  openSlots: number;
  isIntroWanted: boolean;
  /** The moment was shown this session: whatever the answer, it is not shown again. */
  wasAsked: boolean;
  release: (() => void) | null;
  /** A tracking request waiting for an ad screen (the user left for a task meanwhile). */
  adScreenWaiters: (() => void)[];
  input: AdGateInput | null;
  canRequestAds: boolean | null;
};

type Publisher = Pick<ConsentMomentFlow, 'subscribe' | 'getSnapshot'> & {
  readonly publish: () => void;
};

function createPublisher(deps: ConsentMomentFlowDeps, state: Readonly<FlowState>): Publisher {
  const listeners = new Set<() => void>();
  let snapshot: ConsentMomentSnapshot = {
    isIntroShown: false,
    canRequestAds: deps.savedCanRequestAds,
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    publish: () => {
      const isIntroShown = state.isIntroWanted && state.openSlots > 0;
      const { canRequestAds } = state;
      if (isIntroShown === snapshot.isIntroShown && canRequestAds === snapshot.canRequestAds)
        return;
      snapshot = { isIntroShown, canRequestAds };
      for (const listener of listeners) listener();
    },
  };
}

/** Apple's prompt, like the primer, shows only over an ad screen: never over a focused task. */
function trackingOverAdScreen(consent: ConsentPort, state: FlowState): ConsentPort {
  return {
    ...consent,
    requestTracking: async () => {
      if (state.openSlots === 0) {
        await new Promise<void>((resolve) => state.adScreenWaiters.push(resolve));
      }
      return consent.requestTracking();
    },
  };
}

/** prepareAds' dependencies: Apple's prompt only over an ad screen, the primer through the snapshot. */
function createGateDeps(parts: Pick<FlowParts, 'deps' | 'state' | 'publish'>): PrepareAdsDeps {
  const { deps, state, publish } = parts;
  return {
    ads: deps.ads,
    consent: trackingOverAdScreen(deps.consent, state),
    onConsent: (info: ConsentInfo) => {
      deps.onConsent(info);
      // A refusal closes the banners at once; a yes waits for the ATT answer and initialize.
      if (info.canRequestAds) return;
      state.canRequestAds = false;
      publish();
    },
    showIntro: () =>
      new Promise<void>((resolve) => {
        state.wasAsked = true;
        if (!deps.hasPrimer) {
          resolve();
          return;
        }
        state.isIntroWanted = true;
        state.release = resolve;
        publish();
      }),
  };
}

/** One flow per app run (AdsProvider creates it once). */
export function createConsentMomentFlow(deps: ConsentMomentFlowDeps): ConsentMomentFlow {
  const state: FlowState = {
    ...{ phase: 'idle', openSlots: 0, isIntroWanted: false, wasAsked: false },
    ...{ release: null, adScreenWaiters: [], input: null },
    canRequestAds: deps.savedCanRequestAds,
  };
  const { publish, ...reads } = createPublisher(deps, state);
  const gate = createGateDeps({ deps, state, publish });
  /** Runs prepareAds while an ad screen is open; a closed gate (offline ...) stays idle. */
  const prepareIfDue = (): void => {
    const { input } = state;
    if (state.phase !== 'idle' || state.openSlots === 0 || input === null) return;
    state.phase = 'preparing';
    prepareAds(gate, input).then(
      // Once the user saw the moment (or ads are ready) it never comes back this session.
      (isReady) => {
        if (isReady) {
          state.canRequestAds = true; // consent, the ATT answer and initialize are done
          publish();
        }
        state.phase = isReady || state.wasAsked ? 'done' : 'idle';
        // The facts changed while the gate decided (onboarding ended as the first ad screen
        // opened): decide again with the new ones, or the moment would wait for the next screen.
        if (state.phase === 'idle' && state.input !== input) prepareIfDue();
      },
      (error: unknown) => {
        deps.onError(error);
        state.phase = 'idle';
      },
    );
  };
  return createFlowApi({ deps, state, publish, prepareIfDue, gate, reads });
}

type FlowParts = {
  readonly deps: ConsentMomentFlowDeps;
  readonly state: FlowState;
  readonly publish: () => void;
  readonly prepareIfDue: () => void;
  readonly gate: AdGateDeps;
  readonly reads: Pick<ConsentMomentFlow, 'subscribe' | 'getSnapshot'>;
};

function createFlowApi(parts: FlowParts): ConsentMomentFlow {
  const { deps, state, publish, prepareIfDue } = parts;
  return {
    ...parts.reads,
    updateInput: (input) => {
      state.input = input;
      prepareIfDue();
    },
    requestAdMoment: () => {
      state.openSlots += 1;
      for (const resume of state.adScreenWaiters.splice(0)) resume();
      prepareIfDue();
      publish();
      return () => {
        state.openSlots -= 1;
        publish();
      };
    },
    refreshAtLaunch: () => {
      if (state.phase !== 'idle' || state.input === null) return;
      refreshConsentAtLaunch(parts.gate, state.input).catch(deps.onError);
    },
    continueToForm: () => {
      state.isIntroWanted = false;
      state.release?.();
      state.release = null;
      publish();
    },
  };
}
