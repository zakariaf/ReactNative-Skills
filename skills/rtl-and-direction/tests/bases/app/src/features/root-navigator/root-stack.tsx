// src/features/root-navigator/root-stack.tsx
// Expo Router's Stack follows the layout direction by itself (I18nManager), so it gets no direction.
import { Stack } from 'expo-router';

export function RootStack(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
