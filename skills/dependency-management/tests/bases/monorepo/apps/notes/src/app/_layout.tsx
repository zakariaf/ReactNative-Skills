// (fixture) the root layout.
import { Stack } from 'expo-router';
import { create } from 'zustand';

export const useStore = create(() => ({}));

export default function RootLayout() {
  return <Stack />;
}
