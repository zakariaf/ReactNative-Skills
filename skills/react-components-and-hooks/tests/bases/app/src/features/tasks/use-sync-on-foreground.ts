// src/features/tasks/use-sync-on-foreground.ts: an effect that subscribes to an OS event and
// returns the unsubscribe.
import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';

export function useSyncOnForeground(onForeground: () => void): void {
  const handleForeground = useEffectEvent(onForeground);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') handleForeground();
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
