// src/config/audio-plugin.test.ts
import { AUDIO_API_PLUGIN } from './audio-plugin';

describe('AUDIO_API_PLUGIN', () => {
  it('overrides every default that adds background audio, permissions or downloads', () => {
    expect(AUDIO_API_PLUGIN).toStrictEqual([
      'react-native-audio-api',
      {
        iosBackgroundMode: false,
        androidPermissions: [],
        androidForegroundService: false,
        disableFFmpeg: true,
        disableStaticExternalLibs: true,
      },
    ]);
  });
});
