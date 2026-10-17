// src/features/parity/read-parity-launch.ts
// How a parity launch reaches the app on each platform. iOS: capture-app.mjs launches the build with
// the launch argument -parity "<query>", which lands in NSUserDefaults, where React Native's Settings
// reads it; the bridge then opens the launch route in the app (never a deep link from outside: iOS
// answers one with an "Open in ...?" alert that hides the app). Android: capture-app.mjs sends the
// link <scheme>://debug/parity?<query> to the named package, which opens no chooser, and Expo Router
// delivers it to the same route. Both end in src/app/(debug)/debug/parity.tsx.
import { Platform, Settings } from 'react-native';

import type { ParityLaunchParams } from './parity-request';
import type { Href } from 'expo-router';

/** The launch argument's name on iOS (-parity "<query>"). */
export const PARITY_LAUNCH_ARGUMENT = 'parity';

/** The launch route (Expo Router: src/app/(debug)/debug/parity.tsx). */
export const PARITY_LAUNCH_PATH = '/debug/parity' as const;

/** Where launch arguments come from: the platform and React Native's Settings (iOS only). */
export type LaunchArgumentSource = {
  readonly os: string;
  readonly get: (key: string) => unknown;
};

const DEVICE: LaunchArgumentSource = {
  get os() {
    return Platform.OS;
  },
  // Settings exists on iOS only; reading it elsewhere warns, so it is touched only after the OS check.
  get: (key) => Settings.get(key) as unknown,
};

/** The iOS launch argument's query, or null (Android, or a normal start). */
export function readParityLaunchArgument(source: LaunchArgumentSource = DEVICE): string | null {
  if (source.os !== 'ios') return null;
  const value = source.get(PARITY_LAUNCH_ARGUMENT);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The in-app href of a launch query (typed: the route plus a search string, no cast). */
export function parityLaunchHref(query: string): Href {
  return `${PARITY_LAUNCH_PATH}?${query}`;
}

/** A query string as search params (a repeated key becomes a list, so the parser refuses it). */
export function paramsFromQuery(query: string): ParityLaunchParams {
  const params: Record<string, string | string[]> = {};
  for (const part of query.replace(/^\?/, '').split('&')) {
    if (part.length === 0) continue;
    const [rawKey = '', ...rest] = part.split('=');
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const value = decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
    const found = params[key];
    params[key] =
      found === undefined ? value : [...(Array.isArray(found) ? found : [found]), value];
  }
  return params;
}
