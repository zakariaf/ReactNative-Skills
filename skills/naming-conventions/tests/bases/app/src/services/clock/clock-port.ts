// src/services/clock/clock-port.ts
/** The one source of "now" for app code. */
export type ClockPort = { readonly now: () => number };
