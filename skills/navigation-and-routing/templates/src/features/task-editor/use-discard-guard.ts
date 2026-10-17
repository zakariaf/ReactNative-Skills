// src/features/task-editor/use-discard-guard.ts
// Keeps a screen with unsaved work open when something tries to remove it: the header back button,
// the iOS back swipe, Android's back button or gesture, a router.back() or dismissTo() from code.
// usePreventRemove sees every one of them (a BackHandler listener sees only Android's button). The
// blocked action is kept; the screen shows its "Discard changes?" dialog while isPromptOpen, and
// discard() replays the action. leave() is for a deliberate exit after saving: the state that says
// "unsaved" has not re-rendered yet when the screen navigates, so the guard lets the removal that
// go() causes through. go() should remove this screen (back, dismissTo, replace); if it pushes a
// screen on top instead, the guard arms again when this screen is focused once more. It cannot see the app being killed: saving the draft as it changes is what keeps work.
// Expo SDK 57: usePreventRemove comes from expo-router/react-navigation and its callback receives
// the blocked action; from SDK 58 import it from expo-router and continue with the callback's
// repeat() (navigation-and-routing, "Back handling (iOS and Android)").
import { useIsFocused, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';

import type { NavigationAction } from 'expo-router/react-navigation';

export type DiscardGuard = {
  /** A removal was blocked: show the screen's discard dialog. */
  readonly isPromptOpen: boolean;
  /** Closes the dialog and stays on the screen. */
  readonly keepEditing: () => void;
  /** Throws the work away and carries out the blocked removal. */
  readonly discard: () => void;
  /** A deliberate exit (after a save): runs `go`, letting the removal it dispatches through. */
  readonly leave: (go: () => void) => void;
};

/** Blocks removal of the current screen while `hasUnsavedChanges`. */
export function useDiscardGuard(hasUnsavedChanges: boolean): DiscardGuard {
  const navigation = useNavigation();
  const [blocked, setBlocked] = useState<NavigationAction | null>(null);
  const isLeavingRef = useRef(false);
  const isFocused = useIsFocused();
  // Back on this screen after a leave() that kept it in the stack: guard again.
  useEffect(() => {
    if (isFocused) isLeavingRef.current = false;
  }, [isFocused]);
  usePreventRemove(hasUnsavedChanges, ({ data }) => {
    if (isLeavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    setBlocked(data.action);
  });
  return {
    isPromptOpen: blocked !== null,
    keepEditing: () => {
      setBlocked(null);
    },
    discard: () => {
      if (blocked === null) return;
      setBlocked(null);
      isLeavingRef.current = true;
      navigation.dispatch(blocked);
    },
    leave: (go) => {
      isLeavingRef.current = true;
      go();
    },
  };
}
