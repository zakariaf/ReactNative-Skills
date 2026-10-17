// src/features/account/use-delete-account-model.ts
// Shape (it builds on networking-and-server-state): account deletion from inside the app (App Store
// guideline 5.1.1(v); Google Play also wants a web link to the same deletion). The server deletes the
// account and its data and, for a Sign in with Apple account, revokes Apple's tokens (Apple's REST
// /auth/revoke). Only after the server confirms does the session sign out, with reason
// 'account-deleted': the tokens are wiped, every sign-out step runs, and the root Stack's guard shows
// sign-in. A failed delete keeps the person signed in and says so.
import { useMutation } from '@tanstack/react-query';

import { authMutations } from '@/api/auth/auth-mutations';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';
import { useSessionManager } from '@/services/session/session-context';

import type { ApiClient } from '@/api/api-client';

export type DeleteAccountModel = {
  readonly title: string;
  readonly confirmLabel: string;
  readonly isDeleting: boolean;
  readonly hasFailed: boolean;
  readonly onConfirm: () => void;
};

/** `api` is the signed-in ApiClient (createAuthorizedApiClient) from useServices(). */
export function useDeleteAccountModel(api: ApiClient): DeleteAccountModel {
  const t = useT();
  const { errorLog } = useServices();
  const session = useSessionManager();
  const deletion = useMutation({
    ...authMutations.deleteAccount(api),
    onSuccess: () => session.signOut('account-deleted'),
  });
  return {
    title: t('account.delete.title'),
    confirmLabel: t('account.delete.confirm'),
    isDeleting: deletion.isPending,
    hasFailed: deletion.isError,
    onConfirm: () => {
      if (deletion.isPending) return;
      deletion.mutateAsync(undefined).catch((error: unknown) => {
        errorLog.record('service', error);
      });
    },
  };
}
