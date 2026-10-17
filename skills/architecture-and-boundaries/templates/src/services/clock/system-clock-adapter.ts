// src/services/clock/system-clock-adapter.ts
// The one app file allowed to read Date (the lint config's CLOCK_ADAPTERS exemption).
import type { DateKey } from '@/core/dates/date-key';
import type { ClockPort } from '@/services/clock/clock-port';

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

function localDateKey(date: Date): DateKey {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * Local midnight that starts the next calendar day. The Date constructor applies the time
 * zone and daylight saving (a 23 h or 25 h day); a midnight that does not exist moves on.
 */
function msToNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, next.getTime() - now.getTime());
}

/** Creates the device ClockPort. Called once, by the composition root (createDeviceServices). */
export function createSystemClockAdapter(): ClockPort {
  return {
    nowMs: () => Date.now(),
    today: () => localDateKey(new Date()),
    msUntilNextLocalDay: () => msToNextMidnight(new Date()),
  };
}
