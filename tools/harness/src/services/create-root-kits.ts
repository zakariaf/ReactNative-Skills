// src/services/create-root-kits.ts
// device-only: covered by the app launch on a device (it only composes the kits, each tested beside its own files)
// The app's one registry of optional root kits: the only file a kit edits to join startup. AppRoot's
// startApp calls prepareRootKits first (the ports every reader uses: a test build swaps in its
// simulated clock and network there), then createRootKits once per JS run, after the data layer, the
// settings and the stores, and the root skeleton hands each kit's parts to its slots
// (src/services/root-kits/root-kit.ts): error forwarding, blocking startup tasks, flushers, the motion
// config, the test-build route group, providers and effects around the root Stack. A kit's skill
// shows its line (crash reporting, analytics, local and push notifications, the test build's debug and
// parity kits); the root files stay unchanged. A test-only kit is reached only through the
// test-only gate (TEST_ONLY is null in a production build, so none ships). Part of the composition
// root: it may create adapters (no I/O), so it runs only from startApp, never at import time.
import { readCrashReportingConfig } from '@/config/crash-reporting-config';
import { currentAppVariant } from '@/config/current-app-variant';
import { foregroundPresentation } from '@/core/push/foreground-presentation';
import { parsePushData } from '@/core/push/push-message';
import { err, ok } from '@/core/result';
import { createTranslateNow } from '@/i18n/translate-now';
import { createAnalyticsKit } from '@/services/analytics/analytics-root-kit';
import { createAnalytics } from '@/services/analytics/create-analytics';
import { createKvAnalyticsConsentAdapter } from '@/services/analytics/kv-analytics-consent-adapter';
import {
  createCrashReportingKit,
  fixedCrashConsent,
} from '@/services/crash-reporter/crash-reporting-root-kit';
import { createSentryCrashReporterAdapter } from '@/services/crash-reporter/sentry-crash-reporter-adapter';
import { createExpoLocalNotificationsAdapter } from '@/services/local-notifications/expo-local-notifications-adapter';
import { createLocalNotificationsKit } from '@/services/local-notifications/local-notifications-root-kit';
import { createReminderSync } from '@/services/local-notifications/reminder-sync';
import { reminderTexts } from '@/services/local-notifications/reminder-texts';
import { createSystemLocalZoneAdapter } from '@/services/local-zone/system-local-zone-adapter';
import { createSystemSettingsAdapter } from '@/services/permissions/system-settings-adapter';
import { createExpoNotificationsPushAdapter } from '@/services/push/expo-notifications-push-adapter';
import { createKvPushRecordAdapter } from '@/services/push/kv-push-record-adapter';
import { createPushRegistration } from '@/services/push/push-registration';
import { createPushKit, NO_PUSH_ACCOUNT } from '@/services/push/push-root-kit';
import { readEasProjectId } from '@/services/push/read-eas-project-id';
import { TEST_ONLY } from '@/test-only';

import type { PushRegistrar } from '@/core/push/push-registration';
import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';
import type { TestOnlyApi } from '@/test-only';

/** A test build's hooks (debug-menu-and-test-hooks): the switches store and the swapped ports. */
type TestHooks = ReturnType<TestOnlyApi['createTestHooks']>;

/**
 * What prepareRootKits hands startApp: the ports every reader uses from then on, and a test build's
 * hooks for its debug kit (null in production, where TEST_ONLY is null).
 */
export type PreparedKits = { readonly services: Services; readonly testHooks: TestHooks | null };

/**
 * Startup step E1, before the data layer opens and before anything reads a port. A test build first
 * installs the network guard (privacy-and-store-declarations: every JavaScript request is blocked and
 * recorded, the harness has no API), then wraps the device services once: the simulated clock and,
 * once the services hold one, the simulated connectivity, driven by the debug switches (a
 * test-only key-value read). Production gets the device services unchanged.
 */
export function prepareRootKits(device: Services): PreparedKits {
  TEST_ONLY?.installNetworkGuard(globalThis, {
    onAttempt: ({ kind, target }) => {
      device.errorLog.record('service', new Error(`test build blocked a ${kind} to ${target}`));
    },
    isDev: currentAppVariant() === 'development',
  });
  // No settings store yet: lang= and theme= links are refused until a DebugSettingsTarget exists.
  const testHooks =
    TEST_ONLY?.createTestHooks({
      services: device,
      storage: TEST_ONLY.createKvDebugStorageAdapter(),
      settings: null,
    }) ?? null;
  return { services: testHooks?.services ?? device, testHooks };
}

/**
 * What startApp hands the registry: the prepared ports, the open data layer, this run's language and
 * the prepared kits. An app that opens settings or stores in startApp adds them here and to the call.
 */
export type RootKitsInput = {
  readonly services: Services;
  readonly data: AppData;
  readonly language: Language;
  readonly prepared: PreparedKits;
};

/**
 * The harness has no push server yet: every registration call answers 'unavailable' (recorded and
 * tried again at the next launch, foreground or rotation), so no token ever leaves the device. A
 * server replaces it with push-notifications' registrar over the ApiClient (examples/push-registrar.ts).
 */
