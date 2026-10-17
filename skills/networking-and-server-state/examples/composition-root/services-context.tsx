// src/services/services-context.tsx (example: the app's own copy after adding the two server-state ports)
// architecture-and-boundaries owns this file's shape; a new port adds one member here, one line in
// createDeviceServices and one in createTestServices, and nothing else.
import { createContext, use } from 'react';

import type { ApiClient } from '@/api/api-client';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';
import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { JSX, ReactNode } from 'react';

/** Every port the app uses, created once by createDeviceServices (createTestServices in tests). */
export type Services = {
  readonly clock: ClockPort;
  readonly directionGuard: DirectionGuardPort;
  readonly errorLog: ErrorLogPort;
  /** "Online?" for TanStack's onlineManager, offline banners, ads and purchases. */
  readonly connectivity: ConnectivityPort;
  /** The app's server; query and mutation factories in src/api/<resource>/ take it. */
  readonly api: ApiClient;
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
