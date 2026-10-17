// src/services/apple-sign-in/apple-sign-in-port.ts
// Sign in with Apple, as the app needs it: Apple's own button, the native sheet on iOS, a credential
// the app's server verifies and trades for the app's own session tokens, and the credential checks
// Apple asks for (a revoked Apple ID signs the person out). Android and web have no native sheet:
// isAvailable() is false there, and the provider's web flow runs through the OauthPort instead. The
// button travels through the port because only the adapter may import the SDK. Adapter:
// expo-apple-sign-in-adapter.tsx (expo-apple-authentication). Fake: fake-apple-sign-in.tsx.
import type { Result } from '@/core/result';
import type { ComponentType } from 'react';

/** What a screen passes to Apple's button (its look follows the app's colour scheme). */
export type AppleSignInButtonProps = {
  readonly onPress: () => void;
  readonly scheme: 'light' | 'dark';
  readonly cornerRadius: number;
  /** At least the minimum touch height (44). */
  readonly height: number;
};

/** What Apple returned, for the app's server to verify. Never stored on the device. */
export type AppleCredential = {
  /** Apple's stable id for this person and this developer team: the server's account key. */
  readonly user: string;
  /** A JWT the server verifies: Apple's signature, `aud` = the bundle id, `nonce` = SHA-256(rawNonce). */
  readonly identityToken: string;
  /** A one-time code the server exchanges at Apple (it needs Apple's refresh token to revoke later). */
  readonly authorizationCode: string;
  /** The random value whose SHA-256 went to Apple; the server hashes it and compares. */
  readonly rawNonce: string;
  /** Only on this person's first sign-in to the app (null afterwards): the server saves it at once. */
  readonly fullName: string | null;
  /** First sign-in only; may be a private relay address (…@privaterelay.appleid.com). */
  readonly email: string | null;
};

export type AppleSignInFailure =
  /** The person closed the sheet: show nothing. */
  | { readonly kind: 'cancelled' }
  /** No native Sign in with Apple here (Android, web, an old OS): offer the web flow. */
  | { readonly kind: 'unavailable' }
  /** Apple refused or the answer was incomplete; `code` is Apple's (ERR_REQUEST_FAILED, ...). */
  | { readonly kind: 'failed'; readonly code: string };

/** Apple's view of a credential: `revoked` (the person stopped using Apple ID with the app) signs out. */
export type AppleCredentialState = 'authorized' | 'revoked' | 'not-found' | 'transferred';

/** Never rejects: every outcome is a Result. */
export type AppleSignInPort = {
  /** Apple's approved, localized "Sign in with Apple" button; render it only while isAvailable(). */
  readonly Button: ComponentType<AppleSignInButtonProps>;
  readonly isAvailable: () => Promise<boolean>;
  /** Shows Apple's sheet with a fresh nonce, asking for the name and email (given once). */
  readonly signIn: () => Promise<Result<AppleCredential, AppleSignInFailure>>;
  /** Checked at launch for a person who signed in with Apple. */
  readonly credentialState: (
    user: string,
  ) => Promise<Result<AppleCredentialState, AppleSignInFailure>>;
  /** Called when the person revokes the app in Settings while it runs; returns the unsubscribe. */
  readonly onRevoked: (listener: () => void) => () => void;
};
