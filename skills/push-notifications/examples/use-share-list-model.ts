// src/features/share-list/use-share-list-model.ts
// Asking in context: right after the person shared a list, the screen offers "Tell me when they
// add tasks". Only that tap asks, through permissions-and-system-prompts' gate over the one
// notification permission (services.permissions.access.notifications is this app's PushPort, bound
// in the composition root): the gate shows the explain, Android rationale or Settings sheet, respects
// a refusal (no second ask on this screen), and runs onAllowed once notifications are allowed.
// optInToPush then finds the permission allowed: it syncs the channels and registers. In an app
// without that skill, call optInToPush from the press directly: it asks by itself and answers
// 'blocked' when only the Settings app can help (offer Linking.openSettings() then).
// contracts/permissions.json lists `notifications` with askedFrom = this file and a sibling test.
import { useState } from 'react';

import { usePermissionGate } from '@/hooks/use-permission-gate';
import { useT } from '@/i18n/t-context';
import { namedPushChannels } from '@/services/push/push-channels';
import { usePushServices } from '@/services/push/push-context';
import { optInToPush } from '@/services/push/push-opt-in';
import { useServices } from '@/services/services-context';
import { useSessionSnapshot } from '@/services/session/session-context';

import type { PermissionSheet } from '@/hooks/use-permission-gate';
import type { OptInOutcome } from '@/services/push/push-opt-in';

export type ShareListModel = {
  /** null until the registration ran. */
  readonly outcome: OptInOutcome | null;
  /** The permission sheet to show (explain, rationale, settings), or null. */
  readonly sheet: PermissionSheet;
  /** Blocked: show "Notifications are off" with a button to the Settings app. */
  readonly isNotificationsOff: boolean;
  readonly isAsking: boolean;
  readonly onNotifyMe: () => void;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
  readonly onOpenSettings: () => void;
};

export function useShareListModel(): ShareListModel {
  const { permissions, errorLog } = useServices();
  // The push kit's provider (createPushKit in the root-kit registry).
  const { push, registration } = usePushServices();
  const t = useT();
  const session = useSessionSnapshot();
  const [outcome, setOutcome] = useState<OptInOutcome | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const accountId = session.status === 'signed-in' ? session.account.id : null;
  const onError = (thrown: unknown): void => {
    errorLog.record('service', thrown);
  };
  const gate = usePermissionGate({
    access: permissions.access.notifications,
    openSettings: permissions.openSettings,
    shouldExplainFirst: false,
    onError,
  });
  const register = (): void => {
    setIsRegistering(true);
    optInToPush({ push, registration, channels: namedPushChannels(t) }, accountId)
      .then(setOutcome, onError)
      .finally(() => {
        setIsRegistering(false);
      });
  };
  return {
    outcome,
    sheet: gate.sheet,
    isNotificationsOff: gate.state === 'blocked',
    isAsking: gate.isAsking || isRegistering,
    onNotifyMe: () => {
      gate.requestAccess(register);
    },
    onContinue: gate.confirm,
    onDismiss: gate.dismiss,
    onOpenSettings: gate.openSettings,
  };
}
