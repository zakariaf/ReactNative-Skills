// src/features/debug/debug-setup-plan.ts
// Pure: the ordered steps one parsed debug link takes. The order is the contract: the debug switches
// first (the clock and connectivity wrappers read them at once), then saved settings (a language that
// flips the layout direction restarts the app, and nothing after it runs), then the screen. Every step
// sets a value rather than toggling one, so the same link applied twice (a reload re-delivers the
// launch link, a flow retries) leaves the same state.
import { DEBUG_SCREENS } from './debug-links';

import type { DebugRequest } from './debug-links';
import type { DebugSettingsPatch } from '@/services/test-hooks/debug-settings-target';
import type { DebugOverrides } from '@/stores/debug-overrides/debug-overrides';

export type DebugStep =
  | { readonly kind: 'overrides'; readonly patch: Partial<DebugOverrides> }
  | { readonly kind: 'settings'; readonly patch: DebugSettingsPatch }
  | { readonly kind: 'open'; readonly href: (typeof DEBUG_SCREENS)[keyof typeof DEBUG_SCREENS] };

function overridesOf(request: DebugRequest): Partial<DebugOverrides> {
  return {
    ...(request.today === undefined ? {} : { today: request.today }),
    ...(request.isOffline === undefined ? {} : { isOffline: request.isOffline }),
    ...(request.motion === undefined ? {} : { motion: request.motion }),
    ...(request.isCanvasProbeOn === undefined ? {} : { isCanvasProbeOn: request.isCanvasProbeOn }),
  };
}

function settingsOf(request: DebugRequest): DebugSettingsPatch {
  return {
    ...(request.language === undefined ? {} : { language: request.language }),
    ...(request.theme === undefined ? {} : { theme: request.theme }),
  };
}

/** The steps for one request; a link without open= ends on the debug menu. */
export function planDebugSetup(request: DebugRequest): readonly DebugStep[] {
  const steps: DebugStep[] = [];
  const overrides = overridesOf(request);
  if (Object.keys(overrides).length > 0) steps.push({ kind: 'overrides', patch: overrides });
  const settings = settingsOf(request);
  if (Object.keys(settings).length > 0) steps.push({ kind: 'settings', patch: settings });
  steps.push({ kind: 'open', href: DEBUG_SCREENS[request.open ?? 'debug'] });
  return steps;
}
