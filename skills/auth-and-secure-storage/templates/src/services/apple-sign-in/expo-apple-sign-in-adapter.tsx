// src/services/apple-sign-in/expo-apple-sign-in-adapter.tsx
// The AppleSignInPort on expo-apple-authentication, and the only app file that imports it. Each
// attempt makes a fresh random nonce: its SHA-256 goes to Apple, which signs it into the identity
// token, and the raw value goes to the app's server, which hashes it and compares, so a captured
// identity token cannot be replayed. Apple sends the name and email on the first sign-in only. The
// button is Apple's ASAuthorizationAppleIDButton: approved, localized by iOS and accessible as it is.
import {
  addRevokeListener,
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
  AppleAuthenticationCredentialState,
  AppleAuthenticationScope,
  formatFullName,
  getCredentialStateAsync,
  isAvailableAsync,
  signInAsync,
} from 'expo-apple-authentication';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { StyleSheet } from 'react-native';

import { attemptAsync, err, ok } from '@/core/result';

import type {
  AppleCredential,
  AppleCredentialState,
  AppleSignInButtonProps,
  AppleSignInFailure,
  AppleSignInPort,
} from './apple-sign-in-port';
import type { Result } from '@/core/result';
import type { AppleAuthenticationCredential } from 'expo-apple-authentication';

/** expo-apple-authentication rejects with this code when the person closes the sheet. */
export const APPLE_CANCELLED_CODE = 'ERR_REQUEST_CANCELED';

const STATES: Readonly<Record<AppleAuthenticationCredentialState, AppleCredentialState>> = {
  [AppleAuthenticationCredentialState.AUTHORIZED]: 'authorized',
  [AppleAuthenticationCredentialState.REVOKED]: 'revoked',
  [AppleAuthenticationCredentialState.NOT_FOUND]: 'not-found',
  [AppleAuthenticationCredentialState.TRANSFERRED]: 'transferred',
};

export function appleFailureOf(thrown: unknown): AppleSignInFailure {
  const code = (thrown as { readonly code?: unknown } | null)?.code;
  if (code === APPLE_CANCELLED_CODE) return { kind: 'cancelled' };
  return { kind: 'failed', code: typeof code === 'string' ? code : 'ERR_UNKNOWN' };
}

function nameOf(credential: AppleAuthenticationCredential): string | null {
  if (credential.fullName === null) return null;
  const formatted = formatFullName(credential.fullName).trim();
  return formatted === '' ? null : formatted;
}

type NoncedCredential = AppleAuthenticationCredential & { readonly rawNonce: string };

/** False when the platform has no native Sign in with Apple, or the check itself failed. */
async function isNativeAvailable(): Promise<boolean> {
  const available = await attemptAsync(isAvailableAsync, () => false);
  return available.ok && available.value;
}

/** Apple's sheet with a fresh nonce; the raw nonce rides along for the server. */
function requestCredential(): Promise<Result<NoncedCredential, AppleSignInFailure>> {
  return attemptAsync(async () => {
    const rawNonce = randomUUID();
    const hashed = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce);
    const credential = await signInAsync({
      nonce: hashed,
      requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
    });
    return { ...credential, rawNonce };
  }, appleFailureOf);
}

async function signInWithApple(): Promise<Result<AppleCredential, AppleSignInFailure>> {
  try {
    if (!(await isNativeAvailable())) return err({ kind: 'unavailable' });
    const answer = await requestCredential();
    if (!answer.ok) return answer;
    const { user, identityToken, authorizationCode, email, rawNonce } = answer.value;
    // signInAsync already refuses an answer without these; the types still allow null.
    if (identityToken === null || authorizationCode === null) {
      return err({ kind: 'failed', code: 'ERR_REQUEST_FAILED' });
    }
    const fullName = nameOf(answer.value);
    return ok({ user, identityToken, authorizationCode, rawNonce, fullName, email });
  } catch (thrown) {
    return err(appleFailureOf(thrown));
  }
}

/** Black on a light screen, white on a dark one (Apple's Human Interface Guidelines). */
function AppleButton({
  onPress,
  scheme,
  cornerRadius,
  height,
}: AppleSignInButtonProps): React.JSX.Element {
  return (
    <AppleAuthenticationButton
      buttonType={AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={
        scheme === 'dark'
          ? AppleAuthenticationButtonStyle.WHITE
          : AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={cornerRadius}
      style={[styles.button, { height }]}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  button: { width: '100%' },
});

export function createExpoAppleSignInAdapter(): AppleSignInPort {
  return {
    Button: AppleButton,
    isAvailable: isNativeAvailable,
    signIn: signInWithApple,
    credentialState: async (user) => {
      const state = await attemptAsync(() => getCredentialStateAsync(user), appleFailureOf);
      return state.ok ? ok(STATES[state.value]) : state;
    },
    onRevoked: (listener) => {
      const subscription = addRevokeListener(listener);
      return () => {
        subscription.remove();
      };
    },
  };
}
