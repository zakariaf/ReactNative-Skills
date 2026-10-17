// src/features/deep-links/link-routes.ts (example: a Tasks app with sign-in, sharing and email links)
// The shape to imitate when the app links its first screens. Each entry is a route file of src/app
// (groups dropped from the path), the kind of each dynamic segment, the query keys its screen reads,
// and who may send it. Gated entries build their typed href, so typed routes check the one place
// JavaScript navigates to a link.
import type { LinkRouteSpec } from '@/core/links/link-route';
import type { Href } from 'expo-router';

export type AppLinkRoute = LinkRouteSpec<Href>;

export const LINK_ROUTES: readonly AppLinkRoute[] = [
  // Shared from the task screen: https://tasks.example.com/tasks/task-12?highlight=comment-3
  { path: '/tasks/[taskId]', params: { taskId: 'slug' }, query: ['highlight'] },
  // A static route beats the dynamic one for /tasks/new.
  { path: '/tasks/new', query: ['listId'] },
  // A shared list: behind the signed-in guard, so the link waits for sign-in.
  {
    path: '/lists/[listId]',
    params: { listId: 'uuid' },
    gate: 'signed-in',
    open: (values) => ({ pathname: '/lists/[listId]', params: { listId: values['listId'] ?? '' } }),
  },
  // An invitation shows who invited whom; "Join" is a button on the screen, never the link itself.
  {
    path: '/invites/[inviteId]',
    params: { inviteId: 'uuid' },
    gate: 'signed-in',
    open: (values) => ({ pathname: '/invites/[inviteId]', params: { inviteId: values['inviteId'] ?? '' } }),
  },
  // Email verification carries a single-use token: verified https links only.
  { path: '/verify-email', query: ['token'], verifiedOnly: true },
  // Android's OAuth redirect (auth-and-secure-storage): expo-web-browser reads the code itself, so no
  // query keys are listed and the code never reaches route params or navigation state.
  { path: '/oauth-redirect' },
  // The paywall opens; the price and the purchase stay on screen (in-app-purchases).
  { path: '/premium' },
  // The debug link (debug-menu-and-test-hooks): test builds only, its own strict parser reads the query.
  { path: '/debug/setup', query: 'any', testBuildOnly: true },
];
