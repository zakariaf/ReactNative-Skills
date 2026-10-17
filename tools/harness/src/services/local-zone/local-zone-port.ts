// src/services/local-zone/local-zone-port.ts
import type { OffsetAt } from '@/core/reminders/wall-clock';

/**
 * The device's time zone as the reminder planner needs it: the offset from UTC at any instant,
 * daylight saving included. Pure code receives `offsetAt` as a value; it never reads the zone.
 * Adapter: system-local-zone-adapter.ts. Fake: fake-local-zone.ts.
 */
export type LocalZonePort = {
  /** Milliseconds east of UTC at `instantMs`, as the device's current zone rules say. */
  readonly offsetAt: OffsetAt;
};
