// src/services/perf/expo-perf-adapter.ts
// device-only: covered by the simulator and emulator cold-start runs (check-perf-report.mjs --sim-baseline judges the nativeMs it measures) and the debug menu's share action.
import { requireOptionalNativeModule } from 'expo';
import * as Application from 'expo-application';
import { Platform, Share } from 'react-native';

import { attemptAsync } from '@/core/result';

import type { PerfReportHeader } from '@/core/perf/perf-entry';
import type { PerfPort, PerfShareFailure } from '@/services/perf/perf-port';

/** The local Expo module in modules/process-start (iOS: sysctl; Android: Process start elapsed time). */
type ProcessStartModule = {
  getProcessStartEpochMs(): number;
  wasPrewarmed(): boolean;
  getDeviceModel(): string;
};

const UNKNOWN = 'unknown';

/**
 * The installed binary's identity, read natively by expo-application: right under EAS remote
 * versioning and autoIncrement, where the app config's buildNumber/versionCode are not what shipped.
 */
function readHeader(processStart: ProcessStartModule | null): PerfReportHeader {
  return {
    appId: Application.applicationId ?? UNKNOWN,
    appVersion: Application.nativeApplicationVersion ?? UNKNOWN,
    buildNumber: Application.nativeBuildVersion ?? UNKNOWN,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    deviceModel: processStart?.getDeviceModel() ?? UNKNOWN,
  };
}

/** Creates the device PerfPort. Called once, by the composition root (createDeviceServices). */
export function createExpoPerfAdapter(): PerfPort {
  const processStart = requireOptionalNativeModule<ProcessStartModule>('ProcessStart');
  return {
    epochMs: () => Date.now(),
    highResMs: () => performance.now(),
    processStartEpochMs: () => {
      const value = processStart?.getProcessStartEpochMs();
      return value === undefined || value <= 0 ? null : value;
    },
    wasPrewarmed: () => processStart?.wasPrewarmed() ?? false,
    header: () => readHeader(processStart),
    shareReport: (json) =>
      attemptAsync(
        async () => {
          await Share.share({ message: json });
        },
        (): PerfShareFailure => ({ kind: 'perf-share-failed' }),
      ),
  };
}
