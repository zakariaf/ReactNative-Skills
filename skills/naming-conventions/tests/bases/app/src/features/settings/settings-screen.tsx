// src/features/settings/settings-screen.tsx
import { Switch, TextInput } from 'react-native';

import { useSettingsStore } from '@/stores/settings-store';

export function SettingsScreen(): React.JSX.Element {
  const isSoundOn = useSettingsStore((state) => state.isSoundOn);
  const toggleSound = useSettingsStore((state) => state.toggleSound);
  return (
    <>
      <Switch testID="settings.sound-switch" value={isSoundOn} onValueChange={toggleSound} />
      <TextInput testID="settings.display-name-input" />
    </>
  );
}
