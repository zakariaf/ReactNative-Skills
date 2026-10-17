// src/stores/settings/settings-codec.ts
// Pure: the saved text to Settings and back. Decoding works field by field: a field that is
// missing (saved before it existed) takes its first-launch value quietly, and a field whose value
// this version cannot read falls back alone and is reported, so one bad value never resets every
// setting and the text an older version saved always loads. Unknown fields are dropped.
import * as v from 'valibot';

import { attempt } from '@/core/result';

import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from './settings-schema';

import type { Settings } from './settings-schema';

export type SettingKey = keyof Settings;

export type DecodedSettings = {
  readonly settings: Settings;
  /** Saved fields that held a value this version cannot read; each one fell back to its default. */
  readonly repairedKeys: readonly SettingKey[];
};

function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS_SCHEMA.entries, key);
}

/** The fields in schema order. */
export const SETTING_KEYS: readonly SettingKey[] = Object.keys(SETTINGS_SCHEMA.entries).filter(
  isSettingKey,
);

const TOLERANT_SETTINGS = v.object({
  language: v.fallback(SETTINGS_SCHEMA.entries.language, DEFAULT_SETTINGS.language),
  digits: v.fallback(SETTINGS_SCHEMA.entries.digits, DEFAULT_SETTINGS.digits),
  theme: v.fallback(SETTINGS_SCHEMA.entries.theme, DEFAULT_SETTINGS.theme),
  reduceMotion: v.fallback(SETTINGS_SCHEMA.entries.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
  hapticsEnabled: v.fallback(
    SETTINGS_SCHEMA.entries.hapticsEnabled,
    DEFAULT_SETTINGS.hapticsEnabled,
  ),
  soundEnabled: v.fallback(SETTINGS_SCHEMA.entries.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
  soundVolume: v.fallback(SETTINGS_SCHEMA.entries.soundVolume, DEFAULT_SETTINGS.soundVolume),
} satisfies Record<SettingKey, v.GenericSchema>);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed JSON object, or null when the text is not a JSON object. */
function parseObject(text: string): Record<string, unknown> | null {
  const parsed = attempt(
    (): unknown => JSON.parse(text),
    () => ({ kind: 'settings-text-unreadable' }) as const,
  );
  return parsed.ok && isRecord(parsed.value) ? parsed.value : null;
}

/** null (nothing saved yet) is the first launch: every default, nothing repaired. */
export function decodeSettings(text: string | null): DecodedSettings {
  if (text === null) return { settings: DEFAULT_SETTINGS, repairedKeys: [] };
  const raw = parseObject(text);
  if (raw === null) return { settings: DEFAULT_SETTINGS, repairedKeys: SETTING_KEYS };
  const repairedKeys = SETTING_KEYS.filter(
    (key) => Object.hasOwn(raw, key) && !v.is(SETTINGS_SCHEMA.entries[key], raw[key]),
  );
  const decoded = v.safeParse(TOLERANT_SETTINGS, raw);
  return decoded.success
    ? { settings: decoded.output, repairedKeys }
    : { settings: DEFAULT_SETTINGS, repairedKeys: SETTING_KEYS };
}

export function encodeSettings(settings: Settings): string {
  return JSON.stringify(settings);
}
