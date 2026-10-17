# Worked example: the root layout with the direction decided first

The shape every Expo Router app imitates (React Navigation: the same in `App.tsx`). These files ran
in a copy of the reference app on 2026-10-10 with this skill's templates: `tsc` (both programs),
ESLint with `--max-warnings 0`, Prettier, the whole Jest suite and `check-rtl` all passed. Imitate the shape;
the providers between the gate and the Stack are whatever the app's root already mounts.

## 1. The guard in the composition root

`DirectionGuardPort` is a port like any other (architecture-and-boundaries): one member in
`Services`, one line in each factory, one name in the composition root's test. The canonical
composition root already carries these lines; an app whose own composition root predates them adds
exactly these.

```ts
// src/services/services-context.tsx
export type Services = {
  readonly clock: ClockPort;
  readonly directionGuard: DirectionGuardPort;
  readonly errorLog: ErrorLogPort;
};

// src/services/create-device-services.ts (inside createDeviceServices)
    directionGuard: createKvDirectionGuardAdapter(),

// src/services/create-test-services.ts (inside createTestServices)
    directionGuard: given.directionGuard ?? missingPort('directionGuard'),

// src/services/create-device-services.test.ts
    expect(Object.keys(services).sort()).toStrictEqual(['clock', 'directionGuard', 'errorLog']);
```

## 2. The root layout decides; nothing with effects runs here

```tsx
// src/app/_layout.tsx: the root layout. Expo Router reads its default export.
// device-only: covered by the app launch on a device (it only composes the tested modules below)
// The direction is decided first: RootLayout creates the adapters (no I/O) and resolves the language,
// DirectionGate restarts once or renders AppRoot, and only AppRoot does work with effects (the
// database, the error net's sink) and mounts the providers. Nothing here runs at import time.
import '@/services/error-net/install-error-net';

import { reloadAppAsync } from 'expo';
import { getLocales } from 'expo-localization';
import { useState } from 'react';

import { CrashFallback } from '@/features/crash-recovery/crash-fallback';
import { createRouteErrorBoundary } from '@/features/crash-recovery/create-route-error-boundary';
import { AppRoot } from '@/features/root-navigator/app-root';
import { DirectionGate } from '@/i18n/direction-gate';
import { resolveLanguage } from '@/i18n/resolve-language';
import { createDeviceServices } from '@/services/create-device-services';
import { appErrorNet } from '@/services/error-net/app-error-net';

import type { DirectionGiveUp } from '@/i18n/direction-gate';
import type { Language } from '@/i18n/languages';
import type { DirectionGuardFailure } from '@/services/direction-guard/direction-guard-port';
import type { Services } from '@/services/services-context';

/** Expo Router wraps this layout (so the whole app) in a boundary that renders this on a render error. */
export const ErrorBoundary = createRouteErrorBoundary({
  record: (error) => {
    appErrorNet.report({ source: 'render', error, isFatal: false });
  },
  Fallback: CrashFallback,
  // The root fallback replaces the whole navigator: reloading the bundle is the dependable way out.
  // audio-dispose-exempt: the root error boundary renders outside the services it would dispose.
  restart: () => reloadAppAsync('crash-recovery'),
});

type Startup = { readonly services: Services; readonly language: Language };

/** Runs once per JS run, in a state initializer: adapters only (no I/O) and the language. */
function decideStartup(): Startup {
  // The saved language goes in place of null once the settings store reads it before first paint.
  return { services: createDeviceServices(), language: resolveLanguage(null, getLocales()) };
}

export default function RootLayout(): React.JSX.Element {
  const [startup] = useState(decideStartup);
  const handleGiveUp = (giveUp: DirectionGiveUp): void => {
    startup.services.errorLog.record(
      'startup',
      new Error(`layout direction ${giveUp.reason}: ${giveUp.layout} -> ${giveUp.wanted}`),
    );
  };
  const handleGuardFailure = (failure: DirectionGuardFailure): void => {
    startup.services.errorLog.record('startup', new Error(`layout direction ${failure.kind}`));
  };
  return (
    <DirectionGate
      language={startup.language}
      guard={startup.services.directionGuard}
      onGiveUp={handleGiveUp}
      onGuardFailure={handleGuardFailure}
    >
      <AppRoot services={startup.services} language={startup.language} />
    </DirectionGate>
  );
}
```

