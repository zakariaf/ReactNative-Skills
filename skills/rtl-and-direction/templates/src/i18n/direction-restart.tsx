// src/i18n/direction-restart.tsx
// The restart root DirectionGate renders when the layout must flip: it draws one screen, then flips
// the direction from its effect (a mounted component), never during render or at import time: a
// reload while the bundle is still being evaluated crashed a Release build. It sits outside every
// app provider, so it sets the text locale and direction of the language it restarts into;
// without them AppText falls back to English, left to right. `beforeReload` goes through to
// restartForDirection; an app with audio passes () => services.audio.dispose() from the root layout
// (before AppRoot loads the sound bank it closes nothing, which is the point: nothing is left open).
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { TextLocaleProvider } from '@/theme/text-locale';

import { restartForDirection } from './direction';
import { DirectionProvider } from './direction-context';
import { directionOf } from './languages';

import type { Language } from './languages';
import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';
import type { ReactNode } from 'react';

export type DirectionRestartProps = {
  /** The language the app restarts into. */
  readonly language: Language;
  readonly guard: DirectionGuardPort;
  /**
   * Called when restartForDirection fails: the record could not be written or the reload rejected
   * (no reload happened), or beforeReload rejected, in which case the reload was still asked for and
   * this run may be replaced moments later.
   */
  readonly onFailed: () => void;
  /** What to draw for the moment before the reload (default: an empty screen). */
  readonly screen?: ReactNode;
  /** Runs after the flip, right before the reload: close native work (e.g. the audio engine) here. */
  readonly beforeReload?: (() => Promise<void>) | undefined;
};

export function DirectionRestart(props: DirectionRestartProps): ReactNode {
  const { language, guard, onFailed, beforeReload } = props;
  const direction = directionOf(language);
  const hasStarted = useRef(false);
  useEffect(() => {
    // Once per mount, even when a parent re-renders or Strict Mode replays the effect.
    if (hasStarted.current) return;
    hasStarted.current = true;
    restartForDirection(direction, guard, beforeReload).then(
      (result) => {
        if (!result.ok) onFailed();
      },
      () => {
        onFailed();
      },
    );
  }, [direction, guard, onFailed, beforeReload]);
  return (
    <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
      <DirectionProvider direction={directionOf(language)}>
        {props.screen ?? <View style={styles.screen} testID="direction.restart-screen" />}
      </DirectionProvider>
    </TextLocaleProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
