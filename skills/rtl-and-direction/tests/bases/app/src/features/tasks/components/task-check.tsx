// src/features/tasks/components/task-check.tsx
// The check mark slides from the start edge: an animated style with logical keys.
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import type { SharedValue } from 'react-native-reanimated';

export type TaskCheckProps = { readonly progress: SharedValue<number> };

export function TaskCheck({ progress }: TaskCheckProps): React.JSX.Element {
  const markStyle = useAnimatedStyle(() => ({
    marginStart: withTiming(progress.get() * 20),
  }));
  return <Animated.View style={markStyle} />;
}
