// src/features/deep-links/link-origins.ts
// Where links may come from, read from the build's own app config: the custom schemes prebuild
// registered and the verified hosts of ios.associatedDomains and android.intentFilters (both kept in
// Constants.expoConfig: @expo/config strips only mods, hooks and ios/android.config from the public
// config). The OS delivers verified links only for those hosts, so the gate accepts exactly them.
import type { LinkOrigins } from '@/core/links/incoming-link';

type IntentFilterData = { readonly scheme?: string; readonly host?: string };

/** The parts of an Expo config the origins come from (ExpoConfig fits). */
export type LinkConfigFacts = {
  readonly ios?: { readonly associatedDomains?: readonly string[] };
  readonly android?: {
    readonly intentFilters?: readonly {
      readonly autoVerify?: boolean;
      readonly data?: IntentFilterData | readonly IntentFilterData[];
    }[];
  };
};

const WEB_SCHEMES = new Set(['http', 'https']);

/** 'applinks:tasks.example.com?mode=developer' -> 'tasks.example.com'; other services -> null. */
function appLinkHost(entry: string): string | null {
  const match = /^applinks:([^?/]+)/u.exec(entry);
  return match?.[1]?.toLowerCase() ?? null;
}

function intentFilterHosts(config: LinkConfigFacts): string[] {
  const hosts: string[] = [];
  for (const filter of config.android?.intentFilters ?? []) {
    if (filter.autoVerify !== true) continue;
    const data = filter.data === undefined ? [] : [filter.data].flat();
    for (const item of data) {
      if (item.host !== undefined && WEB_SCHEMES.has(item.scheme ?? ''))
        hosts.push(item.host.toLowerCase());
    }
  }
  return hosts;
}

/** The schemes and verified hosts of this build; `schemes` is expo-linking's collectManifestSchemes(). */
export function linkOriginsFromConfig(
  config: LinkConfigFacts | null | undefined,
  schemes: readonly string[],
): LinkOrigins {
  const facts = config ?? {};
  const iosHosts = (facts.ios?.associatedDomains ?? [])
    .map(appLinkHost)
    .filter((host) => host !== null);
  const ownSchemes = schemes
    .map((scheme) => scheme.toLowerCase())
    .filter((scheme) => !WEB_SCHEMES.has(scheme));
  return {
    schemes: [...new Set(ownSchemes)],
    hosts: [...new Set([...iosHosts, ...intentFilterHosts(facts)])],
  };
}
