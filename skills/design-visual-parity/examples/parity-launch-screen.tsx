// Shape, not a template: src/features/debug/parity-launch-screen.tsx, the app's test-only wrapper
// that builds the ParityAppliers from its own services and renders the harness's ParityLaunchRoot.
// It lives in a test-only folder (debug-menu-and-test-hooks' src/features/debug/), the entry exports
// it, and the launch route renders it through TEST_ONLY. useTestHooks() gives the switches store and
// the settings target (debug-menu-and-test-hooks); the repositories are the app's
// (persistence-and-migrations). Names below are the demo Tasks app's; use the app's own.
//
// consent: no consent primer, Google consent form or Apple tracking prompt may ever cover a frame.
// The demo app has no ads, so it resolves at once. An app with react-native-google-mobile-ads
// resolves only in an ADS_MODE=off build (admob-ads-and-consent: that build never asks) and rejects
// otherwise, so the launch stops on the parity.error screen instead of capturing a covered frame;
// check-harness.mjs (harness-consent) fails a bare Promise.resolve() in such an app:
//
//   import * as Application from 'expo-application';
//   import { readAdsExtraForBinary } from '@/services/ads/read-ads-extra';
//   ...
//   consent: () =>
//     readAdsExtraForBinary(Application.applicationId).adsMode === 'off'
//       ? Promise.resolve()
//       : Promise.reject(new Error('capture an ADS_MODE=off build: a consent moment could cover the frame')),
import { useServices } from '@/services/services-context';
import { ParityLaunchRoot } from '@/features/parity/parity-launch-root';

import { useTestHooks } from './test-hooks-context';

import type { ParityAppliers } from '@/features/parity/parity-launch';
import type { ParityLaunchParams } from '@/features/parity/parity-request';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

export type ParityLaunchScreenProps = {
  readonly params: ParityLaunchParams;
  readonly navigate: (href: Href) => void;
};

export function ParityLaunchScreen({ params, navigate }: ParityLaunchScreenProps): ReactNode {
  const hooks = useTestHooks();
  const { tasks, lists } = useServices().repositories;
  const appliers: ParityAppliers = {
    // No ads in this app, so no consent moment can cover a frame (see the header for an app with ads).
    consent: () => Promise.resolve(),
    // Every switch, every launch: the simulated day, motion held still, offline off, the probe.
    overrides: ({ today, motion, isOffline, probe }) => {
      hooks.overrides.getState().dispatch({ type: 'apply-overrides', patch: { today, motion, isOffline, isCanvasProbeOn: probe !== null } });
      const failure = hooks.overrides.getState().lastWriteFailure;
      return failure === null ? Promise.resolve() : Promise.reject(new Error(failure.kind));
    },
    // Replace, never merge: a row an earlier launch or flow wrote must not survive into this frame.
    data: async (data) => {
      await lists.replaceAll(data.lists);
      await tasks.replaceAll(data.tasks);
    },
    // The same target the debug link's lang= and theme= use; "restarting" when the language flips the
    // layout direction (the launch is delivered again after the restart).
    settings: (settings) => {
      if (hooks.settings === null) return Promise.reject(new Error('no debug settings target'));
      return hooks.settings.apply(settings);
    },
  };
  return <ParityLaunchRoot params={params} appliers={appliers} navigate={navigate} />;
}
