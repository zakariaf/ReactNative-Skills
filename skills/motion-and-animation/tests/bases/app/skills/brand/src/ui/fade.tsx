// skills/brand/src/ui/fade.tsx (a skill folder: planted findings, never scanned)
import { withTiming } from 'react-native-reanimated';

export function fadeLater(value: { set: (next: number) => void }): void {
  setTimeout(() => value.set(withTiming(1)), 300);
}
