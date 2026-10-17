// app.config.ts (example: the lines that wire verified links into the app config of every variant)
// The rest of the file is app-variants-and-environment's template. linkNativeConfig reads
// contracts/deep-links.json and returns the applinks entitlement and the App Links intent filter of the
// variant's hosts, so the native config, the gate (which reads the embedded config) and the well-known
// files all come from one contract. Node runs this file with type stripping: keep the .ts extension.
import { linkNativeConfig, readLinkContract } from './scripts/deep-links/link-native-config.ts';
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

import type { VariantIdentity } from './src/config/app-variant.ts';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BASE: VariantIdentity = { appId: 'com.example.tasks', name: 'Tasks', scheme: 'tasks' };

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const identity = variantIdentity(BASE, variant);
  const links = linkNativeConfig(readLinkContract(projectRoot), variant);
  return {
    ...config,
    name: identity.name,
    slug: 'tasks',
    // One custom scheme per variant: a development build never answers a store link.
    scheme: identity.scheme,
    ios: {
      bundleIdentifier: identity.appId,
      // Only with hosts: prebuild writes an empty entitlement for [] and signing can then fail.
      ...(links.associatedDomains && { associatedDomains: links.associatedDomains }),
    },
    android: { package: identity.appId, intentFilters: links.intentFilters },
    plugins: ['expo-router'],
    experiments: { typedRoutes: true },
  };
}
