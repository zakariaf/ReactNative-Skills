// src/features/debug/debug-links.ts
// The debug deep-link registry: the one list of what <scheme>://debug/setup?<param>=<value>&... may
// say in a test build, and its strict parser. Expo Router opens the link as the route
// src/app/(debug)/debug/setup.tsx, which renders the setup screen through TEST_ONLY. Every parameter
// is optional; an unknown, repeated or bad one refuses the whole link, so a typo in an E2E flow fails
// at once instead of testing the wrong state. contracts/debug-links.json mirrors DEBUG_LINK_PARAMS
// (the E2E flows read it); change both in the same commit. Pure: no React, React Native or Expo.
import { isDateKey } from '@/core/dates/date-key';
import { err, ok } from '@/core/result';
import { LANGUAGES } from '@/i18n/languages';

import type { DateKey } from '@/core/dates/date-key';
import type { Result } from '@/core/result';
import type { Language } from '@/i18n/languages';
import type { ThemePreference } from '@/theme/theme-types';

/** The route path of the link (Expo Router: src/app/(debug)/debug/setup.tsx). */
export const DEBUG_LINK_PATH = 'debug/setup';

/**
 * Where open= can go: a name the flows use, mapped to the route it opens. The parameter is not called
 * screen: React Navigation reserves screen, params, initial and state for nested navigation.
 */
export const DEBUG_SCREENS = { tasks: '/', debug: '/debug' } as const;
export type DebugScreen = keyof typeof DEBUG_SCREENS;

type ParamSpec =
  | { readonly kind: 'values'; readonly values: readonly string[]; readonly effect: string }
  | { readonly kind: 'date'; readonly effect: string };

/** Every parameter the link accepts. The contract file lists the same names and values. */
export const DEBUG_LINK_PARAMS = {
  date: { kind: 'date', effect: 'the day clock.today() answers (YYYY-MM-DD), or real' },
  offline: { kind: 'values', values: ['0', '1'], effect: 'simulate offline for every reader' },
  motion: { kind: 'values', values: ['system', 'still'], effect: 'hold every animation still' },
  probe: { kind: 'values', values: ['0', '1'], effect: 'canvas layout probes on' },
  lang: { kind: 'values', values: LANGUAGES, effect: 'the app language (saved setting)' },
  theme: { kind: 'values', values: ['system', 'light', 'dark'], effect: 'the theme setting' },
  open: { kind: 'values', values: Object.keys(DEBUG_SCREENS), effect: 'the screen to open last' },
} as const satisfies Readonly<Record<string, ParamSpec>>;

export type DebugParam = keyof typeof DEBUG_LINK_PARAMS;

/** What one link asks for; a missing field leaves that part of the app as it is. */
export type DebugRequest = {
  /** A day to simulate, or null for the real calendar (date=real). */
  readonly today?: DateKey | null;
  readonly isOffline?: boolean;
  readonly motion?: 'system' | 'still';
  readonly isCanvasProbeOn?: boolean;
  readonly language?: Language;
  readonly theme?: ThemePreference;
  readonly open?: DebugScreen;
};

export type DebugLinkError =
  | { readonly kind: 'debug-link-unknown-param'; readonly param: string }
  | { readonly kind: 'debug-link-repeated-param'; readonly param: string }
  | { readonly kind: 'debug-link-bad-value'; readonly param: string; readonly value: string };

/** Search params as Expo Router hands them over: a repeated key arrives as an array. */
export type DebugLinkParams = Readonly<Record<string, string | readonly string[] | undefined>>;

const isParam = (name: string): name is DebugParam => Object.hasOwn(DEBUG_LINK_PARAMS, name);

function isAllowed(param: DebugParam, value: string): boolean {
  const spec: ParamSpec = DEBUG_LINK_PARAMS[param];
  if (spec.kind === 'date') return value === 'real' || isDateKey(value);
  return spec.values.includes(value);
}

/** One checked value into the request (the value is already one of the allowed ones). */
function withValue(request: DebugRequest, param: DebugParam, value: string): DebugRequest {
  switch (param) {
    case 'date':
      return { ...request, today: value === 'real' ? null : value };
    case 'offline':
      return { ...request, isOffline: value === '1' };
    case 'motion':
      return { ...request, motion: value === 'still' ? 'still' : 'system' };
    case 'probe':
      return { ...request, isCanvasProbeOn: value === '1' };
    case 'lang':
      return { ...request, language: value as Language };
    case 'theme':
      return { ...request, theme: value as ThemePreference };
    case 'open':
      return { ...request, open: value as DebugScreen };
  }
}

/** Parses the link's search params; the first bad parameter refuses the whole link. */
export function parseDebugLink(params: DebugLinkParams): Result<DebugRequest, DebugLinkError> {
  let request: DebugRequest = {};
  for (const [param, raw] of Object.entries(params)) {
    if (raw === undefined) continue;
    if (!isParam(param)) return err({ kind: 'debug-link-unknown-param', param });
    if (typeof raw !== 'string') return err({ kind: 'debug-link-repeated-param', param });
    if (!isAllowed(param, raw)) return err({ kind: 'debug-link-bad-value', param, value: raw });
    request = withValue(request, param, raw);
  }
  return ok(request);
}
