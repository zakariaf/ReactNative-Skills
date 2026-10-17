// __mocks__/react-native-audio-api.ts — root manual mock (automatic in every Jest project).
// react-native-audio-api 0.13.6 installs its native module on import ("Failed to install
// react-native-audio-api: The native module could not be found"), so any suite that reaches the
// AudioPort adapter, even through the composition root, would crash. The package ships a JS mock of
// its Web Audio surface; this file re-exports it and completes its AudioManager, which (0.13.6) lacks
// setAudioSessionOptions and observeAudioInterruptions: the adapter calls both before it creates its
// one AudioContext ("setAudioSessionOptions is not a function" otherwise). activelyReclaimSession is
// left out on purpose: the app never calls it. An adapter test that asserts on calls uses
// jest.mock('react-native-audio-api') + jest.requireMock('react-native-audio-api').
export * from 'react-native-audio-api/mock';

/** Plain functions where a value comes back: no mock reset (resetMocks, mockReset) empties them. */
export const AudioManager = {
  getDevicePreferredSampleRate: (): number => 48_000,
  setAudioSessionOptions: jest.fn(),
  observeAudioInterruptions: jest.fn(),
  observeVolumeChanges: jest.fn(),
  addSystemEventListener: (): { readonly remove: () => void } => ({ remove: () => undefined }),
};
