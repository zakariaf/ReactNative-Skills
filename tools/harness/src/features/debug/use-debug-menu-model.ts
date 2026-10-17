// src/features/debug/use-debug-menu-model.ts
// The debug menu's model: the build, the simulated day, the error count and the switches, each
// changed through the same store a debug link writes, so the menu and the link never disagree.
// The labels go through the catalogs like every other screen's (the menu is a screen of its own).
import { currentAppVariant } from '@/config/current-app-variant';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';
import {
  selectDispatch,
  selectOverrides,
} from '@/stores/debug-overrides/debug-overrides-selectors';
import { useDebugOverridesStore } from '@/stores/debug-overrides/debug-overrides-store';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import type { TFunction } from '@/i18n/create-t';
import type { ClockPort } from '@/services/clock/clock-port';
import type { DebugOverrides } from '@/stores/debug-overrides/debug-overrides';
import type { DebugOverridesState } from '@/stores/debug-overrides/debug-overrides-store';

export type DebugSwitch = {
  readonly id: 'offline' | 'motion' | 'probe';
  /** Translated. */
  readonly label: string;
  readonly isOn: boolean;
  readonly onToggle: () => void;
};

export type DebugAction = {
  readonly id: 'next-day' | 'real-day';
  /** Translated. */
  readonly label: string;
  readonly onPress: () => void;
};

export type DebugMenuModel = {
  /** Translated: "Build: preview". */
  readonly buildText: string;
  /** Translated: "Day: 2030-01-02" or "Day: Real calendar". */
  readonly dayText: string;
  /** Translated: "Errors logged: 2" (read when the menu renders). */
  readonly errorsText: string;
  readonly switches: readonly DebugSwitch[];
  readonly actions: readonly DebugAction[];
  readonly isReducedMotion: boolean;
};

type Dispatch = DebugOverridesState['dispatch'];

function switchesOf(
  t: TFunction,
  overrides: DebugOverrides,
  dispatch: Dispatch,
): readonly DebugSwitch[] {
  return [
    {
      id: 'offline',
      label: t('debug.menu.offline'),
      isOn: overrides.isOffline,
      onToggle: () => {
        dispatch({ type: 'set-offline', isOn: !overrides.isOffline });
      },
    },
    {
      id: 'motion',
      label: t('debug.menu.motion'),
      isOn: overrides.motion === 'still',
      onToggle: () => {
        dispatch({ type: 'set-motion', motion: overrides.motion === 'still' ? 'system' : 'still' });
      },
    },
    {
      id: 'probe',
      label: t('debug.menu.probe'),
      isOn: overrides.isCanvasProbeOn,
      onToggle: () => {
        dispatch({ type: 'set-canvas-probe', isOn: !overrides.isCanvasProbeOn });
      },
    },
  ];
}

function actionsOf(t: TFunction, clock: ClockPort, dispatch: Dispatch): readonly DebugAction[] {
  return [
    {
      id: 'next-day',
      label: t('debug.menu.next-day'),
      onPress: () => {
        // The handler reads the clock when it runs; the reducer moves the day on.
        dispatch({ type: 'advance-day', realToday: clock.today() });
      },
    },
    {
      id: 'real-day',
      label: t('debug.menu.real-day'),
      onPress: () => {
        dispatch({ type: 'use-real-day' });
      },
    },
  ];
}

export function useDebugMenuModel(): DebugMenuModel {
  const t = useT();
  const { clock, errorLog } = useServices();
  const isReducedMotion = useReduceMotion();
  const overrides = useDebugOverridesStore(selectOverrides);
  const dispatch = useDebugOverridesStore(selectDispatch);
  return {
    buildText: t('debug.menu.build', { variantText: currentAppVariant() }),
    dayText: t('debug.menu.day', { dayText: overrides.today ?? t('debug.menu.day-real') }),
    errorsText: t('debug.menu.errors', { count: errorLog.entries().length }),
    switches: switchesOf(t, overrides, dispatch),
    actions: actionsOf(t, clock, dispatch),
    isReducedMotion,
  };
}
