// src/features/settings/settings-screen.tsx
import { View } from 'react-native';

import { ScreenFrame } from '@/ui/screen-frame';

export function SettingsScreen(): React.JSX.Element {
  return (
    <ScreenFrame testID="settings.screen" edges={['right', 'bottom', 'left']}>
      <View testID="settings.rows" />
    </ScreenFrame>
  );
}
