// src/ui/a11y/use-announce.ts
// The only caller of AccessibilityInfo's announce functions. Owned by the accessibility-as-code
// skill. It speaks only while VoiceOver or TalkBack runs; call it at most once per user action
// with one short, translated sentence. The announcement is queued behind speech already playing:
// on iOS one made right after a navigation or focus change is otherwise cut off by VoiceOver
// reading the new screen (the queue and priority options are iOS only; Android ignores them).
// On Android 16 announcements are deprecated but still spoken: for status text that changes on
// screen, prefer accessibilityLiveRegion="polite".
import { AccessibilityInfo } from 'react-native';
import { useStore } from 'zustand';

import { systemA11yStore } from './system-a11y-store';

/** Returns announce(text): speaks through the screen reader only when one is running. */
export function useAnnounce(): (text: string) => void {
  const isScreenReaderOn = useStore(systemA11yStore, (state) => state.isScreenReaderOn);
  return (text) => {
    if (!isScreenReaderOn) return;
    AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
  };
}
