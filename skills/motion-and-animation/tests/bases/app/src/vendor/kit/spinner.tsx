// src/vendor/kit/spinner.tsx (a vendored skill folder holding a SKILL.md: never scanned)
import { runOnJS, withRepeat, withTiming } from 'react-native-reanimated';

export const spin = (done: () => void): number => {
  runOnJS(done)();
  return withRepeat(withTiming(1), -1);
};
