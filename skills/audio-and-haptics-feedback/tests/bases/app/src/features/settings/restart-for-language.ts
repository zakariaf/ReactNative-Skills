// src/features/settings/restart-for-language.ts (stand-in): a language change restarts the bundle.
import { reloadAppAsync } from 'expo';

import type { AudioPort } from '@/services/audio/audio-port';

export async function restartForLanguage(audio: AudioPort): Promise<void> {
  await audio.dispose();
  await reloadAppAsync('language');
}
