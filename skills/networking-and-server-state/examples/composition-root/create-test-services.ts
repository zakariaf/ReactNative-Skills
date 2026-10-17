// src/services/create-test-services.ts (example: the test twin with the server-state ports)
// A test passes createFakeApiClient() and createFakeConnectivity(true) as `api` and `connectivity`;
// a port it does not pass throws on first use and names itself.
import type { Services } from '@/services/services-context';

/** A port the test did not give: any use names the missing port. */
function missingPort<TKey extends keyof Services>(key: TKey): Services[TKey] {
  const handler: ProxyHandler<object> = {
    get: (_target, member) => {
      throw new Error(
        `services.${key}.${String(member)} was used, but the test gave no ${key} port`,
      );
    },
  };
  return new Proxy({}, handler) as Services[TKey];
}

/** Returns Services built from `given`; every port not given throws when a test touches it. */
export function createTestServices(given: Partial<Services> = {}): Services {
  return {
    clock: given.clock ?? missingPort('clock'),
    directionGuard: given.directionGuard ?? missingPort('directionGuard'),
    errorLog: given.errorLog ?? missingPort('errorLog'),
    connectivity: given.connectivity ?? missingPort('connectivity'),
    api: given.api ?? missingPort('api'),
  };
}
