// src/services/push/create-app-push.ts
// The push parts of an app whose registrations need an account (contracts/push.json requiresAccount:
// true, auth-and-secure-storage). They exist before the session: the session's server sign-out step
// removes the registration (examples/create-app-session.ts), and the registrar signs its calls with
// the signed-in client the session attaches itself to. So startApp creates them first, hands them to
// createAppSession, and the root-kit registry only wraps them in the push kit
// (examples/create-root-kits.ts). Part of the composition root: it creates adapters, and the push
// adapter installs the app's one foreground handler when it is created, so this runs once per run.
import { createAuthorizedApiClient } from '@/api/authorized-api-client';
import { createFetchApiClient, deviceFetch } from '@/api/fetch-api-client';
import { createApiPushRegistrar } from '@/api/push/push-registrar';
import { createSessionApiClient } from '@/api/session-api-client';
import { foregroundPresentation } from '@/core/push/foreground-presentation';
import { parsePushData } from '@/core/push/push-message';
import { createExpoNotificationsPushAdapter } from '@/services/push/expo-notifications-push-adapter';
import { createKvPushRecordAdapter } from '@/services/push/kv-push-record-adapter';
import { createPushRegistration } from '@/services/push/push-registration';
import { readEasProjectId } from '@/services/push/read-eas-project-id';

import type { SessionApiClient } from '@/api/session-api-client';
import type { PublicEnvironment } from '@/config/environment';
import type { Language } from '@/i18n/languages';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { PushPort } from '@/services/push/push-port';
import type { PushRegistrationService } from '@/services/push/push-registration';
import type { Services } from '@/services/services-context';

export type AppPush = {
  readonly push: PushPort;
  readonly registration: PushRegistrationService;
  /** The signed-in client the registrar signs with; createAppSession attaches the session to it. */
  readonly signedInApi: SessionApiClient;
};

export type AppPushInput = {
  readonly services: Services;
  readonly errorLog: ErrorLogPort;
  readonly environment: PublicEnvironment;
  /** The app's current language, read at each registration (the server writes texts in it). */
  readonly language: () => Language;
};

export function createAppPush({ services, errorLog, environment, language }: AppPushInput): AppPush {
  const transport = { baseUrl: environment.apiBaseUrl, fetch: deviceFetch, errorLog };
  // The signed-in client, bound to the session by createAppSession (session-api-client.ts).
  const signedInApi = createSessionApiClient((session) =>
    createAuthorizedApiClient({ transport, session }),
  );
  // One adapter, one handler for remote pushes and local reminders alike.
  const push = createExpoNotificationsPushAdapter({
    projectId: readEasProjectId(),
    provider: 'expo',
    present: ({ isRemote, data }) => foregroundPresentation({ isRemote, message: parsePushData(data) }),
    errorLog,
  });
  // requiresAccount equals contracts/push.json, so every registrar call is signed (never the plain
  // client); the record survives restarts, so a launch after notifications were switched off in
  // Settings still unregisters.
  const registration = createPushRegistration({
    push,
    registrar: createApiPushRegistrar({
      api: signedInApi,
      withAccessToken: (accessToken) =>
        createFetchApiClient({
          ...transport,
          headers: () => Promise.resolve({ Authorization: `Bearer ${accessToken}` }),
        }),
    }),
    record: createKvPushRecordAdapter({ errorLog }),
    clock: services.clock,
    errorLog,
    requiresAccount: true,
    language,
  });
  return { push, registration, signedInApi };
}
