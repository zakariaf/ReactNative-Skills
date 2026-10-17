// src/features/settings/use-settings-model.ts
// The Settings screen's data: the current values, the visible groups with their labels, the
// display strings the rows need, and every handler. The only code of the feature that reads the
// store and the copy; the screen view renders exactly what this returns.
import { useState } from 'react';

import { useLanguage } from '@/i18n/language-context';
import { LANGUAGE_AUTONYMS } from '@/i18n/languages';
import { useT } from '@/i18n/t-context';
import {
  selectDispatch,
  selectLastWriteFailure,
  selectSettings,
} from '@/stores/settings/settings-selectors';
import { useSettingsStore, useSettingsStoreApi } from '@/stores/settings/settings-store';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { createDataResets } from './data-resets';
import { planLanguageChange } from './language-change';
import { createPreferenceActions } from './settings-preference-actions';
import {
  SETTINGS_GROUP_TITLE_KEYS,
  SETTINGS_ROW_LABEL_KEYS,
  SETTINGS_ROW_TEST_IDS,
  settingsGroupsFor,
} from './settings-rows';

import type { DataResetInput } from './data-resets';
import type { PreferenceActions } from './settings-preference-actions';
import type { SettingsContext, SettingsGroupId, SettingsRowId } from './settings-rows';
import type { TFunction } from '@/i18n/create-t';
import type { Direction, Language } from '@/i18n/languages';
import type { MessageKey } from '@/i18n/messages';
import type { DeviceLocale } from '@/i18n/resolve-language';
import type { SettingsWriteFailure } from '@/services/settings-storage/settings-storage-port';
import type { Settings } from '@/stores/settings/settings-schema';

export type SettingsRowView = {
  readonly id: SettingsRowId;
  readonly testID: string;
  readonly label: string;
};

export type SettingsGroupView = {
  readonly id: SettingsGroupId;
  readonly testID: string;
  readonly title: string;
  readonly rows: readonly SettingsRowView[];
};

export type SettingsModelInput = {
  readonly context: SettingsContext;
  readonly deviceLocales: readonly DeviceLocale[];
  /** The layout's direction now (rtl-and-direction), for the restart decision. */
  readonly layoutDirection: Direction;
  /** Opens the "Restart to apply" dialog after a language of the other direction was saved (never after a failed save). */
  readonly onRestartNeeded: (language: Language) => void;
  /** "Delete all data": the data layer's reset through updateAndPublish, and the cache refetch. */
  readonly dataResets: DataResetInput;
  /**
   * Plays the toggle moment once after each switch's dispatch (audio-and-haptics-feedback's
   * () => { playUiFeedback(services, 'toggle'); }); never the press feedback, which is silent
   * unless the app opted into tap sounds.
   */
  readonly onToggled: () => void;
};

export type SettingsModel = {
  readonly settings: Settings;
  /** What the Reduce motion switch shows: the choice, or the phone's switch while 'system'. */
  readonly isReduceMotionOn: boolean;
  readonly groups: readonly SettingsGroupView[];
  /** "System (English)" while following the phone, else the chosen language's own name. */
  readonly languageValue: string;
  /** The slider's spoken value ("Volume at 80%"), in the app's digits. */
  readonly volumeText: string;
  /** Shown while the last change could not be saved; null otherwise. */
  readonly saveFailedText: string | null;
  /** Shown after "Delete all data" did not reach the disk; null otherwise. */
  readonly deleteFailedText: string | null;
  readonly actions: PreferenceActions & {
    readonly onSelectLanguage: (next: Language | null) => void;
    /** After the "Delete all data" confirmation: deletes the data, keeps every setting. */
    readonly onConfirmDeleteAllData: () => void;
  };
};

const WRITE_FAILURE_KEYS: Readonly<Record<SettingsWriteFailure['kind'], MessageKey>> = {
  'settings-not-saved': 'settings.save-failed',
};

function groupViews(context: SettingsContext, t: TFunction): readonly SettingsGroupView[] {
  return settingsGroupsFor(context).map((group) => ({
    id: group.id,
    testID: group.testID,
    title: t(SETTINGS_GROUP_TITLE_KEYS[group.id]),
    rows: group.rows.map((id) => ({
      id,
      testID: SETTINGS_ROW_TEST_IDS[id],
      label: t(SETTINGS_ROW_LABEL_KEYS[id]),
    })),
  }));
}

export function useSettingsModel(input: SettingsModelInput): SettingsModel {
  const t = useT();
  const shown = useLanguage();
  const store = useSettingsStoreApi();
  const settings = useSettingsStore(selectSettings);
  const dispatch = useSettingsStore(selectDispatch);
  const writeFailure = useSettingsStore(selectLastWriteFailure);
  const isReduceMotionOn = useReduceMotion();
  const { onToggled } = input;
  const [isDeleteFailed, setIsDeleteFailed] = useState(false);
  const resets = createDataResets(input.dataResets);
  const onSelectLanguage = (next: Language | null): void => {
    const { deviceLocales, layoutDirection } = input;
    const plan = planLanguageChange({ next, deviceLocales, layoutDirection });
    dispatch(plan.action);
    // A failed write publishes nothing (the save-failed note shows): restarting then would come back
    // in the old language, so the dialog opens only once the choice is the store's.
    const isSaved = store.getState().settings.language === next;
    if (plan.isRestartNeeded && isSaved) input.onRestartNeeded(plan.resolved);
  };
  return {
    settings,
    isReduceMotionOn,
    groups: groupViews(input.context, t),
    languageValue:
      settings.language === null
        ? t('settings.language.system', { languageName: LANGUAGE_AUTONYMS[shown] })
        : LANGUAGE_AUTONYMS[settings.language],
    volumeText: t('settings.sound-volume.value', { volumeRate: settings.soundVolume / 100 }),
    saveFailedText: writeFailure === null ? null : t(WRITE_FAILURE_KEYS[writeFailure.kind]),
    deleteFailedText: isDeleteFailed ? t('settings.delete-all-data.failed') : null,
    actions: {
      ...createPreferenceActions({ settings, isReduceMotionOn, dispatch, onToggled }),
      onSelectLanguage,
      onConfirmDeleteAllData: () => {
        setIsDeleteFailed(!resets.onConfirmDeleteAllData().ok);
      },
    },
  };
}
