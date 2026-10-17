// src/app/_layout.tsx
import '@/services/error-net/install-error-net';

import { useState } from 'react';

import { openDeviceWebStorage } from '@/data/open-device-web-storage';
import { AppRoot } from '@/features/root-navigator/app-root';
import { WebStorageGate } from '@/features/root-navigator/web-storage-gate';
import { WebStorageNotice } from '@/features/root-navigator/web-storage-notice';
import { DirectionGate } from '@/i18n/direction-gate';
import { createDeviceServices } from '@/services/create-device-services';
import { appErrorNet } from '@/services/error-net/app-error-net';

function reportWarmUpFailure(error: unknown): void {
  appErrorNet.report({ source: 'render', error, isFatal: false });
}

export default function RootLayout(): React.JSX.Element {
  const [services] = useState(createDeviceServices);
  const [storageWarmUp] = useState(openDeviceWebStorage);
  return (
    <WebStorageGate
      warmUp={storageWarmUp}
      onError={reportWarmUpFailure}
      inUseElsewhere={<WebStorageNotice reason="in-use-elsewhere" titleKey="web.other-tab.title" bodyKey="web.other-tab.body" onMessageError={reportWarmUpFailure} />}
      unsupported={<WebStorageNotice reason="unsupported" titleKey="web.unsupported.title" bodyKey="web.unsupported.body" onMessageError={reportWarmUpFailure} />}
    >
      <DirectionGate guard={services.directionGuard}>
        <AppRoot services={services} />
      </DirectionGate>
    </WebStorageGate>
  );
}
