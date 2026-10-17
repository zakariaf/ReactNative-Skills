// src/services/push/expo-notifications-push-adapter.ts
// The only file that calls expo-notifications for remote push: the permission, Android channels,
// this device's token and its rotations, taps, and the one foreground handler of the app (which
// decides for the app's own local notifications too: expo-notifications keeps a single handler,
// and a second setNotificationHandler call silently replaces the first). Verified against
// expo-notifications 57.0.21: getLastNotificationResponse() and clearLastNotificationResponse() are
// synchronous (the *Async forms are deprecated); shouldShowAlert is deprecated for
// shouldShowBanner + shouldShowList; with no handler, or one slower than 3 s, a notification that
// arrives in the foreground is not shown.
import {
  AndroidImportance,
  DEFAULT_ACTION_IDENTIFIER,
  IosAuthorizationStatus,
  PermissionStatus,
  addNotificationResponseReceivedListener,
  addPushTokenListener,
  clearLastNotificationResponse,
  getDevicePushTokenAsync,
  getExpoPushTokenAsync,
  getLastNotificationResponse,
  getPermissionsAsync,
  requestPermissionsAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
} from 'expo-notifications';
import { Platform } from 'react-native';

import { OPEN_ACTION } from '@/core/push/push-destination';
import { attemptAsync, err, ok } from '@/core/result';

import { isPushAllowed } from './push-port';

import type {
  NamedPushChannel,
  PushPermission,
  PushPort,
  PushResponse,
  PushToken,
  PushTokenFailure,
  Unsubscribe,
} from './push-port';
import type { ForegroundPresentation } from '@/core/push/foreground-presentation';
import type { Result } from '@/core/result';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type * as Sdk from 'expo-notifications';

/** What the foreground handler knows about a notification that arrived while the app is open. */
export type IncomingNotification = {
  readonly isRemote: boolean;
  /** The notification's custom data, unchecked. */
  readonly data: unknown;
};

/** The SDK's module type, for this adapter's tests (only an adapter may import the SDK, types too). */
export type ExpoNotificationsSdk = typeof Sdk;

export type ExpoNotificationsPushOptions = {
  /** The EAS project id (readEasProjectId); null makes `token()` fail with missing-project-id. */
  readonly projectId: string | null;
  /** 'expo' tokens for the Expo push service, 'native' for a server that calls APNs and FCM itself. */
  readonly provider: 'expo' | 'native';
  /** Decides what a foreground notification shows; must answer at once (the OS waits 3 s at most). */
  readonly present: (notification: IncomingNotification) => ForegroundPresentation;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

const IMPORTANCE: Readonly<Record<NamedPushChannel['importance'], AndroidImportance>> = {
  high: AndroidImportance.HIGH,
  default: AndroidImportance.DEFAULT,
  low: AndroidImportance.LOW,
};

const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ERR_NOTIFICATIONS_NETWORK_ERROR',
  'ERR_NOTIFICATIONS_SERVER_ERROR',
]);

function permissionOf(status: Sdk.NotificationPermissionsStatus): PushPermission {
  const iosStatus: IosAuthorizationStatus | undefined = status.ios?.status;
  if (iosStatus === IosAuthorizationStatus.PROVISIONAL) return 'provisional';
  if (status.granted) return 'granted';
  if (status.status === PermissionStatus.UNDETERMINED) return 'undetermined';
  return status.canAskAgain ? 'denied' : 'blocked';
}

