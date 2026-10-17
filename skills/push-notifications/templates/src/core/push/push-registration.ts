// src/core/push/push-registration.ts
// What the app tells its server about this device, and the server calls that carry it. The server
// stores one registration per token: it replaces `previousToken` when the token rotated, ties the
// registration to the signed-in account (and its session, so a revoked session drops it), and writes
// each notification's text in `language`, because the notification is drawn by the OS before any of
// the app's code runs. contracts/push.json describes the same shape for the server's developers.
import type { Result } from '@/core/result';

/** One device's push address, as the server stores it. */
export type PushRegistration = {
  readonly token: string;
  /** 'expo': send through the Expo push service; 'apns' or 'fcm': the server talks to them itself. */
  readonly provider: 'expo' | 'apns' | 'fcm';
  readonly platform: 'ios' | 'android';
  /** The token this one replaces (a rotation), so the server deletes it; null otherwise. */
  readonly previousToken: string | null;
  /** The app's language (a BCP 47 tag such as 'en' or 'ar'): the server writes the text in it. */
  readonly language: string;
};

/** Why a registration call produced no answer. */
export type RegistrarFailure =
  /** No connection, a timeout or a 5xx: the next sync tries again. */
  | { readonly kind: 'unavailable' }
  /** The server refused the request as sent (4xx): retrying the same call will not help. */
  | { readonly kind: 'rejected' };

/**
 * How an unregister call is sent. A sign-out passes the still-valid access token and its deadline's
 * signal (auth-and-secure-storage's ServerSignOutContext; server sign-out steps run before the token
 * wipe): the registrar sends that token as the bearer, so the call never depends on a session that
 * is being torn down. Any other caller passes nothing and the registrar's signed-in client is used.
 */
export type UnregisterOptions = {
  /** Sent as `Authorization: Bearer <accessToken>` on this one call. */
  readonly accessToken?: string;
  readonly signal?: AbortSignal;
};

/**
 * The app's server as push registration sees it; implemented in src/api/push/ over the ApiClient,
 * so this layer never makes a request itself. Neither call rejects.
 */
export type PushRegistrar = {
  readonly register: (
    registration: PushRegistration,
  ) => Promise<Result<undefined, RegistrarFailure>>;
  readonly unregister: (
    token: string,
    options?: UnregisterOptions,
  ) => Promise<Result<undefined, RegistrarFailure>>;
};
