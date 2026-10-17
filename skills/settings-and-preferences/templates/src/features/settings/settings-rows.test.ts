// src/features/settings/settings-rows.test.ts
import {
  SETTINGS_GROUP_TITLE_KEYS,
  SETTINGS_ROW_LABEL_KEYS,
  SETTINGS_ROW_TEST_IDS,
  settingsGroupsFor,
} from './settings-rows';

import type { SettingsContext, SettingsGroupId, SettingsRowId } from './settings-rows';

const EVERYTHING: SettingsContext = {
  isSignedIn: true,
  canVibrate: true,
  isPremium: false,
  hasPrivacyChoices: true,
};

function rowsIn(context: SettingsContext, group: SettingsGroupId): readonly SettingsRowId[] {
  return settingsGroupsFor(context).find((candidate) => candidate.id === group)?.rows ?? [];
}

describe('settingsGroupsFor', () => {
  it('lists the groups in screen order', () => {
    expect(settingsGroupsFor(EVERYTHING).map((group) => group.testID)).toStrictEqual([
      'settings.group.account',
      'settings.group.general',
      'settings.group.appearance',
      'settings.group.sound',
      'settings.group.premium',
      'settings.group.privacy',
      'settings.group.data',
      'settings.group.about',
    ]);
  });

  it('shows every row once when everything applies', () => {
    const rows = settingsGroupsFor(EVERYTHING).flatMap((group) => group.rows);

    expect(rows).toHaveLength(18);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('shows Sign out and Delete account only while someone is signed in', () => {
    expect(rowsIn(EVERYTHING, 'account')).toStrictEqual(['sign-out', 'delete-account']);
    expect(
      settingsGroupsFor({ ...EVERYTHING, isSignedIn: false }).map((group) => group.id),
    ).not.toContain('account');
  });

  it('hides Haptics on a device that cannot vibrate', () => {
    expect(rowsIn({ ...EVERYTHING, canVibrate: false }, 'sound')).toStrictEqual([
      'sound',
      'sound-volume',
    ]);
  });

  it('swaps Get Premium for Premium is active and keeps Restore purchases', () => {
    expect(rowsIn({ ...EVERYTHING, isPremium: true }, 'premium')).toStrictEqual([
      'premium-active',
      'restore-purchases',
    ]);
  });

  it('shows Privacy choices only where the consent answer needs an entry point', () => {
    expect(rowsIn({ ...EVERYTHING, hasPrivacyChoices: false }, 'privacy')).toStrictEqual([
      'privacy-policy',
    ]);
  });
});

describe('row tables', () => {
  it('gives every row a settings testID ending in its role, and a label', () => {
    for (const [row, testID] of Object.entries(SETTINGS_ROW_TEST_IDS)) {
      expect(testID).toMatch(/^settings\.[a-z0-9-]+-(row|switch|slider)$/);
      expect(SETTINGS_ROW_LABEL_KEYS).toHaveProperty(row);
    }
  });

  it('gives every group a title', () => {
    expect(Object.keys(SETTINGS_GROUP_TITLE_KEYS)).toStrictEqual(
      settingsGroupsFor(EVERYTHING).map((group) => group.id),
    );
  });
});
