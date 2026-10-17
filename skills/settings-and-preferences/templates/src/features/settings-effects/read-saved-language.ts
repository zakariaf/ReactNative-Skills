// src/features/settings-effects/read-saved-language.ts
// The saved language for rtl-and-direction's DirectionGate, before any store or database is open:
// one synchronous read of the settings text and the codec's decode, nothing written. The gate
// decides the layout direction from it (resolveLanguage(saved, getLocales()) turns null into the
// phone's language); the settings store opened later reads the same text again.
import { decodeSettings } from '@/stores/settings/settings-codec';

import type { Language } from '@/i18n/languages';
import type { SettingsStoragePort } from '@/services/settings-storage/settings-storage-port';

/** The person's language choice, or null when they follow the phone or nothing could be read. */
export function readSavedLanguage(storage: Pick<SettingsStoragePort, 'read'>): Language | null {
  const read = storage.read();
  return read.ok ? decodeSettings(read.value).settings.language : null;
}
