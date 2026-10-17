// src/ui/press-feedback-context.tsx
// How a press sounds or feels, without a button reaching for the services: the app root provides it
// once (for example () => { feedback.play('tap'); } over the audio and haptics ports); the press
// surfaces read it with usePressFeedback and run it on press (a switch plays its toggle feedback
// itself). It imports only React, so src/ui stays presentational (it may not import src/services).
import { createContext, use } from 'react';

import type { ReactNode } from 'react';

/** Silent by default, so component tests without the provider need no audio or haptics fake. */
const PressFeedbackContext = createContext<() => void>(() => undefined);

/** False by default: without an app sound, Android keeps its own click (the Touch sounds setting). */
const PressSoundContext = createContext(false);

export type PressFeedbackProviderProps = {
  readonly onPress: () => void;
  /**
   * True when onPress plays a sound (a tap moment, audio-and-haptics-feedback). The press surfaces
   * then pass android_disableSound, or Android plays its system click and the app's sound together.
   * Leave it out for haptics only: the person's Touch sounds setting keeps its click.
   */
  readonly playsSound?: boolean;
  readonly children: ReactNode;
};

export function PressFeedbackProvider(props: PressFeedbackProviderProps): ReactNode {
  return (
    <PressFeedbackContext value={props.onPress}>
      <PressSoundContext value={props.playsSound === true}>{props.children}</PressSoundContext>
    </PressFeedbackContext>
  );
}

/** The feedback to run on every press (a no-op outside the provider). */
export function usePressFeedback(): () => void {
  return use(PressFeedbackContext);
}

/** Whether the press feedback plays its own sound: the value for Pressable's android_disableSound. */
export function usePressFeedbackPlaysSound(): boolean {
  return use(PressSoundContext);
}
