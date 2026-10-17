// src/services/services-context.tsx
import { createContext, use } from 'react';

import type { ApiClient } from '@/api/api-client';
import type { AppleSignInPort } from '@/services/apple-sign-in/apple-sign-in-port';
import type { ClockPort } from '@/services/clock/clock-port';
import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { InstallMarkerPort } from '@/services/install-marker/install-marker-port';
import type { OauthPort } from '@/services/oauth/oauth-port';
import type { SecureStoragePort } from '@/services/secure-storage/secure-storage-port';
import type { JSX, ReactNode } from 'react';

/**
 * Every port the app uses, created once by createDeviceServices (createTestServices in tests).
 * A new port adds one member here, one line in each factory, and nothing else.
 */
export type Services = {
  /** networking-and-server-state: the plain client (no session); sign-in and refresh use it. */
  readonly api: ApiClient;
  readonly clock: ClockPort;
  /** rtl-and-direction's restart guard; DirectionGate reads it before the first render. */
  readonly directionGuard: DirectionGuardPort;
  readonly errorLog: ErrorLogPort;
  /** auth-and-secure-storage: tokens and secrets (Keychain / Keystore). */
  readonly secureStorage: SecureStoragePort;
  /** auth-and-secure-storage: "this install has started before" (the fresh-install wipe). */
  readonly installMarker: InstallMarkerPort;
  readonly oauth: OauthPort;
  readonly appleSignIn: AppleSignInPort;
};

const ServicesContext = createContext<Services | null>(null);

export type ServicesProviderProps = {
  readonly services: Services;
  readonly children: ReactNode;
};

/** Hands the ports down. Context carries dependencies only, never state that changes. */
export function ServicesProvider({ services, children }: ServicesProviderProps): JSX.Element {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}

/** Returns the ports. A missing provider is a programmer error, so it throws. */
export function useServices(): Services {
  const services = use(ServicesContext);
  if (services === null) {
    throw new Error('useServices() needs a <ServicesProvider> above it');
  }
  return services;
}
