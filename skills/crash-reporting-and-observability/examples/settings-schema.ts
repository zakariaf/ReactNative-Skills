// src/stores/settings/settings-schema.ts
// An example shape (imitate it, do not copy it): the canonical settings schema
// (settings-and-preferences) with the crash-report choice added the way that skill adds a field
// (schema, default, contracts/settings.json, the reducer case and the settings row). Every other
// field, comment and export stays exactly as the canonical file has it; only the two lines marked
// "crash-reporting-and-observability" are new. The default follows contracts/crash-reporting.json
// consentModel: false for opt-in, true for opt-out.
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
  /**
   * crash-reporting-and-observability: send anonymous crash reports (CrashReporterPort.setConsent).
   * Off applies at once; on after an off in the same run applies at the next launch (the adapter
   * keeps a closed SDK closed), so the settings row's hint says "Turning this back on applies the
   * next time you open the app."
   */
  crashReportsEnabled: v.boolean(),
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
  // crash-reporting-and-observability: opt-in (contracts/crash-reporting.json consentModel).
  crashReportsEnabled: false,
};
