// src/features/tasks/components/swipe-row.tsx (Gesture Handler 3 hook API)
import { View } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';

type SwipeRowProps = { readonly onComplete: () => void };

export function SwipeRow({ onComplete }: SwipeRowProps): React.JSX.Element {
  const tap = useTapGesture({
    onDeactivate: (event) => {
      if (event.canceled) {
        return;
      }
      onComplete();
    },
  });
  const pan = usePanGesture({ onUpdate: () => undefined });
  return (
    <GestureDetector gesture={useExclusiveGestures(pan, tap)}>
      <View />
    </GestureDetector>
  );
}
