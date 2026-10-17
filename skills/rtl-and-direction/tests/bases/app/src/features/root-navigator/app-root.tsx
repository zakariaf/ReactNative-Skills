// src/features/root-navigator/app-root.tsx
// device-only: covered by the app launch on a device (it only composes the tested modules below)
// Everything the app starts once the direction gate kept this JS run: the database (its memory log
// records the open), the error net's sink, then the providers, outermost first: services, data,
// i18n, theme, text locale, and the root Stack. A run that is about to restart never gets here.
import { useState } from 'react';

import { AppDataProvider } from '@/data/app-data-context';
import { openDeviceData } from '@/data/open-device-database';
import { useCheckpointOnBackground } from '@/data/use-checkpoint-on-background';
import { I18nProvider } from '@/i18n/i18n-provider';
import { directionOf } from '@/i18n/languages';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { ServicesProvider } from '@/services/services-context';
import { TextLocaleProvider } from '@/theme/text-locale';
import { AppThemeProvider } from '@/theme/theme-provider';

import { RootStack } from './root-stack';

import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { Services } from '@/services/services-context';

export type AppRootProps = { readonly services: Services; readonly language: Language };

export function AppRoot({ services, language }: AppRootProps): React.JSX.Element {
  const [data] = useState((): AppData => {
    const opened = openDeviceData(services);
    appErrorNet.connect((report) => {
      opened.errorLog.record(report.source, report.error);
    });
    return opened;
  });
  useCheckpointOnBackground(data.database);
  const handleI18nError = (error: Error): void => {
    data.errorLog.record('i18n', error);
  };
  return (
    <ServicesProvider services={services}>
      <AppDataProvider data={data}>
        <I18nProvider language={language} digits="automatic" onError={handleI18nError}>
          <AppThemeProvider preference="system">
            <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
              <RootStack />
            </TextLocaleProvider>
          </AppThemeProvider>
        </I18nProvider>
      </AppDataProvider>
    </ServicesProvider>
  );
}
