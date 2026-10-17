// src/features/reminders/reminder-jitter.ts (example: stateless per-id randomness)
// The Tasks app spreads "daily digest" reminders over a 30-minute window so a server-side digest is
// not hit by every device at 09:00, and so each task keeps the same offset every day and on every
// device (a reinstall or a second phone shows the same time). No state is stored: the offset is a
// pure function of the task id and a frozen salt, mixed by hashU32.
import { hashSeed, hashU32 } from '@/core/rng/sfc32';

/** This feature's salt: frozen on first ship, unique in the app. */
export const REMINDER_JITTER_SALT = 0x51e3_0a77;

/** Minutes (0 … windowMinutes - 1) to add to the reminder time of `taskId`. */
export function reminderOffsetMinutes(taskId: string, windowMinutes: number): number {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1) {
    throw new RangeError(`windowMinutes ${String(windowMinutes)} is not a positive integer`);
  }
  // hashSeed alone is unmixed (neighbouring ids differ by a regular step); hashU32 mixes it with the
  // salt. The modulo bias is below windowMinutes / 2^32: invisible for a 30-minute window.
  return hashU32(hashSeed(taskId), REMINDER_JITTER_SALT) % windowMinutes;
}
