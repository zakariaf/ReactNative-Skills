// src/services/haptics/expo-haptics-adapter.ts (fixture): the one file that imports expo-haptics.
import * as Haptics from 'expo-haptics';

export function tick(): void {
  void Haptics.selectionAsync();
}
