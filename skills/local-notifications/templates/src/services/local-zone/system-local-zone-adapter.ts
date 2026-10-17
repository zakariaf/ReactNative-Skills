// src/services/local-zone/system-local-zone-adapter.ts
// The device zone at sync time, from the engine's getTimezoneOffset. Not verified on devices:
// whether Hermes re-reads the device zone at each call or keeps the zone it started with until the
// app restarts (JavaScript engines have done both). If it keeps it, a foreground sync after a
// flight still plans in the old zone until the next cold start; the zone probe in the skill's
// testing-and-devices.md answers it per SDK. The offset for an arbitrary IANA zone would need
// Intl.DateTimeFormat#formatToParts, which Hermes lacks on iOS without the forced FormatJS
// polyfill and all its zone data, and which the lint keeps in src/i18n, so it is not used here.
import type { LocalZonePort } from '@/services/local-zone/local-zone-port';

const MINUTE_MS = 60_000;

/** Creates the device LocalZonePort. Called once, by the composition root. */
export function createSystemLocalZoneAdapter(): LocalZonePort {
  return {
    // getTimezoneOffset is minutes WEST of UTC (Berlin in summer: -120); the port wants ms east.
    offsetAt: (instantMs) => 0 - new Date(instantMs).getTimezoneOffset() * MINUTE_MS,
  };
}
