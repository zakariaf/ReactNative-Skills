// src/services/apple-sign-in/fake-apple-sign-in.tsx
// Scripted AppleSignInPort for tests: choose availability, queue sign-in answers, set the credential
// state, revoke from the test, and press the stand-in button. An unscripted sign-in rejects, so a test
// never passes on an answer it did not choose.
import { View } from 'react-native';

import { ok } from '@/core/result';

import type {
  AppleCredential,
  AppleCredentialState,
  AppleSignInButtonProps,
  AppleSignInFailure,
  AppleSignInPort,
} from './apple-sign-in-port';
import type { Result } from '@/core/result';

export type FakeAppleSignIn = AppleSignInPort & {
  readonly answerSignIn: (answer: Result<AppleCredential, AppleSignInFailure>) => void;
  readonly setCredentialState: (state: AppleCredentialState) => void;
  /** Calls every revoke listener, as iOS does when the person revokes the app in Settings. */
  readonly revoke: () => void;
  /** Presses the rendered stand-in button (its last props); false when none was rendered. */
  readonly pressButton: () => boolean;
};

export type FakeAppleSignInOptions = { readonly isAvailable?: boolean };

export function createFakeAppleSignIn(options: FakeAppleSignInOptions = {}): FakeAppleSignIn {
  const answers: Result<AppleCredential, AppleSignInFailure>[] = [];
  const listeners = new Set<() => void>();
  let state: AppleCredentialState = 'authorized';
  let lastButton: AppleSignInButtonProps | null = null;
  function FakeAppleButton(props: AppleSignInButtonProps): React.JSX.Element {
    lastButton = props;
    return <View testID="apple-sign-in.button" />;
  }
  return {
    Button: FakeAppleButton,
    answerSignIn: (answer) => answers.push(answer),
    setCredentialState: (replacement) => {
      state = replacement;
    },
    revoke: () => {
      for (const listener of listeners) listener();
    },
    pressButton: () => {
      lastButton?.onPress();
      return lastButton !== null;
    },
    isAvailable: () => Promise.resolve(options.isAvailable ?? true),
    signIn: () => {
      const answer = answers.shift();
      return answer === undefined
        ? Promise.reject(new Error('fake Apple sign-in: no answer was scripted'))
        : Promise.resolve(answer);
    },
    credentialState: () => Promise.resolve(ok(state)),
    onRevoked: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
