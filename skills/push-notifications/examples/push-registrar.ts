// src/api/push/push-registrar.ts
// The PushRegistrar over the app's ApiClient (networking-and-server-state): the only code that sends
// a registration to the server. PUT is idempotent, so a registration sent twice (a retry, two
// launches) leaves one row; the token is the row's id, and previousToken lets the server delete the
// row a rotation replaced. The server ties a registration to an account only through the request's
// credentials (PushRegistration carries no account id), so with requiresAccount: true every call
// must be signed: `api` is the signed-in client (session-api-client.ts), never services.api, the
// plain client, whose calls the server answers 401 ('rejected': the device never registers). At
// sign-out the call carries the step's still-valid access token itself.
import { NO_CONTENT } from '@/api/api-client';
import { isRetryableFailure } from '@/api/api-failure';
import { err, ok } from '@/core/result';

import type { ApiClient } from '@/api/api-client';
import type { ApiFailure } from '@/api/api-failure';
import type { PushRegistrar, RegistrarFailure } from '@/core/push/push-registration';
import type { Result } from '@/core/result';

export type ApiPushRegistrarDeps = {
  /** The signed-in ApiClient: it sends the session's bearer token and renews it after a 401. */
  readonly api: ApiClient;
  /** A client that sends exactly this bearer token: the sign-out step's, valid until the wipe. */
  readonly withAccessToken: (accessToken: string) => ApiClient;
};

function toRegistrarResult(answer: Result<null, ApiFailure>): Result<undefined, RegistrarFailure> {
  if (answer.ok) return ok(undefined);
  return err({ kind: isRetryableFailure(answer.error) ? 'unavailable' : 'rejected' });
}

/** The server side of push registration (contracts/push.json server.registerEndpoint). */
export function createApiPushRegistrar({
  api,
  withAccessToken,
}: ApiPushRegistrarDeps): PushRegistrar {
  return {
    register: async (registration) =>
      toRegistrarResult(
        await api.request({
          method: 'PUT',
          path: `/push/registrations/${encodeURIComponent(registration.token)}`,
          body: registration,
          schema: NO_CONTENT,
        }),
      ),
    unregister: async (token, options) => {
      const client =
        options?.accessToken === undefined ? api : withAccessToken(options.accessToken);
      const answer = await client.request({
        method: 'DELETE',
        path: `/push/registrations/${encodeURIComponent(token)}`,
        schema: NO_CONTENT,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      // Already gone (the server pruned it after DeviceNotRegistered) is what we wanted.
      if (!answer.ok && answer.error.kind === 'not-found') return ok(undefined);
      return toRegistrarResult(answer);
    },
  };
}
