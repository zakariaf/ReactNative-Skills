// src/app/(app)/_layout.tsx
import { Stack } from 'expo-router';

export default function AppLayout(): React.JSX.Element {
  return (
    <Stack>
      <Stack.Screen name="index" />
      <Stack.Screen name="tasks/[taskId]" />
      <Stack.Screen name="tasks/[taskId]/edit" />
      <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