function platformOf(): PushToken['platform'] {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function codeOf(thrown: unknown): string | null {
  if (typeof thrown !== 'object' || thrown === null) return null;
  const code: unknown = Reflect.get(thrown, 'code');
  return typeof code === 'string' ? code : null;
}

function tokenFailureOf(thrown: unknown): PushTokenFailure {
  const code = codeOf(thrown);
  if (code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID') return { kind: 'missing-project-id' };
  if (code !== null && NETWORK_CODES.has(code)) return { kind: 'network-unavailable' };
  return { kind: 'token-unavailable', code };
}

function responseOf(response: Sdk.NotificationResponse): PushResponse {
  const { identifier, content } = response.notification.request;
  const action = response.actionIdentifier;
  return {
    id: identifier,
    action: action === DEFAULT_ACTION_IDENTIFIER ? OPEN_ACTION : action,
    data: content.data ?? null,
  };
}

function incomingOf(notification: Sdk.Notification): IncomingNotification {
  const { trigger, content } = notification.request;
  const isRemote =
    trigger !== null && typeof trigger === 'object' && 'type' in trigger && trigger.type === 'push';
  return { isRemote, data: content.data ?? null };
}

function installForegroundHandler(options: ExpoNotificationsPushOptions): void {
  setNotificationHandler({
    handleNotification: (notification) => {
      const shown = options.present(incomingOf(notification));
      return Promise.resolve({
        shouldShowBanner: shown.banner,
        shouldShowList: shown.list,
        shouldPlaySound: shown.sound,
        shouldSetBadge: shown.badge,
      });
    },
    handleError: (_id, error) => {
      options.errorLog.record(
        'service',
        new Error('foreground notification failed', { cause: error }),
      );
    },
  });
}

/**
 * Turns a native token into what the server stores (a request to the Expo push service for 'expo');
 * never rejects: a failure is a PushTokenFailure.
 */
type TokenFrom = (device: Sdk.DevicePushToken) => Promise<Result<PushToken, PushTokenFailure>>;

/** Turns a native token into what the server stores, through the Expo push service when asked. */
function tokenFrom(
  device: Sdk.DevicePushToken,
  options: ExpoNotificationsPushOptions,
): Promise<PushToken> {
  const platform = platformOf();
  if (options.provider === 'native') {
    const provider = platform === 'ios' ? 'apns' : 'fcm';
    return Promise.resolve({ provider, value: String(device.data), platform });
  }
  if (options.projectId === null) {
    const missing = Object.assign(new Error('no EAS project id'), {
      code: 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID',
    });
    return Promise.reject(missing);
  }
  return getExpoPushTokenAsync({ projectId: options.projectId, devicePushToken: device }).then(
    (expo) => ({ provider: 'expo', value: expo.data, platform }),
  );
}

/**
 * tokenFrom with a memory: an unchanged device token gives the Expo token it gave before, without a
 * request to exp.host. Every launch and every return to the foreground reads the token, and offline
 * that request would fail (and be recorded) although the registration is already up to date.
 */
function rememberingTokenFrom(options: ExpoNotificationsPushOptions): TokenFrom {
  let remembered: { readonly device: string; readonly token: PushToken } | null = null;
  return (device) => {
    const key = String(device.data);
    if (remembered?.device === key) return Promise.resolve(ok(remembered.token));
    return attemptAsync(async () => {
      const token = await tokenFrom(device, options);
      remembered = { device: key, token };
      return token;
    }, tokenFailureOf);
  };
}

/** Reads (or asks for) the permission; an SDK failure is recorded and reads as `fallback`. */
async function permissionFrom(
  read: () => Promise<Sdk.NotificationPermissionsStatus>,
  fallback: PushPermission,
  errorLog: ExpoNotificationsPushOptions['errorLog'],
): Promise<PushPermission> {
  const status = await attemptAsync(read, (thrown) => thrown);
  if (status.ok) return permissionOf(status.value);
  errorLog.record('service', new Error('notification permission failed', { cause: status.error }));
  return fallback;
}

/** Creates or renames the Android channels; never rejects (a failure is recorded). */
async function syncChannels(
  channels: readonly NamedPushChannel[],
  errorLog: ExpoNotificationsPushOptions['errorLog'],
): Promise<void> {
  if (Platform.OS !== 'android') return;
  const done = await attemptAsync(
    async () => {
      for (const channel of channels) {
        await setNotificationChannelAsync(channel.id, {
          name: channel.name,
          description: channel.description,
          importance: IMPORTANCE[channel.importance],
        });
      }
    },
    (thrown) => thrown,
  );
  if (!done.ok) {
    errorLog.record('service', new Error('notification channels failed', { cause: done.error }));
  }
}

async function token(
  options: ExpoNotificationsPushOptions,
  convert: TokenFrom,
): Promise<Result<PushToken, PushTokenFailure>> {
  try {
    if (!isPushAllowed(permissionOf(await getPermissionsAsync())))
      return err({ kind: 'not-allowed' });
    if (options.provider === 'expo' && options.projectId === null) {
      return err({ kind: 'missing-project-id' });
    }
    return await convert(await getDevicePushTokenAsync());
  } catch (thrown: unknown) {
    return err(tokenFailureOf(thrown));
  }
}

function onTokenChange(
  options: ExpoNotificationsPushOptions,
  convert: TokenFrom,
  listener: (token: PushToken) => void,
): Unsubscribe {
  const failed = (cause: unknown): void => {
    options.errorLog.record('service', new Error('push token rotation failed', { cause }));
  };
  const subscription = addPushTokenListener((device) => {
    convert(device).then((converted) => {
      if (converted.ok) listener(converted.value);
      else failed(converted.error);
    }, failed);
  });
  return () => {
    subscription.remove();
  };
}

function onResponse(listener: (response: PushResponse) => void): Unsubscribe {
  const subscription = addNotificationResponseReceivedListener((response) => {
    listener(responseOf(response));
  });
  return () => {
    subscription.remove();
  };
}

function lastResponse(): PushResponse | null {
  const response = getLastNotificationResponse();
  return response === null ? null : responseOf(response);
}

/** Creates the app's PushPort and installs the foreground handler; once, from the composition root. */
export function createExpoNotificationsPushAdapter(
  options: ExpoNotificationsPushOptions,
): PushPort {
  installForegroundHandler(options);
  const convert = rememberingTokenFrom(options);
  return {
    permission: () => permissionFrom(getPermissionsAsync, 'undetermined', options.errorLog),
    requestPermission: () => permissionFrom(requestPermissionsAsync, 'denied', options.errorLog),
    syncChannels: (channels) => syncChannels(channels, options.errorLog),
    token: async () => token(options, convert),
    onTokenChange: (listener) => onTokenChange(options, convert, listener),
    lastResponse,
    clearLastResponse: () => {
      clearLastNotificationResponse();
    },
    onResponse,
  };
}
