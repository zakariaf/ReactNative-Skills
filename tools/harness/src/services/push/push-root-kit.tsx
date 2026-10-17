// src/services/push/push-root-kit.tsx
// Remote push as a root kit (app-startup-and-bootstrap's slots): one entry in
// src/services/create-root-kits.ts plugs it into startup, and no root file changes. The registry
// creates the adapter (which installs the app's one foreground handler, for local reminders too), the
// saved-record adapter and the one registration service. The kit hands them to the slots: provide
// (PushProvider around the root Stack: what the in-context ask needs, the way to the Settings app
// included) and effects (beside the Stack, after
// the splash release and inside the navigator: the channels in the app's language, the registration
// synced at launch, on every return to the foreground and on an account change, re-registered on a
// token rotation, and the push taps, launch tap included, each opening a typed route).
import { useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';

import { usePushSync } from '@/hooks/use-push-sync';
import { usePushTaps } from '@/hooks/use-push-taps';
import { useT } from '@/i18n/t-context';

import { namedPushChannels } from './push-channels';
import { PushProvider } from './push-context';

import type { PushPort } from './push-port';
import type { PushRegistrationService } from './push-registration';
import type { PushDestination } from '@/core/push/push-destination';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Href } from 'expo-router';

/**
 * The signed-in account, read synchronously and watched for changes (the shape of a vanilla store:
 * auth-and-secure-storage's session). The registration follows it: a new account registers again, a
 * sign-out leaves the removal to the session's server sign-out step.
 */
export type PushAccountSource = {
  readonly accountId: () => string | null;
  readonly subscribe: (onChange: () => void) => () => void;
};

/** The source of an app without accounts (contracts/push.json requiresAccount: false). */
export const NO_PUSH_ACCOUNT: PushAccountSource = {
  accountId: () => null,
  subscribe: () => () => undefined,
};

export type PushKitInput = {
  readonly push: PushPort;
  readonly registration: PushRegistrationService;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  readonly account: PushAccountSource;
  /** Opens this app's page in the Settings app (PermissionsPort.openSettings), for 'blocked'. */
  readonly openSettings: () => Promise<void>;
  /** The app's route table: a destination of destinationFor to a typed href. */
  readonly hrefForDestination: (destination: PushDestination) => Href;
};

/** Renders nothing: channels, registration and token rotation, and the routing of push taps. */
type PushEffectsProps = Omit<PushKitInput, 'openSettings'>;

function PushEffects({
  push,
  registration,
  errorLog,
  account,
  hrefForDestination,
}: PushEffectsProps): null {
  const t = useT();
  const router = useRouter();
  const accountId = useSyncExternalStore(account.subscribe, account.accountId);
  usePushSync({ push, registration, errorLog, channels: namedPushChannels(t), accountId });
  // A rotated token registers again (with previousToken), for the account of the last sync.
  useEffect(() => registration.start(), [registration]);
  usePushTaps({
    push,
    navigate: (destination) => {
      router.push(hrefForDestination(destination));
    },
  });
  return null;
}

/** The push kit: register it once in createRootKits. */
export function createPushKit(input: PushKitInput): RootKit {
  return {
    name: 'push-notifications',
    provide: (children) => (
      <PushProvider
        value={{
          push: input.push,
          registration: input.registration,
          openSettings: input.openSettings,
        }}
      >
        {children}
      </PushProvider>
    ),
    effects: (
      <PushEffects
        push={input.push}
        registration={input.registration}
        errorLog={input.errorLog}
        account={input.account}
        hrefForDestination={input.hrefForDestination}
      />
    ),
  };
}
