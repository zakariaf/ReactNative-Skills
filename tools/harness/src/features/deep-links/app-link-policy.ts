// src/features/deep-links/app-link-policy.ts
// The link policy of this build: its own schemes and verified hosts (from the embedded app config),
// the allow-list, and whether test-build routes (the debug link) may open. Read for every link, so a
// test that changes the mocked config sees it; the work is a few array copies.
import Constants from 'expo-constants';
import { collectManifestSchemes } from 'expo-linking';

import { currentAppVariant } from '@/config/current-app-variant';

import { linkOriginsFromConfig } from './link-origins';
import { LINK_ROUTES } from './link-routes';

import type { LinkPolicy } from '@/core/links/route-incoming-link';
import type { Href } from 'expo-router';

/** The policy +native-intent decides with. */
export function appLinkPolicy(): LinkPolicy<Href> {
  return {
    ...linkOriginsFromConfig(Constants.expoConfig, collectManifestSchemes()),
    routes: LINK_ROUTES,
    isTestBuild: currentAppVariant() !== 'production',
  };
}
