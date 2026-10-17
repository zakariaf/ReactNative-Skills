// src/services/updates/expo-updates-adapter.ts
// The one file that imports expo-updates (UpdatesPort). Calls never reject here; failures come back
// as values. Two ways the updater is off, both mapped to { kind: 'disabled' }:
// - Updates.isEnabled is false (Expo Go, a build without updates.url, updates.enabled false): every
//   method rejects, so each call asks first.
// - A development build (dev client): isEnabled is TRUE, and checkForUpdateAsync / fetchUpdateAsync
//   reject with code ERR_NOT_AVAILABLE_IN_DEV_CLIENT (DevLauncherAppController.swift,
//   UpdatesDevLauncherController.kt); the JS layer rejects with ERR_UPDATES_DISABLED when __DEV__
//   runs without the dev launcher. Both codes are read from the rejection.
// Verified against expo-updates 57.0.24 (build/Updates.js, ios/, android/) on 2026-10-14.
import * as Updates from 'expo-updates';

import { attemptAsync, err, ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  RunningUpdate,
  UpdateCheck,
  UpdateDownload,
  UpdatesFailure,
  UpdatesPort,
} from '@/services/updates/updates-port';

const DISABLED: UpdatesFailure = { kind: 'disabled' };

/** Rejection codes that mean "no updater here", not a failed network call. */
const DISABLED_CODES: ReadonlySet<unknown> = new Set([
  'ERR_NOT_AVAILABLE_IN_DEV_CLIENT',
  'ERR_UPDATES_DISABLED',
]);

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function isDisabledRejection(thrown: unknown): boolean {
  if (typeof thrown !== 'object' || thrown === null) return false;
  return DISABLED_CODES.has((thrown as { code?: unknown }).code);
}

/** Maps a rejection to `disabled` (a development build) or to the call's own failure. */
function failureOf(
  kind: 'check-failed' | 'download-failed' | 'apply-failed',
): (thrown: unknown) => UpdatesFailure {
  return (thrown) =>
    isDisabledRejection(thrown) ? DISABLED : { kind, message: messageOf(thrown) };
}

function readRunning(): RunningUpdate {
  return {
    updateId: Updates.updateId,
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    emergencyLaunchReason: Updates.emergencyLaunchReason,
  };
}

async function check(): Promise<Result<UpdateCheck, UpdatesFailure>> {
  if (!Updates.isEnabled) return err(DISABLED);
  const result = await attemptAsync(() => Updates.checkForUpdateAsync(), failureOf('check-failed'));
  if (!result.ok) return result;
  if (result.value.isRollBackToEmbedded) return ok('roll-back-to-embedded');
  return ok(result.value.isAvailable ? 'new-update' : 'none');
}

async function download(): Promise<Result<UpdateDownload, UpdatesFailure>> {
  if (!Updates.isEnabled) return err(DISABLED);
  const result = await attemptAsync(() => Updates.fetchUpdateAsync(), failureOf('download-failed'));
  if (!result.ok) return result;
  return ok(result.value.isNew || result.value.isRollBackToEmbedded ? 'ready' : 'nothing-new');
}

async function apply(): Promise<Result<void, UpdatesFailure>> {
  if (!Updates.isEnabled) return err(DISABLED);
  return attemptAsync(() => Updates.reloadAsync(), failureOf('apply-failed'));
}

/** Creates the device UpdatesPort. The composition root calls it once. */
export function createExpoUpdatesAdapter(): UpdatesPort {
  const running = readRunning();
  return { running: () => running, check, download, apply };
}
