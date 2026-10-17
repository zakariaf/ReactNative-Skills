// src/features/tasks/components/swipe-row.tsx (Gesture Handler 2 builder API)
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

type SwipeRowProps = { readonly onComplete: () => void };

export function SwipeRow({ onComplete }: SwipeRowProps): React.JSX.Element {
  const tap = Gesture.Tap().onEnd((_event, success) => {
    if (success) {
      onComplete();
    }
  });
  const pan = Gesture.Pan();
  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View />
    </GestureDetector>
  );
}