An app with sounds (audio-and-haptics-feedback) also hands the gate its dispose, so the native audio
engine closes before a direction reload (that skill's `dispose-before-reload` rule):

```tsx
    <DirectionGate
      language={startup.language}
      guard={startup.services.directionGuard}
      onGiveUp={handleGiveUp}
      onGuardFailure={handleGuardFailure}
      beforeReload={() => startup.services.audio.dispose()}
    >
```

The gate restarts before `AppRoot` loads the sound bank, so on that path the dispose closes nothing;
it is still the one seam every direction reload goes through, and the same `beforeReload` is what a
language settings screen passes to `restartForDirection` from inside `AppRoot`.

`decideStartup` passes `null` for the saved language until the app saves a language choice; with
settings-and-preferences in place it reads it synchronously, before any store or database opens:
`resolveLanguage(readSavedLanguage(createKvSettingsStorageAdapter(services.errorLog)), getLocales())`
(`readSavedLanguage` is that skill's `src/features/settings-effects/read-saved-language.ts`: one read
and the codec's decode, nothing written).

## 3. Everything with effects lives in the gate's child

```tsx
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
```

## 4. The crash fallback sets its own text locale

Expo Router renders the root `ErrorBoundary`'s `Fallback` in place of the layout, outside every
provider above, so it mounts `TextLocaleProvider` itself (`check-rtl` rule
`root-direction-provider` follows `Fallback` from the root layout and checks it; an
`ErrorBoundary` that draws its own JSX in the layout is checked there, so it wraps that JSX in the
same provider). The file is error-handling-typed-results' crash fallback with one change: the
`TextLocaleProvider` around `CrashScreen`. Its language comes from `languageNow()`, the same source
`createTranslateNow` reads, never from `resolveLanguage(null, getLocales())`: on an English phone with
Arabic chosen in the app, the device language would give Arabic copy laid out as `en`/LTR, the
backwards text rule 7 exists to prevent, and `check-rtl` cannot see that mismatch.

```tsx
// src/features/crash-recovery/crash-fallback.tsx
// The app's root fallback, the `Fallback` the root layout hands createRouteErrorBoundary. It renders
// outside every provider the root layout mounts (Expo Router's boundary replaces the layout), so it
// reads no React context that lacks a default. useTheme() is safe: design-system-structure's theme
// context defaults to the app's light theme, the same theme AppText falls back to, so the text and
// the background stay a pair whose contrast the theme proves. Copy comes from i18n-strings-and-
// catalogs' createTranslateNow (src/i18n/translate-now.ts), a t() that needs no provider: it uses the
// language and digits I18nProvider showed last, so the person keeps their own language, and the
// device's languages when no provider committed yet. The text locale reads the same languageNow(),
// so the copy and its direction always agree. Expo Router's root mounts SafeAreaProvider above the
// layout, so safe-area hooks still work. Keep it trivial: nothing catches or records an error
// thrown here.
import { directionOf } from '@/i18n/languages';
import { createTranslateNow, languageNow } from '@/i18n/translate-now';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { TextLocaleProvider } from '@/theme/text-locale';
import { useTheme } from '@/theme/use-theme';

import { CrashScreen } from './crash-screen';

import type { CrashFallbackProps } from './create-route-error-boundary';

/** A missing crash message is recorded, never thrown: a throw here would be an unrecorded crash. */
function reportMessageError(error: Error): void {
  appErrorNet.report({ source: 'render', error, isFatal: false });
}

/** The crash screen with the app's copy and background; its one way out is `onRestart`. */
export function CrashFallback({ onRestart }: CrashFallbackProps): React.JSX.Element {
  const theme = useTheme();
  const t = createTranslateNow(reportMessageError);
  const { language } = languageNow();
  return (
    <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
      <CrashScreen
        title={t('crash.title')}
        body={t('crash.body')}
        actionLabel={t('crash.restart')}
        onAction={onRestart}
        backgroundColor={theme.colors.background}
      />
    </TextLocaleProvider>
  );
}
```

## What check-rtl says about the wrong versions

| Wrong | Rule |
|---|---|
| `useState(startApp)` in `RootLayout` with `startApp` opening the database | `direction-before-render` (a restart would repeat the open) |
| No `DirectionGate` at all | `direction-before-render` |
| `<SQLiteProvider onInit={migrate}>` (or any provider with effects) around `DirectionGate` | `direction-before-render` (it mounts before the decision; effect-free wrappers go in `gateWrappers`) |
| An inline `export function ErrorBoundary` drawing `<View><AppText>…` without `TextLocaleProvider` | `root-direction-provider`, at the boundary's line in the root layout |
| `<DirectionProvider direction={directionOf(language)}>` around the app | `layout-direction` (icons flip before the rows do) |
| The crash fallback without `TextLocaleProvider` | `root-direction-provider` |
| `reloadAppAsync('language')` in a settings handler | `reload-outside-direction` |
