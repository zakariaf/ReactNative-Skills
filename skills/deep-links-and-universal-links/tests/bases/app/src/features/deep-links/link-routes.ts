// src/features/deep-links/link-routes.ts
// The fixture allow-list: a task (with one query key), the static new-task route, a list behind the
// signed-in gate, a verified-only email link with its token, the Android OAuth redirect (no query
// keys: the auth session reads the code) and the test-build debug link.
import type { LinkRouteSpec } from '@/core/links/link-route';

type Href = string | { readonly pathname: string; readonly params?: Readonly<Record<string, string>> };

export const LINK_ROUTES: readonly LinkRouteSpec<Href>[] = [
  { path: '/tasks/[taskId]', params: { taskId: 'slug' }, query: ['highlight'] },
  { path: '/tasks/new' },
  {
    path: '/lists/[listId]',
    params: { listId: 'uuid' },
    gate: 'signed-in',
    open: (values) => ({ pathname: '/lists/[listId]', params: { listId: values['listId'] ?? '' } }),
  },
  { path: '/verify-email', query: ['token'], verifiedOnly: true },
  { path: '/oauth-redirect' },
  { path: '/debug/setup', query: 'any', testBuildOnly: true },
];
