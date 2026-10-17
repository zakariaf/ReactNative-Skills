// src/features/debug/parity-launch-screen.tsx
// device-only: covered by a parity capture on a device (it only builds the appliers for the tested ParityLaunchRoot)
// The harness's test-only parity launch screen (design-visual-parity, examples/parity-launch-screen.tsx):
// it builds the ParityAppliers from the test hooks and renders the harness's ParityLaunchRoot. It lives
// in a test-only folder, the entry exports it, and the launch route renders it through TEST_ONLY.
// The harness has no approved frame yet (contracts/visual-parity.json "frames" is empty), so the
// parser refuses every launch before an applier runs; the appliers still say what each step does.
import { ParityLaunchRoot } from '@/features/parity/parity-launch-root';

import { useTestHooks } from './test-hooks-context';

import type { ParityAppliers } from '@/features/parity/parity-launch';
import type { ParityLaunchParams } from '@/features/parity/parity-request';
import type { Href } from 'expo-router';

export type ParityLaunchScreenProps = {
  readonly params: ParityLaunchParams;
  readonly navigate: (href: Href) => void;
};

export function ParityLaunchScreen({
  params,
  navigate,
}: ParityLaunchScreenProps): React.JSX.Element {
  const hooks = useTestHooks();
  const appliers: ParityAppliers = {
    // react-native-google-mobile-ads is installed, and no harness build carries an ads mode yet
    // (admob-ads-and-consent's readAdsExtraForBinary and ADS_MODE=off): refuse, so a consent moment
    // can never cover a frame; the launch stops on the parity.error screen instead.
    consent: () =>
      Promise.reject(new Error('capture an ADS_MODE=off build: this build declares no ads mode')),
    // Every switch, every launch: the simulated day, motion held still, offline off, the probe.
    overrides: ({ today, motion, isOffline, probe }) => {
      hooks.overrides.getState().dispatch({
        type: 'apply-overrides',
        patch: { today, motion, isOffline, isCanvasProbeOn: probe !== null },
      });
      const failure = hooks.overrides.getState().lastWriteFailure;
      return failure === null ? Promise.resolve() : Promise.reject(new Error(failure.kind));
    },
    // The harness repositories have no replace-all write yet: a frame with data cannot be staged.
    data: () =>
      Promise.reject(new Error('no parity data writer: the harness has no approved frame')),
    // The same target the debug link's lang= and theme= use; none until the app saves settings.
    settings: (settings) => {
      if (hooks.settings === null) return Promise.reject(new Error('no debug settings target'));
      return hooks.settings.apply(settings);
    },
  };
  return <ParityLaunchRoot params={params} appliers={appliers} navigate={navigate} />;
}
