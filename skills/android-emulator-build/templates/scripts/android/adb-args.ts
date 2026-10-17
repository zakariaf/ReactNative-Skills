// scripts/android/adb-args.ts
// The device binding for every adb call: `-s <serial>` before the command, always. Several sessions,
// agents and CI jobs share one machine; adb without -s fails when two devices are attached, and adb
// -e/-d picks "the only emulator/device", which may be another session's.

const SERIAL = /^[A-Za-z0-9][\w.:-]*$/;

/** Throws unless `serial` looks like an adb serial (emulator-5556, a USB serial, host:port). */
export function assertSerial(serial: string): void {
  if (!SERIAL.test(serial)) {
    throw new Error(`"${serial}" is not an adb serial: pass the serial of your own device`);
  }
}

/** ['-s', serial, ...command]: the only way this repo builds adb arguments. */
export function adbArgs(serial: string, ...command: readonly string[]): string[] {
  assertSerial(serial);
  return ['-s', serial, ...command];
}
