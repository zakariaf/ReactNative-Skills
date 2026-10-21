// src/ui/animation/animation-playback.test.ts
import { MAX_PLAYS, isBoundedPlays, playbackOf } from './animation-playback';

import type { PlaybackInput } from './animation-playback';

const PLAYING: PlaybackInput = {
  isReduceMotion: false,
  isActive: true,
  isAppActive: true,
  hasSlot: true,
  isDone: false,
};

describe('playbackOf', () => {
  it('plays when nothing asks for stillness', () => {
    expect(playbackOf(PLAYING)).toBe('play');
  });

  it.each([
    ['reduce motion is on (or a test build holds motion still)', { isReduceMotion: true }],
    ['the screen is not focused', { isActive: false }],
    ['the app is in the background', { isAppActive: false }],
    ['another heavy moment holds the stage', { hasSlot: false }],
    ['every play has been used', { isDone: true }],
  ])('holds the still frame when %s', (_reason, change: Partial<PlaybackInput>) => {
    expect(playbackOf({ ...PLAYING, ...change })).toBe('still');
  });
});

describe('isBoundedPlays', () => {
  it('accepts a one-shot up to the library ceiling', () => {
    expect(isBoundedPlays(1)).toBe(true);
    expect(isBoundedPlays(MAX_PLAYS)).toBe(true);
  });

  it('refuses an endless, a fractional or an empty play count', () => {
    expect(isBoundedPlays(MAX_PLAYS + 1)).toBe(false);
    expect(isBoundedPlays(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isBoundedPlays(1.5)).toBe(false);
    expect(isBoundedPlays(0)).toBe(false);
  });
});
