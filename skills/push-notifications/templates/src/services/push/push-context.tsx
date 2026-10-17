// src/services/push/push-context.tsx
// How the in-context ask reaches the push port, the registration and the way to the Settings app:
// the push root kit (push-root-kit.tsx) wraps the root Stack in this provider, so the model behind
// "Tell me when they add tasks" calls optInToPush({ push, registration, ... }) from the press and
// offers openSettings when the answer is 'blocked'. Context carries dependencies, never state. Tests
// wrap the code under test in <PushProvider value={...}>.
import { createContext, use } from 'react';

import type { PushPort } from './push-port';
import type { PushRegistrationService } from './push-registration';
import type { JSX, ReactNode } from 'react';

/** What the push kit hands down. */
export type PushServices = {
  readonly push: PushPort;
  readonly registration: PushRegistrationService;
  /**
   * Opens this app's page in the system Settings app, the only way back from 'blocked'
   * (permissions-and-system-prompts' PermissionsPort.openSettings, or its system settings adapter).
   */
  readonly openSettings: () => Promise<void>;
};

const PushContext = createContext<PushServices | null>(null);

export type PushProviderProps = {
  readonly value: PushServices;
  readonly children: ReactNode;
};

/** Hands the push dependencies down (the push kit mounts it around the root Stack). */
export function PushProvider({ value, children }: PushProviderProps): JSX.Element {
  return <PushContext value={value}>{children}</PushContext>;
}

/** The app's push dependencies. A missing provider is a wiring mistake, so it throws. */
export function usePushServices(): PushServices {
  const services = use(PushContext);
  if (services === null) {
    throw new Error(
      'usePushServices() needs the push root kit (createPushKit in createRootKits) above it',
    );
  }
  return services;
}
