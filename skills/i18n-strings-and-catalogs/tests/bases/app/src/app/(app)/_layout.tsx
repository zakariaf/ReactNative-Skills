// src/app/(app)/_layout.tsx (fixture: under the root I18nProvider, so useT() works for screen titles)
import { Stack } from 'expo-router';

import { useT } from '@/i18n/t-context';

export default function AppLayout(): React.JSX.Element {
  const t = useT();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('tasks.list.title') }} />
    </Stack>
  );
}
