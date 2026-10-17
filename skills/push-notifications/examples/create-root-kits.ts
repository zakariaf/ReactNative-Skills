// src/services/create-root-kits.ts
// The push lines of app-startup-and-bootstrap's root-kit registry (a shape: the template's other
// lines stay), in an app with accounts. startApp created the push parts before the session
// (examples/create-app-push.ts) and passes them here with the session; the registry wraps them in the
// push kit, which provides them to the in-context ask, syncs the channels and the registration (at
// launch, on the way back to the foreground, on an account change), re-registers a rotated token and
// routes push taps beside the root Stack. No root file changes. With local-notifications adopted, its
// adapter gets installForegroundHandler: false here (push's handler decides for both).
import { hrefForPushDestination } from '@/services/push/push-destination-href';
import { createPushKit } from '@/services/push/push-root-kit';

import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { PermissionsPort } from '@/services/permissions/permissions-port';
import type { AppPush } from '@/services/push/create-app-push';
import type { PushAccountSource } from '@/services/push/push-root-kit';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';
import type { SessionManager } from '@/services/session/session-types';

export type RootKitsInput = {
  readonly services: Services;
  readonly data: AppData;
  readonly language: Language;
  /** auth-and-secure-storage: created in startApp before the kits. */
  readonly session: SessionManager;
  /** Created in startApp before the session (its sign-out step needs the registration). */
  readonly push: AppPush;
  /** permissions-and-system-prompts: the one PermissionsPort (access.notifications is push's). */
  readonly permissions: PermissionsPort;
};

/** The signed-in account, read now and on every change of the session. */
function sessionAccount(session: SessionManager): PushAccountSource {
  const accountId = (): string | null => {
    const snapshot = session.getSnapshot();
    return snapshot.status === 'signed-in' ? snapshot.account.id : null;
  };
  return { accountId, subscribe: (onChange) => session.subscribe(onChange) };
}

/** Every optional kit, in the order their providers nest (the first outermost). */
export function createRootKits({ data, session, push, permissions }: RootKitsInput): readonly RootKit[] {
  return [
    createPushKit({
      push: push.push,
      registration: push.registration,
      errorLog: data.errorLog,
      account: sessionAccount(session),
      openSettings: permissions.openSettings,
      hrefForDestination: hrefForPushDestination,
    }),
  ];
}
