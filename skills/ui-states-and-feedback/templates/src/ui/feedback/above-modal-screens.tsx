// src/ui/feedback/above-modal-screens.tsx
import { Platform } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

import type { ReactNode } from 'react';

export type AboveModalScreensProps = {
  /**
   * True for a dialog: VoiceOver stays inside and the screen under it is hidden from it. False (the
   * default) for a notice, which must leave the screen reachable.
   */
  readonly isAccessibilityModal?: boolean;
  readonly children: ReactNode;
};

/**
 * On iOS a native-stack screen presented as 'modal', 'formSheet' or 'fullScreenModal' is its own
 * view controller above the root view, so a notice or dialog rendered in the root would sit behind
 * it (and a React Native Modal hosted in the root asks a view controller that is already presenting
 * that screen, which UIKit refuses). react-native-screens' FullWindowOverlay adds its children to
 * the window above every screen presented before it mounted, so mount this only while there is
 * something to show. Its native default is an accessibility modal; a notice turns that off so
 * VoiceOver still reaches the screen. Android keeps every screen in one hierarchy, so the children
 * render in place there.
 */
export function AboveModalScreens({
  isAccessibilityModal = false,
  children,
}: AboveModalScreensProps): ReactNode {
  if (Platform.OS !== 'ios') return children;
  return (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={isAccessibilityModal}>
      {children}
    </FullWindowOverlay>
  );
}
