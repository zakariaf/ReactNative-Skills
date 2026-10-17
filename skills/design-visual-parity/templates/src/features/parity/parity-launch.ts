// src/features/parity/parity-launch.ts
// What a parity launch does, in order: parse the request; hold the consent moment (the app proves no
// consent primer, Google consent form or Apple tracking prompt can cover the frame, or the launch
// stops); set every test-build switch (the simulated day, motion held still, simulated offline off,
// the probe) so a switch an earlier flow saved never carries into a capture; write the design's data through the app's own repositories; apply the
// language and the theme setting ("system": the device appearance decides the colours); then start the
// session (the parity root hands the frame state and scroll offset to the screens) and replace the
// launch route with the frame's route. A language that flips the layout direction restarts the app;
// the launch is delivered again after the restart and finishes then. Pure orchestration: the app
// passes its appliers (debug switches, repositories, settings target) and its navigate function.
import { attemptAsync, ok } from '@/core/result';

import { PARITY_FIXTURE, parityDataFor } from './parity-fixture';
import { parseParityRequest } from './parity-request';
import { startParitySession } from './parity-session';

import type { ParityData, ParityFixture } from './parity-fixture';
import type { ParityPlanTable } from './parity-plans';
import type { ParityLaunchParams, ParityRequest, ParityRequestError } from './parity-request';
import type { Result } from '@/core/result';
import type { Language } from '@/i18n/languages';
import type { Href } from 'expo-router';

/** Every test-build switch a parity launch sets (none is left as an earlier run saved it). */
export type ParityOverrides = {
  readonly today: string | null;
  readonly motion: 'still';
  readonly isOffline: false;
  readonly probe: string | null;
};

/** How the app applies a launch: implemented by its test-only launch screen from its own services. */
export type ParityAppliers = {
  /**
   * Resolves when no consent moment can cover the frame: an app without ads resolves at once; an app
   * with react-native-google-mobile-ads resolves only in an ADS_MODE=off build (admob-ads-and-consent),
   * which never shows the primer, Google's form or Apple's prompt, and rejects otherwise.
   */
  readonly consent: () => Promise<void>;
  readonly overrides: (overrides: ParityOverrides) => Promise<void>;
  readonly data: (data: ParityData) => Promise<void>;
  readonly settings: (settings: {
    readonly language: Language;
    readonly theme: 'system';
  }) => Promise<'applied' | 'restarting'>;
};

export type ParityLaunchError =
  | ParityRequestError
  | { readonly kind: 'parity-apply-failed'; readonly param: string; readonly value: string };

export type ParityLaunchOutcome =
  { readonly kind: 'opened'; readonly request: ParityRequest } | { readonly kind: 'restarting' };

export type ParityLaunchDeps = {
  readonly appliers: ParityAppliers;
  readonly navigate: (href: Href) => void;
  readonly fixture?: ParityFixture;
  /** The plan table (default PARITY_PLANS); tests pass their own. */
  readonly plans?: ParityPlanTable;
};

const failed = (step: string, thrown: unknown): ParityLaunchError => ({
  kind: 'parity-apply-failed',
  param: step,
  value: thrown instanceof Error ? thrown.message : String(thrown),
});

export async function runParityLaunch(
  params: ParityLaunchParams,
  deps: ParityLaunchDeps,
): Promise<Result<ParityLaunchOutcome, ParityLaunchError>> {
  const fixture = deps.fixture ?? PARITY_FIXTURE;
  const parsed = parseParityRequest(params, fixture.day, deps.plans);
  if (!parsed.ok) return parsed;
  const request = parsed.value;
  const { appliers } = deps;
  const consent = await attemptAsync(
    () => appliers.consent(),
    (thrown) => failed('consent', thrown),
  );
  if (!consent.ok) return consent;
  const switches = await attemptAsync(
    () =>
      appliers.overrides({
        today: request.date,
        motion: 'still',
        isOffline: false,
        probe: request.probe,
      }),
    (thrown) => failed('overrides', thrown),
  );
  if (!switches.ok) return switches;
  const data = await attemptAsync(
    () => appliers.data(parityDataFor(fixture, request.language, request.plan.data)),
    (thrown) => failed('data', thrown),
  );
  if (!data.ok) return data;
  const settings = await attemptAsync(
    () => appliers.settings({ language: request.language, theme: 'system' }),
    (thrown) => failed('settings', thrown),
  );
  if (!settings.ok) return settings;
  if (settings.value === 'restarting') return ok({ kind: 'restarting' });
  startParitySession(request);
  deps.navigate(request.plan.href);
  return ok({ kind: 'opened', request });
}
