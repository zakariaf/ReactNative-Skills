// src/services/audio/audio-api-audio-adapter.android.test.ts
// Runs in the android Jest project (jest-expo/android): the adapter reads the real Platform. On
// Android, observeAudioInterruptions(true) requests AUDIOFOCUS_GAIN (react-native-audio-api 0.13.6,
// AudioAPIModule.kt), which fades out and mutes the user's music, so the adapter never calls it there.
import { createAudioApiAudioAdapter } from './audio-api-audio-adapter';

jest.mock('react-native-audio-api');

type AudioManagerMock = {
  readonly observeAudioInterruptions: jest.Mock;
  readonly addSystemEventListener: (name: string) => { readonly remove: () => void };
};

const { AudioManager } = jest.requireMock<{ readonly AudioManager: AudioManagerMock }>(
  'react-native-audio-api',
);

describe('createAudioApiAudioAdapter on Android', () => {
  it('takes no audio focus, yet still listens for interruptions', () => {
    const listen = jest.spyOn(AudioManager, 'addSystemEventListener');
    const audio = createAudioApiAudioAdapter({ reportError: jest.fn() });
    audio.load({});
    expect(AudioManager.observeAudioInterruptions).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith('interruption', expect.any(Function));
  });
});
