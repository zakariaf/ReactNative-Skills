// src/api/auth/server-refresher.ts
// Shape (it builds on networking-and-server-state's ApiClient): the session's one TokenRefresher when
// the app's server issues the tokens. POST /auth/refresh renews them (the server may rotate the
// refresh token); POST /auth/revoke forgets the refresh token at sign-out. The plain ApiClient, not
// the authorized one: these calls carry the refresh token in the body, never a bearer header, and the
// authorized client would ask the session for a token while the session is refreshing.
import { NO_CONTENT } from '@/api/api-client';
import { createServerTokenRefresher } from '@/services/session/server-token-refresher';

import { grantFromServerTokens, serverTokensSchema } from './auth-mutations';

import type { ApiClient } from '@/api/api-client';
import type { TokenRefresher } from '@/services/session/session-types';

export function createServerRefresher(api: ApiClient): TokenRefresher {
  return createServerTokenRefresher({
    refresh: async (refreshToken) => {
      const answer = await api.request({
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken },
        schema: serverTokensSchema,
      });
      return answer.ok ? { ok: true, value: grantFromServerTokens(answer.value) } : answer;
    },
    revoke: (refreshToken) =>
      api.request({
        method: 'POST',
        path: '/auth/revoke',
        body: { refreshToken },
        schema: NO_CONTENT,
      }),
  });
}
