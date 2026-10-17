// scripts/build/emu-ready-signal.ts
// When the launched app counts as ready for its screenshot, and when it has failed. Never a fixed
// sleep: builds and machines vary, so the run polls. The app's process must be alive and its activity
// resumed (not the launcher, not a system dialog). A data signal wins: a logcat line the test build
// writes once its first screen is interactive (contracts/android-emu-build.json readyLog). Without
// one, two byte-identical screenshots in a row mean the screen has settled. A crash report in the
// crash buffer, or a process that is gone, fails the run at once.

/** One poll of the running app. */
export type EmuReadyProbe = {
  /** 1-based poll number, EMU_READY_POLL_MS apart. */
  readonly attempt: number;
  /** `pidof <package>` printed a pid. */
  readonly alive: boolean;
  /** The resumed activity belongs to the app. */
  readonly resumed: boolean;
  /** The crash buffer holds a report for the app. */
  readonly crashed: boolean;
  /** true / false when a readyLog is configured, null when it is not. */
  readonly logMatched: boolean | null;
  /** This screenshot is byte-identical to the previous one. */
  readonly screenUnchanged: boolean;
};

/** What a poll decided. */
export type EmuReadyState =
  | { readonly kind: 'ready'; readonly reason: 'log' | 'stable-screen' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'wait' };

/** Poll every 500 ms... */
export const EMU_READY_POLL_MS = 500;
/** ...for at most 45 s (a cold first launch of a Release build on an emulator takes 3 to 15 s). */
export const EMU_READY_MAX_ATTEMPTS = 90;
/** A still screen counts after at least 3 s. */
const MIN_ATTEMPTS_FOR_STABLE_SCREEN = 6;
/** With a readyLog configured but not seen yet, give the app 8 s before a still screen counts. */
const MIN_ATTEMPTS_WITH_LOG_PENDING = 16;
/** The process may take 2 s to appear after `am start -W` returns on a loaded machine. */
const GRACE_ATTEMPTS_FOR_PROCESS = 4;

const WAIT: EmuReadyState = { kind: 'wait' };

/** Decides one poll: ready (and why), failed (and why), or keep polling. */
export function emuReadyState(probe: EmuReadyProbe): EmuReadyState {
  if (probe.crashed) return { kind: 'failed', reason: 'the app crashed (see the crash report)' };
  if (!probe.alive) {
    return probe.attempt >= GRACE_ATTEMPTS_FOR_PROCESS
      ? { kind: 'failed', reason: 'the app process is not running' }
      : WAIT;
  }
  if (!probe.resumed) return WAIT;
  if (probe.logMatched === true) return { kind: 'ready', reason: 'log' };
  const minAttempts =
    probe.logMatched === null ? MIN_ATTEMPTS_FOR_STABLE_SCREEN : MIN_ATTEMPTS_WITH_LOG_PENDING;
  return probe.attempt >= minAttempts && probe.screenUnchanged
    ? { kind: 'ready', reason: 'stable-screen' }
    : WAIT;
}
