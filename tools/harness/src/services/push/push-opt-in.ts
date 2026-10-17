// src/services/push/push-opt-in.ts
// Turning notifications on, from a person's action, after the app said what they are for (a
// "Notify me when someone shares a list" switch, never a launch prompt). The channels go first:
// Android issues no push token before a channel exists, and an app targeting Android 12L or lower
// gets the system prompt only after its first channel (targetSdk 33+ shows it on request). iOS shows its prompt once; after a refusal only the Settings app can
// turn notifications on, which is what 'blocked' tells the caller to offer.
import { isPushAllowed } from './push-port';

import type { NamedPushChannel, PushPort } from './push-port';
import type { PushRegistrationService } from './push-registration';

/** How the attempt ended, for the model to show the next step. */
export type OptInOutcome =
  /** Allowed (or quietly, provisionally); the registration was sent or will be on the next sync. */
  | 'enabled'
  /** The person said no in the prompt; ask again only from another action of theirs. */
  | 'declined'
  /** No prompt can appear any more: offer a button that opens the app's system settings. */
  | 'blocked';

export type PushOptInDeps = {
  readonly push: Pick<PushPort, 'permission' | 'requestPermission' | 'syncChannels'>;
  readonly registration: Pick<PushRegistrationService, 'sync'>;
  /** The channels with their names in the person's language (namedPushChannels). */
  readonly channels: readonly NamedPushChannel[];
};

/**
 * Asks for the permission when the OS still can (also when iOS delivers only provisionally), then
 * registers. Call it from an action only.
 */
export async function optInToPush(
  deps: PushOptInDeps,
  accountId: string | null,
): Promise<OptInOutcome> {
  await deps.push.syncChannels(deps.channels);
  let permission = await deps.push.permission();
  if (permission === 'blocked') return 'blocked';
  // Provisional (iOS quiet delivery) asks too: the person tapped "Notify me", so they want alerts,
  // and iOS shows the full prompt for a provisional app; a refusal there leaves quiet delivery off.
  if (permission !== 'granted') permission = await deps.push.requestPermission();
  if (permission === 'blocked') return 'blocked';
  if (!isPushAllowed(permission)) return 'declined';
  await deps.registration.sync(accountId);
  return 'enabled';
}
