// scripts/clock/system-clock.ts
// The only tooling module that reads the wall clock (the ESLint config exempts exactly this file
// from the Node-code clock ban): every other tooling module receives the time as a value.

/** Seconds since the epoch, for the 15-minute App Store Connect JWT. */
export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Today's UTC date as YYYY-MM-DD (the release-age exclude check compares against it). */
export function todayIso(): string {
  return new Date(Date.now()).toISOString().slice(0, 10);
}
