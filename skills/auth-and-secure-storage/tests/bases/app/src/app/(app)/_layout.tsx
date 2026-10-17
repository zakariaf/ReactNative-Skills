// src/app/(app)/_layout.tsx: the signed-in group's own layout, so the guard covers every screen in it.
import { Stack } from 'expo-router';

export default function AppLayout(): React.JSX.Element {
  return <Stack />;
}
