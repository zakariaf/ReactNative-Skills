// src/features/settings/settings-rows.ts
// Pure: which groups and rows the Settings screen shows, in which order, with which testID and
// label. The screen renders exactly this list, so every visibility rule is a unit test here. A row
// that does not apply is left out, never greyed: a disabled control nobody can enable is noise for
// VoiceOver and TalkBack, and a tap on it explains nothing.
import type { MessageKey } from '@/i18n/messages';

export const SETTINGS_GROUP_IDS = [
  'account',
  'general',
  'appearance',
  'sound',
  'premium',
  'privacy',
  'data',
  'about',
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number];

/** One literal testID per row (`settings.<row>-<role>`), so tests and Maestro flows never build one. */
export const SETTINGS_ROW_TEST_IDS = {
  'sign-out': 'settings.sign-out-row',
  'delete-account': 'settings.delete-account-row',
  language: 'settings.language-row',
  numbers: 'settings.numbers-row',
  theme: 'settings.theme-row',
  'reduce-motion': 'settings.reduce-motion-switch',
  sound: 'settings.sound-switch',
  'sound-volume': 'settings.sound-volume-slider',
  haptics: 'settings.haptics-switch',
  'get-premium': 'settings.get-premium-row',
  'premium-active': 'settings.premium-active-row',
  'restore-purchases': 'settings.restore-purchases-row',
  'privacy-choices': 'settings.privacy-choices-row',
  'privacy-policy': 'settings.privacy-policy-row',
  'reset-settings': 'settings.reset-settings-row',
  'delete-all-data': 'settings.delete-all-data-row',
  'rate-app': 'settings.rate-app-row',
  'contact-support': 'settings.contact-support-row',
  about: 'settings.about-row',
} as const;
export type SettingsRowId = keyof typeof SETTINGS_ROW_TEST_IDS;

export const SETTINGS_ROW_LABEL_KEYS: Readonly<Record<SettingsRowId, MessageKey>> = {
  'sign-out': 'settings.sign-out.label',
  'delete-account': 'settings.delete-account.label',
  language: 'settings.language.label',
  numbers: 'settings.numbers.label',
  theme: 'settings.theme.label',
  'reduce-motion': 'settings.reduce-motion.label',
  sound: 'settings.sound.label',
  'sound-volume': 'settings.sound-volume.label',
  haptics: 'settings.haptics.label',
  'get-premium': 'settings.premium.get',
  'premium-active': 'settings.premium.active',
  'restore-purchases': 'settings.premium.restore',
  'privacy-choices': 'settings.privacy-choices.label',
  'privacy-policy': 'settings.privacy-policy.label',
  'reset-settings': 'settings.reset-settings.label',
  'delete-all-data': 'settings.delete-all-data.label',
  'rate-app': 'settings.rate-app.label',
  'contact-support': 'settings.contact-support.label',
  about: 'settings.about.label',
};

export const SETTINGS_GROUP_TITLE_KEYS: Readonly<Record<SettingsGroupId, MessageKey>> = {
  account: 'settings.group.account',
  general: 'settings.group.general',
  appearance: 'settings.group.appearance',
  sound: 'settings.group.sound',
  premium: 'settings.group.premium',
  privacy: 'settings.group.privacy',
  data: 'settings.group.data',
  about: 'settings.group.about',
};

/** Facts from outside the settings store that decide which rows exist. */
export type SettingsContext = {
  /**
   * Someone is signed in to an account (an app without accounts passes false): Sign out and Delete
   * account appear. Both hand off to auth-and-secure-storage; the stores require Delete account
   * wherever the app lets people create an account.
   */
  readonly isSignedIn: boolean;
  /** The haptics port says the device can play haptics (no on most iPads and some Android tablets). */
  readonly canVibrate: boolean;
  /** The Premium entitlement is owned: "Premium is active" replaces "Get Premium". */
  readonly isPremium: boolean;
  /** The ads consent answer requires an entry point to change it (Google UMP's privacy options). */
  readonly hasPrivacyChoices: boolean;
};

export type SettingsGroup = {
  readonly id: SettingsGroupId;
  readonly testID: string;
  readonly rows: readonly SettingsRowId[];
};

function rowsOf(id: SettingsGroupId, context: SettingsContext): readonly SettingsRowId[] {
  switch (id) {
    case 'account':
      return context.isSignedIn ? ['sign-out', 'delete-account'] : [];
    case 'general':
      return ['language', 'numbers'];
    case 'appearance':
      return ['theme', 'reduce-motion'];
    case 'sound':
      return context.canVibrate ? ['sound', 'sound-volume', 'haptics'] : ['sound', 'sound-volume'];
    case 'premium':
      return [context.isPremium ? 'premium-active' : 'get-premium', 'restore-purchases'];
    case 'privacy':
      return context.hasPrivacyChoices ? ['privacy-choices', 'privacy-policy'] : ['privacy-policy'];
    case 'data':
      return ['reset-settings', 'delete-all-data'];
    case 'about':
      return ['rate-app', 'contact-support', 'about'];
  }
}

/** The groups in screen order, each with only the rows that apply; a group with none is left out. */
export function settingsGroupsFor(context: SettingsContext): readonly SettingsGroup[] {
  return SETTINGS_GROUP_IDS.map((id) => ({
    id,
    testID: `settings.group.${id}`,
    rows: rowsOf(id, context),
  })).filter((group) => group.rows.length > 0);
}
