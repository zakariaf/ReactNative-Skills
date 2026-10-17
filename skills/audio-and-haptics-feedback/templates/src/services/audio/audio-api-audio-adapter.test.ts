// src/services/audio/audio-api-audio-adapter.test.ts
import { UI_SOUNDS } from '@/services/audio/synth/ui-sounds';

import { createAudioApiAudioAdapter } from './audio-api-audio-adapter';
import { DEFAULT_AUDIO_SETTINGS } from './audio-port';

// The root manual mock (__mocks__/react-native-audio-api.ts) wraps the library's own mock and adds
// the AudioManager methods it lacks. jest.mock + requireMock read the same instance.
jest.mock('react-native-audio-api');

type SourceMethods = { start: (when?: number) => void; stop: (when?: number) => void };
type InterruptionEvent = { readonly type: 'began' | 'ended'; readonly shouldResume: boolean };
type InterruptionListener = (event: InterruptionEvent) => void;
type AudioApiMock = {
  readonly AudioManager: {
    readonly setAudioSessionOptions: jest.Mock;
    readonly observeAudioInterruptions: jest.Mock;
    addSystemEventListener: (
      name: string,
      listener: InterruptionListener,
    ) => { remove: () => void };
  };
  readonly AudioBufferSourceNode: { readonly prototype: SourceMethods };
  readonly AudioContext: {
    readonly prototype: { suspend: () => Promise<void>; resume: () => Promise<void> };
  };
};

const { AudioContext, AudioManager, AudioBufferSourceNode } =
  jest.requireMock<AudioApiMock>('react-native-audio-api');

const TOGGLE_BANK = { 'ui.toggle': { category: 'ui', recipe: UI_SOUNDS['ui.toggle'] } } as const;

describe('createAudioApiAudioAdapter', () => {
  it('loads a bank, plays, schedules, cancels and disposes without throwing', async () => {
    const audio = createAudioApiAudioAdapter({ reportError: jest.fn() });
    audio.load(TOGGLE_BANK);
    audio.applySettings(DEFAULT_AUDIO_SETTINGS);
    audio.play('ui.toggle');
    audio.play('ui.toggle', 120);
    audio.play('unknown-id');
    audio.cancelPending();
    await audio.suspend();
    await audio.resume();
    await expect(audio.dispose()).resolves.toBeUndefined();
  });

  it('sets the ambient session before it creates the context, and observes iOS interruptions', () => {
    const audio = createAudioApiAudioAdapter({ reportError: jest.fn() });
    audio.load({});
    expect(AudioManager.setAudioSessionOptions).toHaveBeenCalledWith({
      iosCategory: 'ambient',
      iosMode: 'default',
      iosOptions: [],
    });
    expect(AudioManager.observeAudioInterruptions).toHaveBeenCalledWith(true);
  });

  it('stops cancelled cues and frees them, so the next action can schedule the sound again', () => {
    const start = jest.spyOn(AudioBufferSourceNode.prototype, 'start');
    const stop = jest.spyOn(AudioBufferSourceNode.prototype, 'stop');
    const audio = createAudioApiAudioAdapter({ reportError: jest.fn() });
    audio.load(TOGGLE_BANK);
    audio.play('ui.toggle', 300);
    audio.play('ui.toggle', 300); // the same start again: dropped by the repeat rule
    audio.cancelPending();
    audio.play('ui.toggle', 300);
    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('plays music once, loops it, and stops it', () => {
    const start = jest.spyOn(AudioBufferSourceNode.prototype, 'start');
    const stop = jest.spyOn(AudioBufferSourceNode.prototype, 'stop');
    const audio = createAudioApiAudioAdapter({ reportError: jest.fn() });
    audio.load({ theme: { category: 'music', recipe: UI_SOUNDS['ui.toggle'], isLoop: true } });
    audio.startMusic('theme');
    audio.startMusic('theme');
    audio.stopMusic();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('records a failed suspend instead of rejecting', async () => {
    const reportError = jest.fn();
    const audio = createAudioApiAudioAdapter({ reportError });
    audio.load({});
    jest.spyOn(AudioContext.prototype, 'suspend').mockRejectedValueOnce(new Error('busy'));
    await expect(audio.suspend()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(new Error('busy'));
  });

  it('resumes after an interruption only while the lifecycle wants audio running', async () => {
    const listeners: InterruptionListener[] = [];
    jest.spyOn(AudioManager, 'addSystemEventListener').mockImplementation((_name, listener) => {
      listeners.push(listener);
      return { remove: () => undefined };
    });
    const resume = jest.spyOn(AudioContext.prototype, 'resume');
    const audio = createAudioApiAudioAdapter({ reportError: jest.fn() });
    audio.load({});
    const [onInterruption] = listeners;
    if (onInterruption === undefined) throw new Error('no interruption listener');

    onInterruption({ type: 'began', shouldResume: false });
    onInterruption({ type: 'ended', shouldResume: true });
    expect(resume).toHaveBeenCalledTimes(1);

    // A full-screen video suspends feedback; a call that ends during it must not bring it back.
    await audio.suspend();
    onInterruption({ type: 'began', shouldResume: false });
    onInterruption({ type: 'ended', shouldResume: true });
    expect(resume).toHaveBeenCalledTimes(1);

    await audio.resume();
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('ignores play, music and settings calls before anything is loaded', async () => {
    const audio = createAudioApiAudioAdapter({ reportError: jest.fn() });
    audio.play('ui.toggle');
    audio.startMusic('ui.toggle');
    audio.applySettings(DEFAULT_AUDIO_SETTINGS);
    audio.stopMusic();
    await expect(audio.dispose()).resolves.toBeUndefined();
  });
});
