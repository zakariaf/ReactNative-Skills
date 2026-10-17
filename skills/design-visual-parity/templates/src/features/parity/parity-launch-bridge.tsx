// src/features/parity/parity-launch-bridge.tsx
// iOS only: turns the -parity launch argument into the launch route, once, when the navigator is up.
// The root stack renders it as TEST_ONLY?.ParityLaunchBridge with router.replace; on Android the
// launch arrives as a link and the bridge does nothing. router.replace throws ("Attempted to navigate
// before mounting the Root Layout component") until the root navigator is ready, and effects run
// child-first, so a first-mount effect can run before it is; the bridge looks again every frame
// until the navigation container reports ready, then navigates once.
import { useNavigationContainerRef } from 'expo-router';
import { useEffect, useRef } from 'react';

import { parityLaunchHref, readParityLaunchArgument } from './read-parity-launch';

import type { Href } from 'expo-router';

/** How long the bridge waits before looking again while the navigator is not ready (ms). */
const READY_POLL_MS = 16;
/** It stops after this many looks (about 5 s); the capture then fails screen-not-reached. */
const READY_POLL_LIMIT = 300;

export type ParityLaunchBridgeProps = {
  readonly navigate: (href: Href) => void;
  /** The launch argument's query (default: React Native's Settings on iOS). */
  readonly readArgument?: () => string | null;
  /** Whether the root navigator can navigate yet (default: the navigation container's isReady). */
  readonly isReady?: () => boolean;
};

export function ParityLaunchBridge({
  navigate,
  readArgument = readParityLaunchArgument,
  isReady,
}: ParityLaunchBridgeProps): null {
  const navigationRef = useNavigationContainerRef();
  const hasRun = useRef(false);
  useEffect(() => {
    if (hasRun.current) return undefined;
    const query = readArgument();
    if (query === null) {
      hasRun.current = true;
      return undefined;
    }
    const ready = isReady ?? ((): boolean => navigationRef.isReady());
    let timer: ReturnType<typeof setTimeout> | null = null;
    let looks = 0;
    const attempt = (): void => {
      timer = null;
      if (hasRun.current) return;
      if (ready()) {
        hasRun.current = true;
        navigate(parityLaunchHref(query));
        return;
      }
      looks += 1;
      if (looks < READY_POLL_LIMIT) timer = setTimeout(attempt, READY_POLL_MS);
    };
    attempt();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [navigate, readArgument, isReady, navigationRef]);
  return null;
}
