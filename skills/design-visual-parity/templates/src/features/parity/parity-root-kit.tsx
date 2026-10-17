// src/features/parity/parity-root-kit.tsx
// The parity harness's root kit (design-visual-parity), a test build's entry of the app's registry
// (src/services/create-root-kits.ts), reached only through the test-only gate as
// TEST_ONLY?.createParityKit, so a production build holds none of it. It fills two root slots: provide,
// where ParityFrameRoot wraps the Stack (the screens' frame request and the launch marker), and
// effects, where ParityLaunchBridge, beside the Stack and inside the navigator, turns iOS's -parity
// launch argument into the launch route once with router.replace (Back never returns to it). On
// Android the launch arrives as a link and the bridge does nothing.
import { router } from 'expo-router';

import { ParityFrameRoot } from './parity-frame-root';
import { ParityLaunchBridge } from './parity-launch-bridge';

import type { RootKit } from '@/services/root-kits/root-kit';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

export type ParityKitOptions = {
  /** How the bridge opens the launch route (default: router.replace). */
  readonly navigate?: (href: Href) => void;
};

const replace = (href: Href): void => {
  router.replace(href);
};

/** The parity harness's kit: the frame root around the Stack and the iOS launch bridge beside it. */
export function createParityKit({ navigate = replace }: ParityKitOptions = {}): RootKit {
  return {
    name: 'parity',
    provide: (children: ReactNode) => <ParityFrameRoot>{children}</ParityFrameRoot>,
    effects: <ParityLaunchBridge navigate={navigate} />,
  };
}
