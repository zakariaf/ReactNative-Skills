// src/features/attachments/capture-screen.tsx: the camera preview; the orientation stays put while it runs.
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { View } from 'react-native';

export function CaptureScreen(): React.JSX.Element {
  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    return () => {
      void ScreenOrientation.unlockAsync();
    };
  }, []);
  return <View testID="capture.screen" style={{ flex: 1 }} />;
}
