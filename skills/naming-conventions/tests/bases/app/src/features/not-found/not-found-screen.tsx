// src/features/not-found/not-found-screen.tsx
import { useT } from '@/i18n/use-t';
import { AppText } from '@/ui/app-text';

export function NotFoundScreen(): React.JSX.Element {
  const t = useT();
  return <AppText testID="not-found.title">{t('common.not-found.title')}</AppText>;
}
