// scripts/e2e/e2e-device.ts
// What the E2E runner and the screenshot capture need from one device, on either platform: an iOS
// simulator (ios-device.ts, targeted by UDID) or an Android emulator (android-device.ts, targeted by
// its adb serial). Both are named <prefix>-<purpose> and belong to this repo; nothing here ever
// reaches the booted simulator or "the only" emulator, which may be another session's.

export const PLATFORMS = ['ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The two form factors of a run: the phone for flows, the tablet for large text and screenshots. */
export const FORM_FACTORS = ['phone', 'tablet'] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export type Appearance = 'light' | 'dark';

/**
 * The text sizes a run uses: the system default, and the largest system size (iOS AX5, about 3.6x
 * in React Native's font scale; Android font scale 2.0).
 */
export type TextSize = 'default' | 'largest';

/** A Release build of the app on disk, read from the build itself (never from the repo config). */
export type BuiltApp = {
  readonly platform: Platform;
  readonly path: string;
  /** iOS bundle id or Android package of the variant that was built. */
  readonly id: string;
  /** The URL scheme the debug link uses (the first one in the embedded app config). */
  readonly scheme: string;
  /** iOS CFBundleExecutable (the process name the socket sampler looks for); the package on Android. */
  readonly executable: string;
  /** A Release build embeds its JavaScript; a Debug build loads it from Metro. */
  readonly hasEmbeddedBundle: boolean;
  /** The embedded app config's `extra` (expo.extra), for contracts/e2e.json buildExtra. */
  readonly extra: Readonly<Record<string, unknown>>;
};

/** One dedicated device, ready for Maestro (its id goes into maestroGlobalArgs). */
export type E2eDevice = {
  readonly platform: Platform;
  /** The device's name: <prefix>-<purpose> (an iOS simulator or an Android virtual device). */
  readonly name: string;
  /** The simulator's UDID or the emulator's adb serial. */
  readonly id: string;
  readonly install: (app: BuiltApp) => void;
  /** A clean, fixed status bar: 9:41, full signal and battery, no notifications. */
  readonly pinStatusBar: () => void;
  readonly setTextSize: (size: TextSize) => void;
  readonly setAppearance: (appearance: Appearance) => void;
  /** Stops the app if it runs (not running is fine). */
  readonly terminate: (app: BuiltApp) => void;
};

export const isPlatform = (value: string): value is Platform =>
  (PLATFORMS as readonly string[]).includes(value);

export const isFormFactor = (value: string): value is FormFactor =>
  (FORM_FACTORS as readonly string[]).includes(value);

/** A device purpose: e2e-phone, e2e-tablet, shots-phone; with --sim <purpose>: <purpose>[-tablet]. */
export function devicePurpose(
  base: 'e2e' | 'shots',
  formFactor: FormFactor,
  sim: string | undefined,
): string {
  if (sim === undefined) return `${base}-${formFactor}`;
  return formFactor === 'phone' ? sim : `${sim}-tablet`;
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The device prefix from the package name: '@acme/tasks-app' -> 'tasks-app'. */
export function devicePrefixOf(packageName: string): string {
  const prefix = (packageName.split('/').at(-1) ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (prefix === '') throw new Error(`cannot derive a device prefix from "${packageName}"`);
  return prefix;
}

/** `tasks` + `e2e-phone` -> `tasks-e2e-phone` (an iOS simulator or an Android AVD). */
export function deviceName(prefix: string, purpose: string): string {
  for (const part of [prefix, purpose]) {
    if (!KEBAB.test(part)) throw new Error(`device name part "${part}" must be kebab-case`);
  }
  return `${prefix}-${purpose}`;
}