const NO_PUSH_SERVER: PushRegistrar = {
  register: () => Promise.resolve(err({ kind: 'unavailable' })),
  unregister: () => Promise.resolve(err({ kind: 'unavailable' })),
};

type KitDeps = RootKitsInput & { readonly onError: (error: unknown) => void };

/**
 * Crash reporting (crash-reporting-and-observability): the DSN comes from the build's EAS
 * environment, and the harness has none, so the adapter stays off. The contract is opt-in and the
 * harness has no settings row for crash reports yet, so the choice is a fixed no.
 */
function crashReportingKit({ onError }: KitDeps): RootKit {
  const crashReporter = createSentryCrashReporterAdapter(readCrashReportingConfig(), onError);
  return createCrashReportingKit({ crashReporter, consent: fixedCrashConsent(false) });
}

/**
 * Analytics (analytics-and-consent): the harness has no vendor yet (contracts/analytics.json sdk
 * "none"), so every build is off and createSdk is never reached; the gate keeps the consent record
 * and drops every event, screen views included.
 */
function analyticsKit({ services, data, onError }: KitDeps): RootKit {
  const analytics = createAnalytics({
    mode: 'off',
    store: createKvAnalyticsConsentAdapter(),
    nowMs: services.clock.nowMs,
    onError,
    createSdk: () => {
      throw new Error('no analytics vendor: contracts/analytics.json says sdk "none"');
    },
  });
  return createAnalyticsKit({ analytics, errorLog: data.errorLog });
}

/**
 * Push (push-notifications): the adapter installs the app's one foreground handler, whose policy
 * covers local reminders too. No accounts in the harness (contracts/push.json requiresAccount false),
 * and one screen, which every destination opens (an app maps each destination to its route).
 */
function pushKit({ services, data, language }: KitDeps): RootKit {
  const push = createExpoNotificationsPushAdapter({
    projectId: readEasProjectId(),
    provider: 'expo',
    present: ({ isRemote, data: payload }) =>
      foregroundPresentation({ isRemote, message: parsePushData(payload) }),
    errorLog: data.errorLog,
  });
  const registration = createPushRegistration({
    push,
    registrar: NO_PUSH_SERVER,
    record: createKvPushRecordAdapter({ errorLog: data.errorLog }),
    clock: services.clock,
    errorLog: data.errorLog,
    requiresAccount: false,
    language: () => language,
  });
  return createPushKit({
    push,
    registration,
    errorLog: data.errorLog,
    account: NO_PUSH_ACCOUNT,
    // The way back from 'blocked' (permissions-and-system-prompts' system settings adapter).
    openSettings: createSystemSettingsAdapter({ errorLog: data.errorLog }).openSettings,
    hrefForDestination: () => '/',
  });
}

/**
 * Local reminders (local-notifications): push owns the foreground handler, so this adapter installs
 * none. The harness has no reminders feature yet: no rows, so the sync plans nothing (and cancels a
 * stale reminder notification), and a tapped reminder opens the home screen.
 */
function localNotificationsKit({ services, data }: KitDeps): RootKit {
  const notifications = createExpoLocalNotificationsAdapter({
    errorLog: data.errorLog,
    installForegroundHandler: false,
  });
  const sync = createReminderSync({
    notifications,
    zone: createSystemLocalZoneAdapter(),
    clock: services.clock,
    errorLog: data.errorLog,
    loadReminders: () => Promise.resolve(ok([])),
    texts: reminderTexts,
    translateNow: () =>
      createTranslateNow((error) => {
        data.errorLog.record('i18n', error);
      }),
  });
  return createLocalNotificationsKit({ notifications, sync, hrefForReminder: () => '/' });
}

/**
 * The test build's kits (debug-menu-and-test-hooks, design-visual-parity), none in production: the
 * debug kit (TestHooksRoot in MotionConfig's place, the (debug) route group opened) over the hooks
 * prepareRootKits made, and the parity kit (the frame request and launch marker around the Stack, the
 * iOS launch bridge beside it).
 */
function testBuildKits({ prepared }: KitDeps): readonly RootKit[] {
  const createDebugKit = TEST_ONLY?.createDebugKit;
  const createParityKit = TEST_ONLY?.createParityKit;
  if (
    prepared.testHooks === null ||
    createDebugKit === undefined ||
    createParityKit === undefined
  ) {
    return [];
  }
  return [createDebugKit(prepared.testHooks), createParityKit()];
}

/** Every optional kit, in the order their providers nest (the first outermost). */
export function createRootKits(input: RootKitsInput): readonly RootKit[] {
  const deps: KitDeps = {
    ...input,
    onError: (error) => {
      input.data.errorLog.record('service', error);
    },
  };
  return [
    crashReportingKit(deps),
    analyticsKit(deps),
    pushKit(deps),
    localNotificationsKit(deps),
    ...testBuildKits(deps),
  ];
}
