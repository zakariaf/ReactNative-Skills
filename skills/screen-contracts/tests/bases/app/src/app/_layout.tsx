// src/app/_layout.tsx: the root layout (a layout, never a screen of its own).
import { Stack } from 'expo-router';

export default function RootLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
