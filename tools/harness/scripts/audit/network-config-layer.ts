// scripts/audit/network-config-layer.ts
// Build configuration that adds network paths, read from `npx expo config --json --type prebuild`
// of the production variant (no prebuild needed). Every profile: no App Transport Security switch
// that allows arbitrary loads and no Android cleartext traffic in the production config. The
// offline-only profile also needs updates.enabled === false and no expo-updates plugin.
// `expo config --type introspect` is not used here: without an ios/ folder it shows a placeholder
// Info.plist (NSAllowsArbitraryLoads true) that prebuild never writes.
import type { Profile } from './privacy-contract.ts';

export type PluginEntry = string | readonly [string, unknown];
export type ExpoConfigLike = {
  readonly updates?: { readonly enabled?: boolean };
  readonly plugins?: readonly PluginEntry[];
  readonly ios?: { readonly infoPlist?: Readonly<Record<string, unknown>> };
  readonly android?: { readonly usesCleartextTraffic?: boolean };
};

const nameOf = (entry: PluginEntry): string => (typeof entry === 'string' ? entry : entry[0]);

function allowsArbitraryLoads(config: ExpoConfigLike): boolean {
  const ats: unknown = config.ios?.infoPlist?.['NSAppTransportSecurity'];
  return (
    typeof ats === 'object' && ats !== null && Reflect.get(ats, 'NSAllowsArbitraryLoads') === true
  );
}

function pluginOption(config: ExpoConfigLike, plugin: string, key: string): unknown {
  const entry = (config.plugins ?? []).find((item) => nameOf(item) === plugin);
  const options = typeof entry === 'string' ? undefined : entry?.[1];
  return typeof options === 'object' && options !== null ? Reflect.get(options, key) : undefined;
}

function cleartextProblems(config: ExpoConfigLike): string[] {
  const android = pluginOption(config, 'expo-build-properties', 'android');
  const isViaPlugin =
    typeof android === 'object' &&
    android !== null &&
    Reflect.get(android, 'usesCleartextTraffic') === true;
  return config.android?.usesCleartextTraffic === true || isViaPlugin
    ? ['Android usesCleartextTraffic is true in the production config']
    : [];
}

export function configProblems(config: ExpoConfigLike, profile: Profile): string[] {
  const problems = [...cleartextProblems(config)];
  if (allowsArbitraryLoads(config)) {
    problems.push('NSAllowsArbitraryLoads is true in the production config');
  }
  if (profile === 'offline-only') {
    if (config.updates?.enabled !== false) {
      problems.push('offline-only: expo.updates.enabled must be false');
    }
    if ((config.plugins ?? []).some((entry) => nameOf(entry) === 'expo-updates')) {
      problems.push('offline-only: the expo-updates plugin adds over-the-air update traffic');
    }
  }
  return problems;
}
