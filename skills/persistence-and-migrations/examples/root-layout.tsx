// src/app/_layout.tsx: the persistence part of an Expo Router root layout (imitate, do not copy).
// Every import is a template of this skill. app-startup-and-bootstrap owns the full startup order
// (polyfills, the error net, reload decisions) and architecture-and-boundaries the composition root:
// with its createDeviceServices, pass those services to openDeviceData instead of creating them here.
import { Stack } from 'expo-router';
import { useState } from 'react';

import { AppDataProvider } from '@/data/app-data-context';
import { openDeviceData } from '@/data/open-device-database';
import { useCheckpointOnBackground } from '@/data/use-checkpoint-on-background';
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';

import type { AppData } from '@/data/app-data-context';

/**
 * Runs once, synchronously, on the first render: after every decision that can reload the
 * JavaScript runtime (direction, update), before the first screen. Never at import time: module
 * code runs again after a reload, and an import-time open runs before those decisions. The memory
 * log comes first, so it records the open itself and takes what the SQLite log cannot.
 */
function openOnce(): AppData {
  const clock = createSystemClockAdapter();
  return openDeviceData({ clock, errorLog: createMemoryErrorLogAdapter({ clock }) });
}

export default function RootLayout(): React.JSX.Element {
  const [data] = useState(openOnce);
  useCheckpointOnBackground(data.database);
  // The first screen reads useAppData().database: when isPersistent is false (newer-version,
  // unversioned, migration-failed, storage-full, unreadable) it says once that changes will not be
  // kept. data.database is only that status: the driver never leaves the data layer.
  return (
    <AppDataProvider data={data}>
      <Stack />
    </AppDataProvider>
  );
}
