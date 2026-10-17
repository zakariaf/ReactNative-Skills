// src/core/async/watch-app-state.ts
import { AppState } from 'react-native';

export function watchAppState(onChange: (state: string) => void): () => void {
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}
