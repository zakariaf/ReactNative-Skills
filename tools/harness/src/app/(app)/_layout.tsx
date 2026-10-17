// src/app/(app)/_layout.tsx: the app's screens, under the root layout's providers. useT() throws
// outside I18nProvider, so the screens are titled here, one level below the layout that renders it.
// The Stack takes its screen animation from useScreenAnimation() (a cross-fade while motion is
// reduced); the moment catalog lists this file under screenPush.files.
import { Stack } from 'expo-router';

import { useT } from '@/i18n/t-context';
import { useScreenAnimation } from '@/ui/motion/use-screen-animation';

export default function AppLayout(): React.JSX.Element {
  const t = useT();
  const animation = useScreenAnimation();
  return (
    <Stack screenOptions={{ animation }}>
      <Stack.Screen name="index" options={{ title: t('tasks.list.title') }} />
    </Stack>
  );
}
