# Worked example: choosing a language in Settings

The Settings language screen saves the choice, switches the text at once, and asks before the one
restart a direction change needs. settings-and-preferences owns the store and the screen; this is
the part this skill owns: when to restart, and how.

## The model hook (shape)

```ts
// src/features/settings/use-language-choice-model.ts
import { getLocales } from 'expo-localization';
import { useState } from 'react';

import { readLayoutDirection, restartForDirection } from '@/i18n/direction';
import { directionOf, LANGUAGES } from '@/i18n/languages';
import { resolveLanguage } from '@/i18n/resolve-language';
import { useServices } from '@/services/services-context';
import { useSettingsStore } from '@/stores/settings/settings-store-context';

import type { Language } from '@/i18n/languages';

export type LanguageChoiceModel = {
  readonly languages: readonly Language[];
  readonly selected: Language | null; // null follows the device
  /** True while the "Restart to apply" dialog is open. */
  readonly isRestartAsked: boolean;
  readonly choose: (language: Language) => void;
  /** The "System" entry: forget the choice and follow the device language again. */
  readonly clearChoice: () => void;
  readonly restartNow: () => void;
  readonly restartLater: () => void;
};

export function useLanguageChoiceModel(): LanguageChoiceModel {
  const { directionGuard, errorLog } = useServices();
  const selected = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const [pending, setPending] = useState<Language | null>(null);
  /** Ask for the restart when the language the app now shows has another direction than the layout. */
  const askIfDirectionChanges = (shown: Language): void => {
    if (directionOf(shown) !== readLayoutDirection()) setPending(shown);
  };
  return {
    languages: LANGUAGES,
    selected,
    isRestartAsked: pending !== null,
    choose: (language) => {
      setLanguage(language); // a synchronous save: complete when it returns; the text switches now
      askIfDirectionChanges(language);
    },
    clearChoice: () => {
      setLanguage(null); // follow the device again
      // The language shown is now the device's (or the source language): Arabic back to System on an
      // English phone is a direction change too, resolved the same way the root layout resolves it.
      askIfDirectionChanges(resolveLanguage(null, getLocales()));
    },
    restartNow: () => {
      if (pending === null) return;
      // From a press handler (a mounted component), after the save: records the guard, flips, reloads.
      // An app with audio passes `() => audio.dispose()` as the third argument (beforeReload).
      void restartForDirection(directionOf(pending), directionGuard).then((result) => {
        if (!result.ok) errorLog.record('storage', new Error(result.error.kind));
      });
    },
    restartLater: () => {
      setPending(null); // the layout follows at the next cold start (DirectionGate fixes it)
    },
  };
}
```

## What the screen shows

- The list of languages by their autonyms (i18n-strings-and-catalogs: code, never catalog text),
  each rendered with `<AppText language={code}>` so it gets its own script's font and
  `accessibilityLanguage`; the "System" entry calls `clearChoice`, which resolves the device
  language and asks for the restart in the same way when its direction differs from the layout.
- The dialog, from catalog keys: `settings.language.restart.title` ("Restart to apply"),
  `settings.language.restart.body` ("The layout direction changes after a quick restart. Your tasks
  are saved."), actions **Restart** and **Later**, the safe choice (Later) at the start edge.
- The first-run language screen does the same without the dialog: its **Continue** tap saves and
  restarts in one go.

## Why this shape

| Choice | Why |
|---|---|
| Save first, restart second | the reload re-runs every module; an unsaved choice would be lost and the gate would plan from the old language |
| Ask only when the direction changes | English to German or Arabic to Persian needs no restart: the text switches at once |
| "System" resolves before it compares | clearing the choice changes the language to the device's; compare that language's direction, never `null`, or Arabic back to System on an English phone keeps the right-to-left layout until a cold start |
| `restartForDirection`, never `reloadAppAsync` here | it writes the guard first; a flip that does not take becomes a reported give-up instead of a loop (`check-rtl` rule `reload-outside-direction`) |
| A press handler | reloading while the bundle is evaluating crashed a Release build (`reload-at-module-scope`) |
| The root layout reads the saved language first | ship this screen only once `decideStartup` passes the saved language to `DirectionGate` (examples/root-layout.md section 2); while it still passes `null`, the gate plans from the device language after the reload and flips straight back |
| Later keeps the layout | text and layout disagree until the next launch; that is accepted, and the gate repairs it |
