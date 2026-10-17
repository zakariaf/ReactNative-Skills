// src/app/_layout.tsx (stand-in): the composition root loads the one composed bank and mounts the
// audio lifecycle once; the crash restart cannot reach the services.
import { reloadAppAsync } from 'expo';
import { useState } from 'react';

import { ARENA_CHASE_SOUNDS } from '@/games/arena-chase/sounds/arena-chase-sounds';
import { TASKS_SOUNDS } from '@/features/tasks/sounds/tasks-sounds';
import { composeSoundBank } from '@/services/audio/compose-sound-bank';
import { useAudioLifecycle } from '@/services/audio/use-audio-lifecycle';
import { createDeviceServices } from '@/services/create-device-services';

export const restartAfterCrash = (): Promise<void> =>
  // audio-dispose-exempt: the root error boundary renders outside the services it would dispose.
  reloadAppAsync('crash-recovery');

function startApp() {
  const services = createDeviceServices();
  services.audio.load(composeSoundBank(TASKS_SOUNDS, ARENA_CHASE_SOUNDS));
  return services;
}

export default function RootLayout(): React.JSX.Element {
  const [services] = useState(startApp);
  useAudioLifecycle({
    audio: services.audio,
    isInterrupted: false,
    reportError: (error) => {
      services.errorLog.record('service', error);
    },
  });
  return <></>;
}
