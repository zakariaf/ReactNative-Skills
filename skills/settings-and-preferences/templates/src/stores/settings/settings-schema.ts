// src/stores/settings/settings-schema.ts
// Every saved setting: its validator and its first-launch value, in one place. Owned by the
// settings-and-preferences skill; contracts/settings.json lists the same fields and its checker
// proves the two agree. A field's stored shape never changes in place: a new meaning gets a new
// field name, so the text an older version saved still decodes (settings-codec.ts).
import * as v from 'valibot';

import { LANGUAGES } from '@/i18n/languages';

/** Integer percent, 0 to 100: the stored unit of a volume; a port converts at its own edge. */
export const PERCENT = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100));

export const SETTINGS_SCHEMA = v.strictObject({
  /** null follows the device languages ("System"). */
  language: v.nullable(v.picklist(LANGUAGES)),
  digits: v.picklist(['automatic', 'latin', 'local']),
  theme: v.picklist(['system', 'light', 'dark']),
  reduceMotion: v.picklist(['system', 'on', 'off']),
  hapticsEnabled: v.boolean(),
  soundEnabled: v.boolean(),
  soundVolume: PERCENT,
});

export type Settings = v.InferOutput<typeof SETTINGS_SCHEMA>;

/**
 * The first-launch values. Settings that mirror a phone setting start at 'system' (or null), so the
 * app follows the phone until the person chooses; sound starts off, because noise is opt-in.
 */
export const DEFAULT_SETTINGS: Settings = {
  language: null,
  digits: 'automatic',
  theme: 'system',
  reduceMotion: 'system',
  hapticsEnabled: true,
  soundEnabled: false,
  soundVolume: 80,
};
