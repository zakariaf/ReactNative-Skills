// src/features/deep-links/link-routes.ts
// The routes an incoming link may open: the allow-list src/app/+native-intent.tsx enforces for every
// custom-scheme, universal and app link, cold start and warm. Any path not listed lands on the
// first screen (cold) or changes nothing (warm). Add a route here, with the kind of each dynamic
// segment and the query keys its screen reads, before anything links to it; the screen still parses
// its params (navigation-and-routing's paramParsers). contracts/deep-links.json lists the web paths
// that open the app at all. The deep-links-and-universal-links checker loads this file in Node.
import type { LinkRouteSpec } from '@/core/links/link-route';
import type { Href } from 'expo-router';

/** One allow-listed route; `open` builds the typed href for a gated route. */
export type AppLinkRoute = LinkRouteSpec<Href>;

/**
 * Empty until the app links a screen: every link opens the app at its first screen. Entries look
 * like { path: '/tasks/[taskId]', params: { taskId: 'slug' }, query: ['highlight'] }.
 */
export const LINK_ROUTES: readonly AppLinkRoute[] = [];
