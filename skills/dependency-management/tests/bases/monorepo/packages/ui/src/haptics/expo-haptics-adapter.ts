// packages/ui/src/haptics/expo-haptics-adapter.ts (fixture): the shared package imports expo-haptics.
import * as Haptics from 'expo-haptics';

export function tick(): void {
  void Haptics.selectionAsync();
}
