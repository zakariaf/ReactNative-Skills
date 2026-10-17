// Example: the settings row that offers a downloaded update. It appears only when the checker is
// ready and restarts only on the person's tap; the texts are message keys of the app's catalogs
// (settings.update.ready, settings.update.restart in every locale).
import { useIntl } from 'react-intl';

import { useUpdateStatus } from '@/hooks/use-update-checks';
import { useServices } from '@/services/services-context';
import { SettingsRow } from '@/ui/settings-row';

import type { JSX } from 'react';

export function RestartToUpdateRow(): JSX.Element | null {
  const intl = useIntl();
  const { updateChecker, errorLog } = useServices();
  const status = useUpdateStatus(updateChecker);
  if (status !== 'ready') return null;
  const onPress = (): void => {
    updateChecker
      .applyNow()
      .then((result) => {
        if (!result.ok) errorLog.record('service', new Error(`updates: ${result.error.kind}`));
      })
      .catch((thrown: unknown) => {
        errorLog.record('service', thrown);
      });
  };
  return (
    <SettingsRow
      testID="settings-restart-to-update"
      title={intl.formatMessage({ id: 'settings.update.ready' })}
      actionLabel={intl.formatMessage({ id: 'settings.update.restart' })}
      onPress={onPress}
    />
  );
}
