// .agents/skills/kit/templates/src/ui/wobble.tsx (an installed skill: planted findings, never scanned)
import { LayoutAnimation } from 'react-native';
import { withRepeat, withTiming } from 'react-native-reanimated';

export const wobble = (): number => {
  LayoutAnimation.easeInEaseOut();
  return withRepeat(withTiming(1), -1, true);
};
