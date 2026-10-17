// src/ui/a11y/system-a11y-store.ts
// The one mirror of the phone's accessibility switches (VoiceOver or TalkBack running, reduce
// motion, Bold Text). Owned by the accessibility-as-code skill. Every other file reads this store;
// only watchSystemA11y() talks to AccessibilityInfo, so the app holds one subscription per switch.
// A switch the app needs that is not mirrored yet is added here, never read in a screen.
import { AccessibilityInfo, Platform } from 'react-native';
import { createStore } from 'zustand/vanilla';

export type SystemA11yState = {
  /** iOS: Settings > Accessibility > Motion > Reduce Motion. Android: Remove animations. */
  readonly isReduceMotionOn: boolean;
  /** VoiceOver (iOS) or TalkBack (Android) is running. */
  readonly isScreenReaderOn: boolean;
  /**
   * iOS: Settings > Accessibility > Display & Text Size > Bold Text. Always false on Android, where
   * React Native 0.86 reports no bold-text setting. An app with custom fonts reads it in its text
   * primitive to step each weight up (custom font files do not get heavier on their own).
   */
  readonly isBoldTextOn: boolean;
};

/** Mirror of the OS accessibility switches. Not persisted; filled by watchSystemA11y(). */
export const systemA11yStore = createStore<SystemA11yState>()(() => ({
  isReduceMotionOn: false,
  isScreenReaderOn: false,
  isBoldTextOn: false,
}));

function setMotion(isOn: boolean): void {
  systemA11yStore.setState({ isReduceMotionOn: isOn });
}

function setReader(isOn: boolean): void {
  systemA11yStore.setState({ isScreenReaderOn: isOn });
}

function setBoldText(isOn: boolean): void {
  systemA11yStore.setState({ isBoldTextOn: isOn });
}

type SwitchWatch = {
  /** Adds the OS change listener and returns its subscription. */
  readonly subscribe: (listener: (isOn: boolean) => void) => { readonly remove: () => void };
  /** Reads the switch's current value once. */
  readonly readNow: () => Promise<boolean>;
  /** Writes the value into the store. */
  readonly write: (isOn: boolean) => void;
};

/**
 * Follows one switch: subscribes first, then reads its current value. The first read writes only
 * while no change event has arrived and the watch still runs, so a slow read never overwrites a
 * newer event and nothing writes after the returned stop function ran.
 */
function followSwitch(watch: SwitchWatch, onError: (error: unknown) => void): () => void {
  let hasHeardChange = false;
  let isStopped = false;
  const subscription = watch.subscribe((isOn) => {
    hasHeardChange = true;
    watch.write(isOn);
  });
  watch
    .readNow()
    .then((isOn) => {
      if (!hasHeardChange && !isStopped) {
        watch.write(isOn);
      }
    })
    .catch((error: unknown) => {
      if (!isStopped) {
        onError(error);
      }
    });
  return () => {
    isStopped = true;
    subscription.remove();
  };
}

/**
 * The first read of a switch react-native-web cannot answer: on the web it answers true for
 * isScreenReaderEnabled on every visitor and has no isBoldTextEnabled (calling it throws), so both
 * read as off there; with the reader off, useAnnounce never calls the announce API the web lacks.
 */
export function readUnlessWeb(os: string, read: () => Promise<boolean>): Promise<boolean> {
  return os === 'web' ? Promise.resolve(false) : read();
}

const SWITCHES: readonly SwitchWatch[] = [
  {
    subscribe: (listener) => AccessibilityInfo.addEventListener('reduceMotionChanged', listener),
    readNow: () => AccessibilityInfo.isReduceMotionEnabled(),
    write: setMotion,
  },
  {
    subscribe: (listener) => AccessibilityInfo.addEventListener('screenReaderChanged', listener),
    readNow: () => readUnlessWeb(Platform.OS, () => AccessibilityInfo.isScreenReaderEnabled()),
    write: setReader,
  },
  {
    subscribe: (listener) => AccessibilityInfo.addEventListener('boldTextChanged', listener),
    readNow: () => readUnlessWeb(Platform.OS, () => AccessibilityInfo.isBoldTextEnabled()),
    write: setBoldText,
  },
];

/**
 * Starts listening and returns the unsubscribe function. Call it once, from the root layout's
 * mount effect: useEffect(() => watchSystemA11y(reportError), []).
 */
export function watchSystemA11y(onError: (error: unknown) => void): () => void {
  const stops = SWITCHES.map((watch) => followSwitch(watch, onError));
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}
